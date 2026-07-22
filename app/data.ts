import { BellRing, CalendarDays, CircleDollarSign, Mail, Phone, TrendingUp, UserRoundPlus } from "lucide-react";

export const metrics = [
  { label: "New Leads", value: "12", trend: "20%", period: "from yesterday", icon: UserRoundPlus, tone: "neutral" },
  { label: "Needs Follow-up", value: "7", trend: "12%", period: "from yesterday", icon: BellRing, tone: "neutral" },
  { label: "Won This Week", value: "3", trend: "50%", period: "from last week", icon: TrendingUp, tone: "green" },
  { label: "Pipeline Value", value: "$18,200", trend: "15%", period: "from last week", icon: CircleDollarSign, tone: "neutral" },
] as const;
export const leads = [
  { initials: "JS", name: "John Smith", source: "Website Form", time: "2m ago", status: "New", message: "Interested in a website redesign..." },
  { initials: "SJ", name: "Sarah Jones", source: "Facebook Messenger", time: "1h ago", status: "Contacted", message: "Do you offer SEO services as well?" },
  { initials: "MC", name: "Mike Chen", source: "Gmail", time: "3h ago", status: "Contacted", message: "Looking for a quote on a new site." },
  { initials: "AB", name: "ABC Construction", source: "Phone Call", time: "5h ago", status: "Follow-up", message: "Left voicemail about your services." },
  { initials: "ET", name: "Emily Thompson", source: "Website Form", time: "1d ago", status: "Follow-up", message: "Wanting to schedule a call." },
] as const;
export const pipeline = [
  { stage: "New", count: 12, width: "100%", color: "#8c83d9" }, { stage: "Contacted", count: 8, width: "68%", color: "#e7bb5f" },
  { stage: "Proposal Sent", count: 5, width: "48%", color: "#df8a59" }, { stage: "Negotiating", count: 3, width: "28%", color: "#82a86f" },
  { stage: "Won", count: 3, width: "28%", color: "#66ad76" }, { stage: "Lost", count: 1, width: "7%", color: "#9ca3af" },
] as const;
export const tasks = [
  { title: "Follow up with Sarah Jones", source: "Facebook Messenger", due: "Today", urgent: true },
  { title: "Send proposal to Mike Chen", source: "Gmail", due: "Tomorrow" }, { title: "Call ABC Construction", source: "Phone Call", due: "Jul 22" },
] as const;
export const reminders = [
  { name: "John Smith", action: "Call back", icon: Phone, tone: "red" }, { name: "Sarah Jones", action: "Send follow-up email", icon: Mail, tone: "amber" },
  { name: "ABC Construction", action: "Schedule meeting", icon: CalendarDays, tone: "green", date: "Tomorrow" },
] as const;
export const navItems = ["Dashboard", "Leads", "Pipeline", "Tasks", "Reminders", "Settings"] as const;
