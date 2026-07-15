# Material Catalogue — Strict-50 Rebuild + Project Re-link

**Date:** 2026-07-14
**Author:** Claude (Opus 4.8) with wilsonharkhono@gmail.com
**Status:** Approved design → execution runbook

---

## 1. Goal

Replace the live SANO `material_catalog` (currently 243 rows, incl. 53 `AUTO-*`
junk codes and duplicates) with the user's curated set of **exactly 50 items**,
taken from `assets/BOQ/(rev) Material Catalogue & Tier List.xlsx`. Clean up the
material-code logic and the rebar batang↔kg conversions along the way, then
re-link the 6 real projects so their estimates adhere to the new base.

## 2. Decisions (from the user)

1. **Strict 50.** The curated subset becomes the *entire* catalogue. Everything
   else is pruned.
2. **Unlink extras, never remap.** BoQ estimate lines that referenced a removed
   material are set to `material_id = NULL` (shown as "material not set"), never
   remapped to a different material — remapping would falsify specs.
3. **All transactions are trial.** Purchase orders, receipts, requests,
   price-history, and baseline snapshots are throwaway test data. Rows that
   reference a removed material are **deleted** (not preserved for provenance).
4. **D29 rebar kept, conversion fixed** to the correct SNI value.
5. **Re-link the 6 real projects** (skip seed Alpha/Beta/Charlie), by exact
   name/alias only — no fuzzy guessing.

## 3. The 50-item catalogue

Codes cleaned/assigned (convention `PREFIX-XXNN`):

| # | Code | Name | Cat | Tier | Unit | Sup.unit | base_qty | Change |
|---|------|------|-----|------|------|----------|----------|--------|
| 1 | BRK-CL02 | Bata merah press | Dinding | 2 | pcs | | | keep |
| 2 | BTK-SM10 | Batako semen 10 cm | Dinding | 2 | pcs | | | keep |
| 3 | MRT-INST | Mortar instan pasangan bata | Dinding | 3 | zak | | | keep |
| 4 | MRT-PLST | Mortar instan plester | Dinding | 3 | zak | | | keep |
| 5 | MRT-ACI | Mortar instan acian | Dinding | 3 | zak | | | keep |
| 6 | CEM-PCC40 | Semen PCC 40 kg | Material Beton | 2 | zak | | | keep |
| 7 | AGG-SP10 | Batu split 1/2 | Material Beton | 2 | m3 | | | keep |
| 8 | AGG-SP20 | Batu split 2/3 | Material Beton | 2 | m3 | | | keep |
| 9 | CON-RM30 | Ready mix fc' 30 MPa | Struktur | 1 | m3 | | | **rename** (was "kelas 30") |
| 10 | CON-RM25 | Ready mix fc' 25 MPa | Struktur | 1 | m3 | | | **rename** (was "kelas 25") |
| 11 | REB-DE10 | Besi beton ulir 10 mm | Struktur | 1 | kg | batang | 7.40 | keep |
| 12 | REB-DE13 | Besi beton ulir 13 mm | Struktur | 1 | kg | batang | 12.50 | keep |
| 13 | REB-DE16 | Besi beton ulir 16 mm | Struktur | 1 | kg | batang | 18.94 | keep |
| 14 | REB-DE19 | Besi beton ulir 19 mm | Struktur | 1 | kg | batang | 26.71 | keep |
| 15 | REB-DE22 | Besi beton ulir 22 mm | Struktur | 1 | kg | batang | 35.81 | keep |
| 16 | REB-DE25 | Besi beton ulir 25 mm | Struktur | 1 | kg | batang | 46.24 | keep |
| 17 | REB-DE29 | Besi beton ulir 29 mm | Struktur | 1 | kg | batang | **62.22** | **NEW + fix** (was 75.76 = D32) |
| 18 | REB-DE32 | Besi beton ulir 32 mm | Struktur | 1 | kg | batang | 75.76 | keep |
| 19 | REB-PL06 | Besi beton polos 6 mm | Struktur | 1 | kg | batang | 2.66 | keep |
| 20 | REB-PL08 | Besi beton polos 8 mm | Struktur | 1 | kg | batang | 4.74 | keep |
| 21 | PLY-FF12 | Plywood film faced 12 mm | Kayu & Bekisting | 2 | lbr | | | keep |
| 22 | PLY-FF15 | Plywood film faced 15 mm | Kayu & Bekisting | 2 | lbr | | | keep |
| 23 | PLY-FF18 | Plywood film faced 18 mm | Kayu & Bekisting | 2 | lbr | | | keep |
| 24 | PLY-MR09 | Plywood meranti 9 mm | Kayu & Bekisting | 2 | lbr | | | keep |
| 25 | PLY-MR12 | Plywood meranti 12 mm | Kayu & Bekisting | 2 | lbr | | | keep |
| 26 | PLY-MR15 | Plywood meranti 15 mm | Kayu & Bekisting | 2 | lbr | | | keep |
| 27 | PLY-MR18 | Plywood meranti 18 mm | Kayu & Bekisting | 2 | lbr | | | keep |
| 28 | WOD-KLS34 | Kayu usuk 4/6 | Kayu & Bekisting | 2 | btg | | | **rename** (was "Kayu kelas 3 4/6") |
| 29 | WOD-KLS46 | Kayu usuk 5/7 | Kayu & Bekisting | 2 | btg | | | **rename** (was "Kayu kelas 3 5/7") |
| 30 | WOD-KLS58 | Kayu usuk 6/8 | Kayu & Bekisting | 2 | btg | | | **rename** (was "Kayu kelas 3 6/8") |
| 31 | FMW-SCAF | Scaffolding set | Kayu & Bekisting | 3 | set | | | keep |
| 32 | FMW-JACK | Jack base / U-head | Kayu & Bekisting | 3 | pcs | | | keep |
| 33 | FMW-TIE01 | Tie rod bekisting | Kayu & Bekisting | 3 | pcs | | | keep |
| 34 | PLB-PVC20 | Pipa PVC AW 1/2 inch | Plumbing | 1 | btg | | | **rename** (+AW) |
| 35 | PLB-PVC25 | Pipa PVC AW 3/4 inch | Plumbing | 1 | btg | | | **rename** (+AW) |
| 36 | PLB-PVC32 | Pipa PVC AW 1 inch | Plumbing | 1 | btg | | | **rename** (+AW) |
| 37 | PLB-PVC50 | Pipa PVC AW 1 1/2 inch | Plumbing | 1 | btg | | | **rename** (+AW) |
| 38 | PLB-PVC75 | Pipa PVC AW 2 1/2 inch | Plumbing | 1 | btg | | | **rename** (+AW) |
| 39 | PLB-PVC80 | Pipa PVC AW 3 inch | Plumbing | 1 | btg | | | **NEW** (DN80) |
| 40 | PLB-PVC100 | Pipa PVC AW 4 inch | Plumbing | 1 | btg | | | **rename** (+AW) |
| 41 | PLB-PVC125 | Pipa PVC AW 5 inch | Plumbing | 1 | btg | | | **NEW** (DN125) |
| 42 | PLB-PVC150 | Pipa PVC AW 6 inch | Plumbing | 1 | btg | | | **NEW** (DN150) |
| 43 | PLB-PVC200 | Pipa PVC AW 8 inch | Plumbing | 1 | btg | | | **NEW** (DN200) |
| 44 | PLB-FIT01 | Fitting dan sambungan pipa PVC | Plumbing | 1 | pcs | | | **NEW** (row was blank → defaults) |
| 45 | SND-KRT | Pasir Kertosono | Material Beton | 2 | m3 | | | keep |
| 46 | SND-LMJ | Pasir Lumajang | Material Beton | 2 | m3 | | | keep |
| 47 | WTR-WRK | Air kerja | Material Beton | 3 | m3 | | | keep |
| 48 | FST-NL01 | Paku 5-12cm | Kayu & Bekisting | 3 | kg | | | keep |
| 49 | KWD-BDR01 | Kawat bendrat | Struktur | 3 | kg | | | keep (retires REB-WR01 dup) |
| 50 | CON-DCK01 | Beton decking (tahu beton) | Material Beton | 3 | kg | | | keep |

**Rebar conversion provenance:** kg per 12 m batang = `0.006165 × d² × 12`
(SNI theoretical weight, steel density 7850 kg/m³). D29 = `0.006165 × 841 × 12
= 62.22`. All others already correct in DB and `tools/rebarBatang.ts`.

### Aliases (old name → code) so BoQ name-matching survives renames
- "Ready mix kelas 30" → CON-RM30
- "Ready mix kelas 25" → CON-RM25
- "Kayu kelas 3 4/6" → WOD-KLS34; "Kayu kelas 3 5/7" → WOD-KLS46; "Kayu kelas 3 6/8" → WOD-KLS58
- "Pipa PVC 1/2 inch" → PLB-PVC20; "…3/4 inch" → PLB-PVC25; "…1 inch" → PLB-PVC32;
  "…1 1/2 inch" → PLB-PVC50; "…2 1/2 inch" → PLB-PVC75; "…4 inch" → PLB-PVC100

**Open default (low-risk):** the "Fitting" row was fully blank in the revision;
assigned `PLB-FIT01` / Plumbing / Tier 1 / pcs. Flag if a different unit/tier is
wanted.

## 4. Reference-row handling (per FK table)

All FKs to `material_catalog` are `ON DELETE NO ACTION` (except `material_aliases`
/ `material_specs` = CASCADE), so referencing rows must be cleared before a
material can be deleted. For rows pointing at a **removed** material:

| Table | material_id nullable | Action |
|---|---|---|
| ahs_lines | yes | **UPDATE → NULL** (unlink estimate line) |
| project_material_master_lines | yes | **DELETE** (demand rollup, regenerated on re-link) |
| material_baseline_snapshots | no | **DELETE** (trial/regenerable) |
| purchase_order_lines | yes | **DELETE** (trial) |
| receipt_lines | yes | **DELETE** (trial) |
| material_request_lines | yes | **DELETE** (trial) |
| mtn_requests | yes | **DELETE** (trial) |
| price_history | yes | **DELETE** (trial) |
| material_aliases | CASCADE | auto-removed |
| material_specs / ahs_price_book / plan_revision_lines | — | 0 rows |

Rows pointing at a **kept** material are untouched. Delete transactional child
rows in FK-safe order (receipts before PO lines, etc.).

## 5. Execution phases (this session, with checkpoints)

- **P0 — Backup.** `CREATE TABLE …_bak_20260714 AS SELECT …` for `material_catalog`
  and the id+material_id of `ahs_lines`, `project_material_master_lines`,
  `material_baseline_snapshots`. Also dump `material_catalog` to a repo CSV.
- **P1 — Excel + CSV + code.** Rewrite the deliverable `.xlsx` (50 rows, fixed
  codes/conversions/Fitting, refreshed Summary + Tier sheets). Regenerate
  `assets/mock/material_master.csv` (50 rows) and `material_aliases.csv`
  (add the 11 rename aliases). Add D29 to `tools/rebarBatang.ts`.
- **P2 — DB rebuild (single transaction).**
  1. UPDATE renamed items in place (names only; codes/ids unchanged).
  2. INSERT the 6 new items (REB-DE29, PLB-PVC80/125/150/200, PLB-FIT01).
  3. INSERT the 11 rename aliases.
  4. Clear references to removed materials per §4.
  5. DELETE `material_catalog` WHERE code NOT IN (the 50).
- **P3 — Re-link 6 projects.** Re-match the just-nulled `ahs_lines` against the
  new catalog by **exact** normalized name/alias; reconnect only unambiguous
  matches (e.g. `AUTO-PAKU`→`FST-NL01`), leave the rest NULL. Rebuild
  `project_material_master_lines` for kept materials if needed.
- **P4 — Verify.** catalogue count = 50; `SELECT` proving no FK orphans; per
  project linked-vs-unlinked counts before/after; spot-check a rebar line's
  batang↔kg factor.

## 6. Rollback

If any phase fails or verification is wrong: the operation runs in a transaction
(P2) and every mutated table has a `…_bak_20260714` snapshot. Restore =
`TRUNCATE … ; INSERT … SELECT * FROM …_bak_20260714` and re-apply the original
`material_id`s from the backup tables.

## 7. Out of scope / follow-ups

- `003_seed.sql` still lists the old 187 rows; a fresh local DB reset would
  diverge. Update it to the 50 in a follow-up (live DB is the operative target).
- Full re-parse of the 4 older projects (Ernawati / TN4/1 / GRAHA / Pakuwon)
  that have no catalogue-linked `ahs_lines` — needs their original workbooks;
  re-link is a no-op for them until re-published.
