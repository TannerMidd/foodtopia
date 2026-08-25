"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { Camera, Home, Refrigerator, Sun, Utensils } from "lucide-react";
import { OfflineProvider, useOfflineInventory } from "./offline-provider";
import { ServiceWorkerRegistration } from "./service-worker-registration";
import { cn } from "./ui";

const navItems = [
  { href: "/", label: "today", icon: Sun },
  { href: "/inventory", label: "kitchen", icon: Refrigerator },
  { href: "/capture", label: "add food", icon: Camera, desktopOnly: true },
  { href: "/recipes", label: "cook", icon: Utensils },
  // "house" keeps the four mobile tabs inside the floating bar; the desktop
  // rail spells the destination out in full.
  { href: "/household", label: "household", shortLabel: "house", icon: Home },
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

/*
 * The mark: a bowl with something in it. Round, full, domestic — the shape
 * the whole interface is built from.
 */
export function BowlMark({ size = 26 }: { size?: number }) {
  return (
    <span
      aria-hidden="true"
      className="relative flex flex-none items-end justify-center overflow-hidden rounded-full bg-[var(--accent)]"
      style={{ width: size, height: size }}
    >
      <span
        className="absolute rounded-full bg-[var(--ink)]"
        style={{ top: size * 0.19, width: size * 0.46, height: size * 0.46 }}
      />
      <span
        className="bg-[var(--sage)]"
        style={{ width: size * 0.77, height: size * 0.27, borderRadius: `${size}px ${size}px 0 0` }}
      />
    </span>
  );
}

function Wordmark({ mark = 26, text = 17 }: { mark?: number; text?: number }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <BowlMark size={mark} />
      <span
        className="font-[family-name:var(--font-familjen)] font-semibold tracking-[-0.02em] text-[var(--ink)]"
        style={{ fontSize: text }}
      >
        Foodtopia
      </span>
    </span>
  );
}

function syncLines({
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
  if (!online) return { head: "offline", sub: "edits are queued here" };
  if (syncState === "syncing") return { head: "syncing…", sub: "" };
  const stamp = lastSyncedAt
    ? `synced ${new Date(lastSyncedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })}`
    : "not synced yet";
  return { head: stamp, sub: pending > 0 ? `${pending} waiting` : "nothing waiting" };
}

function ShellChrome({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { online, syncState, syncError, conflicts, outbox, lastSyncedAt } = useOfflineInventory();
  const publicRoute = isPublicAppRoute(pathname);

  if (publicRoute) {
    return (
      <div className="min-h-dvh">
        {pathname === "/~offline" && !online ? (
          <p className="m mx-auto w-full max-w-3xl px-5 pt-4 text-[10.5px] text-[var(--accent)]" role="status">
            offline — inventory edits sync when this app is open and reconnected
            {outbox.length > 0 ? ` · ${outbox.length} waiting` : ""}
          </p>
        ) : null}
        {children}
      </div>
    );
  }

  const status = syncLines({ online, syncState, pending: outbox.length, lastSyncedAt });

  return (
    <div className="min-h-dvh md:flex">
      {/* Desktop: a warm rail of pills. The active destination is the one
          solid terracotta pill on the screen. */}
      <aside className="sticky top-0 hidden h-dvh w-56 flex-none flex-col px-[18px] py-[26px] md:flex">
        <Link href="/" className="px-2" aria-label="Foodtopia home">
          <Wordmark mark={32} text={20} />
        </Link>
        <nav className="mt-7 flex flex-col gap-1">
          {navItems.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex h-12 items-center gap-3 rounded-3xl px-[18px] text-[15px] transition",
                  active
                    ? "bg-[var(--accent)] font-semibold text-[var(--accent-ink)]"
                    : "font-medium text-[var(--ink-3)] hover:bg-[var(--ground-hi)] hover:text-[var(--ink)]",
                )}
              >
                <item.icon className="size-[17px] shrink-0" aria-hidden="true" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
        <span className="flex-1" />
        <div className="flex flex-col gap-3 px-1">
          <Link href="/settings" className="m text-[12px] text-[var(--ink-4)] hover:text-[var(--ink-2)]">
            settings
          </Link>
          <div className="rounded-[20px] bg-[var(--ground-hi)] px-[18px] py-4" role="status">
            <p className="m text-[12.5px] font-semibold text-[var(--ink-2)]">{status.head}</p>
            {status.sub && <p className="m mt-1 text-[12px] text-[var(--ink-5)]">{status.sub}</p>}
          </div>
        </div>
      </aside>

      <div className="min-w-0 flex-1 pb-[calc(6.5rem+env(safe-area-inset-bottom))] md:pb-0">
        {/* Mobile: the same mark and the same one line of status. */}
        <header className="safe-top flex items-center justify-between px-5 pb-1 md:hidden">
          <Link href="/" aria-label="Foodtopia home">
            <Wordmark mark={26} text={17} />
          </Link>
          <p className="m text-[11px] text-[var(--ink-5)]" role="status">
            {status.head}
            {status.sub ? ` · ${status.sub}` : ""}
          </p>
        </header>

        {online && syncState === "error" && syncError && (
          <p
            className="m mx-auto w-full max-w-3xl px-5 pt-3 text-[10.5px] leading-relaxed text-[var(--accent)] sm:px-8"
            role="status"
          >
            sync paused · {syncError}
          </p>
        )}
        {conflicts.length > 0 && (
          <Link
            href="/inventory#sync-conflicts"
            className="m mx-auto flex w-full max-w-3xl rounded-[16px] bg-[var(--ground-hi)] px-4 py-3 text-[10.5px] leading-relaxed text-[var(--accent)] sm:px-8"
          >
            a household member changed an item · review {conflicts.length} conflict
            {conflicts.length === 1 ? "" : "s"}
          </Link>
        )}

        {children}

        {/* Mobile: a floating pill bar. The active destination is the one
            solid terracotta pill on the screen. */}
        <nav className="safe-bottom fixed inset-x-0 bottom-0 z-40 px-2 pb-5 md:hidden">
          <div className="flex h-16 items-center justify-between rounded-[32px] bg-[var(--ground-hi)] px-1 shadow-[0_8px_24px_rgba(23,19,16,0.55)]">
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
                      "flex min-h-12 items-center gap-1.5 rounded-3xl text-[13px] transition",
                      active
                        ? "bg-[var(--accent)] px-2.5 font-semibold text-[var(--accent-ink)]"
                        : "px-2 font-medium text-[var(--ink-5)]",
                    )}
                  >
                    {/* Only the active destination gets its icon — the design's
                        quiet bar keeps the inactive tabs to words alone. */}
                    {active && <item.icon className="size-4 shrink-0" aria-hidden="true" />}
                    <span>{item.shortLabel ?? item.label}</span>
                  </Link>
                );
              })}
          </div>
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
