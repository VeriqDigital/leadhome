"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";

type StatusOption = {
  value: string;
  label: string;
};

export function StatusFilter({
  defaultValue,
  options,
}: {
  defaultValue: string;
  options: StatusOption[];
}) {
  const [value, setValue] = useState(defaultValue);
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const selectedLabel =
    options.find((option) => option.value === value)?.label ?? "All statuses";

  useEffect(() => {
    function closeOnOutsideClick(event: PointerEvent) {
      if (!detailsRef.current?.contains(event.target as Node)) {
        detailsRef.current?.removeAttribute("open");
      }
    }

    document.addEventListener("pointerdown", closeOnOutsideClick);
    return () => document.removeEventListener("pointerdown", closeOnOutsideClick);
  }, []);

  function selectStatus(nextValue: string) {
    setValue(nextValue);
    detailsRef.current?.removeAttribute("open");
  }

  return (
    <details ref={detailsRef} className="group relative">
      <input type="hidden" name="status" value={value} />
      <summary className="flex h-10 min-w-40 cursor-pointer list-none items-center justify-between gap-3 rounded-xl border border-black/9 bg-white px-3 text-sm transition-colors marker:hidden hover:border-black/25 hover:bg-black/[0.025] dark:bg-transparent">
        {selectedLabel}
        <ChevronDown className="size-4 text-[#687080] transition-transform group-open:rotate-180" />
      </summary>
      <div className="absolute right-0 top-12 z-20 min-w-full overflow-hidden rounded-xl border border-black/10 bg-white p-1.5 shadow-xl dark:border-white/10 dark:bg-[#222328]">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => selectStatus(option.value)}
            className="flex w-full cursor-pointer rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-black/[0.05] dark:hover:bg-white/[0.07]"
          >
            {option.label}
          </button>
        ))}
      </div>
    </details>
  );
}
