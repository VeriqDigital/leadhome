import { BellRing } from "lucide-react";
import { reminders } from "../data";
import { ReminderItem } from "../components";
import { SectionPage } from "../section-page";

export default function RemindersPage() { return <SectionPage title="Reminders" description="Stay ahead of calls, emails, and meetings." icon={BellRing}><div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{reminders.map((reminder) => <article key={reminder.name} className="rounded-xl border border-black/[0.06] p-4"><ReminderItem {...reminder} /></article>)}</div></SectionPage>; }
