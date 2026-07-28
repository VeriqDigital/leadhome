"use client";

export default function LeadDetailError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="mx-auto max-w-xl rounded-2xl border border-red-200 bg-red-50 p-8 text-center dark:border-red-500/20 dark:bg-red-500/10">
      <h1 className="text-lg font-semibold">This lead could not be loaded</h1>
      <p className="mt-2 text-sm text-[#687080] dark:text-[#b7bbc5]">
        Lead details and activity are temporarily unavailable.
      </p>
      <button
        type="button"
        onClick={reset}
        className="mt-5 min-h-11 cursor-pointer rounded-xl bg-[#17181c] px-5 text-sm font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7770c8] dark:bg-white dark:text-[#17181c]"
      >
        Try again
      </button>
    </div>
  );
}
