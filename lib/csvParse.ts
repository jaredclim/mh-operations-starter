/**
 * Tolerant CSV / TSV parser for the Leads bulk-import flow. Handles:
 *   - Comma- or tab-separated values (auto-detected by header line)
 *   - Quoted values (including newlines inside quotes for notes)
 *   - Escaped quotes ("" inside a quoted value)
 *   - Trailing CR
 *
 * Returns: { headers: string[], rows: string[][] }.
 *
 * Designed for DripJobs Contacts exports + similar CRM exports but
 * works on any standard CSV/TSV.
 */

export interface ParsedCsv {
  headers: string[];
  rows: string[][];
  delimiter: "," | "\t";
}

export function parseCsv(input: string): ParsedCsv {
  const text = input.replace(/^﻿/, ""); // strip BOM
  const firstLine = text.split(/\r?\n/, 1)[0] || "";
  const tabCount = (firstLine.match(/\t/g) || []).length;
  const commaCount = (firstLine.match(/,/g) || []).length;
  const delimiter: "," | "\t" = tabCount > commaCount ? "\t" : ",";

  const allRows = splitRows(text, delimiter);
  if (allRows.length === 0) return { headers: [], rows: [], delimiter };
  const headers = allRows[0].map((h) => h.trim());
  const rows = allRows.slice(1).filter((r) => r.some((c) => c.trim() !== ""));
  return { headers, rows, delimiter };
}

function splitRows(text: string, delim: "," | "\t"): string[][] {
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      continue;
    }
    if (c === delim) {
      cur.push(field);
      field = "";
      continue;
    }
    if (c === "\r") continue;
    if (c === "\n") {
      cur.push(field);
      rows.push(cur);
      cur = [];
      field = "";
      continue;
    }
    field += c;
  }
  if (field !== "" || cur.length > 0) {
    cur.push(field);
    rows.push(cur);
  }
  return rows;
}

/**
 * Smart auto-mapping from common CRM export header names → our Lead
 * schema fields. Works for DripJobs, GHL, Jobber, generic CSVs.
 * Returns suggested mapping that the UI can override.
 */
export interface ColumnMapping {
  name?: number;
  firstName?: number;
  lastName?: number;
  phone?: number;
  email?: number;
  address?: number;
  city?: number;
  leadSource?: number;
  stage?: number;
  notes?: number;
  firstInquiryDate?: number;
  dripJobsLink?: number;
}

const HEADER_HINTS: Record<keyof ColumnMapping, RegExp[]> = {
  name: [/^name$/i, /^contact name$/i, /^client name$/i, /^full name$/i, /^customer name$/i],
  firstName: [/^first.?name$/i, /^firstname$/i, /^fname$/i, /^first$/i],
  lastName: [/^last.?name$/i, /^lastname$/i, /^lname$/i, /^surname$/i, /^last$/i],
  phone: [/^phone$/i, /^mobile$/i, /^cell$/i, /^phone.*number$/i, /^primary.*phone$/i, /^contact.*phone$/i],
  email: [/^email$/i, /^e.?mail$/i, /^email.*address$/i, /^primary.*email$/i, /^contact.*email$/i],
  address: [/^address$/i, /^street$/i, /^street address$/i, /^address.*1$/i, /^address.*line.*1$/i, /^property address$/i],
  city: [/^city$/i, /^town$/i, /^municipality$/i],
  leadSource: [/^lead.?source$/i, /^source$/i, /^how.*hear/i, /^channel$/i],
  stage: [/^stage$/i, /^status$/i, /^lead.?stage$/i, /^lead.?status$/i, /^pipeline.?stage$/i],
  notes: [/^notes?$/i, /^description$/i, /^comments?$/i, /^message$/i, /^details$/i],
  firstInquiryDate: [/^date.?created$/i, /^created$/i, /^created.?at$/i, /^inquiry.?date$/i, /^lead.?date$/i, /^first.?contact$/i],
  dripJobsLink: [/^link$/i, /^url$/i, /^dripjobs/i, /^crm.?link$/i, /^profile$/i],
};

export function autoMap(headers: string[]): ColumnMapping {
  const mapping: ColumnMapping = {};
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i].trim();
    for (const [field, patterns] of Object.entries(HEADER_HINTS) as [keyof ColumnMapping, RegExp[]][]) {
      if (mapping[field] != null) continue;
      if (patterns.some((p) => p.test(h))) {
        mapping[field] = i;
        break;
      }
    }
  }
  return mapping;
}

/** Apply a column mapping to a raw row → a structured lead input. */
export interface MappedLead {
  name: string;
  phone?: string;
  email?: string;
  address?: string;
  leadSource?: string;
  stage?:
    | "New"
    | "Attempted contact"
    | "Callback requested"
    | "Estimate booked"
    | "Long-term hold";
  firstInquiryDate?: string;
  notes?: string;
  dripJobsLink?: string;
}

export function applyMapping(row: string[], headers: string[], mapping: ColumnMapping): MappedLead {
  const get = (idx: number | undefined): string => (idx != null && idx >= 0 && idx < row.length ? (row[idx] || "").trim() : "");

  // Compose name from first+last if no single Name column
  let name = get(mapping.name);
  if (!name) {
    const first = get(mapping.firstName);
    const last = get(mapping.lastName);
    name = [first, last].filter(Boolean).join(" ").trim();
  }

  // Compose address with city if separate
  let address = get(mapping.address);
  const city = get(mapping.city);
  if (city && address && !address.toLowerCase().includes(city.toLowerCase())) {
    address = `${address}, ${city}`;
  } else if (city && !address) {
    address = city;
  }

  return {
    name,
    phone: get(mapping.phone) || undefined,
    email: get(mapping.email) || undefined,
    address: address || undefined,
    leadSource: get(mapping.leadSource) || undefined,
    stage: normalizeImportStage(get(mapping.stage)),
    firstInquiryDate: normalizeImportDate(get(mapping.firstInquiryDate)),
    notes: get(mapping.notes) || undefined,
    dripJobsLink: get(mapping.dripJobsLink) || undefined,
  };
}

function normalizeImportStage(raw: string): MappedLead["stage"] {
  const t = raw.trim().toLowerCase();
  if (!t) return undefined;
  if (/new|fresh|just.?came|unread/.test(t)) return "New";
  if (/attempt|trying|reached|tried|no.?reply|no.?answer/.test(t)) return "Attempted contact";
  if (/callback|call.?back/.test(t)) return "Callback requested";
  if (/estimate.?booked|booked|scheduled|appointment|on.?the.?books/.test(t)) return "Estimate booked";
  if (/long.?term|hold|next.?year|future|cold/.test(t)) return "Long-term hold";
  return "New";
}

function normalizeImportDate(raw: string): string | undefined {
  const t = raw.trim();
  if (!t) return undefined;
  // Try ISO yyyy-mm-dd first
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10);
  // Try m/d/yyyy or m/d/yy
  const us = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (us) {
    let [, mm, dd, yyyy] = us;
    if (yyyy.length === 2) yyyy = (parseInt(yyyy, 10) > 50 ? "19" : "20") + yyyy;
    return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
  }
  // Try Date.parse fallback
  const d = new Date(t);
  if (!isNaN(d.getTime())) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  return undefined;
}
