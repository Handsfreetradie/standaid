import { QueryClient, type Query, type Mutation } from "@tanstack/react-query";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import { del, get, set } from "idb-keyval";

// Rough-in setout is used on site with no signal for hours at a time. Every
// setout query key is a literal string starting with "setout_" (setout_plans,
// setout_fittings, setout_circuits, setout_canvases, setout_load_items,
// setout_voice_notes, setout_quick_picks) — checked against every useSetout*
// hook in the repo. That one shared prefix is all that's needed to scope
// persistence to setout data only, without touching every hook file to tag
// its query keys individually.
export const SETOUT_QUERY_KEY_PREFIX = "setout_";

export function isSetoutQueryKey(key: readonly unknown[]): boolean {
  return typeof key[0] === "string" && key[0].startsWith(SETOUT_QUERY_KEY_PREFIX);
}

// TanStack Query's default networkMode ("online") already pauses a mutation
// instead of firing it while offline, and auto-resumes/retries paused
// mutations in call order the moment the browser goes back online — that
// part needs no configuration change here, and applies to every mutation in
// the app exactly as it did before this file existed. What's missing is
// durability: a paused mutation only lives in memory, so a tradie closing
// the app (or the OS killing it) while offline loses every queued change.
// persistQueryClient below fixes that by dehydrating paused mutations and
// cached query data to IndexedDB, then resuming them on the next launch —
// but only for setout data (isSetoutQueryKey / mutationKey below), so this
// doesn't change how any other feature (chat, audits, learn) behaves.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // A plan opened once with signal stays viewable/editable if the app is
      // reopened offline later — 7 days is generous for a job that spans a
      // few site visits without forcing genuinely stale data to hang around.
      gcTime: 1000 * 60 * 60 * 24 * 7,
    },
  },
});

const idbStorage = {
  getItem: (key: string) => get(key),
  setItem: (key: string, value: string) => set(key, value),
  removeItem: (key: string) => del(key),
};

export const setoutPersister = createAsyncStoragePersister({
  storage: idbStorage,
  key: "standaid-setout-query-cache",
  // A corrupt/oversized IndexedDB entry should never block the app from
  // starting — worst case, setout falls back to a normal online-only fetch.
  throttleTime: 1000,
});

// Only ever persists a query if its key is a setout one (see
// isSetoutQueryKey above), and only ever persists a mutation if it's a
// setout mutation that's actually paused waiting for a connection — every
// setout mutation added from here on must pass a mutationKey starting with
// "setout" for its queued state to survive an app restart. A mutation
// without that key still pauses/resumes exactly as it always has; it just
// isn't written to disk, matching today's behaviour for every non-setout
// mutation in the app.
export function shouldDehydrateSetoutQuery(query: Query): boolean {
  return isSetoutQueryKey(query.queryKey) && query.state.status !== "error";
}

export function shouldDehydrateSetoutMutation(mutation: Mutation<unknown, unknown, unknown, unknown>): boolean {
  const key = mutation.options.mutationKey;
  return mutation.state.isPaused && Array.isArray(key) && typeof key[0] === "string" && key[0].startsWith("setout");
}
