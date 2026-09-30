"use client";

import {
  useCallback,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { CartDrawer } from "@/components/cart/CartDrawer";
import {
  CartContext,
  type CartContextValue,
} from "@/components/cart/cart-context";
import { products } from "@/data/products";
import {
  addToCart,
  clearCart,
  getServerSnapshot,
  getSnapshot,
  removeFromCart,
  subscribe,
} from "@/lib/cart-store";

/** Client-side cart state + the cart drawer. No checkout, no payments. */
export function CartProvider({ children }: { children: ReactNode }) {
  const ids = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const [isOpen, setIsOpen] = useState(false);

  const items = useMemo(
    () =>
      ids
        .map((id) => products.find((product) => product.id === id))
        .filter((product): product is NonNullable<typeof product> =>
          Boolean(product),
        ),
    [ids],
  );

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);

  const value = useMemo<CartContextValue>(
    () => ({
      items,
      itemCount: items.length,
      subtotal: items.reduce((sum, item) => sum + item.price, 0),
      isOpen,
      has: (productId) => ids.includes(productId),
      add: addToCart,
      remove: removeFromCart,
      clear: clearCart,
      open,
      close,
    }),
    [items, ids, isOpen, open, close],
  );

  return (
    <CartContext.Provider value={value}>
      {children}
      <CartDrawer />
    </CartContext.Provider>
  );
}
