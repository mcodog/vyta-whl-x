-- Lab Results ------------------------------------------------------------
-- Third-party HPLC-UV analytical reports (Certificates of Analysis) for the
-- research compounds, surfaced on the public /lab-results page.
--
-- One row per unique report PDF. Several product strengths can share a single
-- report (e.g. DSIP 5/10/15mg all reference dsip-5mg.pdf), so the covered
-- products are derived at query time by matching this report_url against the
-- products.coa_url array rather than duplicated here.

create table if not exists public.lab_results (
  id uuid not null default extensions.uuid_generate_v4 (),
  -- Canonical link to the full report PDF. Matches an entry in products.coa_url.
  report_url text not null,
  -- Human label as it appears on the report (e.g. "KLOW 80MG").
  product_name text not null,
  -- Testing laboratory.
  lab text not null default 'PPB Analytical Inc.',
  -- Lab's internal sample identifier (e.g. "5026_0266").
  sample_id text null,
  -- Compound(s) assayed; blends are "; " separated (e.g. "BPC-157; TB-500").
  compound text null,
  -- CAS registry number(s), aligned 1:1 with compound.
  cas_number text null,
  -- Overall HPLC-UV purity as a percentage (e.g. 97.65).
  purity_pct numeric null,
  -- Analytical method used.
  method text not null default 'HPLC-UV',
  -- Sample matrix as reported.
  matrix text null default 'Other',
  -- Key dates lifted from the report.
  receiving_date date null,
  registration_date date null,
  report_date date null,
  active boolean not null default true,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint lab_results_pkey primary key (id),
  constraint lab_results_report_url_key unique (report_url)
) TABLESPACE pg_default;

create index if not exists idx_lab_results_report_url
  on public.lab_results using btree (report_url) TABLESPACE pg_default;

create index if not exists idx_lab_results_active
  on public.lab_results using btree (active) TABLESPACE pg_default;

-- Keep updated_at fresh on edits.
create or replace function public.lab_results_set_updated_at ()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_lab_results_updated_at on public.lab_results;
create trigger trg_lab_results_updated_at
  before update on public.lab_results
  for each row
  execute function public.lab_results_set_updated_at ();

-- Seed data --------------------------------------------------------------
-- Extracted from the PPB Analytical Inc. HPLC-UV reports. Idempotent: an
-- existing report (matched by report_url) is refreshed in place.
insert into public.lab_results
  (report_url, product_name, lab, sample_id, compound, cas_number, purity_pct, method, matrix, receiving_date, registration_date, report_date)
values
  ('https://swpcvpkcfxihxmjpjqow.supabase.co/storage/v1/object/public/certificates/bpc-157-10mg.pdf',
   'BPC-157 10MG', 'PPB Analytical Inc.', '5026_0270', 'BPC-157', '137525-51-0', 100.00, 'HPLC-UV', 'Other', '2026-03-13', '2026-03-13', '2026-03-27'),

  ('https://swpcvpkcfxihxmjpjqow.supabase.co/storage/v1/object/public/certificates/dsip-5mg.pdf',
   'DSIP 5MG', 'PPB Analytical Inc.', '5026_0252', 'DSIP', '62568-57-4', 100.00, 'HPLC-UV', 'Other', '2026-03-13', '2026-03-13', '2026-03-27'),

  ('https://swpcvpkcfxihxmjpjqow.supabase.co/storage/v1/object/public/certificates/ghk-cu-50mg.pdf',
   'GHK-Cu 50MG', 'PPB Analytical Inc.', '5026_0262', 'GHK-Cu', '89030-95-5', 100.00, 'HPLC-UV', 'Other', '2026-03-13', '2026-03-13', '2026-03-27'),

  ('https://swpcvpkcfxihxmjpjqow.supabase.co/storage/v1/object/public/certificates/glow-70mg.pdf',
   'GLOW 70MG', 'PPB Analytical Inc.', '5026_0256', 'BPC-157; TB-500; GHK-Cu', '137525-51-0; 77591-33-4; 89030-95-5', 97.16, 'HPLC-UV', 'Other', '2026-03-13', '2026-03-13', '2026-03-27'),

  ('https://swpcvpkcfxihxmjpjqow.supabase.co/storage/v1/object/public/certificates/igf-1lr3-1mg.pdf',
   'IGF-1LR3 1MG', 'PPB Analytical Inc.', '5026_0264', 'IGF-1LR3', '143045-27-6', 100.00, 'HPLC-UV', 'Other', '2026-03-13', '2026-03-13', '2026-03-27'),

  ('https://swpcvpkcfxihxmjpjqow.supabase.co/storage/v1/object/public/certificates/klow-80mg.pdf',
   'KLOW 80MG', 'PPB Analytical Inc.', '5026_0266', 'BPC-157; TB-500; GHK-Cu; KPV', '137525-51-0; 77591-33-4; 89030-95-5; 67727-97-3', 97.65, 'HPLC-UV', 'Other', '2026-03-13', '2026-03-13', '2026-03-27'),

  ('https://swpcvpkcfxihxmjpjqow.supabase.co/storage/v1/object/public/certificates/mots-c-40mg.pdf',
   'MOTS-C 40MG', 'PPB Analytical Inc.', '5026_0260', 'MOTS-C', '1627580-64-6', 98.27, 'HPLC-UV', 'Other', '2026-03-13', '2026-03-13', '2026-03-27'),

  ('https://swpcvpkcfxihxmjpjqow.supabase.co/storage/v1/object/public/certificates/nad-plus-1000mg.pdf',
   'NAD+ 1000MG', 'PPB Analytical Inc.', '5026_0248', 'NAD+', '53-84-9', 100.00, 'HPLC-UV', 'Other', '2026-03-13', '2026-03-13', '2026-03-27'),

  ('https://swpcvpkcfxihxmjpjqow.supabase.co/storage/v1/object/public/certificates/tesamorelin-10mg.pdf',
   'Tesamorelin 10MG', 'PPB Analytical Inc.', '5026_0274', 'Tesamorelin', '218949-48-5', 100.00, 'HPLC-UV', 'Other', '2026-03-13', '2026-03-13', '2026-03-27')
on conflict (report_url) do update set
  product_name    = excluded.product_name,
  lab             = excluded.lab,
  sample_id       = excluded.sample_id,
  compound        = excluded.compound,
  cas_number      = excluded.cas_number,
  purity_pct      = excluded.purity_pct,
  method          = excluded.method,
  matrix          = excluded.matrix,
  receiving_date  = excluded.receiving_date,
  registration_date = excluded.registration_date,
  report_date     = excluded.report_date,
  updated_at      = now();

-- NOTE: SS-31 50MG (SKU 2S50, certificates/1776855744885-743ww9.pdf) is not
-- seeded yet — its report data was not available at migration time. Add a row
-- following the same shape once the values are on hand.
