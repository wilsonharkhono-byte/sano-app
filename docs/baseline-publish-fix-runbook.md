# Baseline Publish Fix — Runbook

> Fixes: `Publish gagal: ON CONFLICT DO UPDATE command cannot affect row a second time`
> Project seen failing: **CIT-K2/7 · Citraland K2/7** (Sonny Citraland Selat Golf workbook)
> Date: 2026-06-13

---

## 1. What was actually broken

The publish upserts `boq_items` with `onConflict: 'project_id,code'`
(`tools/publishBaselineV2.ts:288`). Postgres aborts the whole statement when a
single batch contains the **same `(project_id, code)` twice** — that is the
literal meaning of "ON CONFLICT DO UPDATE command cannot affect row a second
time."

The duplicate codes came from the **parser**, not the database. The committed
(deployed) `extractBoqRows` zeroed `itemCounter` on every named decorator and
renumbered off `subSubChapterCounter`. In the Citraland RAB that collapses:

- **Poer** (`III.A.1.*` via item 1) onto the **first Sloof subgroup** (`III.A.1.*` via sub-sub 1), and
- **"Sloof Elevasi -0.80"** onto **"Sloof & Balok Lantai 1"** (and the same for Kolom).

The fix (`itemSubgroupCounter`) was written in the working tree but **never
committed**, so production kept running the colliding parser. Confirmed:

- working tree parses the workbook with **0 duplicate codes**;
- committed HEAD **crashes** on the same workbook.

## 2. What changed in the code (already written, tested)

| File | Change |
|---|---|
| `tools/boqParserV2/extractTakeoffs.ts` | `itemSubgroupCounter` nests named subgroups under an active numbered item → `III.A.2.1.*` vs `III.A.2.2.*`. Defensive dedup guard suffixes genuine source numbering typos (`IX.5` → `IX.5b`) and records `code_note`. **AAL-5 codes unchanged.** |
| `tools/publishBaselineV2.ts` | New exported `findDuplicateBoqCodes()` guard runs **before** demoting/inserting `ahs_versions`. A stale session now fails loud naming the offending codes — never the opaque Postgres error, never a half-published version, and never a silent merge of two distinct line items. |
| `tools/__tests__/publishBaselineV2.test.ts` | 3 regression tests for the guard. |

Test status: `npx jest tools/__tests__/publishBaselineV2.test.ts tools/boqParserV2/__tests__/extractTakeoffs.test.ts` → **all green**.

## 3. Why a code fix alone does NOT unblock you

The app parses **client-side** (`BaselineScreen.tsx` → `parseBoqV2`); the
`boq-normalize` edge function is a stub. Your current staging rows were written
by the old parser and **still carry duplicate codes**. So the live publish
keeps failing until the staged rows are regenerated. Two actions only you can
do: **deploy** and **re-import**.

## 4. Procedure (do in order)

### 4.1 Commit (a git lock is currently blocking this)

A stale `.git/index.lock` (held by Dropbox sync or an editor with the repo
open on your Mac) blocked the automated commit. On your machine:

```bash
cd "/Users/.../Dropbox/AI/Claude Code"
# close any editor/Git GUI that has this repo open, pause Dropbox if needed
rm -f .git/index.lock

git add tools/boqParserV2/extractTakeoffs.ts \
        tools/publishBaselineV2.ts \
        tools/__tests__/publishBaselineV2.test.ts \
        tools/boqParserV2/formulaEval/evaluate.ts \
        tools/boqParserV2/formulaEval/parse.ts \
        tools/boqParserV2/formulaEval/tokenize.ts \
        tools/boqParserV2/recipeBuilder.ts \
        tools/boqParserV2/__tests__/formulaEval.evaluate.test.ts \
        tools/rollupMaterials.ts \
        tools/__tests__/rollupMaterials.test.ts \
        tools/normalizer/cli-deterministic.ts \
        tools/materialTakeoff.ts \
        tools/normalizer/cli-rollup.ts \
        tools/__tests__/materialTakeoff.test.ts \
        tools/boqParserV2/rebarDisaggregator/adapters/kolom.ts \
        tools/boqParserV2/__tests__/rebarDisaggregator/selectAdapter.test.ts \
        package.json
git commit -m "feat(boq-v2): SUMIF/SUMIFS eval, unique subgroup codes, publish dup guard, material take-off rollup, rebar-by-diameter"
```

> `package.json` also carries one prior benign edit (an `env -u
> ANTHROPIC_API_KEY` prefix on the `normalize:boq` script) plus the new
> `normalize:boq:rollup` script — both fine to include.

> Do **not** `git add .` — the working tree has unrelated pre-existing files
> (loginIdentity.ts, package.json, migrations, etc.). Add only the list above.

> The working-tree edits are already on disk — `git status` shows both source
> files modified. You are only committing; nothing needs re-editing.

### 4.2 Deploy

Deploy the web app so the client bundle ships the fixed parser **and** the
publish guard. (No Supabase edge-function deploy is required — the publish runs
client-side against Supabase.)

### 4.3 Re-import the workbook

In the app, for project **CIT-K2/7**, re-import `SANO Sonny Citraland Selat
Golf.xlsx` (re-upload → reparse → restage). This regenerates staging rows with
**unique** codes. Do not try to publish the *old* session — its rows are stale.

### 4.4 Publish + verify

1. Publish Baseline → should succeed.
2. Sanity-check the Recipe Index / staging: no duplicate codes; the two Sloof
   blocks show as `III.A.2.1.*` and `III.A.2.2.*`.
3. If publish still errors, the guard now tells you exactly which codes
   collided — that means step 4.3 (re-import) was skipped or the deploy in 4.2
   didn't ship.

## 5. Also shipped in this change (verified)

- **SUMIF / SUMIFS implemented** in `formulaEval/evaluate.ts` (range
  enumeration + criteria operators `= <> > >= < <=`, numeric and text). Sonny
  rows with a zero/null-qty component dropped **26 → 0**. Unknown functions now
  return a **NaN sentinel** (not a silent `0`); `recipeBuilder` keeps the NaN
  and sets confidence `0` so an uncomputable value stays visibly Unresolved —
  honoring the truth-correctness contract.
- **Stale `sub_chapter` labels fixed.** The numeric-item branch in
  `extractBoqRows` now sets `subChapterLabel = label`. `III.A.4` → "Plat
  lantai…", `III.A.5` → "Dinding Beton…" (were both "Kolom Lantai 1"); named
  decorators (Sloof/Kolom subgroups) still override correctly.
- **`rollupMaterials()`** pure function + tests added (`tools/rollupMaterials.ts`)
  — groups bullets by code-prefix, sums **only reconciled** bullets by
  `(material, unit)`, lists unreconciled separately. See `material-rollup-design.md`.

Regression evidence: AAL-5 deterministic CLI **176/176 reconciled, 0
unresolved, 0.00 Rp** variance; `recipeSnapshot` (Poer PC.5) unchanged; **239
unit tests pass**.

## 6. Reconciliation status — CORRECTION

An earlier note here claimed Kolom/Plat/Dinding "don't reconcile." **That was
wrong.** It came from a crude rolled-up-recipe heuristic (zero-qty components,
which were the SUMIF artifact — now fixed), not the actual reconciler. The
deterministic reconciler on the Sonny workbook reports **182/182 candidates
reconciled, 0 unresolved, max variance 0.00 Rp** (155 itemized + 27
direct-ref). Kolom/Plat/Dinding are all in chapter `(A) III.A` and reconcile.

## 7. Material take-off rollup (built)

```
npm run normalize:boq:rollup -- <input.xlsx> [output_takeoff.xlsx]
```

Runs the deterministic reconciler, rolls every **reconciled** row's MATERIAL
lines into procurement blocks (group key = code minus its last segment, e.g.
`(A) III.A.3.2` = "Kolom Lantai 1" = all 14 column types on floor 1), and writes
a workbook with three sheets: **Order List** (project-wide bulk, summed by
material+unit), **By Block** (pour-level groups), **Excluded** (anything not
summed, with reasons — never silently dropped).

Verified on Sonny: 23 blocks, 182 bullets summed, 0 excluded; "Kolom Lantai 1"
readymix rollup = 44.831 m³ = exact sum of its 14 bullets. Note: a few rebar
bullets reconcile only as a labelled "Pembesian (lump)" line rather than
per-diameter — honest, not faked; resolve later if diameter-level ordering is
needed. Sample output: `assets/BOQ/SANO Sonny Citraland Selat Golf - Material Takeoff.xlsx`.

## 8. Remaining (not done)

- **In-app Procurement view** — the `rollupMaterials()` core + take-off export
  are done and tested; the React Native screen that lets a supervisor browse
  these blocks live is not built. It would reuse the same core.
- **Pack-size rounding** for the Order List (besi per 12 m batang, multipleks per
  lembar) — currently raw totals; rounding policy is an open decision
  (material-rollup-design.md §10).

## 9. Rebar shown by diameter, not "U24 & U40" grade (fixed)

The take-off listed "Pembesian U24 & U40 (lump)" for 28 rows. U24/U40 are steel
*grades* (BjTP plain / BjTS deformed), not diameters — they must never appear as
a material line. Three distinct causes, all fixed in `cli-deterministic.ts`
(+ `kolom.ts`):

- **Plat (8 rows):** the disaggregator found the diameter but with one REKAP
  area's *absolute* kg while the BoQ row aggregates several areas, so
  `Σdiam ≠ Z` and the gate rejected it. Fix: rescale the per-diameter split to
  sum to `Z` (`proportions × Z`). Cost-exact; rows that already sum to Z
  (Kolom/Balok/Poer) are unchanged (scale = 1).
- **SW1 shear walls (3 rows):** rebar is on `Hasil-Kolom`; routed `SW…` labels
  through the kolom adapter (Z-formula hint resolves the row).
- **Dinding (17 rows):** `Retaining Wall` organises rebar by function, not
  diameter. Read the per-element diameter proportions from `REKAP BETON BESI
  BEKISTING` (Retaining wall = 100% D10 on every floor) and rescale to Z.

Result: **0 of 28 lumps remain; 182/182 reconcile at 0.0000 Rp**; AAL-5
unchanged at 176/176. Order list now shows D6/D8/D10/D13/D16/D19/D22 only.
Regenerate with `npm run normalize:boq:rollup`.
