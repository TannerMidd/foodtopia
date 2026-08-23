"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { ArrowRight, LoaderCircle, Mail } from "lucide-react";
import { ApiClientError, acceptHouseholdInvite, bootstrapHousehold } from "@/lib/client/api";
import {
  clearFoodtopiaCaches,
  getAuthenticatedUser,
  requestAdminPasswordLogin,
  requestMagicLink,
} from "@/lib/client/auth";
import { normalizeInternalPath } from "@/lib/internal-path";
import { useOfflineInventory } from "./offline-provider";
import { Button, Field, StateNotice, cn, inputClass } from "./ui";

/*
 * The sign-in surfaces are the one place the app shows a frame. On phones it
 * stays a single quiet, centred sheet with the lit mark on top. From `lg` up
 * the frame becomes a two-panel spread: a brand rail that gives the page real
 * desktop presence, and the form sheet on a hairline of its own.
 */

/* The lit mark: one small lamp and the wordmark, nothing heavier. */
function Mark({ className }: { className?: string }) {
  return (
    <Link href="/" className={cn("inline-flex items-center gap-2.5", className)} aria-label="Foodtopia home">
      <span className="lamp size-[7px] rounded-[1px]" aria-hidden="true" />
      <span className="text-[16px] font-light tracking-[0.01em]">foodtopia</span>
    </Link>
  );
}

const BRAND_FACTS = [
  ["photograph", "Grocery photos are read and counted into a live inventory."],
  ["together", "One household shares one list — what's running low, who's cooking."],
  ["private", "Photos and stock stay inside your household. Nothing is public."],
] as const;

function BrandRail() {
  return (
    <aside className="relative hidden overflow-hidden border-r border-[var(--hairline)] lg:flex lg:flex-col">
      {/* Accent as light: one wide, faint halo entering from the top left. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(56rem_30rem_at_10%_-10%,var(--accent-halo),transparent_70%)]"
      />
      <div className="relative flex h-full flex-col justify-between px-14 py-10 xl:px-20 xl:py-12">
        <Mark />
        <div className="max-w-[36rem] py-12">
          <p className="ml">a quieter kitchen ledger</p>
          <h2 className="hd mt-5 text-[clamp(1.9rem,3vw,2.7rem)]">
            From grocery photo to tonight&rsquo;s dinner.
          </h2>
          <p className="bd mt-5 max-w-[30rem] text-[15px]">
            Foodtopia keeps a calm, countable record of your household&rsquo;s food — what you
            have, what it will become, and what to buy next.
          </p>
          <div className="ledger mt-10 max-w-[32rem]">
            {BRAND_FACTS.map(([label, text]) => (
              <div className="row" key={label}>
                <p className="ml w-24 flex-none pt-0.5">{label}</p>
                <p className="bd flex-1">{text}</p>
              </div>
            ))}
          </div>
        </div>
        <p className="m text-[11px] lowercase tracking-[0.14em] text-[var(--ink-6)]">private beta</p>
      </div>
    </aside>
  );
}

function AuthFrame({ children }: { children: React.ReactNode }) {
  return (
    <main className="safe-top safe-bottom flex min-h-dvh w-full flex-col lg:grid lg:grid-cols-[minmax(0,1fr)_30rem] xl:grid-cols-[minmax(0,1fr)_34rem]">
      <BrandRail />
      <div className="relative flex flex-1 items-center justify-center px-6 py-10 sm:px-10 lg:px-14">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-64 bg-[radial-gradient(30rem_14rem_at_50%_-20%,var(--accent-halo),transparent_70%)] lg:hidden"
        />
        <div className="relative w-full max-w-[24rem]">
          <Mark className="lg:hidden" />
          {children}
        </div>
      </div>
    </main>
  );
}

function MagicLinkForm({ nextPath = "/", invitation = false }: { nextPath?: string; invitation?: boolean }) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<"idle" | "sent" | "demo" | "error">("idle");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setState("idle");
    try {
      const result = await requestMagicLink(email.trim(), nextPath);
      setState(result.demo ? "demo" : "sent");
    } catch {
      // Keep the message generic so the UI does not reveal beta membership.
      setState("error");
    } finally {
      setBusy(false);
    }
  }

  if (state === "sent") {
    return (
      <div role="status">
        <p className="ml">check your email</p>
        <h2 className="hd mt-3 text-[22px]">A link is on its way.</h2>
        <p className="bd mt-2.5">
          If this address has private-beta access, a one-time sign-in link has been sent. It expires,
          so open it on this device soon.
        </p>
        <button
          type="button"
          className="m mt-6 min-h-9 text-[10.5px] text-[var(--ink-4)] hover:text-[var(--ink)]"
          onClick={() => setState("idle")}
        >
          use another email
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={(event) => void submit(event)}>
      <label htmlFor="auth-email" className="ml block">
        Email
      </label>
      <div className="mt-2.5 flex items-center gap-3 border-b border-[var(--edge-strong)] pb-3 focus-within:border-[var(--accent)]">
        <Mail className="size-4 flex-none text-[var(--ink-6)]" aria-hidden="true" />
        <input
          id="auth-email"
          name="email"
          type="email"
          autoComplete="email"
          required
          className="bd min-h-8 w-full bg-transparent text-[var(--ink)] focus:outline-none"
          placeholder="you@example.com"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </div>
      {state === "error" && (
        <div className="mt-5">
          <StateNotice title="Sign-in email not sent" tone="error">
            A link could not be sent right now. Check the address and try again later.
          </StateNotice>
        </div>
      )}
      {state === "demo" && (
        <div className="mt-5">
          <StateNotice title="Email is off in this demo" tone="warning">
            This build has no email provider connected. You can still explore the demo household on
            this device.
          </StateNotice>
        </div>
      )}
      <Button type="submit" className="mt-6 w-full" busy={busy}>
        {invitation ? "Continue with email" : "Send a sign-in link"}
        <ArrowRight className="size-4 text-[var(--accent-ink)]" aria-hidden="true" />
      </Button>
      {state === "demo" && (
        <Link
          href="/"
          className="m mt-5 flex min-h-9 items-center justify-center text-[10.5px] text-[var(--ink-4)] hover:text-[var(--ink)]"
        >
          explore the demo household
        </Link>
      )}
    </form>
  );
}

function AdminPasswordForm({ nextPath }: { nextPath: string }) {
  const { clear } = useOfflineInventory();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setFailed(false);
    try {
      await requestAdminPasswordLogin(username, password);
    } catch {
      setPassword("");
      setFailed(true);
      setBusy(false);
      return;
    }

    // Authentication has already succeeded and its response contains the new
    // session cookies. Mobile browsers can reject IndexedDB or CacheStorage
    // cleanup independently; that must not be reported as bad credentials.
    setPassword("");
    await Promise.allSettled([clear(), clearFoodtopiaCaches()]);
    window.location.replace(normalizeInternalPath(nextPath));
  }

  return (
    <form onSubmit={(event) => void submit(event)}>
      <Field label="Username" htmlFor="admin-username">
        <input
          id="admin-username"
          name="username"
          type="text"
          autoComplete="username"
          required
          minLength={1}
          maxLength={64}
          className={inputClass}
          value={username}
          onChange={(event) => setUsername(event.target.value)}
        />
      </Field>
      <div className="mt-6">
        <Field label="Password" htmlFor="admin-password">
          <input
            id="admin-password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            minLength={8}
            maxLength={256}
            className={inputClass}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </Field>
      </div>
      {failed ? (
        <div className="mt-5">
          <StateNotice title="Admin sign-in failed" tone="error">
            Invalid username or password.
          </StateNotice>
        </div>
      ) : null}
      <Button type="submit" className="mt-6 w-full" busy={busy}>
        Sign in as admin
        <ArrowRight className="size-4 text-[var(--accent-ink)]" aria-hidden="true" />
      </Button>
    </form>
  );
}

export function SignInScreen({
  nextPath = "/",
  householdDeletion,
  authError,
  adminLoginEnabled = false,
}: {
  nextPath?: string;
  householdDeletion?: "pending" | "complete";
  authError?: "invalid_link";
  adminLoginEnabled?: boolean;
}) {
  return (
    <AuthFrame>
      {householdDeletion ? (
        <div className="mt-10">
          <StateNotice
            title={
              householdDeletion === "pending" ? "Household deletion scheduled" : "Household deleted"
            }
            tone="success"
          >
            {householdDeletion === "pending"
              ? "Access is quarantined now. Private data will be permanently removed after outstanding upload links expire."
              : "The household and its private application data were removed."}
          </StateNotice>
        </div>
      ) : null}
      {authError ? (
        <div className="mt-10">
          <StateNotice title="That sign-in link could not be completed" tone="error">
            Request a fresh link below. Your invitation and offline household data are unchanged.
          </StateNotice>
        </div>
      ) : null}

      {adminLoginEnabled ? (
        <section className="mt-12 border-b border-[var(--hairline)] pb-10">
          <p className="ml">testing access</p>
          <h1 className="hd mt-3 text-[22px]">Administrator sign-in</h1>
          <p className="bd mt-2.5">Use the configured administrator username and password.</p>
          <div className="mt-7">
            <AdminPasswordForm nextPath={nextPath} />
          </div>
        </section>
      ) : null}

      <section className={adminLoginEnabled ? "mt-10" : "mt-12"}>
        <p className="ml">private beta</p>
        <h1 className="hd mt-3 text-[26px] lg:text-[30px]">Welcome back.</h1>
        <p className="bd mt-2.5">
          Use the address that was invited to your household. There&rsquo;s no password to remember.
        </p>
        <div className="mt-8">
          <MagicLinkForm nextPath={nextPath} />
        </div>
      </section>

      <p className="bd mt-8 text-[13px] text-[var(--ink-5)]">
        Continuing means keeping household photos and inventory private, and acknowledging the{" "}
        <Link className="border-b border-[var(--edge-strong)] text-[var(--ink-3)]" href="/privacy">
          beta privacy notice
        </Link>
        . US English for now.
      </p>
    </AuthFrame>
  );
}

export function InviteScreen({ token }: { token: string }) {
  const { clear } = useOfflineInventory();
  const [state, setState] = useState<"checking" | "sign_in" | "accepting" | "error">("checking");

  useEffect(() => {
    let cancelled = false;
    async function acceptIfSignedIn() {
      try {
        const auth = await getAuthenticatedUser();
        if (cancelled) return;
        if (auth.demo || !auth.user) {
          setState("sign_in");
          return;
        }
        setState("accepting");
        await acceptHouseholdInvite(token);
        await clear();
        if (!cancelled) window.location.replace("/");
      } catch (error) {
        if (cancelled) return;
        if (error instanceof ApiClientError && error.status === 401) setState("sign_in");
        else setState("error");
      }
    }
    void acceptIfSignedIn();
    return () => {
      cancelled = true;
    };
  }, [clear, token]);

  return (
    <AuthFrame>
      <section className="mt-12">
        <p className="ml">household invite</p>
        <h1 className="hd mt-3 text-[26px]">Join the shared kitchen.</h1>
        <p className="bd mt-2.5">
          Enter the invited email. Membership is checked after the one-time sign-in link opens.
        </p>
        <div className="mt-8">
          {state === "sign_in" && (
            <MagicLinkForm invitation nextPath={`/invite/${encodeURIComponent(token)}`} />
          )}
          {(state === "checking" || state === "accepting") && (
            <p className="m flex items-center gap-3 text-[11px] text-[var(--ink-4)]" role="status">
              <LoaderCircle className="size-4 animate-spin text-[var(--accent)]" aria-hidden="true" />
              {state === "checking" ? "checking your sign-in…" : "joining the household…"}
            </p>
          )}
          {state === "error" && (
            <StateNotice title="This invitation could not be accepted" tone="error">
              It may be expired, already used by another account, or intended for a different email.
              Ask the household owner for a new invitation.
            </StateNotice>
          )}
        </div>
      </section>
    </AuthFrame>
  );
}

export function OnboardingScreen({ token }: { token: string }) {
  const { clear } = useOfflineInventory();
  const [authState, setAuthState] = useState<"checking" | "sign_in" | "ready">("checking");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void getAuthenticatedUser()
      .then((auth) => {
        if (!cancelled) setAuthState(auth.demo || !auth.user ? "sign_in" : "ready");
      })
      .catch(() => {
        if (!cancelled) setAuthState("sign_in");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function createHousehold(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(false);
    try {
      await bootstrapHousehold(name, token);
      await clear();
      window.location.replace("/");
    } catch {
      setError(true);
      setBusy(false);
    }
  }

  return (
    <AuthFrame>
      <section className="mt-12">
        <p className="ml">private-beta invitation</p>
        <h1 className="hd mt-3 text-[26px]">Create your shared kitchen.</h1>
        <p className="bd mt-2.5">
          Sign in with the invited email, then choose the household name everyone will see.
        </p>
        <div className="mt-8">
          {authState === "checking" && (
            <p className="m flex items-center gap-3 text-[11px] text-[var(--ink-4)]" role="status">
              <LoaderCircle className="size-4 animate-spin text-[var(--accent)]" aria-hidden="true" />
              checking your invitation…
            </p>
          )}
          {authState === "sign_in" && (
            <MagicLinkForm invitation nextPath={`/onboarding/${encodeURIComponent(token)}`} />
          )}
          {authState === "ready" && (
            <form onSubmit={(event) => void createHousehold(event)}>
              <Field
                label="Household name"
                htmlFor="household-name"
                hint="For example, Maple Street or The Parkers"
              >
                <input
                  id="household-name"
                  required
                  minLength={2}
                  maxLength={80}
                  className={inputClass}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </Field>
              {error && (
                <div className="mt-5">
                  <StateNotice title="Household not created" tone="error">
                    The invitation may be expired, used, or meant for another email. Ask the beta
                    coordinator for a new link.
                  </StateNotice>
                </div>
              )}
              <Button type="submit" className="mt-6 w-full" busy={busy}>
                Create household
                <ArrowRight className="size-4 text-[var(--accent-ink)]" aria-hidden="true" />
              </Button>
            </form>
          )}
        </div>
      </section>
    </AuthFrame>
  );
}

export function AuthCompletion({ nextPath }: { nextPath: string }) {
  const { clear } = useOfflineInventory();

  useEffect(() => {
    let cancelled = false;
    async function finish() {
      try {
        await clear();
        await clearFoodtopiaCaches();
      } finally {
        if (!cancelled) window.location.replace(normalizeInternalPath(nextPath));
      }
    }
    void finish();
    return () => {
      cancelled = true;
    };
  }, [clear, nextPath]);

  return (
    <AuthFrame>
      <section className="mt-12" role="status">
        <p className="ml">signing in</p>
        <h1 className="hd mt-3 flex items-center gap-3 text-[26px]">
          <LoaderCircle className="size-5 animate-spin text-[var(--accent)]" aria-hidden="true" />
          Opening your kitchen
        </h1>
        <p className="bd mt-2.5">Preparing a clean offline store for this account.</p>
      </section>
    </AuthFrame>
  );
}
