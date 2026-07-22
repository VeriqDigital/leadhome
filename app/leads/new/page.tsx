import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { requireUser } from "@/lib/auth-user";
import { createLeadAction } from "../../actions/lead-actions";
import { LeadForm } from "../lead-form";
export default async function NewLeadPage() { await requireUser(); return <div className="mx-auto max-w-3xl"><Link href="/leads" className="mb-5 inline-flex items-center gap-1 text-sm text-[#687080] hover:text-black"><ChevronLeft className="size-4" />Back to leads</Link><section className="dashboard-card rounded-2xl border border-black/[0.055] bg-white p-6 shadow-[0_8px_30px_rgba(23,24,28,0.035)] sm:p-8"><h1 className="text-2xl font-semibold tracking-tight">New lead</h1><p className="mb-8 mt-2 text-sm text-[#687080]">Add an opportunity manually to your pipeline.</p><LeadForm action={createLeadAction} submitLabel="Create lead" /></section></div>; }
