"use client";

import { createContext, useContext } from "react";
import type { CartLineView } from "@/lib/cart-contract";

export interface CartContextValue {
  /**
   * The signed-in customer's database cart, or the browser-local cart for a
   * signed-out visitor. Money values are server-computed for the former.
   */
  lines: CartLineView[];
  itemCount: number;
  /** Subtotal in whole cents. */
  subtotalCents: number;
  isOpen: boolean;
  /** True once the server confirms a session; null while that is checked. */
  isAuthenticated: boolean | null;
  /** A cart read or mutation is in flight. */
  isPending: boolean;
  /** Display message from the last failed read or mutation, if any. */
  notice: string | null;
  has: (productId: string) => boolean;
  quantityOf: (productId: string) => number;
  add: (productId: string, quantity?: number) => void;
  /** Quantity controls exist for the database cart only. */
  setQuantity: (productId: string, quantity: number) => void;
  remove: (productId: string) => void;
  clear: () => void;
  open: () => void;
  close: () => void;
}

export const CartContext = createContext<CartContextValue | null>(null);

export function useCart(): CartContextValue {
  const context = useContext(CartContext);
  if (!context) throw new Error("useCart must be used inside <CartProvider>");
  return context;
}
