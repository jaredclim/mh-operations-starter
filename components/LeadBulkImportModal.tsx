"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { X, Upload, CheckCircle2, AlertCircle, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { LEAD_SOURCES, LEAD_STAGES } from "@/lib/types";
import { parseCsv, autoMap, applyMapping, type ColumnMapping, type MappedLead } from "@/lib/csvParse";

interface Props {
  open: boolean;
  onClose: () => void;
}

type Step = "paste" | "map" | "preview" | "result";

/**
 * Bulk-import flow for CC Leads. Three steps:
 *   1. Paste — paste CSV/TSV (DripJobs export or similar)
 *   2. Map — auto-detected column mapping, user-adjustable
 *   3. Preview — first 10 rows shown as they'll import + override
 *      default stage / source for the whole batch
 *   4. Result — created / skipped / errors
 *
 * Designed for ANY franchisee using this dashboard — works with
 * generic CSV/TSV not just DripJobs exports.
 */
export function LeadBulkImportModal({ open, onClose }: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [step, setStep] = useState<Step>("paste");
  const [raw, setRaw] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [defaultStage, setDefaultStage] = useState<"New" | "Attempted contact" | "Callback requested" | "Estimate booked" | "Long-term hold">("New");
  const [defaultSource, setDefaultSource] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ created: number; skipped: number; errors: string[] } | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);

  function reset() {
    setStep("paste");
    setRaw("");
    setHeaders([]);
    setRows([]);
    setMapping({});
    setDefaultStage("New");
    setDefaultSource("");
    setResult(null);
    setParseError(null);
  }

  function close() {
    reset();
    onClose();
  }

  function parsePaste() {
    setParseError(null);
    try {
      const { headers: h, rows: r } = parseCsv(raw);
      if (h.length === 0 || r.length === 0) {
        setParseError("Couldn't find any rows. First line should be the header (e.g. Name, Phone, Email, …).");
        return;
      }
      setHeaders(h);
      setRows(r);
      setMapping(autoMap(h));
      setStep("map");
    } catch (e) {
      setParseError(e instanceof Error ? e.message : "Parse failed.");
    }
  }

  const mappedPreview = useMemo<MappedLead[]>(() => {
    if (rows.length === 0) return [];
    return rows.slice(0, 50).map((row) => applyMapping(row, headers, mapping));
  }, [rows, headers, mapping]);

  const validCount = useMemo(
    () => rows.filter((r) => applyMapping(r, headers, mapping).name).length,
    [rows, headers, mapping]
  );

  async function doImport() {
    setBusy(true);
    try {
      const payload = rows.map((r) => {
        const m = applyMapping(r, headers, mapping);
        return {
          ...m,
          // Apply batch defaults if not present on the row
          stage: m.stage || defaultStage,
          leadSource: m.leadSource || defaultSource || undefined,
        };
      }).filter((m) => m.name && m.name.trim());

      const res = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "bulk-create", rows: payload }),
      });
      const json = await res.json();
      if (!json.ok) {
        setResult({ created: 0, skipped: 0, errors: [json.error || "Import failed."] });
      } else {
        setResult(json.result);
      }
      setStep("result");
      startTransition(() => router.refresh());
    } catch (e) {
      setResult({
        created: 0,
        skipped: 0,
        errors: [e instanceof Error ? e.message : "Network error."],
      });
      setStep("result");
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={close}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-4xl max-h-[90vh] bg-white rounded-2xl shadow-2xl border border-border overflow-hidden flex flex-col"
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-border bg-cc-navy text-white">
          <div>
            <h2 className="text-base font-bold flex items-center gap-2">
              <Upload className="w-4 h-4" />
              Bulk import leads
            </h2>
            <div className="text-[11px] text-white/60 mt-0.5">{stepLabel(step)}</div>
          </div>
          <button type="button" onClick={close} className="text-white/70 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Step bar */}
        <div className="flex border-b border-border bg-zinc-50 text-[11px]">
          {(["paste", "map", "preview", "result"] as Step[]).map((s, i) => (
            <div
              key={s}
              className={cn(
                "flex-1 py-2 px-3 text-center font-semibold tracking-wide uppercase",
                step === s ? "bg-white text-cc-navy border-b-2 border-cc-accent" : "text-text-muted"
              )}
            >
              {i + 1}. {s}
            </div>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto">
          {step === "paste" && (
            <PasteStep
              raw={raw}
              setRaw={setRaw}
              onParse={parsePaste}
              error={parseError}
            />
          )}
          {step === "map" && (
            <MapStep
              headers={headers}
              rows={rows}
              mapping={mapping}
              setMapping={setMapping}
              validCount={validCount}
              onBack={() => setStep("paste")}
              onNext={() => setStep("preview")}
            />
          )}
          {step === "preview" && (
            <PreviewStep
              preview={mappedPreview}
              totalRows={rows.length}
              validCount={validCount}
              defaultStage={defaultStage}
              setDefaultStage={setDefaultStage}
              defaultSource={defaultSource}
              setDefaultSource={setDefaultSource}
              busy={busy}
              onBack={() => setStep("map")}
              onImport={doImport}
            />
          )}
          {step === "result" && result && (
            <ResultStep result={result} onClose={close} onAgain={reset} />
          )}
        </div>
      </div>
    </div>
  );
}

function stepLabel(s: Step): string {
  switch (s) {
    case "paste":
      return "Paste your CSV / TSV export";
    case "map":
      return "Confirm column mapping";
    case "preview":
      return "Preview and pick batch defaults";
    case "result":
      return "Import complete";
  }
}

function PasteStep({
  raw,
  setRaw,
  onParse,
  error,
}: {
  raw: string;
  setRaw: (s: string) => void;
  onParse: () => void;
  error: string | null;
}) {
  return (
    <div className="p-5 space-y-3">
      <div className="bg-zinc-50 border border-border rounded-lg p-3 text-sm text-text-secondary leading-relaxed">
        <div className="font-semibold text-text-primary mb-1">How to import</div>
        <ol className="list-decimal pl-5 space-y-0.5 text-[13px]">
          <li>Export your leads from DripJobs (or any CRM) as CSV.</li>
          <li>Open the file, select all rows including the header, copy.</li>
          <li>Paste into the box below.</li>
          <li>We&apos;ll auto-detect the columns and let you adjust before importing.</li>
        </ol>
        <div className="mt-2 text-[12px] text-text-muted">
          Existing leads (matched by phone, email, or name+address) are skipped automatically. Safe to re-run.
        </div>
      </div>
      <textarea
        value={raw}
        onChange={(e) => setRaw(e.target.value)}
        placeholder={`Paste your CSV here. Example:\n\nName,Phone,Email,Address,Lead Source\nJane Doe,604-555-0100,jane@example.com,123 Main St,Google\nJohn Smith,604-555-0101,john@example.com,456 Oak Ave,Referral`}
        rows={14}
        className="w-full px-3 py-2 text-[12px] font-mono rounded-lg border border-border focus:outline-none focus:ring-2 focus:ring-cc-accent"
      />
      {error && (
        <div className="text-sm text-cc-danger flex items-start gap-2">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          {error}
        </div>
      )}
      <div className="flex justify-end">
        <button
          type="button"
          onClick={onParse}
          disabled={!raw.trim()}
          className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold bg-cc-navy text-white rounded-lg hover:bg-cc-navy-deep disabled:opacity-50 transition"
        >
          Parse paste
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

function MapStep({
  headers,
  rows,
  mapping,
  setMapping,
  validCount,
  onBack,
  onNext,
}: {
  headers: string[];
  rows: string[][];
  mapping: ColumnMapping;
  setMapping: (m: ColumnMapping) => void;
  validCount: number;
  onBack: () => void;
  onNext: () => void;
}) {
  const fields: Array<{ key: keyof ColumnMapping; label: string; required?: boolean; hint?: string }> = [
    { key: "name", label: "Name", required: true, hint: "Or use First name + Last name below" },
    { key: "firstName", label: "First name" },
    { key: "lastName", label: "Last name" },
    { key: "phone", label: "Phone" },
    { key: "email", label: "Email" },
    { key: "address", label: "Address" },
    { key: "city", label: "City (appended to address)" },
    { key: "leadSource", label: "Lead source" },
    { key: "stage", label: "Stage" },
    { key: "notes", label: "Notes" },
    { key: "firstInquiryDate", label: "First inquiry date" },
    { key: "dripJobsLink", label: "DripJobs / CRM link" },
  ];

  function updateField(key: keyof ColumnMapping, idx: number) {
    setMapping({ ...mapping, [key]: idx === -1 ? undefined : idx });
  }

  const nameOk = mapping.name != null || (mapping.firstName != null || mapping.lastName != null);

  return (
    <div className="p-5 space-y-4">
      <div className="text-sm text-text-secondary">
        Found <span className="font-bold text-text-primary">{rows.length}</span> rows and{" "}
        <span className="font-bold text-text-primary">{headers.length}</span> columns. Auto-matched what we could — adjust as needed.
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {fields.map((f) => (
          <label key={f.key} className="block">
            <div className="text-[11px] font-bold uppercase tracking-wide text-text-muted mb-1">
              {f.label} {f.required && <span className="text-cc-danger">*</span>}
            </div>
            <select
              value={mapping[f.key] ?? -1}
              onChange={(e) => updateField(f.key, parseInt(e.target.value, 10))}
              className="w-full px-2 py-1.5 text-sm rounded-md border border-border focus:outline-none focus:ring-2 focus:ring-cc-accent bg-white"
            >
              <option value={-1}>— Not mapped —</option>
              {headers.map((h, i) => (
                <option key={i} value={i}>
                  {h || `Column ${i + 1}`}
                </option>
              ))}
            </select>
            {f.hint && <div className="text-[10px] text-text-muted mt-0.5">{f.hint}</div>}
          </label>
        ))}
      </div>
      <div className="bg-zinc-50 border border-border rounded-lg p-3 text-[12px] text-text-secondary">
        {nameOk ? (
          <>
            <span className="font-semibold text-emerald-700">{validCount}</span> of {rows.length} rows have a name and will import.
            {rows.length - validCount > 0 && ` ${rows.length - validCount} will be skipped (no name).`}
          </>
        ) : (
          <span className="text-cc-danger font-semibold">Map Name (or First + Last) to continue.</span>
        )}
      </div>
      <div className="flex justify-between">
        <button onClick={onBack} className="text-sm text-text-secondary hover:text-text-primary">
          ← Back
        </button>
        <button
          onClick={onNext}
          disabled={!nameOk || validCount === 0}
          className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold bg-cc-navy text-white rounded-lg hover:bg-cc-navy-deep disabled:opacity-50 transition"
        >
          Preview
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

function PreviewStep({
  preview,
  totalRows,
  validCount,
  defaultStage,
  setDefaultStage,
  defaultSource,
  setDefaultSource,
  busy,
  onBack,
  onImport,
}: {
  preview: MappedLead[];
  totalRows: number;
  validCount: number;
  defaultStage: "New" | "Attempted contact" | "Callback requested" | "Estimate booked" | "Long-term hold";
  setDefaultStage: (s: "New" | "Attempted contact" | "Callback requested" | "Estimate booked" | "Long-term hold") => void;
  defaultSource: string;
  setDefaultSource: (s: string) => void;
  busy: boolean;
  onBack: () => void;
  onImport: () => void;
}) {
  return (
    <div className="p-5 space-y-4">
      {/* Batch defaults */}
      <div className="bg-zinc-50 border border-border rounded-lg p-3 space-y-2">
        <div className="text-[11px] font-bold uppercase tracking-wide text-text-muted">
          Batch defaults (applied when the row doesn&apos;t have its own)
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label>
            <div className="text-[11px] font-semibold text-text-secondary mb-0.5">Default stage</div>
            <select
              value={defaultStage}
              onChange={(e) => setDefaultStage(e.target.value as typeof defaultStage)}
              className="w-full px-2 py-1.5 text-sm rounded-md border border-border bg-white focus:outline-none focus:ring-2 focus:ring-cc-accent"
            >
              {LEAD_STAGES.filter((s) => s !== "Lost").map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label>
            <div className="text-[11px] font-semibold text-text-secondary mb-0.5">Default lead source</div>
            <select
              value={defaultSource}
              onChange={(e) => setDefaultSource(e.target.value)}
              className="w-full px-2 py-1.5 text-sm rounded-md border border-border bg-white focus:outline-none focus:ring-2 focus:ring-cc-accent"
            >
              <option value="">— Use row value or &quot;Other&quot; —</option>
              {LEAD_SOURCES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="text-sm text-text-secondary">
        Showing first <span className="font-bold text-text-primary">{Math.min(preview.length, 50)}</span> rows. Total importable:{" "}
        <span className="font-bold text-emerald-700">{validCount}</span>
        {totalRows - validCount > 0 && (
          <span className="text-text-muted"> · {totalRows - validCount} will be skipped (missing name)</span>
        )}
      </div>

      <div className="border border-border rounded-lg overflow-hidden">
        <div className="max-h-[40vh] overflow-y-auto">
          <table className="w-full text-[12px]">
            <thead className="bg-zinc-50 sticky top-0">
              <tr>
                <th className="text-left px-3 py-2 font-semibold text-text-secondary">Name</th>
                <th className="text-left px-3 py-2 font-semibold text-text-secondary">Phone</th>
                <th className="text-left px-3 py-2 font-semibold text-text-secondary">Email</th>
                <th className="text-left px-3 py-2 font-semibold text-text-secondary">Address</th>
                <th className="text-left px-3 py-2 font-semibold text-text-secondary">Source</th>
                <th className="text-left px-3 py-2 font-semibold text-text-secondary">Stage</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {preview.slice(0, 50).map((p, i) => (
                <tr key={i} className={cn(!p.name && "opacity-40")}>
                  <td className="px-3 py-1.5 font-semibold text-text-primary">{p.name || <em className="text-text-muted">(no name — skipped)</em>}</td>
                  <td className="px-3 py-1.5 text-text-secondary">{p.phone || "—"}</td>
                  <td className="px-3 py-1.5 text-text-secondary truncate max-w-[200px]">{p.email || "—"}</td>
                  <td className="px-3 py-1.5 text-text-secondary truncate max-w-[200px]">{p.address || "—"}</td>
                  <td className="px-3 py-1.5 text-text-secondary">{p.leadSource || <span className="text-text-muted italic">{defaultSource || "Other"}</span>}</td>
                  <td className="px-3 py-1.5 text-text-secondary">{p.stage || <span className="text-text-muted italic">{defaultStage}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex justify-between">
        <button onClick={onBack} disabled={busy} className="text-sm text-text-secondary hover:text-text-primary disabled:opacity-50">
          ← Back
        </button>
        <button
          onClick={onImport}
          disabled={busy || validCount === 0}
          className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold bg-cc-navy text-white rounded-lg hover:bg-cc-navy-deep disabled:opacity-50 transition"
        >
          {busy ? `Importing ${validCount} leads…` : `Import ${validCount} leads`}
          {!busy && <ArrowRight className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );
}

function ResultStep({
  result,
  onClose,
  onAgain,
}: {
  result: { created: number; skipped: number; errors: string[] };
  onClose: () => void;
  onAgain: () => void;
}) {
  return (
    <div className="p-5 space-y-3">
      <div className="flex items-start gap-3 p-4 bg-emerald-50 border border-emerald-200 rounded-lg">
        <CheckCircle2 className="w-6 h-6 text-emerald-700 shrink-0 mt-0.5" />
        <div>
          <div className="text-lg font-bold text-emerald-900">
            {result.created} lead{result.created === 1 ? "" : "s"} imported
          </div>
          <div className="text-sm text-emerald-800 mt-0.5">
            {result.skipped > 0 && <>{result.skipped} skipped (duplicate phone/email/address)</>}
          </div>
        </div>
      </div>

      {result.errors.length > 0 && (
        <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg">
          <div className="text-sm font-bold text-rose-900 mb-1">
            {result.errors.length} error{result.errors.length === 1 ? "" : "s"}
          </div>
          <ul className="text-[12px] text-rose-800 list-disc pl-4 space-y-0.5 max-h-32 overflow-y-auto">
            {result.errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex justify-between pt-2">
        <button onClick={onAgain} className="text-sm font-semibold text-text-secondary hover:text-text-primary">
          Import another batch
        </button>
        <button
          onClick={onClose}
          className="px-4 py-2 text-sm font-semibold bg-cc-navy text-white rounded-lg hover:bg-cc-navy-deep transition"
        >
          Done
        </button>
      </div>
    </div>
  );
}
