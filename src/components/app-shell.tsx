"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Camera,
  CircleUserRound,
  CloudOff,
  Home,
  PackageOpen,
  RefreshCw,
  Soup,
  TriangleAlert,
} from "lucide-react";
import type { ReactNode } from "react";
import { OfflineProvider, useOfflineInventory } from "./offline-provider";
import { ServiceWorkerRegistration } from "./service-worker-registration";
import { cn } from "./ui";

const navItems = [
  { href: "/", label: "Home", icon: Home },
  { href: "/inventory", label: "Inventory", icon: PackageOpen },
  { href: "/capture", label: "Add", icon: Camera, primary: true },
  { href: "/recipes", label: "Recipes", icon: Soup },
  { href: "/household", label: "Household", icon: CircleUserRound },
];

function ShellChrome({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { online, syncState, syncError, conflicts, outbox } = useOfflineInventory();
  const publicRoute =
    pathname.startsWith("/sign-in") ||
    pathname.startsWith("/invite/") ||
    pathname.startsWith("/onboarding/") ||
    pathname.startsWith("/auth/") ||
    pathname === "/privacy" ||
    pathname === "/~offline";

  if (publicRoute) {
    return (
      <div className="min-h-dvh">
        {pathname === "/~offline" && !online ? (
          <div className="mx-auto mt-3 flex w-[calc(100%-2rem)] max-w-3xl items-center gap-2 rounded-2xl bg-[#fff4cc] px-4 py-2.5 text-sm font-semibold text-[#66531b]" role="status">
            <CloudOff className="size-4 shrink-0" aria-hidden="true" />
            <span className="flex-1">Offline — inventory edits will sync when this app is open and reconnected.</span>
            {outbox.length > 0 ? <span className="shrink-0">{outbox.length} pending</span> : null}
          </div>
        ) : null}
        {children}
      </div>
    );
  }

  return (
    <div className="min-h-dvh pb-[calc(5.75rem+env(safe-area-inset-bottom))] md:pb-8">
      <header className="safe-top mx-auto flex w-full max-w-3xl items-center justify-between px-5 pb-2 sm:px-6">
        <Link href="/" className="inline-flex min-h-11 items-center gap-2 rounded-full pr-3" aria-label="Foodtopia home">
          <span className="flex size-9 items-center justify-center rounded-xl bg-[var(--leaf)] text-lg font-black text-white">F</span>
          <span className="text-lg font-extrabold tracking-[-0.04em]">foodtopia</span>
        </Link>
        <div className="flex items-center gap-2 text-xs font-semibold text-[var(--muted)]">
          {syncState === "syncing" && <RefreshCw className="size-4 animate-spin" aria-hidden="true" />}
          {outbox.length > 0 && <span>{outbox.length} pending</span>}
        </div>
      </header>

      {!online && (
        <div className="mx-auto mb-2 flex w-[calc(100%-2rem)] max-w-3xl items-center gap-2 rounded-2xl bg-[#fff4cc] px-4 py-2.5 text-sm font-semibold text-[#66531b]" role="status">
          <CloudOff className="size-4 shrink-0" aria-hidden="true" />
          Offline — inventory edits will sync when this app is open and reconnected.
        </div>
      )}
      {online && syncState === "error" && syncError && (
        <div className="mx-auto mb-2 flex w-[calc(100%-2rem)] max-w-3xl items-center gap-2 rounded-2xl bg-[var(--tomato-soft)] px-4 py-2.5 text-sm text-[#7d3829]" role="status">
          <TriangleAlert className="size-4 shrink-0" aria-hidden="true" />
          <span className="line-clamp-2">Sync paused: {syncError}</span>
        </div>
      )}
      {conflicts.length > 0 && (
        <Link href="/inventory#sync-conflicts" className="mx-auto mb-2 flex min-h-11 w-[calc(100%-2rem)] max-w-3xl items-center gap-2 rounded-2xl bg-[#fff0e9] px-4 py-2.5 text-sm font-bold text-[#843b2b]">
          <TriangleAlert className="size-4 shrink-0" aria-hidden="true" />
          A household member changed an item. Review {conflicts.length} sync conflict{conflicts.length === 1 ? "" : "s"}.
        </Link>
      )}

      {children}

      <nav className="safe-bottom fixed inset-x-0 bottom-0 z-40 mx-auto border-t border-[var(--line)] bg-[rgba(255,253,248,0.94)] px-2 pt-2 shadow-[0_-12px_35px_rgba(42,54,44,0.08)] backdrop-blur-xl md:bottom-5 md:max-w-[680px] md:rounded-[1.5rem] md:border">
        <ul className="mx-auto grid max-w-3xl grid-cols-5 items-end">
          {navItems.map((item) => {
            const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
            const Icon = item.icon;
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-2xl px-1 text-[0.68rem] font-bold transition",
                    active ? "text-[var(--leaf)]" : "text-[#718078] hover:text-[var(--ink)]",
                    item.primary && "relative -mt-5",
                  )}
                >
                  <span
                    className={cn(
                      "flex size-7 items-center justify-center rounded-xl",
                      item.primary && "size-12 rounded-2xl bg-[var(--tomato)] text-white shadow-lg shadow-[#e6674e]/20",
                      active && !item.primary && "bg-[var(--sprout)]",
                    )}
                  >
                    <Icon className={item.primary ? "size-5" : "size-[1.15rem]"} strokeWidth={2.3} aria-hidden="true" />
                  </span>
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <OfflineProvider>
      <ServiceWorkerRegistration />
      <ShellChrome>{children}</ShellChrome>
    </OfflineProvider>
  );
}
