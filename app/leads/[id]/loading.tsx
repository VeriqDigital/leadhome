export default function LeadDetailLoading() {
  return (
    <div
      aria-label="Loading lead and activity"
      aria-busy="true"
      className="mx-auto max-w-315 animate-pulse"
    >
      <div className="mb-5 h-5 w-28 rounded bg-black/[0.06] dark:bg-white/[0.07]" />
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(320px,380px)]">
        <div className="h-[650px] rounded-2xl bg-black/[0.04] dark:bg-white/[0.05]" />
        <div className="h-[480px] rounded-2xl bg-black/[0.04] dark:bg-white/[0.05]" />
      </div>
      <span className="sr-only">Loading activity history.</span>
    </div>
  );
}
