export default function ParentStatusLoading() {
  return (
    <main className="mx-auto max-w-xl px-4 py-6 space-y-5">
      {/* Header skeleton */}
      <header className="space-y-2">
        <div className="h-7 w-40 rounded-md bg-muted animate-pulse" />
        <div className="h-4 w-64 rounded-md bg-muted animate-pulse" />
      </header>

      {/* Card skeletons */}
      <ul className="space-y-3">
        {[0, 1].map((i) => (
          <li
            key={i}
            className="rounded-xl border bg-card overflow-hidden"
            style={{ borderLeftWidth: 4, borderLeftColor: "var(--border)" }}
          >
            <div className="p-4 space-y-3">
              {/* Name + wristband code row */}
              <div className="flex items-center justify-between gap-2">
                <div className="h-5 w-32 rounded-md bg-muted animate-pulse" />
                <div className="h-4 w-12 rounded-md bg-muted animate-pulse" />
              </div>

              {/* Icon + state label row */}
              <div className="flex items-center gap-3">
                <div className="size-8 rounded-full bg-muted animate-pulse shrink-0" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-5 w-28 rounded-md bg-muted animate-pulse" />
                  <div className="h-3.5 w-44 rounded-md bg-muted animate-pulse" />
                </div>
              </div>

              {/* Metadata footer row */}
              <div className="pt-1 border-t flex items-center gap-3">
                <div className="h-3.5 w-24 rounded-md bg-muted animate-pulse" />
                <div className="h-3.5 w-20 rounded-md bg-muted animate-pulse" />
              </div>
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}
