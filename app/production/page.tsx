import { fetchProduction } from "@/lib/sheets";
import { formatCurrency } from "@/lib/utils";

export const revalidate = 300;

export default async function ProductionPage() {
  const jobs = await fetchProduction();
  return (
    <main className="max-w-7xl mx-auto p-6">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-mh-walnut">Production</h1>
        <p className="text-sm text-text-secondary">Booked commissions in build, with target ship dates.</p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {jobs.map((j) => (
          <article key={j.id} className="rounded-lg bg-surface border border-border p-4">
            <div className="flex items-start justify-between mb-2">
              <h3 className="font-semibold text-text-primary">{j.name}</h3>
              <span className="text-sm font-semibold text-mh-mahogany">{formatCurrency(j.bookedValue)}</span>
            </div>
            <p className="text-xs text-text-muted mb-2">{j.status} &middot; {j.woodSpecies} &middot; {j.finishType}</p>
            <p className="text-sm text-text-secondary">
              {j.startDate ? `Start ${j.startDate}` : "Not scheduled"} &mdash; ship {j.targetShipDate || "TBD"}
            </p>
            <p className="text-xs text-text-muted mt-2">
              Quoted: <strong>{j.quotedHours} hrs</strong> &middot; Materials: {formatCurrency(j.materialsBudget)}
            </p>
            {j.notes && <p className="mt-2 text-xs text-text-muted line-clamp-2">{j.notes}</p>}
          </article>
        ))}
      </div>

      {/*
        TODO (CODY): the next layer is a Gantt-style timeline strip. Tell
        Claude Code: "Replace this card grid with a horizontal Gantt
        timeline where each commission spans from startDate to
        targetShipDate. Today's date should be a vertical line."
      */}
    </main>
  );
}
