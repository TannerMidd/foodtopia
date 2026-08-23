"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Inbox, LoaderCircle, RefreshCw } from "lucide-react";

import {
  ApiClientError,
  disableBetaAccounts,
  enableBetaAccounts,
  listBetaAccounts,
  setSignupWindow,
} from "@/lib/client/api";
import type { BetaAccount, BetaAccountsResponse } from "@/contracts/api";
import { Button, EmptyState, Page, PageHeader, StateNotice, cn } from "./ui";

/*
 * Beta admissions console. One operator surface: open or close the public
 * signup window, review who is waiting, and enable exactly the chosen
 * accounts in one batch. Every mutation goes through the admin API, which
 * re-verifies the administrator identity server-side.
 */

function stamp(value: string | null) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? null
    : parsed.toLocaleString([], {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });
}

function AccountRow({
  account,
  children,
}: {
  account: BetaAccount;
  children?: ReactNode;
}) {
  const joined = stamp(account.createdAt);
  const enabled = stamp(account.enabledAt);
  return (
    <div className="flex min-h-11 flex-wrap items-center gap-x-4 gap-y-1 py-1.5">
      <span className="bd min-w-0 flex-1 break-all">{account.email}</span>
      <span className="m flex-none text-[10.5px] text-[var(--ink-5)]">
        {enabled ? `enabled ${enabled}` : joined ? `requested ${joined}` : ""}
      </span>
      {children}
    </div>
  );
}

export function AdminBetaScreen() {
  const [roster, setRoster] = useState<BetaAccountsResponse | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [working, setWorking] = useState<"load" | "enable" | "disable" | "window" | null>("load");
  const [confirmingDisable, setConfirmingDisable] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  const load = useCallback(async () => {
    setWorking("load");
    setLoadFailed(false);
    try {
      setRoster(await listBetaAccounts());
    } catch {
      setLoadFailed(true);
    } finally {
      setWorking(null);
    }
  }, []);

  useEffect(() => {
    // Deferred like the other screens so the effect body never sets state
    // synchronously; the roster arrives through promise callbacks.
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  function errorMessage(error: unknown, fallback: string) {
    return error instanceof ApiClientError && error.message ? error.message : fallback;
  }

  async function enable(userIds: string[]) {
    if (userIds.length === 0 || working) return;
    setWorking("enable");
    setNotice(null);
    try {
      const { changedCount } = await enableBetaAccounts(userIds);
      setSelected(new Set());
      setNotice({
        tone: "success",
        text: `Enabled ${changedCount} of ${userIds.length} selected account${userIds.length === 1 ? "" : "s"}.`,
      });
      await load();
    } catch (error) {
      setNotice({ tone: "error", text: errorMessage(error, "The accounts could not be enabled.") });
      setWorking(null);
    }
  }

  async function disable(userIds: string[]) {
    if (userIds.length === 0 || working) return;
    setWorking("disable");
    setNotice(null);
    try {
      const { changedCount } = await disableBetaAccounts(userIds);
      setConfirmingDisable(null);
      setNotice({
        tone: "success",
        text: `Disabled ${changedCount} account${changedCount === 1 ? "" : "s"}. Their access ends immediately.`,
      });
      await load();
    } catch (error) {
      setNotice({
        tone: "error",
        text: errorMessage(error, "The accounts could not be disabled."),
      });
      setWorking(null);
    }
  }

  async function toggleWindow(open: boolean) {
    if (working) return;
    setWorking("window");
    setNotice(null);
    try {
      await setSignupWindow(open);
      setNotice({
        tone: "success",
        text: open
          ? "The open-beta signup window is open."
          : "The open-beta signup window is closed. Existing requests stay pending.",
      });
      await load();
    } catch (error) {
      setNotice({
        tone: "error",
        text: errorMessage(error, "The signup window could not be updated."),
      });
      setWorking(null);
    }
  }

  function toggleSelected(userId: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  }

  const pending = roster?.accounts.filter((a) => a.status === "pending") ?? [];
  const enabledAccounts = roster?.accounts.filter((a) => a.status === "enabled") ?? [];
  const disabledAccounts = roster?.accounts.filter((a) => a.status === "disabled") ?? [];
  const allPendingSelected = pending.length > 0 && pending.every((a) => selected.has(a.userId));

  return (
    <Page className="max-w-[52rem]">
      <PageHeader
        eyebrow="beta operations"
        title="Admissions"
        description="Review open-beta signups and enable exactly who should get in, in batches you choose."
        action={
          <Button variant="ghost" size="small" onClick={() => void load()} busy={working === "load"}>
            <RefreshCw className="size-3.5" aria-hidden="true" />
            refresh
          </Button>
        }
      />

      {notice && (
        <div className="mb-7">
          <StateNotice
            title={notice.tone === "success" ? "Done" : "Not completed"}
            tone={notice.tone}
          >
            {notice.text}
          </StateNotice>
        </div>
      )}

      {loadFailed && (
        <div className="mb-7">
          <StateNotice title="The roster could not be loaded" tone="error">
            Check your connection and refresh. Nothing was changed.
          </StateNotice>
        </div>
      )}

      {roster && (
        <>
          <section className="ledger mb-9">
            <div className="row">
              <p className="ml w-28 flex-none pt-0.5">signup window</p>
              <div className="flex flex-1 flex-wrap items-center justify-between gap-3">
                <p className="bd">
                  {roster.signupsOpen
                    ? "Open — anyone with the invite link can request an account."
                    : "Closed — only personal invitations can create accounts."}
                </p>
                <Button
                  variant="secondary"
                  size="small"
                  busy={working === "window"}
                  onClick={() => void toggleWindow(!roster.signupsOpen)}
                >
                  {roster.signupsOpen ? "Close signups" : "Open signups"}
                </Button>
              </div>
            </div>
            <div className="row">
              <p className="ml w-28 flex-none pt-0.5">accounts</p>
              <p className="bd">
                {roster.counts.pending} waiting · {roster.counts.enabled} enabled ·{" "}
                {roster.counts.disabled} disabled
              </p>
            </div>
          </section>

          <section className="mt-9">
            <div className="flex items-baseline justify-between gap-4">
              <p className="ml">waiting for review</p>
              <label className="m flex items-center gap-2 text-[10.5px] text-[var(--ink-4)]">
                <input
                  type="checkbox"
                  className="size-3.5 accent-[var(--accent-solid)]"
                  checked={allPendingSelected}
                  disabled={pending.length === 0}
                  onChange={() =>
                    setSelected(allPendingSelected ? new Set() : new Set(pending.map((a) => a.userId)))
                  }
                />
                select all
              </label>
            </div>
            <div className="mt-4 border-t border-[var(--hairline)]">
              {pending.length === 0 ? (
                <EmptyState
                  icon={<Inbox className="size-6" />}
                  title="Nobody is waiting"
                  description="New open-beta signups appear here for your review."
                />
              ) : (
                pending.map((account) => (
                  <AccountRow key={account.userId} account={account}>
                    <input
                      type="checkbox"
                      className="size-4 accent-[var(--accent-solid)]"
                      aria-label={`Enable ${account.email}`}
                      checked={selected.has(account.userId)}
                      onChange={() => toggleSelected(account.userId)}
                    />
                  </AccountRow>
                ))
              )}
            </div>
            {pending.length > 0 && (
              <div className="mt-5 flex items-center gap-4">
                <Button
                  onClick={() => void enable([...selected])}
                  busy={working === "enable"}
                  disabled={selected.size === 0}
                >
                  Enable selected ({selected.size})
                </Button>
                <p className="m text-[10.5px] text-[var(--ink-5)]">
                  Enabled accounts can sign in immediately.
                </p>
              </div>
            )}
          </section>

          <section className="mt-12">
            <p className="ml">enabled</p>
            <div className="mt-4 border-t border-[var(--hairline)]">
              {enabledAccounts.map((account) => (
                <AccountRow key={account.userId} account={account}>
                  {confirmingDisable === account.userId ? (
                    <span className="flex flex-none items-center gap-2">
                      <Button
                        variant="danger"
                        size="small"
                        busy={working === "disable"}
                        onClick={() => void disable([account.userId])}
                      >
                        confirm
                      </Button>
                      <button
                        type="button"
                        className="m min-h-11 text-[10.5px] text-[var(--ink-4)] hover:text-[var(--ink)]"
                        onClick={() => setConfirmingDisable(null)}
                      >
                        cancel
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      className={cn(
                        "m flex-none min-h-11 text-[10.5px]",
                        working ? "text-[var(--ink-6)]" : "text-[var(--ink-4)] hover:text-[var(--time)]",
                      )}
                      disabled={Boolean(working)}
                      onClick={() => setConfirmingDisable(account.userId)}
                    >
                      disable
                    </button>
                  )}
                </AccountRow>
              ))}
            </div>
          </section>

          {disabledAccounts.length > 0 && (
            <section className="mt-12">
              <p className="ml">disabled</p>
              <div className="mt-4 border-t border-[var(--hairline)]">
                {disabledAccounts.map((account) => (
                  <AccountRow key={account.userId} account={account}>
                    <button
                      type="button"
                      className="m flex-none min-h-11 text-[10.5px] text-[var(--ink-4)] hover:text-[var(--ink)] disabled:text-[var(--ink-6)]"
                      disabled={Boolean(working)}
                      onClick={() => void enable([account.userId])}
                    >
                      re-enable
                    </button>
                  </AccountRow>
                ))}
              </div>
            </section>
          )}
        </>
      )}

      {!roster && !loadFailed && (
        <p className="m flex items-center gap-3 text-[11px] text-[var(--ink-4)]" role="status">
          <LoaderCircle className="size-4 animate-spin text-[var(--accent)]" aria-hidden="true" />
          loading accounts…
        </p>
      )}
    </Page>
  );
}
