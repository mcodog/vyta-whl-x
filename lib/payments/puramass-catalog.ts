/**
 * PuraMass hosted-checkout catalog helpers.
 *
 * The storefront's own products carry short internal SKUs (e.g. `RT10`,
 * `TB5`), which do NOT match the SKUs the PuraMass partner API expects
 * (e.g. `puramass-retatrutide-10mg-case`). To hand a cart off to the hosted
 * checkout we therefore keep a per-product `puramass_sku` mapping on the
 * `products` table and populate it by matching each product to a PuraMass
 * catalog entry.
 *
 * The live source of truth is `GET /partner/store/products` (see
 * `fetchPuramassCatalog` in ./puramass). This module bundles a snapshot of that
 * catalog (transcribed from the partner onboarding email) so the matcher works
 * offline — for tests and as a fallback when the live call is unavailable — and
 * provides a deterministic, strength-anchored matcher that the admin SKU-sync
 * endpoint uses to auto-fill `puramass_sku` for confident matches while leaving
 * ambiguous/unmatched products for a human to resolve.
 *
 * Prices here are a point-in-time reference only. PuraMass always re-reads the
 * charged price from its own catalog server-side, so nothing in this file
 * affects what a customer is billed.
 */

export interface PuramassCatalogEntry {
  sku: string;
  name: string;
}

/**
 * Snapshot of the PuraMass partner catalog (peptides + general products).
 * Kept only as a matcher fallback and reference — the sync endpoint prefers the
 * live catalog. Keep entries in sync with the partner catalog when it changes.
 */
export const PURAMASS_CATALOG_SNAPSHOT: PuramassCatalogEntry[] = [
  { sku: 'puramass-5-amino-1mq-5mg-case', name: '5-Amino-1MQ 5mg' },
  { sku: 'puramass-5-amino-1mq-10mg-case', name: '5-Amino-1MQ 10mg' },
  { sku: 'puramass-5-amino-1mq-50mg-case', name: '5-Amino-1MQ 50mg' },
  { sku: 'puramass-adamax-5mg-case', name: 'Adamax 5mg' },
  { sku: 'puramass-ahk-cu-50mg-case', name: 'AHK-Cu 50mg' },
  { sku: 'puramass-ahk-cu-100mg-case', name: 'AHK-Cu 100mg' },
  { sku: 'puramass-aicar-50mg-case', name: 'Aicar 50mg' },
  { sku: 'puramass-aod9604-5mg-case', name: 'AOD9604 5mg' },
  { sku: 'puramass-aod9604-10mg-case', name: 'AOD9604 10mg' },
  { sku: 'puramass-ara-290-10mg-case', name: 'ARA-290 10mg' },
  { sku: 'puramass-bacteriostatic-water-3ml-case', name: 'Bacteriostatic Water 3mL' },
  { sku: 'puramass-bacteriostatic-water-10ml-case', name: 'Bacteriostatic Water 10mL' },
  { sku: 'puramass-bacteriostatic-water-30ml-case', name: 'Bacteriostatic Water 30mL' },
  { sku: 'puramass-bpc-157-5mg-case', name: 'BPC-157 5mg' },
  { sku: 'puramass-bpc-157-10mg-case', name: 'BPC-157 10mg' },
  { sku: 'puramass-bpc-157-20mg-case', name: 'BPC-157 20mg' },
  { sku: 'puramass-bpc-plus-tb500-10mg-wolverine-case', name: 'BPC + TB500 10mg (WOLVERINE)' },
  { sku: 'puramass-bpc-plus-tb500-20mg-wolverine-case', name: 'BPC + TB500 20mg (WOLVERINE)' },
  { sku: 'puramass-cagrilintide-5mg-case', name: 'Cagrilintide 5mg' },
  { sku: 'puramass-cagrilintide-10mg-case', name: 'Cagrilintide 10mg' },
  { sku: 'puramass-cerebrolysin-60mg-case', name: 'Cerebrolysin 60mg' },
  { sku: 'puramass-cjc-1295-with-dac-5mg-case', name: 'CJC-1295 with DAC 5mg' },
  { sku: 'puramass-cjc-1295-without-dac-5mg-case', name: 'CJC-1295 without DAC 5mg' },
  { sku: 'puramass-cjc-1295-without-dac-10mg-case', name: 'CJC-1295 without DAC 10mg' },
  { sku: 'puramass-cjc-1295-without-dac-plus-ipa-10mg-case', name: 'CJC-1295 without DAC + IPA 10mg' },
  { sku: 'puramass-dihexa-10mg-case', name: 'Dihexa 10mg' },
  { sku: 'puramass-dsip-5mg-case', name: 'DSIP 5mg' },
  { sku: 'puramass-dsip-10mg-case', name: 'DSIP 10mg' },
  { sku: 'puramass-epithalon-10mg-case', name: 'Epithalon 10mg' },
  { sku: 'puramass-epithalon-50mg-case', name: 'Epithalon 50mg' },
  { sku: 'puramass-fox-04-10mg-case', name: 'FOX-04 10mg' },
  { sku: 'puramass-ghk-cu-50mg-case', name: 'GHK-CU 50mg' },
  { sku: 'puramass-ghk-cu-100mg-case', name: 'GHK-CU 100mg' },
  { sku: 'puramass-ghrp-2-acetate-10mg-case', name: 'GHRP-2 Acetate 10mg' },
  { sku: 'puramass-ghrp-6-acetate-10mg-case', name: 'GHRP-6 Acetate 10mg' },
  { sku: 'puramass-glow-70mg-case', name: 'GLOW 70mg' },
  { sku: 'puramass-glutathione-1500mg-case', name: 'Glutathione 1500mg' },
  { sku: 'puramass-hcg-5000-iu-case', name: 'HCG 5000 IU' },
  { sku: 'puramass-hcg-10000-iu-case', name: 'HCG 10000 IU' },
  { sku: 'puramass-hexarelin-acetate-5mg-case', name: 'Hexarelin Acetate 5mg' },
  { sku: 'puramass-hgh-191aa-somatropin-10-iu-case', name: 'HGH 191AA (Somatropin) 10 IU' },
  { sku: 'puramass-hgh-191aa-somatropin-15-iu-case', name: 'HGH 191AA (Somatropin) 15 IU' },
  { sku: 'puramass-hgh-191aa-somatropin-24-iu-case', name: 'HGH 191AA (Somatropin) 24 IU' },
  { sku: 'puramass-hgh-191aa-somatropin-36-iu-case', name: 'HGH 191AA (Somatropin) 36 IU' },
  { sku: 'puramass-igf-1lr3-1mg-case', name: 'IGF-1LR3 1mg' },
  { sku: 'puramass-ipamorelin-5mg-case', name: 'Ipamorelin 5mg' },
  { sku: 'puramass-ipamorelin-10mg-case', name: 'Ipamorelin 10mg' },
  { sku: 'puramass-kisspeptin-10-5mg-case', name: 'KissPeptin-10 5mg' },
  { sku: 'puramass-kisspeptin-10-10mg-case', name: 'KissPeptin-10 10mg' },
  { sku: 'puramass-klow-80mg-case', name: 'KLOW 80mg' },
  { sku: 'puramass-kpv-5mg-case', name: 'KPV 5mg' },
  { sku: 'puramass-kpv-10mg-case', name: 'KPV 10mg' },
  { sku: 'puramass-l-carnitine-1200mg-case', name: 'L-Carnitine 1200mg' },
  { sku: 'puramass-ll-37-5mg-case', name: 'LL-37 5mg' },
  { sku: 'puramass-mgf-2mg-case', name: 'MGF 2mg' },
  { sku: 'puramass-mk677-5mg-case', name: 'MK677 5mg' },
  { sku: 'puramass-mots-c-10mg-case', name: 'MOTS-C 10mg' },
  { sku: 'puramass-mots-c-40mg-case', name: 'MOTS-C 40mg' },
  { sku: 'puramass-mt-1-10mg-case', name: 'MT-1 10mg' },
  { sku: 'puramass-mt-2-10mg-case', name: 'MT-2 10mg' },
  { sku: 'puramass-nad-500mg-case', name: 'NAD 500mg' },
  { sku: 'puramass-nad-1000mg-case', name: 'NAD 1000mg' },
  { sku: 'puramass-oxytocin-acetate-2mg-case', name: 'Oxytocin Acetate 2mg' },
  { sku: 'puramass-oxytocin-acetate-5mg-case', name: 'Oxytocin Acetate 5mg' },
  { sku: 'puramass-p21-10mg-case', name: 'P21 10mg' },
  { sku: 'puramass-pe-22-28-10mg-case', name: 'PE 22-28 10mg' },
  { sku: 'puramass-peg-mgf-2mg-case', name: 'PEG MGF 2mg' },
  { sku: 'puramass-pinealon-10mg-case', name: 'Pinealon 10mg' },
  { sku: 'puramass-pnc-10mg-case', name: 'PNC 10mg' },
  { sku: 'puramass-pt-141-10mg-case', name: 'PT-141 10mg' },
  { sku: 'puramass-retatrutide-10mg-case', name: 'Retatrutide 10mg' },
  { sku: 'puramass-retatrutide-20mg-case', name: 'Retatrutide 20mg' },
  { sku: 'puramass-retatrutide-30mg-case', name: 'Retatrutide 30mg' },
  { sku: 'puramass-retatrutide-40mg-case', name: 'Retatrutide 40mg' },
  { sku: 'puramass-retatrutide-50mg-case', name: 'Retatrutide 50mg' },
  { sku: 'puramass-selank-10mg-case', name: 'Selank 10mg' },
  { sku: 'puramass-semaglutide-5mg-case', name: 'Semaglutide 5mg' },
  { sku: 'puramass-semaglutide-10mg-case', name: 'Semaglutide 10mg' },
  { sku: 'puramass-semaglutide-20mg-case', name: 'Semaglutide 20mg' },
  { sku: 'puramass-semaglutide-30mg-case', name: 'Semaglutide 30mg' },
  { sku: 'puramass-semax-10mg-case', name: 'Semax 10mg' },
  { sku: 'puramass-sermorelin-acetate-5mg-case', name: 'Sermorelin Acetate 5mg' },
  { sku: 'puramass-sermorelin-acetate-10mg-case', name: 'Sermorelin Acetate 10mg' },
  { sku: 'puramass-slu-pp-332-5mg-case', name: 'SLU-PP-332 5mg' },
  { sku: 'puramass-snap-8-10mg-case', name: 'Snap-8 10mg' },
  { sku: 'puramass-ss-31-10mg-case', name: 'SS-31 10mg' },
  { sku: 'puramass-ss-31-50mg-case', name: 'SS-31 50mg' },
  { sku: 'puramass-tb500-5mg-case', name: 'TB500 5mg' },
  { sku: 'puramass-tb500-10mg-case', name: 'TB500 10mg' },
  { sku: 'puramass-tesamorelin-5mg-case', name: 'Tesamorelin 5mg' },
  { sku: 'puramass-tesamorelin-10mg-case', name: 'Tesamorelin 10mg' },
  { sku: 'puramass-tesamorelin-20mg-case', name: 'Tesamorelin 20mg' },
  { sku: 'puramass-testagen-20mg-case', name: 'Testagen 20mg' },
  { sku: 'puramass-thymalin-10mg-case', name: 'Thymalin 10mg' },
  { sku: 'puramass-thymosin-alpha-1-5mg-case', name: 'Thymosin Alpha-1 5mg' },
  { sku: 'puramass-thymosin-alpha-1-10mg-case', name: 'Thymosin Alpha-1 10mg' },
  { sku: 'puramass-tirzepatide-10mg-case', name: 'Tirzepatide 10mg' },
  { sku: 'puramass-tirzepatide-20mg-case', name: 'Tirzepatide 20mg' },
  { sku: 'puramass-tirzepatide-30mg-case', name: 'Tirzepatide 30mg' },
  { sku: 'puramass-tirzepatide-40mg-case', name: 'Tirzepatide 40mg' },
  { sku: 'puramass-vilon-20mg-case', name: 'Vilon 20mg' },
  { sku: 'puramass-vip-10mg-case', name: 'VIP 10mg' },
  // General products
  { sku: 'tempramed-vivi-cap', name: 'VIVI Cap – Insulin Pen Temperature Protection Case' },
  { sku: 'tempramed-vivi-cap-smart', name: 'VIVI Cap Smart – Smart Insulin Pen Case' },
  { sku: 'tempramed-vivi-med', name: 'VIVI Med – Vial & Injectable Medication Shield' },
  { sku: 'tempramed-vivi-epi', name: 'VIVI Epi – EpiPen® Temperature Shield Carry Case' },
  { sku: 'viraxall-lpt', name: 'Viraxall LPT™' },
  { sku: 'omeva-complete', name: 'Omeva™ Complete' },
  { sku: 'trihelix-pro', name: 'TriHelix Pro' },
  { sku: 'revasca-capsules', name: 'ReVasca Capsules™' },
  { sku: 'theava', name: 'TheAva' },
  { sku: 'mycobind', name: 'MycoBind' },
  { sku: 'ala-forte', name: 'ALA Forté' },
  { sku: 'ultra-pure-liver-concentrate', name: 'Ultra Pure Liver Concentrate' },
  { sku: 'lipid-rescue', name: 'Lipid Rescue' },
  { sku: 'adpt-cell-signal', name: 'Adpt-Cell Signal' },
  { sku: 'adpt-cns', name: 'Adpt-CNS' },
  { sku: 'hemeplex', name: 'HemePlex' },
  { sku: 'suntheanine', name: 'Suntheanine®' },
  { sku: 'dhea-5mg', name: 'DHEA 5MG' },
  { sku: 'dhea-25mg', name: 'DHEA 25MG' },
  { sku: 'red-yeast-rice', name: 'Red Yeast Rice' },
  { sku: 'aquatrophin', name: 'AquaTrophin™' },
  { sku: 'enduro2-lpt', name: 'EndurO2 LPT™' },
];

/**
 * Snapshot of the PuraMass **single-vial** catalog (SKUs ending `-vial`), used
 * to fill `products.puramass_sku_vial`. Names are cleaned (the `Puramass- …`
 * prefix and `(Single Vial)` suffix stripped) so they align with the box catalog
 * for the matcher. Same fallback/reference role as the box snapshot above; the
 * sync prefers the live catalog (partitioned by SKU suffix).
 */
export const PURAMASS_VIAL_CATALOG_SNAPSHOT: PuramassCatalogEntry[] = [
  { sku: "puramass-cagrilintide-5mg-vial", name: "Cagrilintide 5mg" },
  { sku: "puramass-hgh-191aa-somatropin-15-iu-vial", name: "HGH 191AA (Somatropin) 15 IU" },
  { sku: "puramass-retatrutide-50mg-vial", name: "Retatrutide 50mg" },
  { sku: "puramass-vitamin-t-vial", name: "Vitamin T" },
  { sku: "puramass-hgh-191aa-somatropin-10-iu-vial", name: "HGH 191AA (Somatropin) 10 IU" },
  { sku: "puramass-ara-290-10mg-vial", name: "ARA-290 10mg" },
  { sku: "puramass-retatrutide-30mg-vial", name: "Retatrutide 30mg" },
  { sku: "puramass-semaglutide-30mg-vial", name: "Semaglutide 30mg" },
  { sku: "puramass-aod9604-5mg-vial", name: "AOD9604 5mg" },
  { sku: "puramass-cjc-1295-with-dac-5mg-vial", name: "CJC-1295 with DAC 5mg" },
  { sku: "puramass-ss-31-50mg-vial", name: "SS-31 50mg" },
  { sku: "puramass-thymosin-alpha-1-10mg-vial", name: "Thymosin Alpha-1 10mg" },
  { sku: "puramass-bpc-tb500-20mg-wolverine-vial", name: "BPC + TB500 20mg (WOLVERINE)" },
  { sku: "puramass-ghk-cu-100mg-vial", name: "GHK-CU 100mg" },
  { sku: "puramass-semaglutide-10mg-vial", name: "Semaglutide 10mg" },
  { sku: "puramass-hcg-5000-iu-vial", name: "HCG 5000 IU" },
  { sku: "puramass-mk677-5mg-vial", name: "MK677 5mg" },
  { sku: "puramass-tesamorelin-20mg-vial", name: "Tesamorelin 20mg" },
  { sku: "puramass-acetic-acid-water-vial", name: "Acetic Acid Water" },
  { sku: "puramass-pinaleon-20mg-vial", name: "Pinaleon 20mg" },
  { sku: "puramass-dermorphin-5mg-vial", name: "Dermorphin 5mg" },
  { sku: "puramass-aicar-50mg-vial", name: "Aicar 50mg" },
  { sku: "puramass-bpc-tb500-10mg-wolverine-vial", name: "BPC + TB500 10mg (WOLVERINE)" },
  { sku: "puramass-thymosin-alpha-1-5mg-vial", name: "Thymosin Alpha-1 5mg" },
  { sku: "puramass-cjc-1295-without-dac-5mg-vial", name: "CJC-1295 without DAC 5mg" },
  { sku: "puramass-pt-141-10mg-vial", name: "PT-141 10mg" },
  { sku: "puramass-tesamorelin-10mg-vial", name: "Tesamorelin 10mg" },
  { sku: "puramass-hgh-191aa-somatropin-24-iu-vial", name: "HGH 191AA (Somatropin) 24 IU" },
  { sku: "puramass-mots-c-20mg-vial", name: "MOTS-C 20mg" },
  { sku: "puramass-mt-1-10mg-vial", name: "MT-1 10mg" },
  { sku: "puramass-nad-1000mg-vial", name: "NAD 1000mg" },
  { sku: "puramass-bacteriostatic-water-pfizer-30ml-vial", name: "Bacteriostatic Water Pfizer 30mL" },
  { sku: "puramass-igf-1lr3-1mg-vial", name: "IGF-1LR3 1mg" },
  { sku: "puramass-mgf-2mg-vial", name: "MGF 2mg" },
  { sku: "puramass-adamax-5mg-vial", name: "Adamax 5mg" },
  { sku: "puramass-dsip-5mg-vial", name: "DSIP 5mg" },
  { sku: "puramass-hgh-191aa-somatropin-36-iu-vial", name: "HGH 191AA (Somatropin) 36 IU" },
  { sku: "puramass-retatrutide-20mg-vial", name: "Retatrutide 20mg" },
  { sku: "puramass-klow-80mg-vial", name: "KLOW 80mg" },
  { sku: "puramass-epithalon-40mg-vial", name: "Epithalon 40mg" },
  { sku: "puramass-retatrutide-40mg-pen-vial", name: "Retatrutide 40mg Pen" },
  { sku: "puramass-ahk-cu-100mg-vial", name: "AHK-Cu 100mg" },
  { sku: "puramass-dihexa-10mg-vial", name: "Dihexa 10mg" },
  { sku: "puramass-bacteriostatic-water-10ml-vial", name: "Bacteriostatic Water 10mL" },
  { sku: "puramass-cerebrolysin-60mg-vial", name: "Cerebrolysin 60mg" },
  { sku: "puramass-epithalon-10mg-vial", name: "Epithalon 10mg" },
  { sku: "puramass-oxytocin-acetate-2mg-vial", name: "Oxytocin Acetate 2mg" },
  { sku: "puramass-cjc-1295-without-dac-ipa-10mg-vial", name: "CJC-1295 without DAC + IPA 10mg" },
  { sku: "puramass-glow-70mg-vial", name: "GLOW 70mg" },
  { sku: "puramass-ahk-cu-50mg-vial", name: "AHK-Cu 50mg" },
  { sku: "puramass-kisspeptin-10-10mg-vial", name: "KissPeptin-10 10mg" },
  { sku: "puramass-kpv-5mg-vial", name: "KPV 5mg" },
  { sku: "puramass-peg-mgf-2mg-vial", name: "PEG MGF 2mg" },
  { sku: "puramass-gonadorelin-acetate-2mg-vial", name: "Gonadorelin Acetate 2mg" },
  { sku: "puramass-ghrp-2-acetate-10mg-vial", name: "GHRP-2 Acetate 10mg" },
  { sku: "puramass-tirzepatide-10mg-vial", name: "Tirzepatide 10mg" },
  { sku: "puramass-pnc-27-10mg-vial", name: "PNC -27 10mg" },
  { sku: "puramass-tirzepatide-40mg-vial", name: "Tirzepatide 40mg" },
  { sku: "puramass-vip-10mg-vial", name: "VIP 10mg" },
  { sku: "puramass-5-amino-1mq-10mg-vial", name: "5-Amino-1MQ 10mg" },
  { sku: "puramass-tirzepatide-20mg-vial", name: "Tirzepatide 20mg" },
  { sku: "puramass-5-amino-1mq-50mg-vial", name: "5-Amino-1MQ 50mg" },
  { sku: "puramass-ll-37-5mg-vial", name: "LL-37 5mg" },
  { sku: "puramass-retatrutide-10mg-vial", name: "Retatrutide 10mg" },
  { sku: "puramass-ghk-cu-50mg-vial", name: "GHK-CU 50mg" },
  { sku: "puramass-kpv-10mg-vial", name: "KPV 10mg" },
  { sku: "puramass-mt-2-10mg-vial", name: "MT-2 10mg" },
  { sku: "puramass-selank-10mg-vial", name: "Selank 10mg" },
  { sku: "puramass-ss-31-10mg-vial", name: "SS-31 10mg" },
  { sku: "puramass-cjc-1295-without-dac-10mg-vial", name: "CJC-1295 without DAC 10mg" },
  { sku: "puramass-glutathione-1500mg-vial", name: "Glutathione 1500mg" },
  { sku: "puramass-oxytocin-acetate-10mg-vial", name: "Oxytocin Acetate 10mg" },
  { sku: "puramass-sermorelin-acetate-10mg-vial", name: "Sermorelin Acetate 10mg" },
  { sku: "puramass-retatrutide-30mg-pens-vial", name: "Retatrutide 30mg Pens" },
  { sku: "puramass-tirzepatide-60mg-vial", name: "Tirzepatide 60mg" },
  { sku: "puramass-tirzepatide-50mg-vial", name: "Tirzepatide 50mg" },
  { sku: "puramass-nad-100mg-vial", name: "NAD 100mg" },
  { sku: "puramass-vitamin-e-vial", name: "Vitamin E" },
  { sku: "puramass-retatrutide-20mg-pen-vial", name: "Retatrutide 20mg Pen" },
  { sku: "puramass-bacteriostatic-water-3ml-vial", name: "Bacteriostatic Water 3mL" },
  { sku: "puramass-nad-500mg-vial", name: "NAD 500mg" },
  { sku: "puramass-retatrutide-10mg-pen-vial", name: "Retatrutide 10mg Pen" },
  { sku: "puramass-tb500-10mg-vial", name: "TB500 10mg" },
  { sku: "puramass-thymalin-10mg-vial", name: "Thymalin 10mg" },
  { sku: "puramass-retatrutide-40mg-vial", name: "Retatrutide 40mg" },
  { sku: "puramass-aod9604-10mg-vial", name: "AOD9604 10mg" },
  { sku: "puramass-cagrilintide-10mg-vial", name: "Cagrilintide 10mg" },
  { sku: "puramass-ipamorelin-5mg-vial", name: "Ipamorelin 5mg" },
  { sku: "puramass-oxytocin-acetate-5mg-vial", name: "Oxytocin Acetate 5mg" },
  { sku: "puramass-pinealon-10mg-vial", name: "Pinealon 10mg" },
  { sku: "puramass-vitamin-c-vial", name: "Vitamin C" },
  { sku: "puramass-alprostadil-20mcg-vial", name: "Alprostadil 20mcg" },
  { sku: "puramass-bpc-157-20mg-vial", name: "BPC-157 20mg" },
  { sku: "puramass-dsip-10mg-vial", name: "DSIP 10mg" },
  { sku: "puramass-fox-04-10mg-vial", name: "FOX-04 10mg" },
  { sku: "puramass-l-carnitine-1200mg-vial", name: "L-Carnitine 1200mg" },
  { sku: "puramass-p21-10mg-vial", name: "P21 10mg" },
  { sku: "puramass-semax-10mg-selank-10mg-vial", name: "Semax 10mg + Selank 10mg" },
  { sku: "puramass-epithalon-50mg-vial", name: "Epithalon 50mg" },
  { sku: "puramass-pe-22-28-10mg-vial", name: "PE 22-28 10mg" },
  { sku: "puramass-semaglutide-20mg-vial", name: "Semaglutide 20mg" },
  { sku: "puramass-testagen-20mg-vial", name: "Testagen 20mg" },
  { sku: "puramass-vilon-20mg-vial", name: "Vilon 20mg" },
  { sku: "puramass-tirzepatide-30mg-vial", name: "Tirzepatide 30mg" },
  { sku: "puramass-hcg-2000-iu-vial", name: "HCG 2000 IU" },
  { sku: "puramass-ghrp-6-acetate-10mg-vial", name: "GHRP-6 Acetate 10mg" },
  { sku: "puramass-mots-c-10mg-vial", name: "MOTS-C 10mg" },
  { sku: "puramass-snap-8-10mg-vial", name: "Snap-8 10mg" },
  { sku: "puramass-tesamorelin-12mg-ipamorelin-6mg-vial", name: "Tesamorelin 12mg + Ipamorelin 6mg" },
  { sku: "puramass-kisspeptin-10-5mg-vial", name: "KissPeptin-10 5mg" },
  { sku: "puramass-hcg-10000-iu-vial", name: "HCG 10000 IU" },
  { sku: "puramass-ipamorelin-10mg-vial", name: "Ipamorelin 10mg" },
  { sku: "puramass-semax-10mg-vial", name: "Semax 10mg" },
  { sku: "puramass-bpc-157-5mg-vial", name: "BPC-157 5mg" },
  { sku: "puramass-tb500-5mg-vial", name: "TB500 5mg" },
  { sku: "puramass-5-amino-1mq-5mg-vial", name: "5-Amino-1MQ 5mg" },
  { sku: "puramass-hexarelin-acetate-5mg-vial", name: "Hexarelin Acetate 5mg" },
  { sku: "puramass-slu-pp-332-5mg-vial", name: "SLU-PP-332 5mg" },
  { sku: "puramass-tesamorelin-5mg-vial", name: "Tesamorelin 5mg" },
  { sku: "puramass-mots-c-40mg-vial", name: "MOTS-C 40mg" },
  { sku: "puramass-semaglutide-5mg-vial", name: "Semaglutide 5mg" },
  { sku: "puramass-dsip-15mg-vial", name: "DSIP 15mg" },
  { sku: "puramass-bacteriostatic-water-30ml-vial", name: "Bacteriostatic Water 30mL" },
  { sku: "puramass-sermorelin-acetate-5mg-vial", name: "Sermorelin Acetate 5mg" },
  { sku: "puramass-bpc-157-10mg-vial", name: "BPC-157 10mg" },
];

/** Units that denote a dose/strength when they follow a number (e.g. `10mg`). */
const DOSE_UNITS = ['mcg', 'mg', 'kg', 'g', 'ml', 'iu'];
const DOSE_TOKEN_RE = new RegExp(`^\\d+(?:\\.\\d+)?(?:${DOSE_UNITS.join('|')})$`);

/**
 * Lowercase, strip punctuation to spaces, collapse whitespace, and glue a bare
 * number to a following unit word so `"10 IU"` and `"10mg"` normalise to a
 * single dose token (`10iu`, `10mg`). Trademark/®/™ and hyphens all fold away
 * so `"GHK-CU"`, `"GHK CU"` and `"ghkcu"`-style variants align on their tokens.
 */
export function normalizeName(raw: string): string {
  const base = (raw || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
  const out: string[] = [];
  const tokens = base.length ? base.split(' ') : [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const next = tokens[i + 1];
    if (/^\d+(?:\.\d+)?$/.test(t) && next && DOSE_UNITS.includes(next)) {
      out.push(t + next);
      i++; // consume the unit token
    } else {
      out.push(t);
    }
  }
  return out.join(' ');
}

function tokenize(name: string): string[] {
  const n = normalizeName(name);
  return n.length ? n.split(' ') : [];
}

function partition(tokens: string[]): { dose: string[]; words: string[] } {
  const dose: string[] = [];
  const words: string[] = [];
  for (const t of tokens) {
    if (DOSE_TOKEN_RE.test(t)) dose.push(t);
    else words.push(t);
  }
  return { dose: dose.sort(), words };
}

function sameDose(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}

export type PuramassMatchStatus = 'exact' | 'matched' | 'ambiguous' | 'unmatched';

export interface PuramassMatchResult {
  status: PuramassMatchStatus;
  /** The chosen SKU for `exact`/`matched`; null otherwise. */
  sku: string | null;
  /** The matched catalog entry for `exact`/`matched`; null otherwise. */
  entry: PuramassCatalogEntry | null;
  /** Candidate entries when `ambiguous` (the admin picks one). */
  candidates: PuramassCatalogEntry[];
}

/**
 * Match a storefront product to a PuraMass catalog entry by name + strength.
 *
 * Tiers, most-confident first:
 *  1. `exact`     — normalised names are identical.
 *  2. `matched`   — the product's dose signature equals the candidate's AND all
 *                   of the product's non-dose words are present in the
 *                   candidate's; when several candidates qualify, the one with
 *                   the fewest extra words wins if that minimum is unique.
 *  3. `ambiguous` — several equally-good candidates (same minimal extra-word
 *                   count); returned for a human to choose.
 *  4. `unmatched` — nothing shares the dose + words.
 *
 * `productName` should be the customer-facing product name (which already
 * embeds the strength in this catalog, e.g. "Retatrutide 10mg"); `strength`
 * is appended defensively so products whose name omits it still carry a dose.
 */
export function matchProductToPuramass(
  productName: string,
  strength: string | null | undefined,
  catalog: PuramassCatalogEntry[] = PURAMASS_CATALOG_SNAPSHOT,
): PuramassMatchResult {
  const combined = strength ? `${productName} ${strength}` : productName;
  const productNorm = normalizeName(combined);
  const productTokens = Array.from(new Set(tokenize(combined)));
  const { dose: productDose, words: productWords } = partition(productTokens);

  // Tier 1: exact normalised-name equality (before appending strength, since
  // the catalog names embed strength themselves).
  const exact = catalog.find((e) => normalizeName(e.name) === normalizeName(productName));
  if (exact) return { status: 'exact', sku: exact.sku, entry: exact, candidates: [] };
  const exactCombined = catalog.find((e) => normalizeName(e.name) === productNorm);
  if (exactCombined)
    return { status: 'exact', sku: exactCombined.sku, entry: exactCombined, candidates: [] };

  // Tier 2/3: dose-anchored word-subset.
  type Scored = { entry: PuramassCatalogEntry; extra: number };
  const eligible: Scored[] = [];
  for (const entry of catalog) {
    const entryTokens = Array.from(new Set(tokenize(entry.name)));
    const { dose: entryDose, words: entryWords } = partition(entryTokens);
    if (!sameDose(productDose, entryDose)) continue;
    // Every product word must appear among the candidate's words.
    const covered = productWords.every((w) => entryWords.includes(w));
    if (!covered) continue;
    // Prefer the tightest fit — the fewest words the candidate adds beyond the
    // product's own words.
    const extra = entryWords.filter((w) => !productWords.includes(w)).length;
    eligible.push({ entry, extra });
  }

  if (eligible.length === 0)
    return { status: 'unmatched', sku: null, entry: null, candidates: [] };

  eligible.sort((a, b) => a.extra - b.extra);
  const best = eligible[0].extra;
  const winners = eligible.filter((e) => e.extra === best);
  if (winners.length === 1) {
    return { status: 'matched', sku: winners[0].entry.sku, entry: winners[0].entry, candidates: [] };
  }
  return {
    status: 'ambiguous',
    sku: null,
    entry: null,
    candidates: winners.map((w) => w.entry),
  };
}
