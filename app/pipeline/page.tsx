import { LeadStatus } from "@prisma/client";
import { SlidersHorizontal } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-user";
import { PipelineRow } from "../components";
import { SectionPage } from "../section-page";

const colors = ["#8c83d9", "#e7bb5f", "#df9a59", "#df8a59", "#82a86f", "#66ad76", "#9ca3af"];
const label = (value: string) => value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
export default async function PipelinePage() { const user = await requireUser(); const rows = await prisma.lead.groupBy({ by: ["status"], where: { userId: user.id }, _count: true }); const counts = Object.fromEntries(rows.map((row) => [row.status, row._count])); const maximum = Math.max(1, ...Object.values(counts)); return <SectionPage title="Pipeline" description="See how opportunities are moving toward a win." icon={SlidersHorizontal}><div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{Object.values(LeadStatus).map((status, index) => { const count = counts[status] ?? 0; return <article key={status} className="rounded-xl border border-black/[0.06] p-5"><div className="mb-5 flex items-start justify-between"><div><h3 className="text-sm font-semibold">{label(status)}</h3><p className="mt-1 text-xs text-[#687080]">Active opportunities</p></div><span className="text-2xl font-semibold tracking-tight">{count}</span></div><PipelineRow stage={label(status)} count={count} width={`${count / maximum * 100}%`} color={colors[index]} /></article>; })}</div></SectionPage>; }
