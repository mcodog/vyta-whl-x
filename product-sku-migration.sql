-- Product SKU Migration
-- Adds a `sku` column to the products table and populates it from the
-- "Code" column of the wholesale CAD pricelist (CAD_Pricelist_Wholesale).
--
-- Mapping is keyed by product id. SKUs are matched by product name + strength.
--
-- NOTE: 6 catalogue products have no Code in the wholesale pricelist and are
-- intentionally left with sku = NULL:
--   Epithalon 40mg        (992a2595-8548-45ab-a313-19bd468e4ddc) - not in pricelist
--   Vitamin C             (3fe705f8-e1aa-4668-acc4-67375c5b872d) - not in pricelist
--   Vitamin E             (3fc6c5a9-3dd9-4fdd-a05e-0ff88113b7b9) - not in pricelist
--   MOTS-C 20mg           (53a4f946-c43b-44a5-952e-cc7505821db2) - not in pricelist
--   Oxytocin Acetate 2mg  (a22b8bb6-5c2c-43d4-82ea-e34848d19c21) - not in pricelist
--   AHK-Cu 100mg          (4caef3a4-2943-4cde-91e1-047e69ede3b9) - not in pricelist
--
-- Run this in the Supabase SQL Editor.

BEGIN;

ALTER TABLE products ADD COLUMN IF NOT EXISTS sku VARCHAR(50);

-- Index to support searching products by SKU (invoice & purchase order line items).
CREATE INDEX IF NOT EXISTS idx_products_sku ON products(sku);

UPDATE products SET sku = 'BA10', updated_at = NOW() WHERE id = '44987a86-9fb7-414d-afce-419032554eb5'; -- Bacteriostatic Water 10mL
UPDATE products SET sku = '5AM50', updated_at = NOW() WHERE id = '0402838e-7ef8-4a3b-be7a-9e5dfaf95b35'; -- 5-Amino-1MQ 50mg
UPDATE products SET sku = 'CP10', updated_at = NOW() WHERE id = 'fb61c9eb-8200-422b-bd86-1315a541ff99'; -- CJC-1295 without DAC + IPA 10mg
UPDATE products SET sku = 'BA3', updated_at = NOW() WHERE id = 'b344df10-2df8-4c91-909f-889fb36485b7'; -- Bacteriostatic Water 3mL
UPDATE products SET sku = 'CND10', updated_at = NOW() WHERE id = '594482e7-32b6-4940-a8fd-a288ecb4083b'; -- CJC-1295 without DAC 10mg
UPDATE products SET sku = 'DS5', updated_at = NOW() WHERE id = '1cc951c5-a318-482e-a356-fd8ebf3ba1cc'; -- DSIP 5mg
UPDATE products SET sku = 'TY10', updated_at = NOW() WHERE id = '1df7cd5b-48d1-4ebb-8ec9-fb8be1f9dc4c'; -- Thymalin 10mg
UPDATE products SET sku = 'CU100', updated_at = NOW() WHERE id = '9db6538d-513b-4435-b1b9-de9c779b96c1'; -- GHK-CU 100mg
UPDATE products SET sku = 'VIP10', updated_at = NOW() WHERE id = 'f65e8816-5d86-476b-bcfd-595ae37dd24a'; -- VIP 10mg
UPDATE products SET sku = 'RT10', updated_at = NOW() WHERE id = 'be7bb0cc-5e46-4b26-939f-9527b675219d'; -- Retatrutide 10mg
UPDATE products SET sku = 'TA10', updated_at = NOW() WHERE id = 'f874c604-b08b-4ed6-b75b-7e3a99dc775b'; -- Thymosin Alpha-1 10mg
UPDATE products SET sku = 'MT1', updated_at = NOW() WHERE id = 'a9736f74-e1ce-453e-9a19-21d50ca3da98'; -- MT-1 10mg
UPDATE products SET sku = 'H10', updated_at = NOW() WHERE id = '896aafbe-f2c5-4b3c-b522-19b2fe39cb43'; -- HGH 191AA (Somatropin) 10 IU
UPDATE products SET sku = 'H36', updated_at = NOW() WHERE id = '1ba5822b-ee5f-4c96-95ef-0e3f774ebb5e'; -- HGH 191AA (Somatropin) 36 IU
UPDATE products SET sku = 'IP10', updated_at = NOW() WHERE id = 'a9a1b8bd-e711-403a-ae56-8731c0f56b9c'; -- Ipamorelin 10mg
UPDATE products SET sku = 'ET10', updated_at = NOW() WHERE id = '97480ee8-9ea2-4b93-bbc0-24b1cbd3deb7'; -- Epithalon 10mg
UPDATE products SET sku = 'GTT1500', updated_at = NOW() WHERE id = 'ab01f074-8b3d-406c-83c8-a6905cbf1d6e'; -- Glutathione 1500mg
UPDATE products SET sku = '5AM5', updated_at = NOW() WHERE id = 'bd479663-919b-4f9e-a454-9a387879ee38'; -- 5-Amino-1MQ 5mg
UPDATE products SET sku = 'LC1200', updated_at = NOW() WHERE id = '499b087f-f5fa-4787-9a0b-6b567a920767'; -- L-Carnitine 1200mg
UPDATE products SET sku = 'NP810', updated_at = NOW() WHERE id = '8b7884c6-667f-4943-bde7-ca82126602ae'; -- Snap-8 10mg
UPDATE products SET sku = 'H15', updated_at = NOW() WHERE id = '7a4e5acf-ceba-4486-a27a-95ae7294d970'; -- HGH 191AA (Somatropin) 15 IU
UPDATE products SET sku = 'TA5', updated_at = NOW() WHERE id = 'eb2f69fe-9709-4811-9672-032a8704dba7'; -- Thymosin Alpha-1 5mg
UPDATE products SET sku = '375', updated_at = NOW() WHERE id = '25cbd6f0-8ecf-4cb6-80ba-92bc77d3b67f'; -- LL-37 5mg
UPDATE products SET sku = 'DS10', updated_at = NOW() WHERE id = '2aa8da89-3a06-459a-88d4-3a3acd7c9629'; -- DSIP 10mg
UPDATE products SET sku = '2S10', updated_at = NOW() WHERE id = 'b9f2cbba-cca1-4549-b4a9-597d20af282c'; -- SS-31 10mg
UPDATE products SET sku = 'TSM10', updated_at = NOW() WHERE id = '1cbcea9a-5e40-472e-aaec-4e6cd7b36222'; -- Tesamorelin 10mg
UPDATE products SET sku = 'CGL10', updated_at = NOW() WHERE id = '1972fc92-e490-4eef-961a-6cf4154348e1'; -- Cagrilintide 10mg
UPDATE products SET sku = 'RT40', updated_at = NOW() WHERE id = '0ffe9dec-5f87-4ada-9954-e57bcf2248f4'; -- Retatrutide 40mg
UPDATE products SET sku = 'CND5', updated_at = NOW() WHERE id = '40ba4ce9-b7cd-49d3-8765-7c5f2eba8732'; -- CJC-1295 without DAC 5mg
UPDATE products SET sku = 'SM20', updated_at = NOW() WHERE id = '4480d09d-c013-4a7d-a0b4-6dc56ebcb9e6'; -- Semaglutide 20mg
UPDATE products SET sku = 'BB20', updated_at = NOW() WHERE id = '4a453e91-cde6-4e65-8f63-9b47cc3e98af'; -- BPC+ TB500 20mg
UPDATE products SET sku = 'G10K', updated_at = NOW() WHERE id = '4f3e83e0-ac60-4431-9437-91ea114f3d9d'; -- HCG 10000 IU
UPDATE products SET sku = 'SK10', updated_at = NOW() WHERE id = 'd4cdd6de-39ee-4f88-bea5-d7181aa22426'; -- Selank 10mg
UPDATE products SET sku = 'BB10', updated_at = NOW() WHERE id = '3599f1ef-6651-401a-b27c-f30467d706d9'; -- BPC+ TB500 10mg
UPDATE products SET sku = 'TB5', updated_at = NOW() WHERE id = '2e45a24a-ccc9-4694-9a08-7de641c797d1'; -- TB500 5mg
UPDATE products SET sku = 'HX5', updated_at = NOW() WHERE id = '5191b73a-ddfb-4e1e-90ef-779ef7ef7fab'; -- Hexarelin Acetate 5mg
UPDATE products SET sku = 'BC5', updated_at = NOW() WHERE id = '42ccc3e4-f13e-4107-a373-e8ed7e0c8852'; -- BPC-157 5mg
UPDATE products SET sku = 'XA10', updated_at = NOW() WHERE id = 'e913bb7d-1629-49e9-906f-59bbee251206'; -- Semax 10mg
UPDATE products SET sku = 'G5K', updated_at = NOW() WHERE id = '5fc22fdb-c7f7-4a82-b5f5-7404925766d9'; -- HCG 5000 IU
UPDATE products SET sku = 'TSM5', updated_at = NOW() WHERE id = '661b0739-ffd7-46d7-9256-6b89b4bbb79a'; -- Tesamorelin 5mg
UPDATE products SET sku = 'KS5', updated_at = NOW() WHERE id = '7b942675-9284-4de0-9290-53bb15fa5349'; -- KissPeptin-10 5mg
UPDATE products SET sku = 'ET50', updated_at = NOW() WHERE id = '742b876e-35f1-45be-9139-53469630036a'; -- Epithalon 50mg
UPDATE products SET sku = 'PIN10', updated_at = NOW() WHERE id = 'f09512ed-57e5-432d-8898-bb05eed30623'; -- Pinealon 10mg
UPDATE products SET sku = 'TB10', updated_at = NOW() WHERE id = '06418ec3-48ac-4d7b-85ad-c80fc23bf20a'; -- TB500 10mg
UPDATE products SET sku = 'G2K', updated_at = NOW() WHERE id = '3d83e9fa-4ece-438c-ab72-dff68ba00398'; -- HCG 2000 IU
UPDATE products SET sku = 'NAD500', updated_at = NOW() WHERE id = '68a9480c-d38f-4c30-aad7-6b6535391112'; -- NAD 500mg
UPDATE products SET sku = 'KS10', updated_at = NOW() WHERE id = '84e33a4e-c63b-458a-bdc9-b9eed3771f5d'; -- KissPeptin-10 10mg
UPDATE products SET sku = 'GLOW', updated_at = NOW() WHERE id = '70b8331e-714b-4bb2-b8b5-1a5b72b76c70'; -- GLOW 70mg
UPDATE products SET sku = 'CGL5', updated_at = NOW() WHERE id = 'aa591440-3063-47a3-898e-1d1653f89540'; -- Cagrilintide 5mg
UPDATE products SET sku = 'KLOW', updated_at = NOW() WHERE id = '0bfc6211-3390-4478-b895-e96bdafa3e7f'; -- KLOW 80mg
UPDATE products SET sku = 'G210', updated_at = NOW() WHERE id = '151b63e3-28f0-4654-905f-ddbc4c7a9ffd'; -- GHRP-2 Acetate 10mg
UPDATE products SET sku = 'RA10', updated_at = NOW() WHERE id = '24281155-42e6-422c-977f-9a31a1757184'; -- ARA-290 10mg
UPDATE products SET sku = 'TR20', updated_at = NOW() WHERE id = '21785804-ea07-44ed-9360-cf2001510616'; -- Tirzepatide 20mg
UPDATE products SET sku = 'RT50', updated_at = NOW() WHERE id = '5f333974-c7f2-4ccd-93eb-64645df85410'; -- Retatrutide 50mg
UPDATE products SET sku = 'TR40', updated_at = NOW() WHERE id = '3f6ce31e-effa-4e41-a643-e6021086db23'; -- Tirzepatide 40mg
UPDATE products SET sku = 'MT2', updated_at = NOW() WHERE id = '72beeaf6-9edc-44c2-b61f-8fcb6d9608eb'; -- MT-2 10mg
UPDATE products SET sku = 'TR30', updated_at = NOW() WHERE id = '86d3901f-5db8-4b12-9c17-dbaad34d3c61'; -- Tirzepatide 30mg
UPDATE products SET sku = 'BA30', updated_at = NOW() WHERE id = 'a7ccab6d-8a29-4e7c-a524-9d1a382fe117'; -- Bacteriostatic Water 30mL
UPDATE products SET sku = 'FMP2', updated_at = NOW() WHERE id = '8c0d4e73-8650-431a-bd5d-a02a38e8f34f'; -- PEG MGF 2mg
UPDATE products SET sku = 'PIN10', updated_at = NOW() WHERE id = 'cafe63fe-6034-454b-8a71-e0c92567fb79'; -- Pinealon 10mg
UPDATE products SET sku = 'NAD1000', updated_at = NOW() WHERE id = 'afe514ff-bcc5-4ef2-aaf4-22b6eeaca5e0'; -- NAD 1000mg
UPDATE products SET sku = 'DS15', updated_at = NOW() WHERE id = 'eb3e5a23-7003-4f9e-b4e0-a7606746937b'; -- DSIP 15mg
UPDATE products SET sku = '3325', updated_at = NOW() WHERE id = 'ecae3cd6-e9e8-45a9-8e3f-2e075d5a1ef5'; -- SLU-PP-332 5mg
UPDATE products SET sku = 'SMO5', updated_at = NOW() WHERE id = 'fee2fdfe-a202-489b-b0ae-fe8859f9d3da'; -- Sermorelin Acetate 5mg
UPDATE products SET sku = '2S50', updated_at = NOW() WHERE id = '20f78f9a-57f1-4d22-8b3c-8d4868e07184'; -- SS-31 50mg
UPDATE products SET sku = 'KPV5', updated_at = NOW() WHERE id = '9730baac-3aa0-4cdc-ab53-7ed34c22133a'; -- KPV 5mg
UPDATE products SET sku = 'H24', updated_at = NOW() WHERE id = '072ce6e3-7ef9-43fc-8486-b8b2bede93b5'; -- HGH 191AA (Somatropin) 24 IU
UPDATE products SET sku = 'BC20', updated_at = NOW() WHERE id = '78de7e50-0001-49a1-9dfa-9bc7958562c8'; -- BPC-157 20mg
UPDATE products SET sku = 'CU50', updated_at = NOW() WHERE id = 'f05fa51c-8547-4381-a1da-9be071c6f962'; -- GHK-CU 50mg
UPDATE products SET sku = 'G610', updated_at = NOW() WHERE id = '9ccb3179-af2e-4552-a80c-c44a6b9fc2c7'; -- GHRP-6 Acetate 10mg
UPDATE products SET sku = 'KPV10', updated_at = NOW() WHERE id = '9448fd58-16d9-4ee9-b7c0-817912fb8348'; -- KPV 10mg
UPDATE products SET sku = '10AD', updated_at = NOW() WHERE id = 'e65ee2e7-00e7-4a2e-bead-a829ccc2dec0'; -- AOD9604 10mg
UPDATE products SET sku = 'MS40', updated_at = NOW() WHERE id = 'b1443576-b8e1-4b33-94d5-99bf947cf349'; -- MOTS-C 40mg
UPDATE products SET sku = 'TR10', updated_at = NOW() WHERE id = 'b200840d-faf1-45a4-8b71-2d9a5d72e8a8'; -- Tirzepatide 10mg
UPDATE products SET sku = 'RT30', updated_at = NOW() WHERE id = 'ae88b72c-64f9-405b-8679-5972da8bf825'; -- Retatrutide 30mg
UPDATE products SET sku = 'IP5', updated_at = NOW() WHERE id = 'b072e8cc-4762-426a-91c0-f46984f801df'; -- Ipamorelin 5mg
UPDATE products SET sku = 'IG1', updated_at = NOW() WHERE id = 'eda5c84c-515f-4bf9-90fe-0eeebc3c98a5'; -- IGF-1LR3 1mg
UPDATE products SET sku = 'SM10', updated_at = NOW() WHERE id = 'ef992db1-1910-4c18-a49b-63f94415d31f'; -- Semaglutide 10mg
UPDATE products SET sku = 'SMO10', updated_at = NOW() WHERE id = 'f7040f79-8ac6-49ce-b443-02884328abf6'; -- Sermorelin Acetate 10mg
UPDATE products SET sku = 'P41', updated_at = NOW() WHERE id = 'd54bebce-a87d-4690-9b29-ef5e7206df0c'; -- PT-141 10mg
UPDATE products SET sku = '5AD', updated_at = NOW() WHERE id = 'ef2af62b-9846-4592-b927-b9284545c644'; -- AOD9604 5mg
UPDATE products SET sku = 'RT20', updated_at = NOW() WHERE id = 'aea525cb-4292-4e4b-ba11-41f6e397a055'; -- Retatrutide 20mg
UPDATE products SET sku = 'CD5', updated_at = NOW() WHERE id = 'f916b605-8c8f-4461-b850-ffca24f2fe14'; -- CJC-1295 with DAC 5mg
UPDATE products SET sku = 'MS10', updated_at = NOW() WHERE id = 'bea7ce3e-8539-4770-a347-4cb28e72cb07'; -- MOTS-C 10mg
UPDATE products SET sku = 'SM5', updated_at = NOW() WHERE id = 'fcef48a1-fc87-42b4-846c-1fde2ad0da17'; -- Semaglutide 5mg
UPDATE products SET sku = 'BC10', updated_at = NOW() WHERE id = 'ab5599d0-98d4-43bb-8fd5-5faaf9f5a5bf'; -- BPC-157 10mg
UPDATE products SET sku = '5AM10', updated_at = NOW() WHERE id = 'a9a70607-4564-4c98-addd-19de27ebd6b4'; -- 5-Amino-1MQ 10mg

COMMIT;
