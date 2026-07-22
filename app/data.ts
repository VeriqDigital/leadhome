import { CalendarDays, Mail, Phone } from "lucide-react";

// These two sections intentionally remain mock-backed until task persistence is introduced.
export const tasks = [
  { title: "Follow up with Sarah Jones", source: "Facebook Messenger", due: "Today", urgent: true },
  { title: "Send proposal to Mike Chen", source: "Gmail", due: "Tomorrow" }, { title: "Call ABC Construction", source: "Phone Call", due: "Jul 22" },
] as const;
export const reminders = [
  { name: "John Smith", action: "Call back", icon: Phone, tone: "red" }, { name: "Sarah Jones", action: "Send follow-up email", icon: Mail, tone: "amber" },
  { name: "ABC Construction", action: "Schedule meeting", icon: CalendarDays, tone: "green", date: "Tomorrow" },
] as const;
