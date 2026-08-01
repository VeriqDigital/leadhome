import { Plus } from "lucide-react";
import Link from "next/link";
function greetingForHour(hour: number) {
  if (hour >= 4 && hour < 12) return "Good morning";
  if (hour >= 12 && hour < 17) return "Good afternoon";
  return "Good evening";
}

export function Header({
  name = "there",
  hour = new Date().getHours(),
}: {
  name?: string;
  hour?: number;
}) {
  return (
    <header className="flex items-start justify-between gap-5">
      <div>
        <h1 className="text-[25px] font-semibold tracking-[-0.035em] sm:text-[28px]">
          {greetingForHour(hour)}, {name.split(" ")[0]}.
        </h1>
        <p className="mt-1.5 text-sm text-[#687080]">
          Here is what needs your attention today.
        </p>
      </div>
      <div className="flex items-center gap-3">
        <Link
          href="/leads/new"
          className="action-primary hidden h-11 items-center gap-2 rounded-[10px] border border-transparent px-5 text-sm font-medium shadow-sm transition-colors sm:flex"
        >
          <Plus className="size-4" />
          New Lead
        </Link>
      </div>
    </header>
  );
}
export function StatusBadge({ status }: { status: string }) {
  const styles =
    status === "New"
      ? "bg-[#efedfb] text-[#5449ae]"
      : status === "Contacted"
        ? "bg-[#fff4da] text-[#9a6500]"
        : "bg-[#fff0e8] text-[#b34f20]";
  return (
    <span
      className={`inline-flex rounded-lg px-3 py-1.5 text-[11px] font-medium ${styles}`}
    >
      {status}
    </span>
  );
}
export function PipelineRow({
  stage,
  count,
  width,
  color,
}: {
  stage: string;
  count: number;
  width: string;
  color: string;
}) {
  return (
    <li className="grid grid-cols-[90px_22px_1fr] items-center gap-3">
      <span className="text-xs font-medium">{stage}</span>
      <span className="text-right text-xs font-semibold">{count}</span>
      <span className="h-1.5 overflow-hidden rounded-full bg-[#e9eaec]">
        <span
          className="block h-full rounded-full"
          style={{ width, backgroundColor: color }}
        />
      </span>
    </li>
  );
}
