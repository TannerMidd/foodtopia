"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { OfflineProvider, useOfflineInventory } from "./offline-provider";
import { ServiceWorkerRegistration } from "./service-worker-registration";
import { cn } from "./ui";

const navItems = [
  { href: "/", label: "today" },
  { href: "/inventory", label: "kitchen" },
  { href: "/capture", label: "add food", desktopOnly: true },
  { href: "/recipes", label: "cook" },
  { href: "/household", label: "household" },
];

/** Routes that render without the nav rail or the mobile tab bar. */
export function isPublicAppRoute(pathname: string) {
  return (
    pathname.startsWith("/sign-in") ||
    pathname.startsWith("/sign-up") ||
    pathname.startsWith("/invite/") ||
    pathname.startsWith("/onboarding") ||
    pathname.startsWith("/auth/") ||
    pathname === "/pending" ||
    // The beta administration console is chrome-less; the proxy still requires
    // sign-in for it and the page verifies the administrator identity.
    pathname === "/admin" ||
    pathname.startsWith("/admin/") ||
    pathname === "/privacy" ||
    pathname === "/~offline"
  );
}

/*
 * Household data must not bind before an identity is verified, so the auth and
 * onboarding routes pause sync entirely. The offline fallback is deliberately
 * not one of them: it is only ever reached by a device that is already signed
 * in, and it is the one screen that still has to track connectivity, read the
 * local snapshot, and queue edits until the connection returns.
 */
export function isSyncPausedRoute(pathname: string) {
  return isPublicAppRoute(pathname) && pathname !== "/~offline";
}

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

/* The lit mark. One small lamp, never a logo block. */
function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <span className="lamp size-[7px] rounded-[1px]" aria-hidden="true" />
      <span className="text-[16px] font-light tracking-[0.01em]">foodtopia</span>
    </span>
  );
}

function syncLine({
  online,
  syncState,
  pending,
  lastSyncedAt,
}: {
  online: boolean;
  syncState: string;
  pending: number;
  lastSyncedAt?: string | null;
}) {
  if (!online) return "offline · edits are queued here";
  if (syncState === "syncing") return "syncing…";
  const stamp = lastSyncedAt
    ? `synced ${new Date(lastSyncedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })}`
    : "not synced yet";
  return `${stamp} · ${pending > 0 ? `${pending} waiting` : "nothing waiting"}`;
}

function ShellChrome({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { online, syncState, syncError, conflicts, outbox, lastSyncedAt } = useOfflineInventory();
  const publicRoute = isPublicAppRoute(pathname);

  if (publicRoute) {
    return (
      <div className="min-h-dvh">
        {pathname === "/~offline" && !online ? (
          <p className="m mx-auto w-full max-w-3xl px-5 pt-4 text-[10.5px] text-[var(--time)]" role="status">
            offline — inventory edits sync when this app is open and reconnected
            {outbox.length > 0 ? ` · ${outbox.length} waiting` : ""}
          </p>
        ) : null}
        {children}
      </div>
    );
  }

  const status = syncLine({ online, syncState, pending: outbox.length, lastSyncedAt });

  return (
    <div className="min-h-dvh md:flex">
      {/* Desktop: a quiet left rail. No icons — the words carry it. */}
      <aside className="sticky top-0 hidden h-dvh w-44 flex-none flex-col border-r border-[var(--hairline)] bg-[var(--ground)] py-7 md:flex">
        <Link href="/" className="px-6" aria-label="Foodtopia home">
          <Wordmark />
        </Link>
        <nav className="mt-9 flex flex-col">
          {navItems.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex h-[34px] items-center gap-2.5 px-6 text-[15px] transition",
                  active ? "text-[var(--ink)]" : "text-[var(--ink-4)] hover:text-[var(--ink)]",
                )}
              >
                <span
                  className={cn("size-1 rounded-[1px]", active && "bg-[var(--accent)]")}
                  aria-hidden="true"
                />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <span className="flex-1" />
        <div className="flex flex-col gap-2 px-6">
          <Link href="/settings" className="m text-[11px] text-[var(--ink-5)] hover:text-[var(--ink-2)]">
            settings
          </Link>
          <p className="m text-[11px] leading-relaxed text-[var(--ink-5)]" role="status">
            {status}
          </p>
        </div>
      </aside>

      <div className="min-w-0 flex-1 pb-[calc(4rem+env(safe-area-inset-bottom))] md:pb-0">
        {/* Mobile: the same mark and the same one line of status. */}
        <header className="safe-top flex items-center justify-between px-5 pb-1 md:hidden">
          <Link href="/" aria-label="Foodtopia home">
            <Wordmark className="text-[15px]" />
          </Link>
          <p className="m text-[11px] text-[var(--ink-5)]" role="status">
            {status}
          </p>
        </header>

        {online && syncState === "error" && syncError && (
          <p
            className="m mx-auto w-full max-w-3xl px-5 pt-3 text-[10.5px] leading-relaxed text-[var(--time)] sm:px-8"
            role="status"
          >
            sync paused · {syncError}
          </p>
        )}
        {conflicts.length > 0 && (
          <Link
            href="/inventory#sync-conflicts"
            className="m mx-auto flex w-full max-w-3xl px-5 pt-3 text-[10.5px] leading-relaxed text-[var(--time)] sm:px-8"
          >
            a household member changed an item · review {conflicts.length} conflict
            {conflicts.length === 1 ? "" : "s"}
          </Link>
        )}

        {children}

        {/* Mobile: four words on a hairline. The fifth destination is the lit
            action inside each screen, so it never needs a tab. */}
        <nav className="safe-bottom fixed inset-x-0 bottom-0 z-40 flex h-16 items-center justify-between border-t border-[var(--hairline)] bg-[var(--ground)] px-6 md:hidden">
          {navItems
            .filter((item) => !item.desktopOnly)
            .map((item) => {
              const active = isActive(pathname, item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex min-h-11 items-center gap-2 text-[14px] transition",
                    active ? "text-[var(--ink)]" : "text-[var(--ink-5)]",
                  )}
                >
                  {active && <span className="size-1 rounded-[1px] bg-[var(--accent)]" aria-hidden="true" />}
                  {item.label}
                </Link>
              );
            })}
        </nav>
      </div>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <OfflineProvider syncEnabled={!isSyncPausedRoute(pathname)}>
      <ServiceWorkerRegistration />
      <ShellChrome>{children}</ShellChrome>
    </OfflineProvider>
  );
}
