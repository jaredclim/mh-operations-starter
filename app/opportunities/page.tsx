import { fetchOpportunities } from "@/lib/sheets";
import { bucketize, BUCKET_LABELS, type BucketKey } from "@/lib/bucketing";
import { formatCurrency, relativeDate, todayISO } from "@/lib/utils";
import type { Opportunity } from "@/lib/types";

export const revalidate = 300; // ISR: re-fetch sheet every 5 minutes

export default async function OpportunitiesPage() {
  const opps = await fetchOpportunities();
  const { byBucket } = bucketize(opps);
  const verbalYes = opps.filter((o) => o.stage === "Verbal Yes");
  const today = todayISO();

  return (
    <main className="max-w-7xl mx-auto p-6">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-mh-walnut">Opportunities</h1>
        <p className="text-sm text-text-secondary">Active deals from first designer touch through verbal yes.</p>
      </header>

      {verbalYes.length > 0 && (
        <section className="mb-8 rounded-xl bg-mh-brass-soft border border-mh-brass p-5">
          <h2 className="text-sm font-bold uppercase tracking-wider text-mh-walnut mb-3">
            🔥 Verbal Yes &mdash; closest to revenue
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {verbalYes.map((o) => (<OppCard key={o.id} opp={o} today={today} />))}
          </div>
        </section>
      )}

      <div className="space-y-6">
        {(Object.keys(byBucket) as BucketKey[]).map((key) => {
          const opps = byBucket[key];
          if (opps.length === 0) return null;
          return (
            <section key={key}>
              <h2 className="text-sm font-bold uppercase tracking-wider text-text-secondary mb-2">
                {BUCKET_LABELS[key]} <span className="text-text-muted">({opps.length})</span>
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {opps.map((o) => (<OppCard key={o.id} opp={o} today={today} />))}
              </div>
            </section>
          );
        })}
      </div>
    </main>
  );
}

function OppCard({ opp, today }: { opp: Opportunity; today: string }) {
  return (
    <article className="rounded-lg bg-surface border border-border p-4 hover:border-mh-brass transition-colors">
      <div className="flex items-start justify-between gap-3 mb-2">
        <h3 className="font-semibold text-text-primary">{opp.name}</h3>
        <span className="text-sm font-semibold text-mh-mahogany whitespace-nowrap">
          {formatCurrency(opp.estValue || opp.bookedValue)}
        </span>
      </div>
      <p className="text-xs text-text-muted mb-2">{opp.stage} &middot; {opp.source}</p>
      {opp.nextFollowUpDate && (
        <p className="text-sm text-text-secondary">
          Next: <strong>{relativeDate(opp.nextFollowUpDate, today)}</strong> &mdash; {opp.nextFollowUpType || "follow up"}
        </p>
      )}
      {opp.notes && <p className="mt-2 text-xs text-text-muted line-clamp-2">{opp.notes}</p>}
    </article>
  );
}
