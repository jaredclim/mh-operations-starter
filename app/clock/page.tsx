export const metadata = { title: "Clock In/Out" };

/**
 * Phone-first clock-in surface for Cody and Paul.
 *
 * STARTER SCAFFOLDING. The next layer for Claude Code:
 *   1. Add a /sign-in cookie picker so Paul can pick his name once.
 *   2. Replace the static dropdowns with values pulled live from the
 *      Todoist MCP (Job = Todoist project, Task = Todoist task within
 *      that project).
 *   3. Wire the Start/Stop button to write a row to a Postgres
 *      `time_entries` table (Neon free tier). Schema:
 *         id serial primary key
 *         user text not null
 *         job_id text not null
 *         task text not null
 *         started_at timestamptz not null default now()
 *         ended_at timestamptz null
 *         units numeric null
 *         unit_type text null
 *   4. When the user picks a different task while one is running, auto-stop
 *      the previous timer (set ended_at = now()) BEFORE inserting the new
 *      row. Wrap in a transaction.
 */
export default function ClockPage() {
  return (
    <main className="max-w-md mx-auto p-6">
      <h1 className="text-2xl font-bold text-mh-walnut mb-1">Clock</h1>
      <p className="text-sm text-text-secondary mb-6">Tap to start. Switching auto-stops the previous timer.</p>

      <form className="space-y-4">
        <div>
          <label className="block text-sm font-semibold text-text-primary mb-1">Job</label>
          <select className="w-full rounded-lg border border-border-strong bg-surface px-3 py-3 text-base">
            <option>— pick a job —</option>
            {/* TODO (CODY): replace with Todoist projects */}
          </select>
        </div>

        <div>
          <label className="block text-sm font-semibold text-text-primary mb-1">Task</label>
          <select className="w-full rounded-lg border border-border-strong bg-surface px-3 py-3 text-base">
            <option>— pick a task —</option>
            <option>Milling</option>
            <option>Glue-up</option>
            <option>Sanding</option>
            <option>Finishing</option>
            <option>Assembly</option>
            <option>Install</option>
            {/* TODO (CODY): confirm your standard task list with Claude Code */}
          </select>
        </div>

        <button
          type="button"
          className="w-full rounded-lg bg-mh-mahogany text-white font-semibold py-4 text-lg active:bg-mh-walnut"
        >
          Start
        </button>
      </form>
    </main>
  );
}
