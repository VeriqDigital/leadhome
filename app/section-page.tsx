import type { LucideIcon } from "lucide-react";
import { PageHeader } from "./page-header";

export function SectionPage({ title, description, icon: Icon, children }: { title: string; description: string; icon: LucideIcon; children: React.ReactNode }) { return <div className="mx-auto max-w-[1260px]"><PageHeader title={title} description={description} /><section className="dashboard-card mt-9 rounded-2xl border border-black/[0.055] bg-white p-6 shadow-[0_8px_30px_rgba(23,24,28,0.035)] sm:p-8"><div className="mb-7 flex items-center gap-3"><span className="grid size-11 place-items-center rounded-xl bg-[#f1f2f4] text-[#5f6672]"><Icon className="size-5" /></span><h2 className="text-lg font-semibold">{title} overview</h2></div>{children}</section></div>; }
