import type { LucideIcon } from "lucide-react";
import { CalendarDays, Mail, Phone } from "lucide-react";

type DemoTask = {
  title: string;
  source: string;
  due: string;
  urgent?: boolean;
};

type DemoReminder = {
  name: string;
  action: string;
  icon: LucideIcon;
  tone: "red" | "amber" | "green";
  date?: string;
};

// Temporary display fixtures. Tasks and reminders do not have persistence yet.
export const demoTasks: DemoTask[] = [
  {
    title: "Follow up with Sarah Jones",
    source: "Facebook Messenger",
    due: "Today",
    urgent: true,
  },
  {
    title: "Send proposal to Mike Chen",
    source: "Gmail",
    due: "Tomorrow",
  },
  {
    title: "Call ABC Construction",
    source: "Phone Call",
    due: "Jul 22",
  },
];

export const demoReminders: DemoReminder[] = [
  { name: "John Smith", action: "Call back", icon: Phone, tone: "red" },
  {
    name: "Sarah Jones",
    action: "Send follow-up email",
    icon: Mail,
    tone: "amber",
  },
  {
    name: "ABC Construction",
    action: "Schedule meeting",
    icon: CalendarDays,
    tone: "green",
    date: "Tomorrow",
  },
];
