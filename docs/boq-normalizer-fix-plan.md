# BoQ Normalizer — Fix Plan (2026-05-24)

> Hand this file to Claude Code. It is the work list to turn the current
> deterministic CLI from "reconciles 95% by Rp but only 11% by material
> detail" into "itemized for every structural row across all three reference
> workbooks." Order matters — work top to bottom.
>
> Source for the diagnosis: read `docs/boq-normalizer-field-guide.md`,
> `docs/boq-normalizer-validation-PD3-23.md`, and
> `docs/boq-normalizer-validation-I4-29.md` first if you haven't already.
> The validation docs are partially stale — see §1.2 below.
>
> **Truth-correctness contract from CLAUDE.md §1.1 is non-negotiable.** Every
> fix below must preserve it. If a fix breaks the ±1 Rp gate for any row
> that currently reconciles, abandon and re-design.

---

## The single most important framing fix

Stop reporting "95.4% reconciled" as the headline. That is reconciliation by
Rp, not by per-material detail. The actual per-material itemized coverage is
**84/744 = 11.3%** across AAL-5+PD3+I4-29. The original goal in field guide
§1 is per-material breakdown (Multipleks, Usuk, kg D8 vs D13, etc.) — for
that goal, the system has barely moved. The rolled-lump fallback is a safety
net, not the deliverable.

Every fix in §2 below targets per-material coverage, not Rp coverage. Track
both metrics separately.

---

## §1. Mechanical hygiene (do first — low effort, high honesty)

### 1.1 Re-run the CLI against all three reference workbooks

The `_normalized.xlsx` files in `assets/BOQ/` are stale. The AAL-5 one was
generated *before* the rolled tier shipped — it has 31 breakdowns + 136
unresolved, but the current CLI would produce 31 itemized + 128 rolled + 5
unresolved.

```
npm run normalize:boq:det -- "assets/BOQ/RAB R1 Pakuwon Indah AAL-5.xlsx"
npm run normalize:boq:det -- "assets/BOQ/RAB R2 Pakuwon Indah PD3 no. 23.xlsx"
npm run normalize:boq:det -- "assets/BOQ/RAB Nusa Golf I4 no. 29_R3.xlsx"
```

After each run, capture the final 4-line summary block (`Reconciled total:`
through `Unresolved:`) into a new section in `docs/boq-normalizer-fix-plan-results.md`
with the run date. Use those numbers to verify the test in §1.3 below.

**Acceptance.** Three fresh `*_normalized.xlsx` files in `assets/BOQ/`,
counts captured in `boq-normalizer-fix-plan-results.md`, numbers match (or
are explicitly reconciled with) the field guide §13 table.

If they DON'T match: the field guide §13 table is wrong, not the run.
Update §13 — do not loosen the run.

### 1.2 Mark stale sections of the two validation docs

`docs/boq-normalizer-validation-PD3-23.md` (15:06 on 2026-05-24) was written
*before* the CLI was patched at 15:35. It still reads "104/241 = 43%
reconciled" throughout. Most of its §7 "Updates needed to the field guide"
is already done.

`docs/boq-normalizer-validation-I4-29.md` (15:04) still says the CLI produces
"0 itemized / 0 rolled / 0 unresolved" because `boqSheet: 'auto'` wasn't
passed and `readRowCols` was hardcoded to `'RAB (A)'`. Both bugs are fixed
in the current `cli-deterministic.ts` (lines 621 and 644 respectively).

**Do not delete these docs.** They are valuable as the diagnostic record of
what the system used to do wrong. Instead:

- At the top of each, add a callout box:
  ```
  > **SUPERSEDED 2026-05-24.** This document records the CLI's behavior as
  > of <timestamp>, before the X / AC*AD / L / M column fixes and the
  > `boqSheet: 'auto'` default. For current coverage see
  > `docs/boq-normalizer-field-guide.md` §13 and the run results in
  > `docs/boq-normalizer-fix-plan-results.md`. The §X analysis below
  > remains valuable as the diagnostic record.
  ```
- Inline-annotate sections whose claim is no longer true. Use `~~strikethrough~~`
  + a `> Fixed 2026-05-24 in commit XXXX. New behavior: ...` line directly
  underneath.

**Acceptance.** Reader can open either validation doc and within 30 seconds
see which claims are historical-only vs still active.

### 1.3 Add a Jest regression test pinning the count triples

`tools/normalizer/__tests__/` has nothing that catches a coverage regression.
If you fix the H-side bekisting bug in §2.1 below and accidentally break
AAL-5's 31 itemized rows, nothing alerts. The field guide §13 numbers will
silently drift into fiction within a quarter.

Add `tools/normalizer/__tests__/deterministicCli.integration.test.ts`. It
should:

1. Import the CLI's `main`-equivalent as a callable function (refactor
   `cli-deterministic.ts` to export a `runDeterministic({ inputPath, outputPath })`
   wrapper around the current `main` body so the test can call it without
   `process.argv`).
2. Run against each of the three reference workbooks.
3. Assert the `{ itemized, rolled, unresolved, total }` counts match the
   field guide §13 table exactly. Pin to current run output, not aspirational
   numbers.
4. Assert the truth-correctness contract: every breakdown sheet's
   reconciliation block has `|variance| <= 1`. Fail the test if any sheet
   has a larger variance.
5. Mark with `jest.setTimeout(120_000)` — parseBoqV2 on a 4MB workbook is
   slow.

**Acceptance.** `npm test -- deterministicCli.integration` passes locally
and is run in CI. Intentionally breaking the rolled tier (delete the X
column read in `readRowCols`) causes the test to fail with a clear count
mismatch.

---

## §2. The real coverage gap — architectural fixes

These move per-material itemized coverage from 11% toward the structural
target. Do in order.

### 2.1 H-side bekisting sub-item extraction (the big one)

**Problem.** In PD3 and I4-29, Bekisting Balok and Bekisting Plat embed
Perancah as a sub-item inside the block, with its cost in column H (not F).
The `Harga per m²` row splits per-m² cost into two: F-side (forms) and
H-side (Perancah), with *different* cycle factors. Example from I4-29
Bekisting Balok (Analisa rows 134..143):

- F divisor = `(0.3 + 0.35×2) × 4 = 4.0` (forms cycle 4)
- H divisor = `1.2 × 2.4 = 2.88` (Perancah cycle 2.88)

The current `extractBekistingTemplates` (cli-deterministic.ts lines 99–143)
only captures F-side sub-items (`includedInTotal: fTotal > 0` at line 137).
Perancah's F=0 so it's silently dropped. Tier-1 itemized then fails the
±1 Rp gate by exactly `V × X` per row, and the row falls through to the
rolled tier.

Result: every Balok and Plat row in PD3/I4-29 is rolled, not itemized.
Balok+Plat is typically 40–60% of structural budget. That's the actual
coverage gap.

**Fix.** Extend `BekistingTemplate` to carry F-side and H-side sub-item
sets separately, each with its own cycle factor.

```ts
interface BekistingTemplate {
  blockTitle: string;
  hargaPerM2_F: number;          // F-side (forms) per-m² cost — matches RAB!W
  hargaPerM2_H: number;          // H-side (Perancah) per-m² cost — matches RAB!X
  cycleFactor_F: number;          // F-side cycle (jumlahF / hargaF)
  cycleFactor_H: number;          // H-side cycle (jumlahH / hargaH), or 1 if H=0
  subItems: Array<{
    materialName: string;
    qtyPerNative: number;
    nativeUnit: string;
    unitPrice: number;
    side: 'F' | 'H';              // which side of the block this sub-item totals into
    includedInTotal: boolean;
  }>;
}
```

In `extractBekistingTemplates`:

- Read `jumlahF = F{jumlahRow}`, `jumlahH = H{jumlahRow}`.
- Read `hargaF = F{jumlahRow + 1}` (or `jumlahF` for single-cycle), `hargaH = H{jumlahRow + 1}` (or 0).
- `cycleFactor_F = jumlahF / hargaF`, `cycleFactor_H = hargaH > 0 ? jumlahH / hargaH : 1`.
- For each component row, classify `side` by whichever column carries the
  total: `fTotal > 0 → 'F'`, `hTotal > 0 → 'H'`, else skip (not included).

In `buildBreakdownForRow` (lines 472–506):

- Keep the current F-side expansion: `factor_F = cols.bekistingRatioM2PerM3 / template.cycleFactor_F`,
  emit each F-side sub-item with that factor.
- Add H-side expansion when `cols.bekistingPeralatanPerM2 > 0`:
  `factor_H = cols.bekistingRatioM2PerM3 / template.cycleFactor_H`.
  Emit each H-side sub-item as a separate breakdown row with
  `componentGroup: "BEKISTING PERALATAN (Material) — Perancah, ratio ${V} m²/m³"`.
- The combined sum of F-side cost + H-side cost should equal
  `V × W + V × X` exactly. Verify by reconciling against `RAB!N{row}`.

**Acceptance.** Re-run the CLI against PD3 and I4-29. Expected outcomes:

- PD3: itemized count rises from 19 to ~145 (the 125 Balok/Plat rows that
  currently fail tier-1 with -V*X variance should now itemize).
- I4-29: itemized count rises from 6 to ~200+ (all rows with X>0).
- AAL-5: itemized count unchanged at 31 (X=0 for every AAL-5 row, so the
  fix is a no-op there).
- Zero new variance failures. The Jest test from §1.3 still passes after
  updating expected counts.

If AAL-5 itemized count drops, the fix has regressed F-side extraction —
roll back and re-check the side-classification logic.

**Estimated complexity.** Medium. ~80 lines of code plus updating the test
expectations. The math is well-understood from PD3/I4-29 validation §3.4
and §6.3.

### 2.2 Direct-reference breakdown path for masonry / pile / custom items

**Problem.** Rows like `II.B.3 Strauss pile dia. 30 cm` (PD3, N=Rp 3,502,524.51)
have `R = S = T = V = W = Z = AA = 0` because they aren't built from the
Bekisting+Concrete+Pembesian template. Instead their `I/J/K` columns
reference a specific Analisa block directly:

```
I{row} = Analisa!F{poured_block_jumlah}   (material lump)
J{row} = Analisa!G{poured_block_jumlah}   (labor lump)
K{row} = Analisa!H{poured_block_jumlah}   (equipment lump)
N{row} = I + J + K + L + M                 (total)
```

The current rolled tier skips them because their structural columns are
zero. Result: they go to Unresolved and contribute nothing to any project
rollup. On PD3 that's ~Rp 3.5M+ of pile work silently dropped. The
truth-correctness contract is honored per-row but project-level rollups
are systematically understated.

This is the same pattern as AAL-5 chapter VIII Pasangan dinding bata and
PD3 chapter IX masonry rows.

**Fix.** Add a third tier (call it tier-2.5 or rolled-via-direct-reference):
after tier-1 itemized fails AND tier-2 rolled-from-columns fails, try
to find the referenced Analisa block via the row's recipe components
(`row.recipe.components[*].referencedCell`), then build a 3-lump breakdown
(material from F, labor from G, equipment from H) at the referenced block's
Jumlah row.

Skeleton:

```ts
function buildDirectReferenceBreakdown(args: {
  row: BoqRowV2;
  lookup: Map<string, HarvestedCell>;
  sourceUnitCost: number;
  sourceLineTotal: number;
}): BuildResult {
  // Pick the dominant referenced block from the row's recipe.
  const ref = pickDominantReferencedBlock(args.row);  // see field guide §7.3
  if (!ref) return { reason: 'No referenced Analisa block found.' };

  const f = getCellNum(lookup, 'Analisa', `F${ref.jumlahRow}`);
  const g = getCellNum(lookup, 'Analisa', `G${ref.jumlahRow}`);
  const h = getCellNum(lookup, 'Analisa', `H${ref.jumlahRow}`);
  // Plus any L/M direct-cost contributions from the BoQ row itself.

  // Emit 3 lumps + subkon + prelim as in the rolled tier.
  // Reconcile against N. If within ±1 Rp, return as 'rolled-direct'.
}
```

Add `'rolled-direct'` as a third `level` value in `BuildResult`. Track its
count separately in the CLI output summary so you can see how many rows
this tier catches.

**Acceptance.**

- PD3 unresolved count drops from 12 to ≤5 (the remaining ≤5 are genuinely
  un-decomposable items where even the recipe doesn't reference an
  Analisa block).
- AAL-5 unresolved drops from 5 to ≤2 (Strong band BB + at most a few VIII.*
  rows).
- I4-29 unresolved drops materially.
- Every newly-handled row reconciles within ±1 Rp.

**Estimated complexity.** Medium. The hard part is `pickDominantReferencedBlock`
— a row's recipe may have multiple components referencing different blocks;
need a rule for which one represents the row's primary cost (probably:
highest `cost_per_unit` × `quantityPerUnit`, or the one whose Jumlah equals
the row's `N`).

### 2.3 REKAP Plat adapter layout-awareness (smaller, do if §2.1 and §2.2 are done)

**Problem.** PD3 validation §7.5 documents that `tools/boqParserV2/rebarDisaggregator/adapters/plat.ts`
hardcodes AAL-5's REKAP Plat column layout (`C=label, N=D8, O=D10, ..., R=D19`).
PD3's REKAP Plat layout is different: `D=Luas Plat, J=Wire Mesh, K=D8, L=D10,
M=D13, N=D16, O=D25`. On PD3 the adapter returns empty diameter weights and
the rebar disaggregator silently falls back to the rolled Pembesian lump.

This means: even after §2.1 fixes Plat *bekisting* itemization, the *rebar*
side of every Plat row in PD3 will still be a single "Pembesian (lump)" line
rather than per-diameter Besi D8 / D10 / D13 lines.

**Fix.** Make the adapter detect the header row by scanning row 1–3 for
text matching `/^\s*(?:Besi\s*)?D\s*(\d{1,2})\s*$/` and mapping each
detected diameter to its column letter. Then read per-row weights by the
detected mapping instead of hardcoded letters.

Apply the same fix to balok / poer / kolom adapters where similar drift
exists.

**Acceptance.** PD3 itemized Plat rows show per-diameter Besi components
(D8, D10, D13, etc.) rather than a single Pembesian lump. AAL-5 still works
(headers there are at L=D6, M=D8, N=D10, O=D13 etc. — auto-detect should
find them).

**Estimated complexity.** Small. ~30 lines per adapter, plus a header-detect
helper.

---

## §3. Documentation honesty (do alongside §2)

### 3.1 Split the field guide §13 coverage table into two metrics

Current §13 table reports a single "Coverage" column showing 95–97%. That
number is reconciliation by Rp (rolled-tier safety net). The number readers
actually care about is per-material coverage (itemized tier).

Replace the table with:

```
| Workbook | Itemized | Rolled | Unresolved | Total | Rp coverage | Material coverage |
|---|---|---|---|---|---|---|
| AAL-5    | 31  | 128 | 5  | 164 | 96.9% | 18.9% |
| PD3-23   | 19  | 210 | 12 | 241 | 95.0% |  7.9% |
| I4-29    |  6  | 316 | 17 | 339 | 95.0% |  1.8% |
| All      | 84  | 626 | 34 | 744 | 95.4% | 11.3% |
```

Add a paragraph below:

> Rp coverage = `(itemized + rolled) / total` — share of project Rp value
> whose total reconciles to source within ±1 Rp. Material coverage =
> `itemized / total` — share of rows with per-material detail (Multipleks,
> Usuk, kg D8 vs D13, etc.) available to procurement. The two metrics
> diverge because the rolled tier emits group lumps (Bekisting lump,
> Pembesian lump) that reconcile by total but provide zero per-material
> visibility.

After §2.1 + §2.3 ship, the material coverage column should jump to ~60–80%.
Update the table then.

### 3.2 Reconcile AAL-5 `_normalized.xlsx` with field guide §10.4

After §1.1 re-runs, the on-disk file matches the field guide. If §10.4's
"31 itemized + 128 rolled + 5 unresolved" disagrees with the actual run,
update §10.4 to match the run, not the other way around.

### 3.3 Add the §2.1 + §2.2 architecture to field guide §2.3 and §4

Once §2.1 ships, field guide §2.3 needs to document the F-side/H-side split.
Currently it says "two distinct shapes: cycle-based vs single-cycle." Add a
third: "cycle-based with embedded Perancah (separate H-side cycle)." The
PD3 validation §3.4 has the right diagram — promote it.

Field guide §4.0 (column-sum invariant) already covers `V·W + V·X` so no
change there. But §4.2 (Bekisting cycle-based math) needs a parallel "§4.2b
H-side expansion" block once §2.1 lands.

---

## §4. Out of scope (do NOT do these now)

- LLM/agentic CLI changes. The deterministic CLI must hit ~90% per-material
  coverage before the LLM fallback is worth re-tuning.
- New workbook ingestion (any RAB beyond the three reference workbooks).
  Get the reference set to 90%+ material coverage first, then expand.
- UI changes in `workflows/screens/BaselineScreen.tsx`. The SANO downstream
  doesn't need any change to consume the new itemized breakdowns from §2.1
  — same schema, more rows.
- Touching `tools/normalizer/cli.ts` (the LLM CLI). Hands-off until §1–§3
  ship.

---

## §5. Verification checklist before any commit

For each change:

1. `npm run normalize:boq:det` against all three reference workbooks. No
   row that previously reconciled now fails. No variance >1 Rp on any
   written breakdown.
2. `npm test` passes. The integration test from §1.3 catches count drift.
3. Each new breakdown sheet's reconciliation block shows `|variance| < 1`
   AND `reconciles: true`.
4. Spot-check by hand one row from each affected chapter — open the
   workbook in Excel, sum the breakdown sheet's `Cost per m³` column,
   compare to `RAB!N{sourceRow}`. They must match within ±1 Rp.

If any check fails, revert. The truth-correctness contract is non-negotiable.

---

## Appendix — file map

| File | Why you'll edit it |
|---|---|
| `tools/normalizer/cli-deterministic.ts` | §1.3 refactor `main` → `runDeterministic`. §2.1 H-side template + expansion. §2.2 new `buildDirectReferenceBreakdown` tier. |
| `tools/normalizer/__tests__/deterministicCli.integration.test.ts` | §1.3 new file. |
| `tools/boqParserV2/rebarDisaggregator/adapters/plat.ts` (and siblings: `balokSloof.ts`, `kolom.ts`, `poer.ts`) | §2.3 header-detection. Note: `headerDetect.ts` already exists in this dir (modified 2026-05-24 16:30) — check whether someone already started this work. |
| `docs/boq-normalizer-field-guide.md` | §3.1 table split. §3.3 §2.3 + §4 additions. |
| `docs/boq-normalizer-validation-PD3-23.md` | §1.2 SUPERSEDED banner + inline strikethroughs. |
| `docs/boq-normalizer-validation-I4-29.md` | §1.2 SUPERSEDED banner + inline strikethroughs. |
| `docs/boq-normalizer-fix-plan-results.md` | §1.1 new file holding run results. |
| `assets/BOQ/*_normalized.xlsx` | §1.1 re-generate. |

---

*Plan author: Claude (Cowork session, 2026-05-24). Hand to Claude Code as
the briefing for a single multi-step pass. Each section has self-contained
acceptance criteria — Claude Code can verify completion without re-asking.*
