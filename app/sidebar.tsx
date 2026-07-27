"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  Gauge,
  Home,
  Inbox,
  LogOut,
  Menu,
  Moon,
  Settings,
  SlidersHorizontal,
  SquareCheckBig,
  Sun,
  UserRound,
  UsersRound,
  X,
} from "lucide-react";
import { logoutAction } from "./actions/auth-actions";

const items = [
  { label: "Dashboard", href: "/", icon: Gauge },
  { label: "Leads", href: "/leads", icon: UsersRound },
  { label: "Inbox", href: "/inbox", icon: Inbox },
  { label: "Pipeline", href: "/pipeline", icon: SlidersHorizontal },
  { label: "Tasks", href: "/tasks", icon: SquareCheckBig },
  { label: "Settings", href: "/settings", icon: Settings },
] as const;

function Logo() {
  return (
    <div className="flex items-center gap-3">
      <span className="relative grid size-9 place-items-center rounded-[11px] bg-white text-neutral-950">
        <Home className="size-4.5" strokeWidth={2.4} />
      </span>
      <span className="text-[21px] font-semibold tracking-[-0.02em] text-white">
        LeadHome
      </span>
    </div>
  );
}

export function Sidebar({
  user,
}: {
  user?: { name?: string | null; email?: string | null };
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [dark, setDark] = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const saved = localStorage.getItem("leadhome-theme");
    const enabled =
      saved === "dark" ||
      (!saved && matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.classList.toggle("dark", enabled);
    const frame = requestAnimationFrame(() => setDark(enabled));
    return () => cancelAnimationFrame(frame);
  }, []);
  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (!profileRef.current?.contains(event.target as Node))
        setProfileOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);
  const toggleTheme = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("leadhome-theme", next ? "dark" : "light");
  };

  const initials =
    user?.name
      ?.split(" ")
      .map((part) => part[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() || "LH";
  const content = (
    <>
      <div className="flex items-center justify-between px-4">
        <Logo />
        <button
          aria-label="Close navigation"
          onClick={() => setOpen(false)}
          className="grid size-9 place-items-center rounded-lg text-neutral-400 hover:bg-white/10 hover:text-white lg:hidden"
        >
          <X className="size-5" />
        </button>
      </div>
      <nav className="mt-11" aria-label="Main navigation">
        <ul className="space-y-1.5">
          {items.map(({ label, href, icon: Icon }) => {
            const active =
              href === "/" ? pathname === "/" : pathname.startsWith(href);
            return (
              <li key={href}>
                <Link
                  href={href}
                  onClick={() => setOpen(false)}
                  aria-current={active ? "page" : undefined}
                  className={`flex h-12 items-center gap-3 rounded-xl px-4 text-sm transition-colors ${active ? "bg-white/[0.1] font-medium text-white" : "text-neutral-400 hover:bg-white/[0.06] hover:text-white"}`}
                >
                  <Icon className="size-[19px]" />
                  <span>{label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      <div ref={profileRef} className="relative mt-auto">
        <div
          className={`absolute bottom-[calc(100%+8px)] left-0 right-0 origin-bottom rounded-xl border border-white/10 bg-[#222328] p-1.5 shadow-2xl transition-all ${profileOpen ? "visible scale-100 opacity-100" : "invisible scale-95 opacity-0"}`}
          role="menu"
        >
          <button
            onClick={toggleTheme}
            className="cursor-pointer flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm text-neutral-300 hover:bg-white/[0.07] hover:text-white"
            role="menuitem"
          >
            {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
            {dark ? "Light mode" : "Dark mode"}
          </button>
          <Link
            href="/settings"
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm text-neutral-300 hover:bg-white/[0.07] hover:text-white"
            role="menuitem"
          >
            <UserRound className="size-4" />
            Profile settings
          </Link>
          <form action={logoutAction}>
            <button
              className="cursor-pointer flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm text-neutral-300 hover:bg-white/[0.07] hover:text-white"
              role="menuitem"
            >
              <LogOut className="size-4" />
              Sign out
            </button>
          </form>
        </div>
        <button
          onClick={() => setProfileOpen((value) => !value)}
          aria-expanded={profileOpen}
          aria-haspopup="menu"
          className="cursor-pointer flex w-full items-center gap-3 rounded-xl p-3 text-left transition-colors hover:bg-white/[0.05]"
        >
          <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-neutral-700 text-sm font-semibold">
            {initials}
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-white">
              {user?.name ?? "LeadHome User"}
            </p>
            <p className="truncate text-xs text-neutral-500">
              {user?.email ?? ""}
            </p>
          </div>
          <ChevronDown
            className={`ml-auto size-4 text-neutral-400 transition-transform ${profileOpen ? "rotate-180" : ""}`}
          />
        </button>
      </div>
    </>
  );

  return (
    <>
      <div className="mobile-bar fixed inset-x-0 top-0 z-30 flex h-16 items-center justify-between bg-[#17181c] px-4 lg:hidden">
        <Logo />
        <button
          aria-label="Open navigation"
          onClick={() => setOpen(true)}
          className="grid size-10 place-items-center rounded-xl border border-white/10 text-white"
        >
          <Menu className="size-5" />
        </button>
      </div>
      {open && (
        <button
          className="fixed inset-0 z-30 bg-black/50 lg:hidden"
          aria-label="Close navigation overlay"
          onClick={() => setOpen(false)}
        />
      )}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-[246px] flex-col bg-[#17181c] px-4 py-8 text-white transition-transform lg:translate-x-0 ${open ? "translate-x-0" : "-translate-x-full"}`}
      >
        {content}
      </aside>
    </>
  );
}
