# Storefront Product Modal (`AddToCartModal`)

How the "Add to cart" modal that pops up on the storefront is built, wired up,
and priced. This is the dialog a shopper sees after tapping **Add** on a product
card — it lets them pick a pack size, choose a quantity, see a live subtotal, and
either add to the cart drawer or jump straight to checkout.

- **Component:** `components/AddToCartModal.tsx`
- **Opened from:** `components/Products.tsx` (the featured-products grid). Any
  storefront surface can reuse it the same way.
- **Design system:** PURA tokens from `tailwind.config.ts`
  (`ink`, `ink-muted`, `ink-light`, `surface`, `line`, `bronze`).

---

## 1. The shape of a product

The modal is driven entirely by a single `AddToCartProduct` prop. Everything it
renders and every price it computes comes from these fields:

```ts
export interface AddToCartProduct {
  id: string;
  name: string;
  price: number;              // catalog CAD price for a PACK OF 10 vials
  vial_price?: number | null; // explicit single-vial price; falls back to price/10
  price_usd?: number | null;  // optional explicit USD box price; else derived from rate
  has_override?: boolean;     // true when `price` is a per-customer CAD override
  strength: string;
  image_url?: string;         // square vial artwork
  box_image_url?: string;     // 16:9 packaging shot, shown for the pack of 10
}
```

The catalog `price` is always the price of a **pack of 10** — the single-vial
price is either the explicit `vial_price` or `price / 10`.

## 2. Opening the modal

The parent owns a piece of state (`null` = closed). Tapping a product's **Add**
button fills it in; the modal renders `null` (nothing) until a product is set,
so a single instance at the bottom of the page serves the whole grid.

```tsx
// components/Products.tsx
const [modalProduct, setModalProduct] = useState<AddToCartProduct | null>(null);

const handleAddToCart = (product: Product) => {
  setModalProduct({
    id: product.id,
    name: product.name,
    price: product.price,
    vial_price: product.vial_price,
    price_usd: product.price_usd,
    has_override: product.has_override,
    strength: product.strength,
    image_url: product.image_url || undefined,
    box_image_url: product.box_image_url || undefined,
  });
};

return (
  <>
    {/* …product grid… */}
    <AddToCartModal product={modalProduct} onClose={() => setModalProduct(null)} />
  </>
);
```

Inside the component the very first line short-circuits when there's nothing to
show:

```tsx
export default function AddToCartModal({ product, onClose }: {
  product: AddToCartProduct | null;
  onClose: () => void;
}) {
  const { addItem, setIsOpen: setCartOpen } = useCart();
  const { currency, rate } = useCurrency();
  const router = useRouter();

  const [packSize, setPackSize] = useState<1 | 10>(10);
  const [packs, setPacks] = useState(1);

  // Reset the form each time a new product opens.
  useEffect(() => {
    if (product) { setPackSize(10); setPacks(1); }
  }, [product]);

  if (!product) return null;
  // …
}
```

## 3. Pricing math

Two pack options exist — a **single vial** and a **pack of 10**. Their per-vial
prices differ, so the subtotal is always computed from a per-vial price × the
number of vials:

```tsx
const PACK_OF_TEN = 10;

// A single vial uses vial_price (or price/10). Inside a pack of 10, each vial is
// the box price split ten ways, so the pack still totals the box price.
const singleVialPrice =
  product.vial_price != null && product.vial_price > 0
    ? product.vial_price
    : product.price / PACK_OF_TEN;
const boxPerVialPrice = product.price / PACK_OF_TEN;
const perVialPrice = packSize === 1 ? singleVialPrice : boxPerVialPrice;

const vials = packSize * packs;         // 1 or 10, times the pack count
const lineTotal = perVialPrice * vials; // what the shopper pays
```

### Currency

The modal reads `currency` and `rate` from `CurrencyContext` and captures the USD
per-vial equivalent into the cart so a USD-tagged customer is billed in USD
(honouring an explicit `price_usd` box override via `productUsdPrice`):

```tsx
const boxPerVialUsd = productUsdPrice(product, rate) / PACK_OF_TEN;
const singleVialUsd =
  product.vial_price != null && product.vial_price > 0
    ? usdFromCad(product.vial_price, rate)
    : boxPerVialUsd;
const perVialUsd = packSize === 1 ? singleVialUsd : boxPerVialUsd;

// Show the right amount in the active display currency.
const disp  = (cad: number, usd: number) => (currency === 'USD' ? usd : cad);
const money = (cad: number, usd: number) => `$${disp(cad, usd).toFixed(2)}`;
```

## 4. Adding to the cart

Both actions add a **per-vial** priced line to the cart. `handleAdd` slides the
cart drawer open; `handleBuyNow` skips straight to checkout:

```tsx
const addToCart = () => {
  addItem(
    {
      id: product.id,
      name: product.name,
      price: perVialPrice,
      priceUsd: perVialUsd,
      strength: product.strength,
      image_url: product.image_url,
      box_image_url: product.box_image_url,
      packSize,
      priceType: packSize === 1 ? 'vial' : 'box',
    },
    packs,
  );
};

const handleAdd    = () => { addToCart(); onClose(); setCartOpen(true); };
const handleBuyNow = () => { addToCart(); onClose(); router.push('/checkout'); };
```

## 5. Layout & animation

The dialog is a Framer Motion overlay + panel. It docks to the **bottom on
mobile** (`items-end`) and **centers on desktop** (`sm:items-center`). Clicking
the backdrop closes it; clicks inside are stopped from bubbling.

```tsx
<AnimatePresence>
  <motion.div
    initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
    className="fixed inset-x-0 top-0 h-[100dvh] z-[100] flex items-end sm:items-center
               justify-center bg-ink/40 backdrop-blur-sm p-0 sm:p-4"
    onClick={onClose}
  >
    <motion.div
      initial={{ opacity: 0, y: 40, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 40, scale: 0.98 }}
      transition={{ type: 'spring', damping: 30, stiffness: 320 }}
      className={`relative w-full max-h-[100dvh] sm:max-h-[90vh] overflow-y-auto bg-white
                  rounded-t-2xl sm:rounded-2xl border border-line shadow-xl
                  flex flex-col sm:flex-row transition-[max-width] duration-300
                  ${isBox ? 'sm:max-w-4xl' : 'sm:max-w-2xl'}`}
      onClick={(e) => e.stopPropagation()}
    >
      {/* image (left) · content (right) */}
    </motion.div>
  </motion.div>
</AnimatePresence>
```

A nice touch: the vial artwork is **square** but the pack-of-10 box shot is
**16:9**, so selecting a pack size animates the image's `aspect-ratio` and the
panel's `max-width` together for a smooth resize:

```tsx
const isBox = packSize === 10 && !!product.box_image_url;
const displayImage = isBox ? product.box_image_url : product.image_url;
```

## 6. The controls

The body is three stacked blocks — **pack size**, **quantity**, and a
**subtotal + actions** footer.

```tsx
{/* Pack size — two selectable cards; the active one is inverted (ink) with a check */}
<div className="grid grid-cols-2 gap-2">
  {PACK_OPTIONS.map((opt) => {
    const active = packSize === opt.size;
    return (
      <button
        key={opt.size}
        type="button"
        onClick={() => setPackSize(opt.size)}
        className={`relative rounded-xl border p-3 text-left transition-all ${
          active
            ? 'border-ink bg-ink text-white shadow-sm'
            : 'border-line bg-surface text-ink hover:border-ink/40 hover:bg-white'
        }`}
      >
        {active && (
          <span className="absolute top-2 right-2 flex h-4 w-4 items-center
                           justify-center rounded-full bg-white">
            <Check className="h-3 w-3 text-ink" />
          </span>
        )}
        <span className="block text-sm font-semibold">{opt.label}</span>
        <span className={`block text-[11px] ${active ? 'text-white/70' : 'text-ink-muted'}`}>
          {opt.sublabel}
        </span>
      </button>
    );
  })}
</div>

{/* Quantity — a −/+ stepper, clamped at a minimum of 1 */}
<div className="flex items-center bg-surface border border-line rounded-xl overflow-hidden">
  <button onClick={() => setPacks((p) => Math.max(1, p - 1))}>{/* Minus */}</button>
  <span className="tabular-nums">{packs}</span>
  <button onClick={() => setPacks((p) => p + 1)}>{/* Plus */}</button>
</div>

{/* Subtotal + actions */}
<div className="flex items-end justify-between border-t border-line pt-4">
  <div>
    <span className="block text-sm text-ink-muted">Subtotal</span>
    <span className="block text-[11px] text-ink-light tabular-nums">
      {money(perVialPrice, perVialUsd)} × {vials} {vials === 1 ? 'vial' : 'vials'}
    </span>
  </div>
  <span className="text-xl font-bold text-ink tabular-nums">
    {money(lineTotal, perVialUsd * vials)}
  </span>
</div>

<div className="grid grid-cols-2 gap-2">
  <button onClick={handleAdd}    className="… bg-white border border-line text-ink">Add to cart</button>
  <button onClick={handleBuyNow} className="… bg-ink text-white shadow-sm">Buy now</button>
</div>
```

---

## Design conventions

Keep the modal on-brand by reusing PURA tokens rather than raw hex:

| Role                     | Token / class                                   |
| ------------------------ | ----------------------------------------------- |
| Primary text             | `text-ink`                                      |
| Secondary text           | `text-ink-muted`                                |
| Tertiary / hint text     | `text-ink-light`                                |
| Panel background         | `bg-white`                                       |
| Inset / control surface  | `bg-surface`                                     |
| Borders / dividers       | `border-line`                                    |
| Accent (strength, badges)| `bronze` family (`bg-bronze-50`, `text-bronze`) |
| Primary action / selected| `bg-ink text-white`                              |
| Radius                   | `rounded-xl` (controls), `rounded-2xl` (panel)  |
| Numbers                  | `tabular-nums` for prices & quantities          |

**Design refinements applied** in this pass (presentation only — no pricing or
behaviour changed):

- Stronger header hierarchy: larger product name, `strength` promoted to a
  bronze pill, and the pack/vial prices emphasised with `font-medium`.
- Selected pack card now carries a check badge and a soft shadow so the active
  choice reads at a glance; the inactive card lifts to `bg-white` on hover.
- Subtotal is separated by a divider and annotated with a
  `per-vial × count` breakdown so the total is self-explanatory.
- Action buttons: a cleaner white/ink secondary vs. an `ink` primary with a
  subtle shadow on hover.
- Close button gets a bordered, higher-contrast hit target.
