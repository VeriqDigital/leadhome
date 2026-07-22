import { SlidersHorizontal } from "lucide-react";
import { pipeline } from "../data";
import { PipelineRow } from "../components";
import { SectionPage } from "../section-page";

export default function PipelinePage() { return <SectionPage title="Pipeline" description="See how opportunities are moving toward a win." icon={SlidersHorizontal}><div className="grid gap-4 md:grid-cols-3">{pipeline.map((item) => <article key={item.stage} className="rounded-xl border border-black/[0.06] p-5"><div className="mb-5 flex items-start justify-between"><div><h3 className="text-sm font-semibold">{item.stage}</h3><p className="mt-1 text-xs text-[#687080]">Active opportunities</p></div><span className="text-2xl font-semibold tracking-tight">{item.count}</span></div><PipelineRow {...item} /></article>)}</div></SectionPage>; }
