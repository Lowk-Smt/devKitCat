"use client";

import { createContext, useContext } from "react";
import type { Product } from "@/types";

export interface CartContextValue {
  items: Product[];
  itemCount: number;
  /** Sum of item prices in USD. */
  subtotal: number;
  isOpen: boolean;
  has: (productId: string) => boolean;
  add: (productId: string) => void;
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
