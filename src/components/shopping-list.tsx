"use client";

import { useEffect, useState } from "react";
import { Check, Plus, Trash2 } from "lucide-react";
import {
  shoppingListResponseSchema,
  type ShoppingListItem,
} from "@/contracts/api";
import {
  addShoppingListItems,
  deleteShoppingListItem,
  getShoppingList,
  setShoppingListItemDone,
  ApiClientError,
} from "@/lib/client/api";
import { getOfflineDb } from "@/lib/offline/db";
import { resolveFoodIdentity } from "@/domain/normalization";
import { useOfflineInventory } from "./offline-provider";
import { StateNotice, cn } from "./ui";

const CACHE_KEY = "shoppingList";

async function readCached(): Promise<ShoppingListItem[]> {
  try {
    const record = await getOfflineDb().meta.get(CACHE_KEY);
    if (typeof record?.value !== "string") return [];
    const parsed = shoppingListResponseSchema.safeParse({ items: JSON.parse(record.value) });
    return parsed.success ? parsed.data.items : [];
  } catch {
    return [];
  }
}

function writeCached(items: ShoppingListItem[]) {
  return getOfflineDb()
    .meta.put({ key: CACHE_KEY, value: JSON.stringify(items) })
    .catch(() => undefined);
}

/**
 * The shared household shopping list. Server-backed so every member sees the
 * same list; the last synced copy stays readable offline. Mutations need a
 * connection because they settle against other members' edits.
 */
export function ShoppingList() {
  const { online } = useOfflineInventory();
  const [items, setItems] = useState<ShoppingListItem[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const cached = await readCached();
      if (!cancelled) {
        setItems(cached);
        setHydrated(true);
      }
      if (!online) return;
      try {
        const result = await getShoppingList();
        if (!cancelled) {
          setItems(result.items);
          void writeCached(result.items);
        }
      } catch {
        // Offline viewing keeps the cached copy; retry happens on reconnect.
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [online]);

  function apply(next: ShoppingListItem[] | ((current: ShoppingListItem[]) => ShoppingListItem[])) {
    setItems((current) => {
      const value = typeof next === "function" ? next(current) : next;
      void writeCached(value);
      return value;
    });
  }

  async function addItem(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || !online || busy) return;
    setBusy(true);
    setError(null);
    try {
      const identity = resolveFoodIdentity(trimmed);
      const result = await addShoppingListItems({
        items: [
          {
            name: trimmed,
            category: identity.category ?? "Other",
            foodConceptId: identity.foodConceptId,
            quantityText: null,
          },
        ],
      });
      apply(result.items);
      setName("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The item could not be added.");
    } finally {
      setBusy(false);
    }
  }

  async function toggleItem(item: ShoppingListItem) {
    if (!online || busy) return;
    setBusy(true);
    setError(null);
    // Optimistic flip; reconcile with the server response afterwards.
    apply((current) => current.map((entry) => (entry.id === item.id ? { ...entry, done: !item.done } : entry)));
    try {
      const updated = await setShoppingListItemDone(item.id, !item.done);
      apply((current) => current.map((entry) => (entry.id === item.id ? updated : entry)));
    } catch (caught) {
      apply((current) => current.map((entry) => (entry.id === item.id ? { ...entry, done: item.done } : entry)));
      setError(
        caught instanceof ApiClientError && caught.status === 404
          ? `${item.name} was already removed by someone else.`
          : caught instanceof Error
            ? caught.message
            : "The change could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function removeItem(item: ShoppingListItem) {
    if (!online || busy) return;
    setBusy(true);
    setError(null);
    const previous = items;
    apply(items.filter((entry) => entry.id !== item.id));
    try {
      await deleteShoppingListItem(item.id);
    } catch (caught) {
      apply(previous);
      setError(
        caught instanceof Error ? caught.message : "The item could not be removed.",
      );
    } finally {
      setBusy(false);
    }
  }

  const open = items.filter((item) => !item.done);

  return (
    <section aria-labelledby="shopping-list-title" className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between">
        <p id="shopping-list-title" className="ml !text-[var(--accent)]">
          to fetch
        </p>
        <span className="m text-[11px] text-[var(--ink-5)]">
          {open.length === 0 ? "nothing to fetch" : `${open.length} to fetch`}
        </span>
      </div>

      {!online && hydrated && items.length > 0 && (
        <StateNotice title="Showing the last synced list" tone="neutral">
          Reconnect to tick off or add items — the shared list settles against everyone&rsquo;s edits.
        </StateNotice>
      )}
      {error && (
        <StateNotice title="The list needs attention" tone="error">
          {error}
        </StateNotice>
      )}

      <form onSubmit={(event) => void addItem(event)} className="flex gap-2.5">
        <input
          type="text"
          aria-label="Add an item to the shopping list"
          placeholder={online ? "add something to fetch…" : "offline — reconnect to add"}
          disabled={!online || busy}
          maxLength={120}
          value={name}
          onChange={(event) => setName(event.target.value)}
          className="bd min-h-[52px] w-full rounded-xl bg-[var(--ground-hi)] px-5 text-[16px] text-[var(--ink)] placeholder:text-[var(--ink-5)] focus:outline-none disabled:opacity-60"
        />
        <button
          type="submit"
          aria-label="Add to shopping list"
          disabled={!online || busy || !name.trim()}
          className="glow flex size-[52px] flex-none items-center justify-center rounded-full transition disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Plus className="size-[18px]" aria-hidden="true" />
        </button>
      </form>

      <div className="flex flex-col gap-2">
        {items.map((item) => (
          <div
            key={item.id}
            className={cn(
              "row min-h-[52px] justify-between rounded-xl px-4 py-2",
              item.done ? "bg-[var(--ground)] opacity-70" : "bg-[var(--ground-hi)]",
            )}
          >
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <button
                type="button"
                role="checkbox"
                aria-checked={item.done}
                aria-label={`Mark ${item.name} as ${item.done ? "still needed" : "fetched"}`}
                disabled={!online || busy}
                onClick={() => void toggleItem(item)}
                className={cn(
                  "flex size-7 flex-none items-center justify-center rounded-full transition",
                  item.done
                    ? "bg-[var(--sage)] text-[var(--sage-ink)]"
                    : "border-2 border-[var(--ground-tint)] bg-transparent hover:border-[var(--ink-6)] disabled:opacity-35",
                )}
              >
                {item.done && <Check className="size-4" aria-hidden="true" />}
              </button>
              <span className="truncate">
                <span className={cn("bd", item.done && "line-through decoration-1")}>{item.name}</span>
                {item.quantityText && (
                  <span className="m ml-2 text-[11px] text-[var(--ink-4)]">{item.quantityText}</span>
                )}
                <span className="m block text-[10px] uppercase tracking-[0.08em] text-[var(--ink-6)]">
                  {item.category.toLowerCase()} · added by {item.addedByName.toLowerCase()}
                </span>
              </span>
            </div>
            <button
              type="button"
              aria-label={`Remove ${item.name} from the list`}
              disabled={!online || busy}
              onClick={() => void removeItem(item)}
              className="flex size-8 flex-none items-center justify-center rounded-full text-[var(--ink-6)] transition hover:bg-[var(--ground-tint)] hover:text-[var(--accent)] disabled:opacity-35"
            >
              <Trash2 className="size-4" aria-hidden="true" />
            </button>
          </div>
        ))}
        {hydrated && items.length === 0 && (
          <p className="bd rounded-xl bg-[var(--ground)] px-5 py-6 text-[var(--ink-4)]">
            Empty for now. Missing ingredients from any recipe can land here in one tap.
          </p>
        )}
      </div>
    </section>
  );
}
