"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import {
  Bell,
  ChevronRight,
  Copy,
  Crown,
  MailPlus,
  Settings2,
  Trash2,
  UserRound,
  Users,
} from "lucide-react";

import {
  createHouseholdInvite,
  deleteCurrentHousehold,
  getCurrentHousehold,
  getHouseholdMembers,
  removeHouseholdMember,
} from "@/lib/client/api";
import {
  clearFoodtopiaCaches,
  getAuthenticatedUser,
  signOut,
} from "@/lib/client/auth";
import { useOfflineInventory } from "./offline-provider";
import {
  Badge,
  Button,
  Card,
  Field,
  inputClass,
  Page,
  PageHeader,
  StateNotice,
} from "./ui";

type HouseholdMember = Awaited<
  ReturnType<typeof getHouseholdMembers>
>["members"][number];

export function HouseholdScreen() {
  const router = useRouter();
  const { apiMode, activeHouseholdId, clear } = useOfflineInventory();
  const [email, setEmail] = useState("");
  const [result, setResult] = useState<{
    email: string;
    delivery: "queued" | "demo";
  } | null>(null);
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
      setInviteError(
        "The invitation could not be prepared. Check the address and try again.",
      );
    } finally {
      setInviting(false);
    }
  }

  async function removeMember(member: HouseholdMember) {
    if (!window.confirm(`Remove ${member.displayName ?? member.email ?? "this member"} from the household? Their next request will lose access.`)) return;
    setRemovingUserId(member.userId);
    setMemberError(null);
    try {
      await removeHouseholdMember(member.userId);
      setMembers((current) =>
        current?.filter((item) => item.userId !== member.userId) ?? null,
      );
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
      const result = await deleteCurrentHousehold();
      state = "status" in result ? "pending" : "complete";
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
  return (
    <Page>
      <PageHeader
        eyebrow="Shared kitchen"
        title={apiMode === "demo" ? "Maple Street demo" : householdName ?? "Your household"}
        description="Members see the same inventory after their device syncs. Offline edits replay in the order they were made."
        action={
          <span className="flex size-12 items-center justify-center rounded-2xl bg-[var(--sprout)] text-[var(--leaf)]">
            <Users className="size-5" aria-hidden="true" />
          </span>
        }
      />

      {apiMode === "demo" ? (
        <StateNotice title="Demo household" tone="warning">
          Member names and invitations on this screen are previews. No
          invitation email is sent from demo mode.
        </StateNotice>
      ) : null}

      <section className="mt-6">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-extrabold">
            {apiMode === "demo" ? "Example beta members" : "Members"}
          </h2>
          <Badge>
            {apiMode === "demo"
              ? "2 examples"
              : members
                ? `${members.length} active`
                : "Loading"}
          </Badge>
        </div>
        {apiMode === "demo" ? (
          <Card className="overflow-hidden p-0">
            <div className="flex min-h-20 items-center gap-3 px-4 py-3">
              <span className="flex size-11 items-center justify-center rounded-2xl bg-[var(--leaf)] font-black text-white">T</span>
              <div className="min-w-0 flex-1"><p className="font-bold">Tanner <span className="font-normal text-[var(--muted)]">(you)</span></p><p className="text-xs text-[var(--muted)]">tanner@example.com</p></div>
              <Badge tone="yellow"><Crown className="mr-1 size-3" aria-hidden="true" /> Owner</Badge>
            </div>
            <div className="flex min-h-20 items-center gap-3 border-t border-[var(--line)] px-4 py-3">
              <span className="flex size-11 items-center justify-center rounded-2xl bg-[var(--sprout)] font-black text-[var(--leaf)]">A</span>
              <div className="min-w-0 flex-1"><p className="font-bold">Alex</p><p className="text-xs text-[var(--muted)]">alex@example.com</p></div>
              <Badge>Member</Badge>
            </div>
          </Card>
        ) : memberError ? (
          <StateNotice title="Member directory unavailable" tone="error">{memberError}</StateNotice>
        ) : members ? (
          <Card className="overflow-hidden p-0">
            {members.map((member, index) => {
              const label = member.displayName ?? member.email ?? "Household member";
              const canRemove = viewerRole === "owner" && member.role === "member" && member.userId !== currentUserId;
              return (
                <div key={member.userId} className={`flex min-h-20 items-center gap-3 px-4 py-3 ${index ? "border-t border-[var(--line)]" : ""}`}>
                  <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-[var(--sprout)] font-black text-[var(--leaf)]">{label.slice(0, 1).toUpperCase()}</span>
                  <div className="min-w-0 flex-1"><p className="truncate font-bold">{label}{member.userId === currentUserId ? <span className="font-normal text-[var(--muted)]"> (you)</span> : null}</p>{member.displayName && member.email ? <p className="truncate text-xs text-[var(--muted)]">{member.email}</p> : null}</div>
                  <Badge tone={member.role === "owner" ? "yellow" : "neutral"}>{member.role === "owner" ? <Crown className="mr-1 size-3" aria-hidden="true" /> : null}{member.role === "owner" ? "Owner" : "Member"}</Badge>
                  {canRemove ? <Button size="icon" variant="ghost" busy={removingUserId === member.userId} aria-label={`Remove ${label}`} onClick={() => void removeMember(member)}><Trash2 className="size-4" aria-hidden="true" /></Button> : null}
                </div>
              );
            })}
          </Card>
        ) : (
          <div className="skeleton h-24 rounded-3xl" />
        )}
      </section>

      <Card className="mt-6">
        <div className="flex items-start gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-[var(--tomato-soft)] text-[var(--tomato)]"><MailPlus className="size-5" aria-hidden="true" /></span>
          <div><h2 className="font-extrabold">Invite a household member</h2><p className="mt-1 text-xs leading-5 text-[var(--muted)]">Private-beta access is checked server-side against the invited email. Links cannot grant a different email access.</p></div>
        </div>
        <form className="mt-4" onSubmit={(event) => void sendInvite(event)}>
          <Field label="Member email" htmlFor="invite-email"><input id="invite-email" type="email" required className={inputClass} placeholder="person@example.com" value={email} onChange={(event) => setEmail(event.target.value)} /></Field>
          <Button type="submit" className="mt-3 w-full" variant="secondary" busy={inviting}>Send invitation</Button>
        </form>
        {inviteError ? <div className="mt-3"><StateNotice title="Invitation not sent" tone="error">{inviteError}</StateNotice></div> : null}
        {result ? <div className="mt-3"><StateNotice title={result.delivery === "demo" ? "Demo invitation created" : "Invitation queued"} tone="success">{result.delivery === "demo" ? `${result.email} was recorded as a demo invite; no email was sent.` : `A passwordless invite for ${result.email} was queued for delivery.`}</StateNotice></div> : null}
      </Card>

      <section className="mt-7 overflow-hidden rounded-3xl border border-[var(--line)] bg-[var(--card)]">
        <Link href="/settings" className="flex min-h-16 items-center gap-3 px-4 py-3"><Settings2 className="size-5 text-[var(--leaf)]" aria-hidden="true" /><span className="flex-1 font-bold">Household settings</span><ChevronRight className="size-4 text-[var(--muted)]" aria-hidden="true" /></Link>
        <button type="button" className="flex min-h-16 w-full items-center gap-3 border-t border-[var(--line)] px-4 py-3 text-left" onClick={() => void navigator.clipboard?.writeText(activeHouseholdId)}><Copy className="size-5 text-[var(--leaf)]" aria-hidden="true" /><span className="flex-1"><span className="block font-bold">Copy household reference</span><span className="block text-xs text-[var(--muted)]">For beta support only</span></span><ChevronRight className="size-4 text-[var(--muted)]" aria-hidden="true" /></button>
      </section>

      {apiMode === "connected" && viewerRole === "owner" ? (
        <Card className="mt-6 border-[#efb9ad]">
          <h2 className="font-extrabold text-[#963928]">Delete household</h2>
          <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
            This immediately quarantines the household and schedules permanent
            deletion after outstanding photo-upload links expire. Every member
            loses access. This cannot be undone.
          </p>
          {showDelete ? (
            <div className="mt-4">
              <Field label="Type DELETE to confirm" htmlFor="delete-household-confirmation">
                <input
                  id="delete-household-confirmation"
                  autoComplete="off"
                  className={inputClass}
                  value={deleteConfirmation}
                  onChange={(event) => setDeleteConfirmation(event.target.value)}
                />
              </Field>
              <div className="mt-3 flex gap-2">
                <Button
                  type="button"
                  variant="danger"
                  busy={deleting}
                  disabled={deleteConfirmation !== "DELETE"}
                  onClick={() => void deleteHousehold()}
                >
                  Quarantine and delete
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={deleting}
                  onClick={() => {
                    setShowDelete(false);
                    setDeleteConfirmation("");
                    setDeleteError(null);
                  }}
                >
                  Cancel
                </Button>
              </div>
              {deleteError ? (
                <div className="mt-3">
                  <StateNotice title="Deletion not started" tone="error">
                    {deleteError}
                  </StateNotice>
                </div>
              ) : null}
            </div>
          ) : (
            <Button
              type="button"
              className="mt-4"
              variant="danger"
              onClick={() => setShowDelete(true)}
            >
              Delete household
            </Button>
          )}
        </Card>
      ) : null}

      <div className="mt-6 grid grid-cols-2 gap-3">
        <div className="rounded-2xl bg-white/45 p-4"><Bell className="size-5 text-[var(--leaf)]" aria-hidden="true" /><p className="mt-3 text-sm font-bold">No background sync promise</p><p className="mt-1 text-xs leading-5 text-[var(--muted)]">Open the PWA to replay offline edits.</p></div>
        <div className="rounded-2xl bg-white/45 p-4"><UserRound className="size-5 text-[var(--leaf)]" aria-hidden="true" /><p className="mt-3 text-sm font-bold">Household-scoped</p><p className="mt-1 text-xs leading-5 text-[var(--muted)]">Data access is constrained by membership.</p></div>
      </div>
    </Page>
  );
}
