"use client";

import { CartProvider } from "@/lib/cart";
import { ReactNode } from "react";

export default function Providers({ children }: { children: ReactNode }) {
  return <CartProvider>{children}</CartProvider>;
}
