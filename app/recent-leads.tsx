"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { LeadRow } from "./components";

export type RecentLead = React.ComponentProps<typeof LeadRow>["lead"];

export function RecentLeads({ leads }: { leads: RecentLead[] }) {
  const [expanded, setExpanded] = useState(false);
  const visibleLeads = expanded ? leads : leads.slice(0, 5);
  const canExpand = leads.length > 5;
  const additionalLeadCount = leads.length - 5;

  return (
    <>
      <ul id="recent-leads-list">
        {visibleLeads.map((lead) => (
          <LeadRow key={lead.id} lead={lead} />
        ))}
      </ul>
      {canExpand ? (
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls="recent-leads-list"
          onClick={() => setExpanded((current) => !current)}
          className="flex h-14 w-full items-center justify-center gap-2 text-xs text-[#687080] transition-colors hover:bg-black/[0.025] hover:text-[#17181c] dark:hover:bg-white/[0.035] dark:hover:text-white"
        >
          {expanded
            ? "Show 5 recent leads"
            : `Show ${additionalLeadCount} more recent ${additionalLeadCount === 1 ? "lead" : "leads"}`}
          <ChevronDown
            className={`size-4 transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}
          />
        </button>
      ) : (
        <div className="flex h-14 items-center justify-center text-xs text-[#687080]">
          Showing {leads.length} recent {leads.length === 1 ? "lead" : "leads"}
        </div>
      )}
    </>
  );
}
