"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
  type ReactNode,
} from "react";
import { CartDrawer } from "@/components/cart/CartDrawer";
import {
  CartContext,
  type CartContextValue,
} from "@/components/cart/cart-context";
import { getCategoryBySlug } from "@/data/categories";
import { products } from "@/data/products";
import {
  emptyCart,
  summarizeCartLines,
  type CartLineView,
  type CartMutationResult,
  type CartSummaryView,
} from "@/lib/cart-contract";
import { lineTotalCents, toPriceCents } from "@/lib/money";
import {
  addToCart as addLocalItem,
  clearCart as clearLocalCart,
  getServerSnapshot,
  getSnapshot,
  removeFromCart as removeLocalItem,
  subscribe,
} from "@/lib/cart-store";
import {
  addToCartAction,
  clearCartAction,
  readCartAction,
  removeCartItemAction,
  setCartItemQuantityAction,
} from "@/lib/server/cart-actions";

/**
 * Cart state + the cart drawer.
 *
 * Two sources, one shape. A signed-in customer gets their **database** cart:
 * it is read once when this provider mounts and every mutation goes to a Server
 * Function that re-checks the session, so the cart survives reloads and devices.
 * A signed-out visitor keeps the existing browser-local cart (`localStorage`),
 * which cannot be ordered — the drawer sends them to sign in first.
 *
 * Nothing here computes an authoritative price: the server returns whole-cent
 * totals for the database cart, and the local cart is a preview of the catalog
 * fixtures that the checkout page recalculates before an order is written.
 */

/** Maps a browser-local cart id onto the shared line shape (one per product). */
function localLine(productId: string): CartLineView | null {
  const product = products.find((candidate) => candidate.id === productId);
  if (!product) return null;

  const category = getCategoryBySlug(product.category);
  const unitPriceCents = toPriceCents(product.price) ?? 0;

  return {
    productId: product.id,
    productTitle: product.title,
    productSlug: product.slug,
    categoryName: category?.name ?? product.category,
    categoryIcon: category?.icon ?? "templates",
    imageSrc: product.images[0] ?? null,
    unitPriceCents,
    lineTotalCents: lineTotalCents(unitPriceCents, 1) ?? unitPriceCents,
    quantity: 1,
    available: true,
  };
}

export function CartProvider({ children }: { children: ReactNode }) {
  const localIds = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const [isOpen, setIsOpen] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [serverCart, setServerCart] = useState<CartSummaryView | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const syncRef = useRef<Promise<boolean> | null>(null);

  /**
   * Reads the database cart once per page load and remembers whether there is a
   * session to read. Mutations await the same promise, so a click that lands
   * before the read finishes still goes to the right cart.
   */
  const syncCart = useCallback((): Promise<boolean> => {
    if (!syncRef.current) {
      syncRef.current = readCartAction()
        .then((result) => {
          if (result.status === "ok") {
            setServerCart(result.cart);
            return true;
          }

          if (result.status === "error") setNotice(result.message);
          return false;
        })
        .catch(() => false)
        .then((authenticated) => {
          setIsAuthenticated(authenticated);
          return authenticated;
        });
    }

    return syncRef.current;
  }, []);

  useEffect(() => {
    void syncCart();
  }, [syncCart]);

  const localCart = useMemo(
    () =>
      summarizeCartLines(
        localIds
          .map(localLine)
          .filter((line): line is CartLineView => line !== null),
      ),
    [localIds],
  );

  const cart = isAuthenticated === true ? (serverCart ?? emptyCart()) : localCart;

  /** Runs a Server Function for a signed-in customer, or the local fallback. */
  const mutate = useCallback(
    (server: () => Promise<CartMutationResult>, local: () => void) => {
      setNotice(null);
      startTransition(async () => {
        if (!(await syncCart())) {
          local();
          return;
        }

        const result = await server();
        if (result.status === "ok") {
          setServerCart(result.cart);
          return;
        }

        setNotice(result.message);
        if (result.cart) setServerCart(result.cart);
      });
    },
    [startTransition, syncCart],
  );

  const add = useCallback(
    (productId: string, quantity = 1) =>
      mutate(
        () => addToCartAction(productId, quantity),
        () => addLocalItem(productId),
      ),
    [mutate],
  );

  const setQuantity = useCallback(
    (productId: string, quantity: number) =>
      mutate(
        () => setCartItemQuantityAction(productId, quantity),
        // The browser-local cart holds one license per product, so it has no
        // quantity to change; the control is only rendered for the signed-in cart.
        () => undefined,
      ),
    [mutate],
  );

  const remove = useCallback(
    (productId: string) =>
      mutate(
        () => removeCartItemAction(productId),
        () => removeLocalItem(productId),
      ),
    [mutate],
  );

  const clear = useCallback(
    () =>
      mutate(
        () => clearCartAction(),
        () => clearLocalCart(),
      ),
    [mutate],
  );

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);

  const value = useMemo<CartContextValue>(
    () => ({
      lines: cart.lines,
      itemCount: cart.itemCount,
      subtotalCents: cart.subtotalCents,
      isOpen,
      isAuthenticated,
      isPending,
      notice,
      has: (productId) => cart.lines.some((line) => line.productId === productId),
      quantityOf: (productId) =>
        cart.lines.find((line) => line.productId === productId)?.quantity ?? 0,
      add,
      setQuantity,
      remove,
      clear,
      open,
      close,
    }),
    [
      add,
      cart,
      clear,
      close,
      isAuthenticated,
      isPending,
      isOpen,
      notice,
      open,
      remove,
      setQuantity,
    ],
  );

  return (
    <CartContext.Provider value={value}>
      {children}
      <CartDrawer />
    </CartContext.Provider>
  );
}
