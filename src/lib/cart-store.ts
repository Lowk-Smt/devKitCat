import { products } from "@/data/products";

/**
 * Tiny client-side cart store (no backend): a list of product ids persisted in
 * localStorage and exposed through the `useSyncExternalStore` contract.
 *
 * Digital products are sold as a single license each, so a cart line is just a
 * product id — there is no quantity. Prices are always read from the catalog,
 * never stored.
 */

const STORAGE_KEY = "devkitcat:cart:v1";
const EMPTY: readonly string[] = [];

const knownIds = new Set(products.map((product) => product.id));
const listeners = new Set<() => void>();

let snapshot: readonly string[] = EMPTY;
let loaded = false;

/** Parses stored JSON, dropping duplicates and ids that no longer exist. */
function parse(raw: string | null): readonly string[] {
  if (!raw) return EMPTY;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return EMPTY;
    const ids = parsed.filter(
      (id, index): id is string =>
        typeof id === "string" &&
        knownIds.has(id) &&
        parsed.indexOf(id) === index,
    );
    return ids.length > 0 ? ids : EMPTY;
  } catch {
    return EMPTY;
  }
}

function readStorage(): readonly string[] {
  try {
    return parse(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return EMPTY; // Storage blocked (e.g. private mode): cart stays in memory.
  }
}

function emit() {
  listeners.forEach((listener) => listener());
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);

  // Keep multiple tabs in sync.
  const onStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY) return;
    snapshot = readStorage();
    emit();
  };
  window.addEventListener("storage", onStorage);

  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

/** Reads storage once on first use; afterwards the in-memory copy is truth. */
export function getSnapshot(): readonly string[] {
  if (!loaded) {
    loaded = true;
    snapshot = readStorage();
  }
  return snapshot;
}

export function getServerSnapshot(): readonly string[] {
  return EMPTY;
}

function write(ids: readonly string[]) {
  snapshot = ids.length > 0 ? ids : EMPTY;
  try {
    if (ids.length > 0) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
    } else {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // Ignore storage failures; the in-memory snapshot still updates the UI.
  }
  emit();
}

export function addToCart(id: string) {
  const current = getSnapshot();
  if (knownIds.has(id) && !current.includes(id)) write([...current, id]);
}

export function removeFromCart(id: string) {
  const current = getSnapshot();
  if (current.includes(id)) write(current.filter((item) => item !== id));
}

export function clearCart() {
  if (getSnapshot().length > 0) write(EMPTY);
}
