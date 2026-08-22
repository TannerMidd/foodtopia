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
import { Button, Field, Page, Section, StateNotice, cn, inputClass } from "./ui";

type HouseholdMember = Awaited<ReturnType<typeof getHouseholdMembers>>["members"][number];

const demoMembers = [
  { name: "Tanner", role: "owner", you: true },
  { name: "Alex", role: "member", you: false },
];

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

  return (
    <Page className="max-w-[42rem]">
      <header>
        <p className="ml">household</p>
        <h1 className="hd mt-3 text-[clamp(1.5rem,6vw,1.65rem)]">{title}</h1>
        <p className="bd mt-2.5 max-w-[30rem]">
          One kitchen, shared. Edits made offline replay in the order they were made.
        </p>
      </header>

      {apiMode === "demo" && (
        <p className="bd mt-5 text-[12px] text-[var(--time)]">
          Demo household — the members and invitations below are previews, and no email is sent.
        </p>
      )}

      <div className="mt-9 flex flex-col gap-8">
        <Section label="members" labelWidth="78px">
          {apiMode === "demo" ? (
            demoMembers.map((member) => (
              <div key={member.name} className="row px-1">
                <span className="nm flex-1">
                  {member.name}{" "}
                  {member.you && <span className="m text-[10.5px] text-[var(--ink-6)]">you</span>}
                </span>
                <span
                  className={cn(
                    "m text-[10.5px]",
                    member.role === "owner" ? "text-[var(--time)]" : "text-[var(--ink-6)]",
                  )}
                >
                  {member.role}
                </span>
              </div>
            ))
          ) : memberError ? (
            <p className="bd py-4 text-[var(--time)]" role="alert">
              {memberError}
            </p>
          ) : members ? (
            members.map((member) => {
              const label = member.displayName ?? member.email ?? "Household member";
              const canRemove =
                viewerRole === "owner" && member.role === "member" && member.userId !== currentUserId;
              return (
                <div key={member.userId} className="row px-1">
                  <span className="nm min-w-0 flex-1 truncate">
                    {label}{" "}
                    {member.userId === currentUserId && (
                      <span className="m text-[10.5px] text-[var(--ink-6)]">you</span>
                    )}
                  </span>
                  <span
                    className={cn(
                      "m flex-none text-[10.5px]",
                      member.role === "owner" ? "text-[var(--time)]" : "text-[var(--ink-6)]",
                    )}
                  >
                    {member.role}
                  </span>
                  {canRemove && (
                    <button
                      type="button"
                      className="flex size-7 flex-none items-center justify-center text-[var(--ink-5)] hover:text-[var(--time)] disabled:opacity-40"
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
            <div className="skeleton my-3 h-10" />
          )}

          {/* Inviting is a row, not a form panel — same weight as a member. */}
          <form className="row min-h-[48px] gap-3.5 px-1" onSubmit={(event) => void sendInvite(event)}>
            <Plus className="size-4 flex-none text-[var(--ink-6)]" aria-hidden="true" />
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
              className="m flex-none text-[10.5px] text-[var(--ink-4)] hover:text-[var(--ink)] disabled:opacity-40"
              disabled={inviting}
            >
              {inviting ? "sending…" : "send"}
            </button>
          </form>
        </Section>

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

        <p className="bd max-w-[32rem] text-[12px] text-[var(--ink-6)]">
          Beta access is checked on the server against the invited address. A link cannot let a
          different email in.
        </p>

        <Section label="good to know" labelWidth="78px">
          <div className="row min-h-[46px] px-1">
            <span className="bd flex-1">Sync runs while the app is open</span>
            <span className="m text-[10.5px] text-[var(--ink-6)]">every 15 s</span>
          </div>
          <div className="row min-h-[46px] px-1">
            <span className="bd flex-1">Access is limited to this household</span>
            <span className="m text-[10.5px] text-[var(--ink-6)]">by membership</span>
          </div>
          <div className="row min-h-[46px] px-1">
            <span className="bd flex-1">Household settings and preferences</span>
            <Link href="/settings" className="m text-[10.5px] text-[var(--ink-4)] hover:text-[var(--ink)]">
              settings
            </Link>
          </div>
          <div className="row min-h-[46px] px-1">
            <span className="bd flex-1 text-[var(--ink-4)]">Household reference, for beta support</span>
            <button
              type="button"
              className="m text-[10.5px] text-[var(--ink-4)] hover:text-[var(--ink)]"
              onClick={() => {
                void navigator.clipboard?.writeText(activeHouseholdId);
                setCopied(true);
              }}
            >
              {copied ? "copied" : "copy"}
            </button>
          </div>
          {apiMode === "connected" && viewerRole === "owner" && (
            <div className="row min-h-[46px] px-1">
              <span className="bd flex-1 text-[var(--ink-3)]">
                Deleting quarantines the kitchen for everyone
              </span>
              <button
                type="button"
                className="m text-[10.5px] text-[var(--ink-4)] hover:text-[var(--time)]"
                onClick={() => setShowDelete((current) => !current)}
              >
                delete
              </button>
            </div>
          )}
        </Section>

        {showDelete && apiMode === "connected" && viewerRole === "owner" && (
          <div className="border-t border-[var(--hairline)] pt-5 shadow-[inset_2px_0_0_0_var(--time)] pl-5">
            <h2 className="nm text-[var(--time)]">Delete this household</h2>
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
              <p className="bd mt-4 text-[var(--time)]" role="alert">
                {deleteError}
              </p>
            )}
            <div className="mt-5 flex items-center gap-6">
              <button
                type="button"
                className="m text-[11px] text-[var(--ink-4)] hover:text-[var(--ink)] disabled:opacity-40"
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
