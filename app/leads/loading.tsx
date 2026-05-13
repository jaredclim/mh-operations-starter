export default function Loading() {
  return (
    <main className="min-h-screen bg-bg">
      <div className="bg-cc-navy h-[64px]" />
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-6 space-y-5">
        <Skeleton className="h-12 rounded-xl" />
        <Skeleton className="h-44 rounded-2xl" />
        <Skeleton className="h-56 rounded-2xl" />
        <Skeleton className="h-16 rounded-2xl" />
        <div className="space-y-3">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-32 rounded-2xl" />
          ))}
        </div>
      </div>
    </main>
  );
}

function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div
      className={`bg-gradient-to-r from-zinc-100 via-zinc-50 to-zinc-100 bg-[length:200%_100%] animate-[shimmer_1.6s_ease-in-out_infinite] ${className}`}
      style={
        {
          backgroundSize: "200% 100%",
        } as React.CSSProperties
      }
    />
  );
}
