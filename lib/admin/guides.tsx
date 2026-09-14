'use client';

/**
 * Admin how-to guides / internal wiki.
 *
 * A small, hand-authored knowledge base surfaced on the dashboard and at
 * `/admin/guides`. Each guide is plain content (no data fetching) so it renders
 * instantly and can be read by admins/assistants who are learning the system.
 *
 * To add a guide: append an entry to `guides` below with a unique `slug` and a
 * `Body` component built from the prose primitives in this file. It shows up on
 * the index, the dashboard panel, and at `/admin/guides/<slug>` automatically.
 */

import React from 'react';
import Link from 'next/link';
import { Scale, UserPlus, Info, Tag, Network, type LucideIcon } from 'lucide-react';

export interface Guide {
  /** URL slug: /admin/guides/<slug> */
  slug: string;
  title: string;
  /** One-line description shown on cards. */
  summary: string;
  /** Grouping label (e.g. "Affiliates & Sales"). */
  category: string;
  icon: LucideIcon;
  /** Rough reading time, e.g. "3 min". */
  readingTime: string;
  /** Last meaningful edit (ISO date). */
  updated: string;
  /** The article body. */
  Body: React.FC;
}

/* ------------------------------------------------------------------ */
/* Prose primitives — a tiny, palette-consistent typography kit so every
   guide reads the same. Color stays on ink / vital / surface; no filled
   color boxes. */
/* ------------------------------------------------------------------ */

function Lead({ children }: { children: React.ReactNode }) {
  return <p className="text-[15px] md:text-base leading-relaxed text-ink-muted mb-6">{children}</p>;
}

function H2({ children }: { children: React.ReactNode }) {
  return <h2 className="text-lg font-bold text-ink mt-9 mb-3 scroll-mt-24">{children}</h2>;
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="text-sm md:text-[15px] leading-relaxed text-ink/80 mb-4">{children}</p>;
}

function UL({ children }: { children: React.ReactNode }) {
  return <ul className="mb-5 space-y-2">{children}</ul>;
}

function LI({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-2.5 text-sm md:text-[15px] leading-relaxed text-ink/80">
      <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-vital" aria-hidden />
      <span>{children}</span>
    </li>
  );
}

/** Numbered steps with vital index badges. */
function Steps({ children }: { children: React.ReactNode }) {
  const items = React.Children.toArray(children);
  return (
    <ol className="mb-6 space-y-4">
      {items.map((child, i) => (
        <li key={i} className="flex gap-3.5">
          <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-vital/12 text-vital text-sm font-bold tabular-nums">
            {i + 1}
          </span>
          <div className="min-w-0 flex-1 pt-0.5">{child}</div>
        </li>
      ))}
    </ol>
  );
}

function StepTitle({ children }: { children: React.ReactNode }) {
  return <div className="text-sm md:text-[15px] font-semibold text-ink mb-1">{children}</div>;
}

function StepBody({ children }: { children: React.ReactNode }) {
  return <div className="text-sm leading-relaxed text-ink/75">{children}</div>;
}

/** Subtle callout — surface background, vital accent rail + icon. */
function Note({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <div className="my-6 rounded-lg border border-line bg-surface/70 border-l-2 border-l-vital p-4">
      <div className="flex gap-3">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-vital" />
        <div className="min-w-0">
          {title && <div className="text-sm font-semibold text-ink mb-1">{title}</div>}
          <div className="text-sm leading-relaxed text-ink/75">{children}</div>
        </div>
      </div>
    </div>
  );
}

/** Inline UI-path / keyboard-ish token. */
function Path({ children }: { children: React.ReactNode }) {
  return (
    <span className="mx-0.5 rounded border border-line bg-white px-1.5 py-0.5 text-[13px] font-medium text-ink whitespace-nowrap">
      {children}
    </span>
  );
}

function InternalLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="font-medium text-vital underline decoration-vital/30 underline-offset-2 hover:decoration-vital">
      {children}
    </Link>
  );
}

/* A compact comparison table (ink header, line borders, no color fills). */
function CompareTable({
  columns,
  rows,
}: {
  columns: [string, string, string];
  rows: Array<[React.ReactNode, React.ReactNode, React.ReactNode]>;
}) {
  return (
    <div className="my-6 overflow-x-auto rounded-lg border border-line">
      <table className="w-full min-w-[520px] text-sm">
        <thead>
          <tr className="border-b border-line bg-surface">
            <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-ink-muted">{columns[0]}</th>
            <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-ink">{columns[1]}</th>
            <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-vital">{columns[2]}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line/60">
          {rows.map((row, i) => (
            <tr key={i} className="align-top">
              <td className="px-4 py-3 font-medium text-ink">{row[0]}</td>
              <td className="px-4 py-3 text-ink/75">{row[1]}</td>
              <td className="px-4 py-3 text-ink/75">{row[2]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Guide bodies                                                        */
/* ------------------------------------------------------------------ */

function AffiliateVsSalesPersonBody() {
  return (
    <>
      <Lead>
        A <strong className="text-ink font-semibold">sales person</strong> and an{' '}
        <strong className="text-ink font-semibold">affiliate</strong> are the same kind of person in
        two tiers: someone who brings us business. The difference is whether they have a login and do
        the work themselves, or whether we do it for them.
      </Lead>

      <H2>The one-sentence version</H2>
      <P>
        A <strong className="text-ink font-semibold">Rep</strong> (plain sales person) introduces a
        customer and asks us to cut the invoice for them — they don&rsquo;t log in. An{' '}
        <strong className="text-ink font-semibold">Affiliate</strong> is a rep who has been given a
        login and a referral code so they can create their own invoices <em>and</em> earn referral
        commissions on storefront orders placed through their code.
      </P>

      <H2>Side by side</H2>
      <CompareTable
        columns={['', 'Rep (Sales Person)', 'Affiliate']}
        rows={[
          ['Has a login', 'No — contact record only', 'Yes — their own account'],
          ['Referral code', 'No', 'Yes — a unique code / link'],
          [
            'Who makes the invoice',
            'We do, on their behalf',
            'They can make it themselves (or we still can)',
          ],
          [
            'Invoice commission',
            'Yes — a % on invoices they’re attached to',
            'Yes — same invoice commission',
          ],
          [
            'Referral commission',
            'No',
            'Yes — earns on storefront orders that use their code',
          ],
          ['Sees a dashboard', 'No', 'Yes — a scoped "Client Dashboard"'],
          [
            'Typical use',
            'A contact who sends us the occasional customer',
            'A partner running their own book of business',
          ],
        ]}
      />

      <H2>Why they live on one page</H2>
      <P>
        Every affiliate is, underneath, a sales person with a login attached. Because of that they are
        managed from a single surface — <Path>People → Sales People</Path> — where each row is badged{' '}
        <strong className="text-ink font-semibold">Rep</strong> or{' '}
        <strong className="text-ink font-semibold">Affiliate</strong>. This keeps one person from
        showing up in two places and keeps their name, rate and history from drifting apart.
      </P>

      <H2>Two commission ledgers</H2>
      <P>Because an affiliate can earn in two different ways, there are two separate ledgers:</P>
      <UL>
        <LI>
          <strong className="text-ink font-semibold">Invoice commission</strong> — a percentage
          (e.g. 5%) on invoices the person is the sales person on. This applies to reps and affiliates
          alike.
        </LI>
        <LI>
          <strong className="text-ink font-semibold">Referral commission</strong> — earned only by
          affiliates, calculated at checkout when a customer uses their referral code on a storefront
          order.
        </LI>
      </UL>
      <P>
        Both are reviewed and paid from <InternalLink href="/admin/commissions">Commissions</InternalLink>{' '}
        (and on the person&rsquo;s detail page). Marking a commission paid is admin-only.
      </P>

      <Note title="Rule of thumb">
        Start everyone as a <strong className="text-ink font-semibold">Rep</strong>. Promote to{' '}
        <strong className="text-ink font-semibold">Affiliate</strong> only when they should log in and
        work independently or earn on their own referral link.
      </Note>

      <P>
        Ready to promote someone?{' '}
        <InternalLink href="/admin/guides/how-to-set-up-an-affiliate">
          How to set up an affiliate →
        </InternalLink>
      </P>
    </>
  );
}

function HowToSetUpAnAffiliateBody() {
  return (
    <>
      <Lead>
        Setting up an affiliate is a two-part move: create the person as a sales person, then promote
        them so they get a login and a referral code. Everything happens from{' '}
        <Path>People → Sales People</Path>.
      </Lead>

      <Note title="Before you start">
        Not sure whether this person should be an affiliate at all? Read{' '}
        <InternalLink href="/admin/guides/affiliate-vs-sales-person">
          Affiliate vs. Sales Person
        </InternalLink>{' '}
        first. Short version: promote only people who should log in and work on their own.
      </Note>

      <H2>Steps</H2>
      <Steps>
        <div>
          <StepTitle>Open Sales People</StepTitle>
          <StepBody>
            Go to <InternalLink href="/admin/sales-people">People → Sales People</InternalLink>. This
            is the single place reps and affiliates are managed.
          </StepBody>
        </div>
        <div>
          <StepTitle>Add the person as a Rep</StepTitle>
          <StepBody>
            Click <Path>Add Sales Person</Path> and fill in their name and contact details. This
            creates a plain rep (no login yet). If they already exist in the list, skip this step.
          </StepBody>
        </div>
        <div>
          <StepTitle>Open their detail page and Promote to affiliate</StepTitle>
          <StepBody>
            Click the person to open their detail page, then click{' '}
            <Path>Promote to affiliate</Path>. This creates their login account, an affiliate record,
            and a unique referral code — all linked to the rep you just made, so their history is
            preserved.
          </StepBody>
        </div>
        <div>
          <StepTitle>Set their commission rates</StepTitle>
          <StepBody>
            On the same detail page, confirm the <strong className="text-ink font-semibold">invoice
            commission</strong> percentage (defaults to 5%) and the{' '}
            <strong className="text-ink font-semibold">referral commission</strong> used when a
            customer checks out with their code.
          </StepBody>
        </div>
        <div>
          <StepTitle>Share their referral link</StepTitle>
          <StepBody>
            Copy the referral code from their detail page and share the link — it looks like{' '}
            <Path>yourstore.com/?ref=CODE</Path>. Customers who arrive or check out through it are
            bound to the affiliate automatically.
          </StepBody>
        </div>
        <div>
          <StepTitle>(Optional) Assign a price list</StepTitle>
          <StepBody>
            If the affiliate should sell at specific prices, assign them a price list from the{' '}
            <InternalLink href="/admin/pricing">Pricing</InternalLink> area. Affiliate invoice pricing
            is locked to their assigned list, and their bound customers stay in sync with it.
          </StepBody>
        </div>
      </Steps>

      <H2>What the affiliate gets</H2>
      <UL>
        <LI>
          A login to a scoped <strong className="text-ink font-semibold">Client Dashboard</strong>{' '}
          showing their customers, invoices and earnings.
        </LI>
        <LI>The ability to create invoices for their own customers.</LI>
        <LI>A referral code + link that earns referral commission on storefront orders.</LI>
      </UL>

      <H2>Where the money shows up</H2>
      <P>
        Both invoice and referral commissions appear on the person&rsquo;s detail page and in{' '}
        <InternalLink href="/admin/commissions">Commissions</InternalLink>. Review what&rsquo;s owed
        there and mark commissions paid once you&rsquo;ve sent payment (admin-only).
      </P>

      <Note title="Undoing a promotion">
        Deleting an affiliate cascades cleanly (commissions → referral code → login → affiliate
        record). If you only want to pause them, deactivate the person instead of deleting — that
        keeps their history and invoices intact.
      </Note>
    </>
  );
}

function CustomerPricingBody() {
  return (
    <>
      <Lead>
        A customer&rsquo;s invoice prices come from their own <em>price overrides</em>. A customer with
        none simply follows the house (active) price list. You set their pricing from{' '}
        <Path>Pricing → Customer Pricing</Path>, either by applying a saved list or by hand-editing
        specific prices.
      </Lead>

      <H2>Two ways a customer gets priced</H2>
      <P>
        Every customer is in one of two modes, shown as a badge on their pricing and on the invoice
        form:
      </P>
      <UL>
        <LI>
          <strong className="text-ink font-semibold">Template</strong> — a faithful copy of a shared
          price list. Several customers can share the same list; edit the list and re-apply to move
          them together.
        </LI>
        <LI>
          <strong className="text-ink font-semibold">Dedicated</strong> — hand-managed prices unique
          to this customer. Any manual edit, a re-priced apply, or an import puts them here.
        </LI>
      </UL>

      <H2>Steps</H2>
      <Steps>
        <div>
          <StepTitle>Open Customer Pricing</StepTitle>
          <StepBody>
            Go to <InternalLink href="/admin/pricing">Pricing</InternalLink> and choose the{' '}
            <Path>Customer Pricing</Path> tab, then pick the customer (or open their pricing editor
            directly).
          </StepBody>
        </div>
        <div>
          <StepTitle>Apply a saved price list (Template)</StepTitle>
          <StepBody>
            Pick a saved list as the <Path>Source</Path>, leave the multiplier at{' '}
            <Path>100%</Path>, and click <Path>Apply</Path>. The list&rsquo;s prices are copied onto
            the customer and they&rsquo;re marked <strong className="text-ink font-semibold">Template ·
            «list name»</strong>.
          </StepBody>
        </div>
        <div>
          <StepTitle>(Optional) Re-price on apply</StepTitle>
          <StepBody>
            Before applying, set a <strong className="text-ink font-semibold">Multiplier</strong>{' '}
            (25–300%; 100% = unchanged) to sell a list at a premium/sample tier, and/or turn on{' '}
            <strong className="text-ink font-semibold">Convert CAD → USD</strong> (offered for CAD
            sources; divides by an editable per-use rate, default <Path>1.45</Path> CAD per USD). You
            can also copy <em>another customer&rsquo;s</em> current prices as the source. Any of these
            makes the customer <strong className="text-ink font-semibold">Dedicated</strong>.
          </StepBody>
        </div>
        <div>
          <StepTitle>(Optional) Hand-edit specific prices</StepTitle>
          <StepBody>
            Use <Path>Edit pricelist</Path> to open the per-customer editor and set individual cells:
            the box price (Labeled / Unlabeled) and a <strong className="text-ink font-semibold">Custom
            Vial</strong> price (the catalog value shows as <em>Default Vial</em>). Editing any cell
            makes the customer <strong className="text-ink font-semibold">Dedicated</strong>.
          </StepBody>
        </div>
      </Steps>

      <H2>Implications — read before you edit</H2>
      <Note title="Dedicated is sticky">
        Any hand-edit — or a re-priced / kept-existing apply — flips the customer to{' '}
        <strong className="text-ink font-semibold">Dedicated</strong> and it stays there. A price typed
        back to the exact list value still counts. <strong className="text-ink font-semibold">Re-applying
        a list is the only way back to Template.</strong>
      </Note>
      <Note title="Applied prices are a snapshot, not a live link">
        A re-priced or hand-set price stores literal numbers. If you later change the source list,{' '}
        <strong className="text-ink font-semibold">this customer does not follow</strong> — re-apply the
        list to pull the new prices. (A plain Template apply records the source list so you can re-apply
        easily.)
      </Note>
      <Note title="The convert rate is not the site FX rate">
        The <Path>1.45</Path> CAD→USD convert is a <em>per-use</em> convenience for one-off USD pricing.
        It is deliberately separate from the global <em>usd_exchange_rate</em> in Site Settings — never
        move the global rate to price a single customer; that re-prices the whole storefront.
      </Note>
      <Note title="Vial prices are set in the per-customer editor only">
        The bulk Customer Pricing tool is box-only. To give a customer a real single-vial price
        (independent of the box price), use the <strong className="text-ink font-semibold">Custom Vial</strong>{' '}
        column in their editor. Vial price precedence is: custom vial → catalog vial → box ÷ 10.
      </Note>

      <P>
        Pricing an <strong className="text-ink font-semibold">affiliate</strong>? The steps are the
        same, but extra rules apply —{' '}
        <InternalLink href="/admin/guides/how-to-set-up-pricing-for-affiliates">
          How to set up pricing for affiliates →
        </InternalLink>
      </P>
    </>
  );
}

function AffiliatePricingBody() {
  return (
    <>
      <Lead>
        An affiliate is a customer with a login (see{' '}
        <InternalLink href="/admin/guides/affiliate-vs-sales-person">Affiliate vs. Sales Person</InternalLink>),
        so you price them the same way as any customer — but because they sell to their own customers,
        their prices are <strong className="text-ink font-semibold">locked</strong> on invoices and are
        kept in sync with the customers bound to them.
      </Lead>

      <H2>Where to set it</H2>
      <P>
        From <InternalLink href="/admin/pricing">Pricing</InternalLink> you can use the{' '}
        <Path>Affiliate Pricing</Path> tab (each affiliate plus the bound-customer prices their list
        drives), the <Path>Customer Pricing</Path> tab on the affiliate&rsquo;s own record, or the{' '}
        <strong className="text-ink font-semibold">Pricing</strong> tab on their sales-person detail
        page. All three drive the same prices.
      </P>

      <H2>Steps</H2>
      <Steps>
        <div>
          <StepTitle>Open the affiliate&rsquo;s pricing</StepTitle>
          <StepBody>
            Go to <InternalLink href="/admin/pricing">Pricing → Affiliate Pricing</InternalLink> and
            pick the affiliate (or open Customer Pricing on their record).
          </StepBody>
        </div>
        <div>
          <StepTitle>Apply a price list (optionally re-priced)</StepTitle>
          <StepBody>
            Choose a <Path>Source</Path> list, optionally set a <Path>Multiplier</Path> or{' '}
            <Path>Convert CAD → USD</Path>, and click <Path>Apply</Path> — exactly like a customer.
            This becomes the affiliate&rsquo;s assigned pricing.
          </StepBody>
        </div>
        <div>
          <StepTitle>Set a per-vial price if they sell vials</StepTitle>
          <StepBody>
            Use the <strong className="text-ink font-semibold">Custom Vial</strong> column in the
            per-customer editor so a vial line quotes their price, not the catalog default.
          </StepBody>
        </div>
      </Steps>

      <H2>Implications — the important part</H2>
      <Note title="Affiliate invoice prices are locked">
        On the invoices an affiliate creates, the unit price <strong className="text-ink font-semibold">auto-fills
        from the list you assign and can&rsquo;t be changed by them</strong> — the server re-derives it, so
        it can&rsquo;t be bypassed through the API either. They <em>can</em> still apply a per-line
        discount (0–100%). If an affiliate needs a special base price, <strong className="text-ink font-semibold">you
        (an admin) must set it</strong> as an override on their record.
      </Note>
      <Note title="Editing one affiliate price updates all their customers">
        An affiliate&rsquo;s prices are kept in sync with every customer bound to them — today&rsquo;s
        and future. Change the affiliate&rsquo;s prices and their bound customers move with them; when an
        affiliate imports a price list, their own invoice prices update too. <strong className="text-ink font-semibold">Only
        the box price is synced</strong> — unlabeled, per-vial and hidden-product settings live on the
        affiliate&rsquo;s own record only.
      </Note>
      <Note title="Affiliates can't manage their own pricing">
        The pricing pages are admin-only. On the invoice form an affiliate sees their currency and price
        list, but <strong className="text-ink font-semibold">locked</strong> (with a Template / Dedicated
        badge) — they can read what they&rsquo;re selling at, not change it. Pricing is yours to control.
      </Note>
      <Note title="Template vs dedicated still applies">
        Everything from the customer guide holds: any hand-edit or re-priced apply makes them Dedicated,
        applied prices are a snapshot (re-apply to pull list changes), and the per-use convert rate is
        separate from the site FX rate. See{' '}
        <InternalLink href="/admin/guides/how-to-set-up-pricing-for-a-customer">
          How to set up pricing for a customer
        </InternalLink>.
      </Note>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Registry                                                            */
/* ------------------------------------------------------------------ */

export const guides: Guide[] = [
  {
    slug: 'how-to-set-up-an-affiliate',
    title: 'How to set up an affiliate',
    summary: 'Create a sales person, promote them to an affiliate, and hand over a referral link.',
    category: 'Affiliates & Sales',
    icon: UserPlus,
    readingTime: '3 min',
    updated: '2026-08-12',
    Body: HowToSetUpAnAffiliateBody,
  },
  {
    slug: 'affiliate-vs-sales-person',
    title: 'Affiliate vs. Sales Person',
    summary: 'The same person in two tiers — who logs in, who earns what, and when to promote.',
    category: 'Affiliates & Sales',
    icon: Scale,
    readingTime: '2 min',
    updated: '2026-08-12',
    Body: AffiliateVsSalesPersonBody,
  },
  {
    slug: 'how-to-set-up-pricing-for-a-customer',
    title: 'How to set up pricing for a customer',
    summary: 'Apply a price list or set dedicated prices — and what template vs. dedicated means.',
    category: 'Pricing',
    icon: Tag,
    readingTime: '4 min',
    updated: '2026-08-12',
    Body: CustomerPricingBody,
  },
  {
    slug: 'how-to-set-up-pricing-for-affiliates',
    title: 'How to set up pricing for affiliates',
    summary: 'Assign an affiliate’s prices — plus locking, the two synced lists, and the gotchas.',
    category: 'Pricing',
    icon: Network,
    readingTime: '4 min',
    updated: '2026-08-12',
    Body: AffiliatePricingBody,
  },
];

export function getGuide(slug: string): Guide | undefined {
  return guides.find((g) => g.slug === slug);
}

/** Featured guides for the dashboard panel (first N). */
export function featuredGuides(n = 2): Guide[] {
  return guides.slice(0, n);
}
