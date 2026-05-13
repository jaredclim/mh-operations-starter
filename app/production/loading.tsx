import { Nav } from "@/components/Nav";

const DAY_HEIGHT_PX = 80;
const SKELETON_DAYS = 9;
const SKELETON_CREWS = 4;

export default function ProductionLoading() {
  const days = Array.from({ length: SKELETON_DAYS });
  const crews = Array.from({ length: SKELETON_CREWS });

  return (
    <main className="min-h-screen bg-bg">
      <header className="bg-cc-navy text-white border-b border-cc-navy-deep sticky top-0 z-30">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-3 sm:py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-10 px-2 rounded-lg bg-white/95 flex items-center justify-center shadow-md">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/cc-logo.png"
                alt="Colour Craft"
                className="h-7 w-auto object-contain"
              />
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-[0.25em] text-cc-accent/90 font-semibold">
                Colour Craft
              </div>
              <h1 className="text-lg sm:text-xl font-bold leading-tight">Production</h1>
            </div>
          </div>
          <div className="flex items-center gap-3 sm:gap-4">
            <Nav />
            <div className="skeleton-dark h-9 w-24 rounded-md" />
          </div>
        </div>
      </header>

      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-5 sm:py-6 space-y-4">
        {/* Header strip — Total Scheduled + toolbar */}
        <div className="bg-surface rounded-2xl border border-border px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="skeleton h-4 w-4 rounded" />
            <div className="space-y-1.5">
              <div className="skeleton h-2.5 w-24 rounded" />
              <div className="skeleton h-5 w-44 rounded" />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="skeleton h-7 w-12 rounded-md" />
            <div className="skeleton h-7 w-12 rounded-md" />
            <div className="skeleton h-7 w-24 rounded-md" />
            <div className="skeleton h-7 w-36 rounded-md" />
          </div>
        </div>

        {/* Search + filter bar */}
        <div className="bg-surface rounded-2xl border border-border px-4 py-2.5 flex items-center gap-3">
          <div className="skeleton h-8 w-full max-w-md rounded-md" />
          <div className="skeleton h-7 w-20 rounded-full hidden sm:block" />
          <div className="skeleton h-7 w-24 rounded-full hidden sm:block" />
          <div className="skeleton h-7 w-20 rounded-full hidden md:block" />
        </div>

        {/* Day-row × crew-column grid */}
        <div className="bg-surface rounded-2xl border border-border overflow-hidden">
          <div
            className="grid"
            style={{
              width: "100%",
              minWidth: "max(100%, 640px)",
              gridTemplateColumns: `clamp(7rem, 11vw, 11rem) repeat(${SKELETON_CREWS}, minmax(220px, 1fr))`,
              gridTemplateRows: `auto repeat(${SKELETON_DAYS}, ${DAY_HEIGHT_PX}px)`,
            }}
          >
            {/* Header row */}
            <div className="border-b border-border px-3 py-2">
              <div className="skeleton h-3 w-8 rounded" />
            </div>
            {crews.map((_, i) => (
              <div key={`crew-h-${i}`} className="border-b border-l border-border px-3 py-2 space-y-1.5">
                <div className="skeleton h-3 w-16 rounded" />
                <div className="skeleton h-3 w-20 rounded" />
              </div>
            ))}

            {/* Day rows */}
            {days.map((_, di) => (
              <DayRow key={di} di={di} crewCount={SKELETON_CREWS} />
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}

function DayRow({ di, crewCount }: { di: number; crewCount: number }) {
  // Stagger which cells get a placeholder card so the skeleton resembles
  // a real schedule density rather than a uniform checkerboard.
  const hasCard = (ci: number) => (di + ci) % 3 === 0;
  return (
    <>
      <div className="border-b border-border px-3 py-2 space-y-1.5">
        <div className="skeleton h-3 w-10 rounded" />
        <div className="skeleton h-3 w-12 rounded" />
      </div>
      {Array.from({ length: crewCount }).map((_, ci) => (
        <div key={ci} className="border-b border-l border-border p-1.5">
          {hasCard(ci) && (
            <div className="bg-white border border-border rounded-lg h-full p-2 space-y-1.5">
              <div className="skeleton h-3 w-3/5 rounded" />
              <div className="flex gap-1.5">
                <div className="skeleton h-4 w-12 rounded" />
                <div className="skeleton h-4 w-14 rounded" />
              </div>
            </div>
          )}
        </div>
      ))}
    </>
  );
}
