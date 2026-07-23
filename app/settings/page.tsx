import { Settings } from "lucide-react";
import { SectionPage } from "../section-page";
import { requireUser } from "@/lib/auth-user";
import { prisma } from "@/lib/prisma";
import { WebsiteSources } from "./website-sources";
import { headers } from "next/headers";

export default async function SettingsPage() {
  const user = await requireUser();
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  const protocol = requestHeaders.get("x-forwarded-proto") ?? "http";
  const endpoint = host
    ? `${protocol}://${host}/api/inbound/forms`
    : "https://your-leadhome.example/api/inbound/forms";
  const sources = await prisma.inboundSource.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, isActive: true, createdAt: true },
  });
  return (
    <SectionPage
      title="Settings"
      description="Manage your LeadHome workspace preferences."
      icon={Settings}
    >
      <div className="max-w-3xl space-y-8">
        <div className="grid gap-5 sm:grid-cols-2">
          <label className="block">
            <span className="mb-2 block text-sm font-semibold">Display name</span>
            <input readOnly value={user.name ?? ""} className="w-full rounded-xl border border-black/[0.09] bg-transparent px-4 py-3 text-sm" />
          </label>
          <label className="block">
            <span className="mb-2 block text-sm font-semibold">Account email</span>
            <input readOnly value={user.email ?? ""} className="w-full rounded-xl border border-black/[0.09] bg-transparent px-4 py-3 text-sm" />
          </label>
        </div>
        <p className="text-xs text-[#687080]">
          Appearance can be changed from the profile menu in the lower-left
          corner.
        </p>
        <div className="border-t border-black/[0.07] pt-8">
          <WebsiteSources endpoint={endpoint} sources={sources.map((source) => ({ ...source, createdAt: source.createdAt.toISOString() }))} />
        </div>
      </div>
    </SectionPage>
  );
}
