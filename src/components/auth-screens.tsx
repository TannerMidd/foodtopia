"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { ArrowRight, CheckCircle2, LoaderCircle, LockKeyhole, Mail, Users } from "lucide-react";
import { ApiClientError, acceptHouseholdInvite, bootstrapHousehold } from "@/lib/client/api";
import { clearFoodtopiaCaches, getAuthenticatedUser, requestMagicLink } from "@/lib/client/auth";
import { normalizeInternalPath } from "@/lib/internal-path";
import { useOfflineInventory } from "./offline-provider";
import { Button, Card, Field, inputClass, StateNotice } from "./ui";

function AuthFrame({ children }: { children: React.ReactNode }) {
  return (
    <main className="safe-top safe-bottom mx-auto flex min-h-dvh w-full max-w-lg items-center px-4 py-8 sm:px-6">
      <div className="w-full">
        <Link href="/" className="mx-auto mb-8 flex w-max items-center gap-2 rounded-full" aria-label="Foodtopia home">
          <span className="flex size-11 items-center justify-center rounded-2xl bg-[var(--leaf)] text-xl font-black text-white">F</span>
          <span className="text-xl font-extrabold tracking-[-0.04em]">foodtopia</span>
        </Link>
        {children}
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
      <div className="text-center" role="status">
        <span className="mx-auto mb-5 flex size-16 items-center justify-center rounded-3xl bg-[var(--sprout)] text-[var(--leaf)]"><CheckCircle2 className="size-7" aria-hidden="true" /></span>
        <h2 className="text-2xl font-extrabold tracking-tight">Check your email</h2>
        <p className="mt-2 text-sm leading-6 text-[var(--muted)]">If this address has private-beta access, a one-time sign-in link is on its way. The link expires, so open it on this device soon.</p>
        <Button variant="ghost" className="mt-5" onClick={() => setState("idle")}>Use another email</Button>
      </div>
    );
  }

  return (
    <form onSubmit={(event) => void submit(event)}>
      <Field label="Email address" htmlFor="auth-email" hint="No password needed. Access is limited to invited beta households.">
        <div className="relative"><Mail className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-[var(--muted)]" aria-hidden="true" /><input id="auth-email" name="email" type="email" autoComplete="email" required className={`${inputClass} pl-11`} placeholder="you@example.com" value={email} onChange={(event) => setEmail(event.target.value)} /></div>
      </Field>
      {state === "error" && <div className="mt-3"><StateNotice title="Sign-in email not sent" tone="error">We couldn’t send a link right now. Check the address and try again later.</StateNotice></div>}
      {state === "demo" && <div className="mt-3"><StateNotice title="Email is off in this demo" tone="warning">This build does not have an email provider connected. You can still explore the demo household on this device.</StateNotice></div>}
      <Button type="submit" className="mt-5 w-full" busy={busy}>{invitation ? "Continue with email" : "Email me a sign-in link"}<ArrowRight className="size-4" aria-hidden="true" /></Button>
      {state === "demo" && <Link href="/" className="mt-3 flex min-h-12 items-center justify-center rounded-full border border-[var(--line)] bg-white font-bold text-[var(--leaf)]">Explore demo household</Link>}
    </form>
  );
}

export function SignInScreen({
  nextPath = "/",
  householdDeletion,
  authError,
}: {
  nextPath?: string;
  householdDeletion?: "pending" | "complete";
  authError?: "invalid_link";
}) {
  return (
    <AuthFrame>
      {householdDeletion ? (
        <div className="mb-4">
          <StateNotice title={householdDeletion === "pending" ? "Household deletion scheduled" : "Household deleted"} tone="success">
            {householdDeletion === "pending"
              ? "Access is quarantined now. Private data will be permanently removed after outstanding upload links expire."
              : "The household and its private application data were removed."}
          </StateNotice>
        </div>
      ) : null}
      {authError ? (
        <div className="mb-4">
          <StateNotice title="That sign-in link could not be completed" tone="error">
            Request a fresh link below. Your invitation and offline household data are unchanged.
          </StateNotice>
        </div>
      ) : null}
      <Card className="p-6 sm:p-8">
        <div className="mb-6 text-center"><span className="mx-auto mb-5 flex size-14 items-center justify-center rounded-2xl bg-[var(--tomato-soft)] text-[var(--tomato)]"><LockKeyhole className="size-6" aria-hidden="true" /></span><p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--tomato)]">Private beta</p><h1 className="mt-2 text-3xl font-extrabold tracking-[-0.045em]">Welcome back</h1><p className="mt-2 text-sm leading-6 text-[var(--muted)]">Use the email that was invited to your household.</p></div>
        <MagicLinkForm nextPath={nextPath} />
      </Card>
      <p className="mt-5 text-center text-xs leading-5 text-[var(--muted)]">By continuing, you agree to keep household photos and inventory private and acknowledge the <Link className="font-bold underline underline-offset-2" href="/privacy">beta privacy notice</Link>. Foodtopia is currently US English only.</p>
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
    return () => { cancelled = true; };
  }, [clear, token]);

  return (
    <AuthFrame>
      <Card className="p-6 sm:p-8">
        <div className="mb-6 text-center"><span className="mx-auto mb-5 flex size-14 items-center justify-center rounded-2xl bg-[var(--sprout)] text-[var(--leaf)]"><Users className="size-6" aria-hidden="true" /></span><p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--tomato)]">Household invite</p><h1 className="mt-2 text-3xl font-extrabold tracking-[-0.045em]">Join the shared kitchen</h1><p className="mt-2 text-sm leading-6 text-[var(--muted)]">Enter the invited email. Membership is checked after the one-time sign-in link opens.</p></div>
        {state === "sign_in" && <MagicLinkForm invitation nextPath={`/invite/${encodeURIComponent(token)}`} />}
        {(state === "checking" || state === "accepting") && <div className="text-center" role="status"><LoaderCircle className="mx-auto size-8 animate-spin text-[var(--leaf)]" aria-hidden="true" /><p className="mt-3 text-sm text-[var(--muted)]">{state === "checking" ? "Checking your sign-in..." : "Joining the household..."}</p></div>}
        {state === "error" && <StateNotice title="This invitation could not be accepted" tone="error">It may be expired, already used by another account, or intended for a different email. Ask the household owner for a new invitation.</StateNotice>}
      </Card>
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
    void getAuthenticatedUser().then((auth) => {
      if (!cancelled) setAuthState(auth.demo || !auth.user ? "sign_in" : "ready");
    }).catch(() => { if (!cancelled) setAuthState("sign_in"); });
    return () => { cancelled = true; };
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
      <Card className="p-6 sm:p-8">
        <div className="mb-6 text-center"><span className="mx-auto mb-5 flex size-14 items-center justify-center rounded-2xl bg-[var(--sprout)] text-[var(--leaf)]"><Users className="size-6" aria-hidden="true" /></span><p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--tomato)]">Private-beta invitation</p><h1 className="mt-2 text-3xl font-extrabold tracking-[-0.045em]">Create your shared kitchen</h1><p className="mt-2 text-sm leading-6 text-[var(--muted)]">Sign in with the invited email, then choose the household name everyone will see.</p></div>
        {authState === "checking" && <div className="text-center" role="status"><LoaderCircle className="mx-auto size-8 animate-spin text-[var(--leaf)]" aria-hidden="true" /><p className="mt-3 text-sm text-[var(--muted)]">Checking your invitation...</p></div>}
        {authState === "sign_in" && <MagicLinkForm invitation nextPath={`/onboarding/${encodeURIComponent(token)}`} />}
        {authState === "ready" && <form onSubmit={(event) => void createHousehold(event)}><Field label="Household name" htmlFor="household-name" hint="For example, Maple Street or The Parkers"><input id="household-name" required minLength={2} maxLength={80} className={inputClass} value={name} onChange={(event) => setName(event.target.value)} /></Field>{error && <div className="mt-3"><StateNotice title="Household not created" tone="error">The invitation may be expired, used, or meant for another email. Ask the beta coordinator for a new link.</StateNotice></div>}<Button type="submit" className="mt-5 w-full" busy={busy}>Create household<ArrowRight className="size-4" aria-hidden="true" /></Button></form>}
      </Card>
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
      <Card className="p-8 text-center">
        <LoaderCircle className="mx-auto size-9 animate-spin text-[var(--leaf)]" aria-hidden="true" />
        <h1 className="mt-5 text-2xl font-extrabold">Opening your kitchen</h1>
        <p className="mt-2 text-sm text-[var(--muted)]">Preparing a clean offline store for this account.</p>
      </Card>
    </AuthFrame>
  );
}
