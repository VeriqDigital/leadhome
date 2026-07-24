import type { LucideIcon } from "lucide-react";
import { Bell, Plus } from "lucide-react";
import Link from "next/link";
export function Header({ name = "there" }: { name?: string }) {
  return (
    <header className="flex items-start justify-between gap-5">
      <div>
        <h1 className="text-[25px] font-semibold tracking-[-0.035em] sm:text-[28px]">
          Good morning, {name.split(" ")[0]}.
        </h1>
        <p className="mt-1.5 text-sm text-[#687080]">
          Here&apos;s what&apos;s happening with your leads today.
        </p>
      </div>
      <div className="flex items-center gap-3">
        <Link
          href="/leads/new"
          className="hidden h-11 items-center gap-2 rounded-[10px] bg-[#17181c] px-5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-black sm:flex"
        >
          <Plus className="size-4" />
          New Lead
        </Link>
        <button
          aria-label="Notifications"
          className="relative grid size-11 place-items-center rounded-xl transition-colors hover:bg-white"
        >
          <Bell className="size-5" />
          <span className="absolute right-2 top-2 size-1.5 rounded-full bg-[#17181c] ring-2 ring-[#f7f7f5]" />
        </button>
      </div>
    </header>
  );
}
export function DashboardCard({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="dashboard-card rounded-2xl border border-black/5.5 bg-white shadow-[0_8px_30px_rgba(23,24,28,0.035)]">
      <header className="flex min-h-16 items-center justify-between border-b border-black/6 px-6">
        <h2 className="text-[15px] font-semibold tracking-[-0.01em]">
          {title}
        </h2>
        {action}
      </header>
      {children}
    </section>
  );
}
export function MetricCard({
  label,
  value,
  trend,
  period,
  icon: Icon,
  tone,
}: {
  label: string;
  value: string;
  trend: string;
  period: string;
  icon: LucideIcon;
  tone: string;
}) {
  return (
    <article className="metric-card relative min-h-33 rounded-2xl border border-black/5.5 bg-white p-5 shadow-[0_7px_24px_rgba(23,24,28,0.03)]">
      <p className="text-sm font-semibold">{label}</p>
      <p className="mt-2 text-[27px] font-semibold leading-none tracking-[-0.04em]">
        {value}
      </p>
      <p className="mt-4 text-xs text-[#687080]">
        <span className="font-medium text-[#279457]">↑ {trend}</span> {period}
      </p>
      <span
        className={`absolute right-5 top-5 grid size-10 place-items-center rounded-xl ${tone === "green" ? "bg-[#edf6ee] text-[#549967]" : "bg-[#f3f4f6] text-[#717784]"}`}
      >
        <Icon className="size-5" />
      </span>
    </article>
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
export function LeadRow({
  lead,
}: {
  lead: {
    id: string;
    initials: string;
    name: string;
    source: string;
    time: string;
    status: string;
    message: string;
  };
}) {
  return (
    <li className="border-b border-black/5.5 last:border-b-0">
      <Link
        href={`/leads/${lead.id}`}
        className="grid min-h-18 grid-cols-[42px_minmax(120px,1.15fr)_70px_100px_minmax(150px,1.35fr)] items-center gap-3 px-6 transition-colors hover:bg-black/[0.025] focus-visible:bg-black/[0.025] max-sm:grid-cols-[42px_1fr_auto] max-sm:py-3 dark:hover:bg-white/[0.035] dark:focus-visible:bg-white/[0.035]"
      >
        <span className="grid size-10 place-items-center rounded-full bg-[#f2f3f5] text-xs font-medium text-[#5e6674]">
          {lead.initials}
        </span>
        <div className="min-w-0">
          <p className="truncate text-[13px] font-semibold">{lead.name}</p>
          <p className="mt-0.5 truncate text-xs text-[#687080]">{lead.source}</p>
        </div>
        <span className="text-xs text-[#687080] max-sm:hidden">{lead.time}</span>
        <div className="max-sm:justify-self-end">
          <StatusBadge status={lead.status} />
        </div>
        <p className="truncate text-xs text-[#687080] max-sm:col-span-2 max-sm:col-start-2">
          {lead.message}
        </p>
      </Link>
    </li>
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
export function TaskRow({
  title,
  source,
  due,
  urgent,
}: {
  title: string;
  source: string;
  due: string;
  urgent?: boolean;
}) {
  return (
    <li className="flex min-h-18.75 items-center gap-3 border-b border-black/5.5 last:border-0">
      <span
        aria-hidden
        className="size-5 shrink-0 rounded-[5px] border border-[#d4d7db] bg-white"
      />
      <div className="min-w-0">
        <p className="truncate text-[13px] font-semibold">{title}</p>
        <p className="mt-1 text-xs text-[#687080]">{source}</p>
      </div>
      <span
        className={`ml-auto shrink-0 text-xs ${urgent ? "text-[#e94343]" : "text-[#687080]"}`}
      >
        {due}
      </span>
    </li>
  );
}
export function ReminderItem({
  name,
  action,
  icon: Icon,
  tone,
  date,
}: {
  name: string;
  action: string;
  icon: LucideIcon;
  tone: string;
  date?: string;
}) {
  const colors =
    tone === "red"
      ? "bg-[#ffeded] text-[#e34f52]"
      : tone === "amber"
        ? "bg-[#fff6df] text-[#dea014]"
        : "bg-[#edf6ee] text-[#5ba36b]";
  return (
    <div className="flex min-w-0 flex-1 items-center gap-3">
      <span
        className={`grid size-11 shrink-0 place-items-center rounded-xl ${colors}`}
      >
        <Icon className="size-5" />
      </span>
      <div className="min-w-0">
        <p className="truncate text-[13px] font-semibold">{name}</p>
        <p className="mt-1 truncate text-xs text-[#687080]">{action}</p>
      </div>
      {date && <span className="ml-auto text-xs text-[#687080]">{date}</span>}
    </div>
  );
}
export const SmallAction = ({ children }: { children: React.ReactNode }) => (
  <button className="rounded-lg border border-black/[0.07] bg-white px-3 py-2 text-xs font-medium transition-colors hover:bg-[#f7f7f5]">
    {children}
  </button>
);
export const ViewAll = () => (
  <button className="text-xs text-[#606775] transition-colors hover:text-black">
    View all
  </button>
);
