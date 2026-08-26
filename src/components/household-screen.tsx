"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { Plus, Trash2 } from "lucide-react";

import {
  createHouseholdInvite,
  deleteCurrentHousehold,
  getCurrentHousehold,
  getHouseholdMembers,
  removeHouseholdMember,
} from "@/lib/client/api";
import { clearFoodtopiaCaches, getAuthenticatedUser, signOut } from "@/lib/client/auth";
import { useOfflineInventory } from "./offline-provider";
import { Button, Field, Page, StateNotice, cn, inputClass } from "./ui";

type HouseholdMember = Awaited<ReturnType<typeof getHouseholdMembers>>["members"][number];

const demoMembers = [
  { name: "Tanner", role: "owner", you: true },
  { name: "Alex", role: "member", you: false },
];

/* The disc avatar: a small circle carrying the member's initial. */
function Avatar({ name, you }: { name: string; you: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex size-10 flex-none items-center justify-center rounded-full font-[family-name:var(--font-familjen)] text-[17px] font-semibold",
        you
          ? "bg-[var(--accent)] text-[var(--accent-ink)]"
          : "bg-[var(--ground-tint)] text-[var(--ink)]",
      )}
    >
      {name.charAt(0).toUpperCase()}
    </span>
  );
}

export function HouseholdScreen() {
  const router = useRouter();
  const { apiMode, activeHouseholdId, clear } = useOfflineInventory();
  const [email, setEmail] = useState("");
  const [result, setResult] = useState<{ email: string; delivery: "queued" | "demo" } | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);
  const [members, setMembers] = useState<HouseholdMember[] | null>(null);
  const [householdName, setHouseholdName] = useState<string | null>(null);
  const [memberError, setMemberError] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [removingUserId, setRemovingUserId] = useState<string | null>(null);
  const [showDelete, setShowDelete] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (apiMode !== "connected") return;
    let cancelled = false;
    void Promise.all([getHouseholdMembers(), getAuthenticatedUser(), getCurrentHousehold()])
      .then(([directory, auth, household]) => {
        if (cancelled) return;
        setMembers(directory.members);
        setCurrentUserId(auth.user?.id ?? null);
        setHouseholdName(household.name);
        setMemberError(null);
      })
      .catch(() => {
        if (!cancelled) setMemberError("The household directory could not be loaded.");
      });
    return () => {
      cancelled = true;
    };
  }, [apiMode]);

  async function sendInvite(event: FormEvent) {
    event.preventDefault();
    setInviting(true);
    setInviteError(null);
    setResult(null);
    try {
      const created = await createHouseholdInvite(email.trim());
      setResult({ email: created.email, delivery: created.delivery });
      setEmail("");
    } catch {
      setInviteError("The invitation could not be prepared. Check the address and try again.");
    } finally {
      setInviting(false);
    }
  }

  async function removeMember(member: HouseholdMember) {
    if (
      !window.confirm(
        `Remove ${member.displayName ?? member.email ?? "this member"} from the household? Their next request will lose access.`,
      )
    )
      return;
    setRemovingUserId(member.userId);
    setMemberError(null);
    try {
      await removeHouseholdMember(member.userId);
      setMembers((current) => current?.filter((item) => item.userId !== member.userId) ?? null);
    } catch {
      setMemberError("The member could not be removed. Only an owner can revoke another member.");
    } finally {
      setRemovingUserId(null);
    }
  }

  async function deleteHousehold() {
    if (deleteConfirmation !== "DELETE") return;
    setDeleting(true);
    setDeleteError(null);
    let state: "pending" | "complete";
    try {
      const outcome = await deleteCurrentHousehold();
      state = "status" in outcome ? "pending" : "complete";
    } catch {
      setDeleteError(
        "The household could not be placed into deletion quarantine. No local data was cleared.",
      );
      setDeleting(false);
      return;
    }
    await Promise.allSettled([signOut(), clear(), clearFoodtopiaCaches()]);
    router.replace(`/sign-in?householdDeletion=${state}`);
    router.refresh();
  }

  const viewerRole = members?.find((member) => member.userId === currentUserId)?.role;
  const title = apiMode === "demo" ? "Maple Street" : (householdName ?? "Your household");
  const memberCount = apiMode === "demo" ? demoMembers.length : (members?.length ?? null);

  return (
    <Page className="max-w-[42rem]">
      <header>
        <p className="ml !text-[var(--accent)]">household</p>
        <h1 className="hd mt-3 text-[clamp(2rem,7vw,2.5rem)]">{title}</h1>
        <p className="bd mt-3 max-w-[30rem] text-[15px]">
          One kitchen, shared. Edits made offline replay in the order they were made.
        </p>
      </header>

      {apiMode === "demo" && (
        <div className="mt-6">
          <StateNotice
            title="Demo household — the members and invitations below are previews, and no email is sent."
            tone="warning"
          />
        </div>
      )}

      <div className="mt-9 flex flex-col gap-8">
        <section className="flex flex-col gap-3">
          <div className="flex items-baseline justify-between">
            <p className="ml !text-[var(--sage)]">members</p>
            {memberCount !== null && (
              <span className="font-[family-name:var(--font-familjen)] text-[16px] font-semibold text-[var(--ink-5)]">
                {String(memberCount).padStart(2, "0")}
              </span>
            )}
          </div>

          {apiMode === "demo" ? (
            demoMembers.map((member) => (
              <div key={member.name} className="row !rounded-lg">
                <Avatar name={member.name} you={member.you} />
                <span className="nm min-w-0 flex-1 truncate text-[16.5px]">
                  {member.name}{" "}
                  {member.you && (
                    <span className="chip chip-sage !px-2.5 !py-0.5 !text-[10.5px] align-middle">
                      you
                    </span>
                  )}
                </span>
                <span
                  className={cn(
                    "m flex-none text-[11.5px] font-semibold",
                    member.role === "owner" ? "text-[var(--ink-2)]" : "text-[var(--ink-5)]",
                  )}
                >
                  {member.role}
                </span>
              </div>
            ))
          ) : memberError ? (
            <p className="bd rounded-lg bg-[var(--ground-hi)] px-[18px] py-4 text-[var(--accent)]" role="alert">
              {memberError}
            </p>
          ) : members ? (
            members.map((member) => {
              const label = member.displayName ?? member.email ?? "Household member";
              const canRemove =
                viewerRole === "owner" && member.role === "member" && member.userId !== currentUserId;
              return (
                <div key={member.userId} className="row !rounded-lg">
                  <Avatar name={label} you={member.userId === currentUserId} />
                  <span className="nm min-w-0 flex-1 truncate text-[16.5px]">
                    {label}{" "}
                    {member.userId === currentUserId && (
                      <span className="chip chip-sage !px-2.5 !py-0.5 !text-[10.5px] align-middle">
                        you
                      </span>
                    )}
                  </span>
                  <span
                    className={cn(
                      "m flex-none text-[11.5px] font-semibold",
                      member.role === "owner" ? "text-[var(--ink-2)]" : "text-[var(--ink-5)]",
                    )}
                  >
                    {member.role}
                  </span>
                  {canRemove && (
                    <button
                      type="button"
                      className="flex size-7 flex-none items-center justify-center rounded-full text-[var(--ink-5)] transition hover:bg-[var(--ground-tint)] hover:text-[var(--accent)] disabled:opacity-40"
                      disabled={removingUserId === member.userId}
                      aria-label={`Remove ${label}`}
                      onClick={() => void removeMember(member)}
                    >
                      <Trash2 className="size-3.5" aria-hidden="true" />
                    </button>
                  )}
                </div>
              );
            })
          ) : (
            <div className="skeleton my-3 h-10 rounded-lg" />
          )}

          {/* Inviting is a row, not a form panel — same weight as a member. */}
          <form
            className="flex min-h-[56px] items-center gap-3.5 rounded-lg bg-[var(--ground)] px-[18px] py-3"
            onSubmit={(event) => void sendInvite(event)}
          >
            <span className="flex size-10 flex-none items-center justify-center rounded-full bg-[var(--ground-tint)]">
              <Plus className="size-4 text-[var(--sage)]" aria-hidden="true" />
            </span>
            <label htmlFor="invite-email" className="sr-only">
              Member email
            </label>
            <input
              id="invite-email"
              type="email"
              required
              className="bd min-w-0 flex-1 bg-transparent italic text-[var(--ink)] focus:outline-none"
              placeholder="Invite by email…"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
            <button
              type="submit"
              className="m flex-none rounded-lg bg-[var(--ground-tint)] px-3 py-1.5 text-[11.5px] font-semibold text-[var(--sage)] transition hover:text-[var(--ink)] disabled:opacity-40"
              disabled={inviting}
            >
              {inviting ? "sending…" : "send"}
            </button>
          </form>
        </section>

        {inviteError && (
          <StateNotice title="Invitation not sent" tone="error">
            {inviteError}
          </StateNotice>
        )}
        {result && (
          <StateNotice
            title={result.delivery === "demo" ? "Demo invitation created" : "Invitation queued"}
            tone="success"
          >
            {result.delivery === "demo"
              ? `${result.email} was recorded as a demo invite; no email was sent.`
              : `A passwordless invite for ${result.email} was queued for delivery.`}
          </StateNotice>
        )}

        <p className="bd max-w-[32rem] px-1 text-[12.5px] text-[var(--ink-5)]">
          Beta access is checked on the server against the invited address. A link cannot let a
          different email in.
        </p>

        <section className="flex flex-col gap-3">
          <p className="ml">good to know</p>
          <div className="row !rounded-lg">
            <span className="bd flex-1 !text-[var(--ink-2)]">Sync runs while the app is open</span>
            <span className="m flex-none text-[11.5px] font-semibold text-[var(--ink-5)]">every 15 s</span>
          </div>
          <div className="row !rounded-lg">
            <span className="bd flex-1 !text-[var(--ink-2)]">Access is limited to this household</span>
            <span className="m flex-none text-[11.5px] font-semibold text-[var(--ink-5)]">by membership</span>
          </div>
          <div className="row !rounded-lg">
            <span className="bd flex-1 !text-[var(--ink-2)]">Household settings and preferences</span>
            <Link href="/settings" className="m flex-none text-[11.5px] font-semibold text-[var(--sage)] hover:text-[var(--ink)]">
              settings
            </Link>
          </div>
          <div className="row !rounded-lg">
            <span className="bd flex-1 !text-[var(--ink-3)]">Household reference, for beta support</span>
            <button
              type="button"
              className="m flex-none rounded-md bg-[var(--ground-tint)] px-3 py-1 text-[10.5px] font-semibold text-[var(--sage)] transition hover:text-[var(--ink)]"
              onClick={() => {
                void navigator.clipboard?.writeText(activeHouseholdId);
                setCopied(true);
              }}
            >
              {copied ? "copied" : "copy"}
            </button>
          </div>
          {apiMode === "connected" && viewerRole === "owner" && (
            <div className="row !rounded-lg">
              <span className="bd flex-1 !text-[var(--ink-3)]">
                Deleting quarantines the kitchen for everyone
              </span>
              <button
                type="button"
                className="m flex-none text-[11.5px] font-semibold text-[var(--ink-4)] transition hover:text-[var(--accent)]"
                onClick={() => setShowDelete((current) => !current)}
              >
                delete
              </button>
            </div>
          )}
        </section>

        {showDelete && apiMode === "connected" && viewerRole === "owner" && (
          <div className="rounded-xl bg-[var(--ground-hi)] py-5 pl-6 pr-5 shadow-[inset_5px_0_0_0_var(--accent)]">
            <h2 className="nm text-[var(--accent)]">Delete this household</h2>
            <p className="bd mt-2 max-w-[32rem]">
              This immediately quarantines the household and schedules permanent deletion after
              outstanding photo-upload links expire. Every member loses access. It cannot be undone.
            </p>
            <div className="mt-5 max-w-[16rem]">
              <Field label="Type DELETE to confirm" htmlFor="delete-household-confirmation">
                <input
                  id="delete-household-confirmation"
                  autoComplete="off"
                  className={inputClass}
                  value={deleteConfirmation}
                  onChange={(event) => setDeleteConfirmation(event.target.value)}
                />
              </Field>
            </div>
            {deleteError && (
              <p className="bd mt-4 text-[var(--accent)]" role="alert">
                {deleteError}
              </p>
            )}
            <div className="mt-5 flex items-center gap-6">
              <button
                type="button"
                className="m text-[11.5px] font-semibold text-[var(--ink-4)] transition hover:text-[var(--ink)] disabled:opacity-40"
                disabled={deleting}
                onClick={() => {
                  setShowDelete(false);
                  setDeleteConfirmation("");
                  setDeleteError(null);
                }}
              >
                cancel
              </button>
              <Button
                type="button"
                variant="secondary"
                busy={deleting}
                disabled={deleteConfirmation !== "DELETE"}
                onClick={() => void deleteHousehold()}
              >
                Quarantine and delete
              </Button>
            </div>
          </div>
        )}
      </div>
    </Page>
  );
}
