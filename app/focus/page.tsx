import { fetchOpportunities } from "@/lib/sheets";
import { buildFocusQueue } from "@/lib/focusQueue";
import { formatCurrency, relativeDate, todayISO } from "@/lib/utils";

export const revalidate = 60;

/**
 * Focus Mode — one card at a time, in AI-prioritized order.
 *
 * The full version logs an action (called / emailed / texted / IG-comment /
 * voicemail) and advances to the next card without a page reload. This
 * starter renders just the top card so the priority logic can be validated
 * against your real data first.
 *
 * Next layer for Claude Code:
 *   - Add Server Actions to log a touch (writes lastTouchDate back to the
 *     sheet) and a Next/Skip button to advance the queue.
 *   - Compute "designer touch score" — count touches in the last 30 days
 *     per designer — and surface as a small chip on each card.
 */
export default async function FocusPage() {
  const opps = await fetchOpportunities();
  const queue = buildFocusQueue(opps);
  const today = todayISO();
  const top = queue[0];

  if (!top) {
    return (
      <main className="max-w-2xl mx-auto p-6 text-center">
        <h1 className="text-2xl font-bold text-mh-walnut mb-2">Focus</h1>
        <p className="text-text-secondary">Nothing in the queue right now. Everyone&apos;s been touched today.</p>
      </main>
    );
  }

  return (
    <main className="max-w-2xl mx-auto p-6">
      <header className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-mh-walnut">Focus</h1>
        <span className="text-sm text-text-muted">{queue.length} in queue</span>
      </header>

      <article className="rounded-2xl bg-surface border border-mh-brass shadow-sm p-8">
        <p className="text-xs uppercase tracking-widest text-mh-mahogany font-semibold mb-2">
          {top.stage}
        </p>
        <h2 className="text-3xl font-bold text-mh-walnut mb-1">{top.name}</h2>
        <p className="text-text-secondary mb-4">
          {formatCurrency(top.estValue)} &middot; {top.source || "no source"}
        </p>

        {top.nextFollowUpDate && (
          <p className="text-sm text-text-secondary mb-4">
            Follow-up due <strong>{relativeDate(top.nextFollowUpDate, today)}</strong>
            {top.nextFollowUpType && <> &mdash; {top.nextFollowUpType}</>}
          </p>
        )}

        {top.notes && (
          <div className="rounded-lg bg-mh-cream-soft border border-border p-4 mb-6">
            <p className="text-xs uppercase tracking-wider font-semibold text-text-muted mb-1">Notes</p>
            <p className="text-sm text-text-primary whitespace-pre-wrap">{top.notes}</p>
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          <button className="rounded-lg bg-mh-mahogany text-white py-3 font-semibold">Called</button>
          <button className="rounded-lg bg-mh-mahogany text-white py-3 font-semibold">Emailed</button>
          <button className="rounded-lg bg-mh-walnut text-white py-3 font-semibold">Texted</button>
          <button className="rounded-lg bg-mh-walnut text-white py-3 font-semibold">IG comment</button>
        </div>
        <button className="mt-3 w-full rounded-lg border border-border-strong py-3 text-text-secondary font-medium">
          Skip / Next
        </button>
      </article>
    </main>
  );
}
