"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
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

const REFRESH_INTERVAL_MS = 30_000;
const MAX_ENABLE_BATCH = 50;

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
    <div className="row flex-wrap gap-x-4 gap-y-1">
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
  const [refreshing, setRefreshing] = useState(true);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<string | null>(null);
  const [working, setWorking] = useState<"enable" | "disable" | "window" | null>(null);
  const [confirmingDisable, setConfirmingDisable] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const mutationInFlight = useRef(false);
  const loadInFlight = useRef<Promise<void> | null>(null);

  const load = useCallback(() => {
    if (mutationInFlight.current) return Promise.resolve();
    if (loadInFlight.current) return loadInFlight.current;
    setRefreshing(true);
    setLoadFailed(false);
    const task = listBetaAccounts()
      .then((nextRoster) => {
        setRoster(nextRoster);
        const eligibleIds = new Set(
          nextRoster.accounts
            .filter((account) => account.status === "pending" && account.emailConfirmedAt)
            .map((account) => account.userId),
        );
        setSelected((current) =>
          new Set([...current].filter((userId) => eligibleIds.has(userId)).slice(0, MAX_ENABLE_BATCH)),
        );
        setLastRefreshedAt(new Date().toISOString());
      })
      .catch(() => {
        setLoadFailed(true);
      })
      .finally(() => {
        loadInFlight.current = null;
        setRefreshing(false);
      });
    loadInFlight.current = task;
    return task;
  }, []);

  useEffect(() => {
    function refreshWhenVisible() {
      if (document.visibilityState === "visible") void load();
    }
    const initialTimer = window.setTimeout(() => void load(), 0);
    const interval = window.setInterval(refreshWhenVisible, REFRESH_INTERVAL_MS);
    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [load]);

  function errorMessage(error: unknown, fallback: string) {
    return error instanceof ApiClientError && error.message ? error.message : fallback;
  }

  async function enable(userIds: string[]) {
    if (userIds.length === 0 || mutationInFlight.current || loadInFlight.current) return;
    const eligibleIds = new Set(
      (roster?.accounts ?? [])
        .filter(
          (account) =>
            (account.status === "pending" || account.status === "disabled") &&
            account.emailConfirmedAt,
        )
        .map((account) => account.userId),
    );
    const confirmedPendingIds = userIds
      .filter((userId) => eligibleIds.has(userId))
      .slice(0, MAX_ENABLE_BATCH);
    if (confirmedPendingIds.length === 0) {
      setSelected(new Set());
      return;
    }
    mutationInFlight.current = true;
    setWorking("enable");
    setNotice(null);
    let succeeded = false;
    try {
      const { changedCount } = await enableBetaAccounts(confirmedPendingIds);
      setSelected(new Set());
      setNotice({
        tone: "success",
        text: `Enabled ${changedCount} of ${confirmedPendingIds.length} selected account${confirmedPendingIds.length === 1 ? "" : "s"}.`,
      });
      succeeded = true;
    } catch (error) {
      setNotice({ tone: "error", text: errorMessage(error, "The accounts could not be enabled.") });
    } finally {
      mutationInFlight.current = false;
      setWorking(null);
    }
    if (succeeded) await load();
  }

  async function disable(userIds: string[]) {
    if (userIds.length === 0 || mutationInFlight.current || loadInFlight.current) return;
    mutationInFlight.current = true;
    setWorking("disable");
    setNotice(null);
    let succeeded = false;
    try {
      const { changedCount } = await disableBetaAccounts(userIds);
      setConfirmingDisable(null);
      setNotice({
        tone: "success",
        text: `Disabled ${changedCount} account${changedCount === 1 ? "" : "s"}. Their access ends immediately.`,
      });
      succeeded = true;
    } catch (error) {
      setNotice({
        tone: "error",
        text: errorMessage(error, "The accounts could not be disabled."),
      });
    } finally {
      mutationInFlight.current = false;
      setWorking(null);
    }
    if (succeeded) await load();
  }

  async function toggleWindow(open: boolean) {
    if (mutationInFlight.current || loadInFlight.current) return;
    mutationInFlight.current = true;
    setWorking("window");
    setNotice(null);
    let succeeded = false;
    try {
      await setSignupWindow(open);
      setNotice({
        tone: "success",
        text: open
          ? "The open-beta signup window is open."
          : "The open-beta signup window is closed. Existing requests stay pending.",
      });
      succeeded = true;
    } catch (error) {
      setNotice({
        tone: "error",
        text: errorMessage(error, "The signup window could not be updated."),
      });
    } finally {
      mutationInFlight.current = false;
      setWorking(null);
    }
    if (succeeded) await load();
  }

  function toggleSelected(userId: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(userId)) next.delete(userId);
      else if (next.size < MAX_ENABLE_BATCH) next.add(userId);
      return next;
    });
  }

  const pending = roster?.accounts.filter(
    (account) => account.status === "pending" && account.emailConfirmedAt,
  ) ?? [];
  const awaitingEmail = roster?.accounts.filter(
    (account) => account.status === "pending" && !account.emailConfirmedAt,
  ) ?? [];
  const enabledAccounts = roster?.accounts.filter((a) => a.status === "enabled") ?? [];
  const disabledAccounts = roster?.accounts.filter((a) => a.status === "disabled") ?? [];
  const selectableBatch = pending.slice(0, MAX_ENABLE_BATCH);
  const allPendingSelected = selectableBatch.length > 0 &&
    selectableBatch.every((account) => selected.has(account.userId));
  const controlsDisabled = Boolean(working) || refreshing;

  return (
    <Page className="max-w-[52rem]">
      <PageHeader
        eyebrow="beta operations"
        title="Admissions"
        description="Review open-beta signups and enable exactly who should get in, in batches you choose."
        action={
          <div className="flex flex-col items-end gap-1 sm:flex-row sm:items-center sm:gap-2">
            <Link
              href="/settings"
              className="m inline-flex min-h-11 items-center px-2 text-[10.5px] text-[var(--ink-4)] hover:text-[var(--ink)]"
            >
              back to settings
            </Link>
            <Button
              variant="ghost"
              size="small"
              onClick={() => void load()}
              busy={refreshing}
              disabled={Boolean(working)}
            >
              <RefreshCw className="size-3.5" aria-hidden="true" />
              refresh
            </Button>
          </div>
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
              <p className="ml w-28 flex-none">signup window</p>
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
                  disabled={refreshing}
                  onClick={() => void toggleWindow(!roster.signupsOpen)}
                >
                  {roster.signupsOpen ? "Close signups" : "Open signups"}
                </Button>
              </div>
            </div>
            <div className="row">
              <p className="ml w-28 flex-none">accounts</p>
              <p className="bd">
                {pending.length} waiting · {awaitingEmail.length} awaiting email ·{" "}
                {roster.counts.enabled} enabled ·{" "}
                {roster.counts.disabled} disabled
              </p>
            </div>
          </section>

          {lastRefreshedAt && (
            <p className="m -mt-6 mb-9 text-right text-[10.5px] text-[var(--ink-6)]" role="status">
              refreshed {stamp(lastRefreshedAt)} · updates automatically
            </p>
          )}

          <section className="mt-9">
            <div className="flex items-baseline justify-between gap-4">
              <p className="ml">waiting for review</p>
              <label className="m flex items-center gap-2 text-[10.5px] text-[var(--ink-4)]">
                <input
                  type="checkbox"
                  className="size-3.5 accent-[var(--accent)]"
                  checked={allPendingSelected}
                  disabled={selectableBatch.length === 0 || controlsDisabled}
                  onChange={() =>
                    setSelected(
                      allPendingSelected
                        ? new Set()
                        : new Set(selectableBatch.map((account) => account.userId)),
                    )
                  }
                />
                {pending.length > MAX_ENABLE_BATCH ? "select first 50" : "select all"}
              </label>
            </div>
            <div className="ledger mt-4">
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
                      className="size-4 accent-[var(--accent)]"
                      aria-label={`Enable ${account.email}`}
                      checked={selected.has(account.userId)}
                      disabled={
                        controlsDisabled ||
                        (!selected.has(account.userId) && selected.size >= MAX_ENABLE_BATCH)
                      }
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
                  disabled={selected.size === 0 || refreshing}
                >
                  Enable selected ({selected.size})
                </Button>
                <p className="m text-[10.5px] text-[var(--ink-5)]">
                  Enabled accounts can sign in immediately. Up to 50 per batch.
                </p>
              </div>
            )}
          </section>

          {awaitingEmail.length > 0 && (
            <section className="mt-12">
              <p className="ml">awaiting email confirmation</p>
              <div className="ledger mt-4">
                {awaitingEmail.map((account) => (
                  <AccountRow key={account.userId} account={account}>
                    <span className="m flex-none text-[10.5px] text-[var(--ink-6)]">
                      not approvable yet
                    </span>
                  </AccountRow>
                ))}
              </div>
            </section>
          )}

          <section className="mt-12">
            <p className="ml">enabled</p>
            <div className="ledger mt-4">
              {enabledAccounts.map((account) => (
                <AccountRow key={account.userId} account={account}>
                  {confirmingDisable === account.userId ? (
                    <span className="flex flex-none items-center gap-2">
                      <Button
                        variant="danger"
                        size="small"
                        busy={working === "disable"}
                        disabled={refreshing}
                        className="!min-h-9 rounded-lg bg-[var(--accent)] px-4 text-[12px] font-semibold !text-[var(--accent-ink)] hover:!text-[var(--accent-ink)]"
                        onClick={() => void disable([account.userId])}
                      >
                        confirm
                      </Button>
                      <button
                        type="button"
                        className="m min-h-9 rounded-lg px-3 text-[10.5px] text-[var(--ink-4)] hover:text-[var(--ink)]"
                        onClick={() => setConfirmingDisable(null)}
                      >
                        cancel
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      className={cn(
                        "m flex-none min-h-9 rounded-lg bg-[var(--ground-hi)] px-4 text-[10.5px] transition hover:bg-[var(--ground-tint)]",
                        controlsDisabled ? "text-[var(--ink-6)]" : "text-[var(--ink-2)] hover:text-[var(--accent)]",
                      )}
                      disabled={controlsDisabled}
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
              <div className="ledger mt-4">
                {disabledAccounts.map((account) => (
                  <AccountRow key={account.userId} account={account}>
                    <button
                      type="button"
                      className="m flex-none min-h-9 rounded-lg bg-[var(--ground-hi)] px-4 text-[10.5px] text-[var(--ink-2)] transition hover:bg-[var(--sage)] hover:text-[var(--sage-ink)] disabled:text-[var(--ink-6)] disabled:hover:bg-[var(--ground-hi)] disabled:hover:text-[var(--ink-2)]"
                      disabled={controlsDisabled}
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

      {!roster && !loadFailed && refreshing && (
        <p className="m flex items-center gap-3 text-[11px] text-[var(--ink-4)]" role="status">
          <LoaderCircle className="size-4 animate-spin text-[var(--accent)]" aria-hidden="true" />
          loading accounts…
        </p>
      )}
    </Page>
  );
}
