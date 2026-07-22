import { ChevronDown } from "lucide-react";
import { DashboardCard, Header, LeadRow, MetricCard, PipelineRow, ReminderItem, SmallAction, TaskRow, ViewAll } from "./components";
import { leads, metrics, pipeline, reminders, tasks } from "./data";

export default function Home() {
  return <div className="mx-auto max-w-[1260px]"><Header />
    <section aria-label="Lead metrics" className="mt-9 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{metrics.map((metric) => <MetricCard key={metric.label} {...metric} />)}</section>
    <div className="mt-5 grid items-start gap-5 xl:grid-cols-[minmax(0,2.08fr)_minmax(300px,1fr)]"><div className="grid gap-5">
      <DashboardCard title="Recent Leads" action={<SmallAction>View all leads</SmallAction>}><ul>{leads.map((lead) => <LeadRow key={lead.name} lead={lead} />)}</ul><div className="flex h-14 items-center justify-center gap-2 text-xs text-[#687080]">Showing 5 of 12 leads <ChevronDown className="size-4" /></div></DashboardCard>
      <DashboardCard title="Reminders" action={<ViewAll />}><div className="flex gap-6 px-6 py-5 max-md:flex-col">{reminders.map((reminder) => <ReminderItem key={reminder.name} {...reminder} />)}</div></DashboardCard>
    </div><div className="grid gap-5">
      <DashboardCard title="Pipeline Overview" action={<SmallAction>This Week <ChevronDown className="ml-1 inline size-3.5" /></SmallAction>}><ul className="space-y-6 px-6 py-6">{pipeline.map((item) => <PipelineRow key={item.stage} {...item} />)}</ul></DashboardCard>
      <DashboardCard title="Upcoming Tasks" action={<ViewAll />}><ul className="px-6">{tasks.map((task) => <TaskRow key={task.title} {...task} />)}</ul></DashboardCard>
    </div></div>
  </div>;
}
