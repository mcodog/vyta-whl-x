'use client';

import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { useCustomer } from '@/contexts/CustomerContext';

export interface CartItem {
  id: string;
  name: string;
  price: number; // CAD price per single vial (base currency)
  /**
   * USD price per single vial, captured at add-to-cart time (from the product's
   * price_usd override, or CAD × the exchange rate). Used to bill USD-tagged
   * customers in USD without re-deriving overrides later. Optional — older carts
   * and CAD-only flows may not have it, in which case USD falls back to
   * price × rate.
   */
  priceUsd?: number | null;
  strength: string;
  image_url?: string;
  /** Packaging shot, shown when this line is a pack of 10. */
  box_image_url?: string;
  /** Vials per pack for this line — 1 (single vial) or 10 (pack of 10). */
  packSize: number;
  /**
   * Which catalog price this line was priced from: 'box' (pack of 10) or
   * 'vial' (single vial). Carried into the order so admins can tell which the
   * customer chose. Optional for backwards compatibility with older carts.
   */
  priceType?: 'box' | 'vial';
  /** Total vials in the cart for this line (always a multiple of packSize). */
  quantity: number;
}

/**
 * A cart line is uniquely identified by product + pack size, so a "single
 * vial" purchase and a "pack of 10" purchase of the same product stay as
 * separate lines.
 */
export function cartLineKey(id: string, packSize: number): string {
  return `${id}__${packSize}`;
}

interface CartContextType {
  items: CartItem[];
  /** Add `packs` packs of the given item (defaults to 1 pack). */
  addItem: (item: Omit<CartItem, 'quantity'>, packs?: number) => void;
  removeItem: (key: string) => void;
  updateQuantity: (key: string, quantity: number) => void;
  clearCart: () => void;
  totalItems: number;
  totalPrice: number;
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
  /**
   * True once the lines in the cart have been priced against the *current*
   * customer. False while that is still in flight, during which the prices on
   * the lines are the add-to-cart snapshot and may not be this customer's — so
   * price UIs should hold rather than print a figure that is about to change.
   * An empty cart is trivially ready.
   */
  pricesReady: boolean;
  /**
   * Names of lines dropped by the last re-price because the customer can no
   * longer buy them (delisted, or hidden/zero-priced for their account). The
   * cart surfaces these so items never vanish silently; call
   * {@link dismissRemoved} once shown.
   */
  removedNames: string[];
  dismissRemoved: () => void;
}

const CartContext = createContext<CartContextType | undefined>(undefined);

const STORAGE_KEY = 'northern_peptides_cart';

// Normalise a stored/loaded item, defaulting older carts (which had no pack
// concept and always sold in tens) to a pack size of 10.
function normalizeItem(raw: any): CartItem | null {
  if (!raw || typeof raw.id !== 'string') return null;
  const packSize = raw.packSize === 1 ? 1 : 10;
  const quantity =
    typeof raw.quantity === 'number' && raw.quantity > 0 ? raw.quantity : packSize;
  const priceUsd =
    raw.priceUsd == null || raw.priceUsd === ''
      ? null
      : Number.isFinite(Number(raw.priceUsd))
        ? Number(raw.priceUsd)
        : null;
  return {
    id: raw.id,
    name: raw.name,
    price: Number(raw.price) || 0,
    priceUsd,
    strength: raw.strength ?? '',
    image_url: raw.image_url,
    box_image_url: raw.box_image_url,
    packSize,
    // Preserve an explicit tag if present; otherwise derive from pack size so
    // freshly loaded carts still tag correctly (1 vial → vial, else box).
    priceType: raw.priceType === 'vial' || raw.priceType === 'box'
      ? raw.priceType
      : packSize === 1 ? 'vial' : 'box',
    quantity,
  };
}

// Helper function to get initial cart from localStorage
function getInitialCart(): CartItem[] {
  if (typeof window === 'undefined') return [];
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed)) {
        return parsed.map(normalizeItem).filter((i): i is CartItem => i !== null);
      }
    }
  } catch (error) {
    console.error('Error loading cart:', error);
  }
  return [];
}

export function CartProvider({ children }: { children: React.ReactNode }) {
  // Use lazy initialization to load cart synchronously from localStorage
  const [items, setItems] = useState<CartItem[]>(getInitialCart);
  const [isOpen, setIsOpen] = useState(false);
  const [isHydrated, setIsHydrated] = useState(false);
  const { customer, isLoading: customerLoading } = useCustomer();
  const [pricedSignature, setPricedSignature] = useState<string | null>(null);
  const [pricedCustomerKey, setPricedCustomerKey] = useState<string | null>(null);
  const [removedNames, setRemovedNames] = useState<string[]>([]);

  // Mark as hydrated after first client-side render
  useEffect(() => {
    setIsHydrated(true);
  }, []);

  // Save cart to localStorage whenever it changes (only after hydration)
  useEffect(() => {
    if (isHydrated) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    }
  }, [items, isHydrated]);

  // Mirror the cart to the server for signed-in customers, so admins can see on
  // the customer takeover page whether the customer has added items to their
  // cart. Best-effort and debounced; a signed-out visitor writes nothing.
  const syncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!isHydrated) return;
    if (syncTimer.current) clearTimeout(syncTimer.current);
    syncTimer.current = setTimeout(async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.access_token) return; // guest cart stays local-only
        await fetch('/api/customers/cart', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ items }),
        });
      } catch {
        /* cart sync is best-effort — never disrupt the store */
      }
    }, 800);
    return () => {
      if (syncTimer.current) clearTimeout(syncTimer.current);
    };
  }, [items, isHydrated]);

  // ---- Re-price the cart against the signed-in customer ---------------------
  // A line stores the price that was on screen when it was added, and the cart
  // lives in localStorage — so that snapshot outlives the page, the sign-in and
  // the account it was taken under. A guest who adds at catalog prices and then
  // signs in, or a customer whose overrides an admin has since edited, would
  // otherwise keep seeing (and, at the e-Transfer checkout, be invoiced from) a
  // price that is no longer theirs.
  //
  // So whenever the customer resolves or changes, or a line is added the server
  // hasn't priced yet, ask the server what these lines cost *this* customer and
  // overwrite the snapshot. The customer is taken from the access token on the
  // server, never sent from here.
  //
  // The signature is the customer plus the set of lines, so applying the prices
  // (which changes only the amounts) can't re-trigger the fetch.
  const customerKey = customerLoading ? 'loading' : (customer?.id ?? 'guest');
  const signature = `${customerKey}|${items
    .map((i) => cartLineKey(i.id, i.packSize))
    .sort()
    .join(',')}`;
  // Readiness tracks the *customer*, not the line set: a cart restored from
  // localStorage may hold prices from another account, which is what has to be
  // held back. A line added afterwards was quoted from this customer's own
  // tiles, so verifying it in the background doesn't warrant blanking the
  // prices already on screen.
  const pricesReady = pricedCustomerKey === customerKey;

  useEffect(() => {
    if (!isHydrated || customerLoading) return;
    if (pricedSignature === signature) return;
    if (items.length === 0) {
      setPricedSignature(signature);
      setPricedCustomerKey(customerKey);
      return;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const lines = items.map((i) => ({ id: i.id, packSize: i.packSize }));
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;

        const res = await fetch('/api/cart/prices', {
          method: 'POST',
          headers,
          body: JSON.stringify({ items: lines }),
        });
        if (!res.ok) throw new Error(`Cart pricing failed (${res.status})`);
        const { lines: priced } = await res.json();
        if (cancelled || !Array.isArray(priced)) return;

        const byKey = new Map<string, any>(
          priced.map((l: any) => [cartLineKey(String(l.id), Number(l.packSize) === 1 ? 1 : 10), l]),
        );
        const dropped: string[] = [];
        setItems((current) => {
          // Reset so a double-invoked updater (React StrictMode) can't report
          // the same line as dropped twice.
          dropped.length = 0;
          const next: CartItem[] = [];
          for (const item of current) {
            const match = byKey.get(cartLineKey(item.id, item.packSize));
            // A line the server didn't answer for (added mid-flight) keeps its
            // snapshot and is picked up by the next pass.
            if (!match) {
              next.push(item);
              continue;
            }
            if (!match.available) {
              dropped.push(match.name || item.name);
              continue;
            }
            next.push({
              ...item,
              price: Number(match.price) || 0,
              priceUsd: match.priceUsd == null ? null : Number(match.priceUsd),
            });
          }
          return next;
        });
        if (dropped.length) {
          setRemovedNames((prev) => [...new Set([...prev, ...dropped])]);
        }
        // Mark the pass done only after it succeeded; a failed one leaves the
        // cart "not ready" so the prices stay held rather than shown wrong.
        if (!cancelled) {
          setPricedSignature(signature);
          setPricedCustomerKey(customerKey);
        }
      } catch (err) {
        if (!cancelled) console.error('Cart re-pricing failed:', err);
      }
    }, 150);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // `items` is deliberately not a dependency — `signature` covers the lines
    // that matter, and the effect writes to `items` itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, customerKey, isHydrated, customerLoading, pricedSignature]);

  const dismissRemoved = () => setRemovedNames([]);

  const addItem = (newItem: Omit<CartItem, 'quantity'>, packs: number = 1) => {
    const packSize = newItem.packSize === 1 ? 1 : 10;
    const addedVials = packSize * Math.max(1, Math.floor(packs));

    setItems((currentItems) => {
      const key = cartLineKey(newItem.id, packSize);
      const existingItem = currentItems.find(
        (item) => cartLineKey(item.id, item.packSize) === key
      );

      if (existingItem) {
        return currentItems.map((item) =>
          cartLineKey(item.id, item.packSize) === key
            ? { ...item, quantity: item.quantity + addedVials }
            : item
        );
      }

      return [...currentItems, { ...newItem, packSize, quantity: addedVials }];
    });
  };

  const removeItem = (key: string) => {
    setItems((currentItems) =>
      currentItems.filter((item) => cartLineKey(item.id, item.packSize) !== key)
    );
  };

  const updateQuantity = (key: string, quantity: number) => {
    setItems((currentItems) => {
      const target = currentItems.find(
        (item) => cartLineKey(item.id, item.packSize) === key
      );
      if (!target) return currentItems;

      // Round to the nearest multiple of the line's pack size.
      const step = target.packSize;
      const rounded = Math.round(quantity / step) * step;

      if (rounded < step) {
        return currentItems.filter(
          (item) => cartLineKey(item.id, item.packSize) !== key
        );
      }

      return currentItems.map((item) =>
        cartLineKey(item.id, item.packSize) === key
          ? { ...item, quantity: rounded }
          : item
      );
    });
  };

  const clearCart = () => {
    setItems([]);
  };

  // Count the units the customer actually chose so the badge reflects the cart:
  // each line contributes its number of packs (quantity ÷ packSize), so three
  // packs-of-10 read as 3, not 1. Guards a zero/invalid packSize.
  const totalItems = items.reduce((sum, item) => {
    const per = item.packSize > 0 ? item.packSize : 1;
    return sum + Math.max(1, Math.round(item.quantity / per));
  }, 0);
  const totalPrice = items.reduce((sum, item) => sum + item.price * item.quantity, 0);

  return (
    <CartContext.Provider
      value={{
        items,
        addItem,
        removeItem,
        updateQuantity,
        clearCart,
        totalItems,
        totalPrice,
        isOpen,
        setIsOpen,
        pricesReady,
        removedNames,
        dismissRemoved,
      }}
    >
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  const context = useContext(CartContext);
  if (context === undefined) {
    throw new Error('useCart must be used within CartProvider');
  }
  return context;
}
