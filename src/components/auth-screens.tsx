"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { ArrowRight, LoaderCircle, Mail } from "lucide-react";
import {
  ApiClientError,
  acceptHouseholdInvite,
  bootstrapHousehold,
  getAccountStatus,
} from "@/lib/client/api";
import {
  clearFoodtopiaCaches,
  getAuthenticatedUser,
  requestAdminPasswordLogin,
  requestMagicLink,
  signInWithPassword,
  signOut,
  signUpWithPassword,
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

type MagicLinkAudience = "member" | "invite" | "open-beta";

const MAGIC_LINK_SENT_COPY: Record<
  MagicLinkAudience,
  { title: string; body: string }
> = {
  member: {
    title: "A link is on its way.",
    body:
      "If this address has private-beta access, a one-time sign-in link has been sent. It expires, so open it on this device soon.",
  },
  invite: {
    title: "A link is on its way.",
    body:
      "If this address was invited to the household, a one-time sign-in link has been sent. It expires, so open it on this device soon.",
  },
  "open-beta": {
    title: "You're on the list.",
    body:
      "A one-time link to finish creating your account has been sent. It expires soon, so open it on this device.",
  },
};

function MagicLinkForm({
  nextPath = "/",
  audience = "member",
}: {
  nextPath?: string;
  audience?: MagicLinkAudience;
}) {
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
    const copy = MAGIC_LINK_SENT_COPY[audience];
    return (
      <div role="status">
        <p className="ml">check your email</p>
        <h2 className="hd mt-3 text-[22px]">{copy.title}</h2>
        <p className="bd mt-2.5">{copy.body}</p>
        {audience === "open-beta" && (
          <div className="mt-5">
            <StateNotice title="Accounts start in review" tone="neutral">
              An administrator enables each new account before it can be used.
              After opening the link you&rsquo;ll see your account&rsquo;s
              review status.
            </StateNotice>
          </div>
        )}
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
        {audience === "open-beta"
          ? "Send a sign-up link"
          : audience === "invite"
            ? "Continue with email"
            : "Send a sign-in link"}
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

function PasswordSignInForm({ nextPath }: { nextPath: string }) {
  const { clear } = useOfflineInventory();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<"idle" | "demo" | "error">("idle");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setState("idle");
    try {
      const result = await signInWithPassword(email.trim(), password);
      if (result.demo) {
        setState("demo");
        setBusy(false);
        return;
      }
    } catch {
      setPassword("");
      setState("error");
      setBusy(false);
      return;
    }

    setPassword("");
    await Promise.allSettled([clear(), clearFoodtopiaCaches()]);
    window.location.replace(normalizeInternalPath(nextPath));
  }

  return (
    <form onSubmit={(event) => void submit(event)}>
      <Field label="Email" htmlFor="member-email">
        <input
          id="member-email"
          name="email"
          type="email"
          autoComplete="email"
          required
          maxLength={320}
          className={inputClass}
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </Field>
      <div className="mt-6">
        <Field label="Password" htmlFor="member-password">
          <input
            id="member-password"
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
      {state === "error" ? (
        <div className="mt-5">
          <StateNotice title="Sign-in failed" tone="error">
            Check your email and password, then try again.
          </StateNotice>
        </div>
      ) : null}
      {state === "demo" ? (
        <div className="mt-5">
          <StateNotice title="Accounts are off in this demo" tone="warning">
            This build has no account provider connected. You can still explore the demo household.
          </StateNotice>
        </div>
      ) : null}
      <Button type="submit" className="mt-6 w-full" busy={busy}>
        Sign in
        <ArrowRight className="size-4 text-[var(--accent-ink)]" aria-hidden="true" />
      </Button>
      {state === "demo" ? (
        <Link
          href="/"
          className="m mt-5 flex min-h-9 items-center justify-center text-[10.5px] text-[var(--ink-4)] hover:text-[var(--ink)]"
        >
          explore the demo household
        </Link>
      ) : null}
    </form>
  );
}

function PasswordSignUpForm() {
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<
    "idle" | "sent" | "sign-in" | "demo" | "mismatch" | "error"
  >("idle");

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (password !== confirmation) {
      setState("mismatch");
      return;
    }
    setBusy(true);
    setState("idle");
    try {
      const result = await signUpWithPassword(
        displayName.trim(),
        email.trim(),
        password,
        "/",
      );
      if (result.demo) {
        setState("demo");
      } else if (result.signedIn) {
        window.location.replace("/pending");
      } else {
        setState("sign-in");
      }
    } catch {
      setState("error");
    } finally {
      setPassword("");
      setConfirmation("");
      setBusy(false);
    }
  }

  if (state === "sent") {
    return (
      <div role="status">
        <p className="ml">check your email</p>
        <h2 className="hd mt-3 text-[22px]">Confirm your email address.</h2>
        <p className="bd mt-2.5">
          Open the confirmation email, then sign in with your email and password. Your account will
          remain in review until an administrator enables it.
        </p>
        <Link
          href="/sign-in"
          className="m mt-6 inline-flex min-h-9 items-center gap-2 text-[10.5px] text-[var(--ink-4)] hover:text-[var(--ink)]"
        >
          go to sign in
          <ArrowRight className="size-3.5" aria-hidden="true" />
        </Link>
      </div>
    );
  }

  if (state === "sign-in") {
    return (
      <div role="status">
        <p className="ml">continue securely</p>
        <h2 className="hd mt-3 text-[22px]">Try signing in.</h2>
        <p className="bd mt-2.5">
          Account setup could not continue here. Try the sign-in page. If you previously used an
          email sign-in link and do not have a password, ask the administrator to migrate your
          access.
        </p>
        <Link
          href="/sign-in"
          className="m mt-6 inline-flex min-h-9 items-center gap-2 text-[10.5px] text-[var(--ink-4)] hover:text-[var(--ink)]"
        >
          go to sign in
          <ArrowRight className="size-3.5" aria-hidden="true" />
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={(event) => void submit(event)}>
      <Field label="Username" htmlFor="signup-display-name" hint="Shown to your household">
        <input
          id="signup-display-name"
          name="displayName"
          type="text"
          autoComplete="nickname"
          required
          minLength={2}
          maxLength={80}
          className={inputClass}
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
        />
      </Field>
      <div className="mt-6">
        <Field label="Email" htmlFor="signup-email">
          <input
            id="signup-email"
            name="email"
            type="email"
            autoComplete="email"
            required
            maxLength={320}
            className={inputClass}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </Field>
      </div>
      <div className="mt-6">
        <Field label="Password" htmlFor="signup-password" hint="At least 8 characters">
          <input
            id="signup-password"
            name="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            maxLength={256}
            className={inputClass}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </Field>
      </div>
      <div className="mt-6">
        <Field label="Confirm password" htmlFor="signup-password-confirmation">
          <input
            id="signup-password-confirmation"
            name="passwordConfirmation"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            maxLength={256}
            className={inputClass}
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
          />
        </Field>
      </div>
      {state === "mismatch" ? (
        <div className="mt-5">
          <StateNotice title="Passwords do not match" tone="error">
            Enter the same password in both fields.
          </StateNotice>
        </div>
      ) : null}
      {state === "error" ? (
        <div className="mt-5">
          <StateNotice title="Account not created" tone="error">
            Check the details and try again. If this email already has an account, sign in instead.
          </StateNotice>
        </div>
      ) : null}
      {state === "demo" ? (
        <div className="mt-5">
          <StateNotice title="Accounts are off in this demo" tone="warning">
            This build has no account provider connected.
          </StateNotice>
        </div>
      ) : null}
      <Button type="submit" className="mt-6 w-full" busy={busy}>
        Create account
        <ArrowRight className="size-4 text-[var(--accent-ink)]" aria-hidden="true" />
      </Button>
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
  emailConfirmed = false,
  adminLoginEnabled = false,
}: {
  nextPath?: string;
  householdDeletion?: "pending" | "complete";
  authError?: "invalid_link";
  emailConfirmed?: boolean;
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
      {emailConfirmed ? (
        <div className="mt-10">
          <StateNotice title="Email confirmed" tone="success">
            Your email address is confirmed. Sign in with the password you chose when creating the
            account.
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
          Sign in with your email address and password.
        </p>
        <div className="mt-8">
          <PasswordSignInForm nextPath={nextPath} />
        </div>
      </section>

      <p className="bd mt-8 text-[13px] text-[var(--ink-5)]">
        New here?{" "}
        <Link
          className="border-b border-[var(--edge-strong)] text-[var(--ink-3)]"
          href="/sign-up"
        >
          Request open-beta access
        </Link>
        .
      </p>
      <p className="bd mt-4 text-[13px] text-[var(--ink-5)]">
        Continuing means keeping household photos and inventory private, and acknowledging the{" "}
        <Link className="border-b border-[var(--edge-strong)] text-[var(--ink-3)]" href="/privacy">
          beta privacy notice
        </Link>
        . US English for now.
      </p>
    </AuthFrame>
  );
}

export function SignUpScreen({ signupsOpen = true }: { signupsOpen?: boolean }) {
  return (
    <AuthFrame>
      <section className="mt-12">
        <p className="ml">open beta</p>
        <h1 className="hd mt-3 text-[26px] lg:text-[30px]">Set up your shared kitchen.</h1>
        <p className="bd mt-2.5">
          Choose a username, enter your email, and create a password. Your account will enter review
          immediately.
        </p>
        {signupsOpen ? (
          <>
            <div className="mt-8">
              <PasswordSignUpForm />
            </div>
            <p className="bd mt-6 text-[13px] text-[var(--ink-5)]">
              New accounts start in review. An administrator enables each account before it can be
              used, so expect a short wait after signing up.
            </p>
          </>
        ) : (
          <div className="mt-8">
            <StateNotice title="Signups are closed right now" tone="warning">
              The open beta is not accepting new accounts at the moment. If you received a personal
              invitation, sign in with the invited email on the{" "}
              <Link className="border-b border-[var(--edge-strong)]" href="/sign-in">
                sign-in page
              </Link>{" "}
              instead.
            </StateNotice>
          </div>
        )}
      </section>

      <p className="bd mt-8 text-[13px] text-[var(--ink-5)]">
        Signing up means keeping household photos and inventory private, and acknowledging the{" "}
        <Link className="border-b border-[var(--edge-strong)] text-[var(--ink-3)]" href="/privacy">
          beta privacy notice
        </Link>
        . US English for now.
      </p>
    </AuthFrame>
  );
}

export function PendingAccountScreen({ nextPath = "/" }: { nextPath?: string }) {
  const [status, setStatus] = useState<"pending" | "disabled" | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    async function check() {
      try {
        const current = await getAccountStatus();
        if (cancelled) return;
        if (current === "enabled") {
          window.location.replace(normalizeInternalPath(nextPath));
          return;
        }
        setStatus(current);
      } catch (error) {
        if (!cancelled && error instanceof ApiClientError && error.status === 401) {
          window.location.replace("/sign-in");
          return;
        }
        // Transient failures keep waiting; the next tick retries quietly.
      }
      if (!cancelled) timer = window.setTimeout(() => void check(), 20_000);
    }
    void check();
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [nextPath]);

  const disabled = status === "disabled";

  return (
    <AuthFrame>
      <section className="mt-12" role="status">
        <p className="ml">account review</p>
        <h1 className="hd mt-3 flex items-center gap-3 text-[26px]">
          {!disabled && (
            <LoaderCircle className="size-5 animate-spin text-[var(--accent)]" aria-hidden="true" />
          )}
          Account not enabled
        </h1>
        <p className="bd mt-2.5">
          {disabled
            ? "An administrator disabled this account, so it cannot be used. If you believe this is a mistake, contact the beta coordinator from your invited email."
            : "Your account was created, but an administrator has not enabled it yet. You'll keep your place in line — this page opens your kitchen automatically once an administrator approves you."}
        </p>
        <button
          type="button"
          className="m mt-6 min-h-9 text-[10.5px] text-[var(--ink-4)] hover:text-[var(--ink)]"
          onClick={() => void signOut().then(() => window.location.replace("/sign-in"))}
        >
          sign out
        </button>
      </section>
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
            <MagicLinkForm audience="invite" nextPath={`/invite/${encodeURIComponent(token)}`} />
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
            <MagicLinkForm audience="invite" nextPath={`/onboarding/${encodeURIComponent(token)}`} />
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
