import { Settings } from "lucide-react";
import { SectionPage } from "../section-page";
import { requireUser } from "@/lib/auth-user";

export default async function SettingsPage() { const user = await requireUser(); return <SectionPage title="Settings" description="Manage your LeadHome workspace preferences." icon={Settings}><div className="max-w-2xl space-y-6"><label className="block"><span className="mb-2 block text-sm font-semibold">Display name</span><input readOnly value={user.name ?? ""} className="w-full rounded-xl border border-black/[0.09] bg-transparent px-4 py-3 text-sm" /></label><label className="block"><span className="mb-2 block text-sm font-semibold">Account email</span><input readOnly value={user.email ?? ""} className="w-full rounded-xl border border-black/[0.09] bg-transparent px-4 py-3 text-sm" /></label><p className="text-xs text-[#687080]">Appearance can be changed from the profile menu in the lower-left corner.</p></div></SectionPage>; }
