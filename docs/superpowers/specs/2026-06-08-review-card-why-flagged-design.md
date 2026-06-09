# Review-Card "Why Flagged + What To Do" — Design

> Turn each flagged BoQ-import review card from a *locator* into a *decision aid*:
> tell the non-technical estimator **why** the row needs checking and **what**
> each action does — in plain Indonesian, with a soft suggestion — so they can
> act (Setuju / Tolak / Koreksi) confidently without leaving the app.

- **Date:** 2026-06-08
- **Status:** Approved design, ready for implementation plan
- **Scope:** the WHY/WHAT explanation (follow-up #1 from the 4-agent eval). Out of scope: in-app source-cell *content* preview (#2), Normalized-file provenance (#3), queue grouping/batch (#4 of the eval), anchor-column correctness (#5), and field-label translation of the raw preview.
- **Surfaces:** `tools/boqParserV2/index.ts` (parser), a new `tools/flagExplanation.ts` (helper), `workflows/screens/BaselineScreen.tsx` (card).
- **Builds on:** `docs/superpowers/specs/2026-06-05-review-card-source-provenance-design.md`.

---

## 1. Problem

The shipped provenance feature tells the estimator **where** a flagged row is
(`📄 Analisa!B84`) and its role (`⚠ tidak dipakai BoQ manapun`), but not **why**
it was flagged or **what** pressing Setuju / Tolak / Koreksi will do. The 4-agent
evaluation scored the feature 5.5/10 with this as the core gap: a correct
*locator* was built where the goal needed *comprehension*. The estimator (Julius,
non-technical, often mobile) still hesitates between Tolak and Koreksi and may
reject a row that is actually needed.

## 2. The two flag reasons (the entire taxonomy)

The v2 parser sets `needs_review = true` in exactly two places
(`tools/boqParserV2/index.ts`):

| Reason | Trigger (in `index.ts`) | Meaning |
|---|---|---|
| **Orphan AHS block** | `needs_review: linkedBoqCode == null` on an `ahs_block` row | Recipe exists in `Analisa` but no BoQ row references it. |
| **Literal AHS component** | `needs_review: classification.cost_basis === 'literal'` on an `ahs` row | Component cell is a hardcoded number with no formula, so the parser can't trace where the cost came from. |

`material` and `boq` rows are never flagged (`needs_review: false`). REJECTED rows
also appear in the queue but already carry a user decision, so they need no
explanation.

## 3. What each action does (from `publishBaseline`, `tools/baseline.ts`)

`publishBaseline` includes a row in the baseline when `review_status` is
`APPROVED` or `MODIFIED`, or when it's a clean (`!needs_review`) `PENDING` row.

- **Setuju** (APPROVED) → row goes into the baseline as parsed.
- **Koreksi** (MODIFIED) → row goes in with the estimator's edits.
- **Tolak** (REJECTED) → row is excluded from the baseline.

Publish is blocked until every `needs_review` row has left PENDING.

## 4. Design

Mirrors the provenance pattern: **the parser stamps the reason; the UI renders
it.** Re-deriving in the UI was rejected because the component reason needs
`cost_basis`, which is not on the UI's `ImportStagingRow` type.

### Part 1 — Parser stamps `flag_reason`

In `tools/boqParserV2/index.ts`, at the two sites that set `needs_review`, add a
`flag_reason` string to the row's `raw_data` (additive JSONB field, no DB
migration):

- `ahs_block` builder: `flag_reason: linkedBoqCode == null ? 'orphan_ahs_block' : undefined`.
- `ahs` component builder: `flag_reason: classification.cost_basis === 'literal' ? 'literal_component' : undefined`.

`flag_reason` is set by the **same predicate** that sets `needs_review`, so the
two can never disagree.

### Part 2 — `flagExplanation(row)` helper

New pure module `tools/flagExplanation.ts`, unit-tested, no React/IO:

```
flagExplanation(row: ImportStagingRow): { why: string; saran: string } | null
```

- Returns `null` when `row.needs_review` is false (no callout shown).
- Reads `raw_data.flag_reason` and maps it to copy (Section 5).
- When `needs_review` is true but `flag_reason` is missing/unknown (e.g. stale
  pre-feature rows, or a future trigger), returns the **generic** fallback
  `{ why: 'Baris ini ditandai untuk dicek manual.', saran: 'Periksa nilainya; Setuju jika benar, Koreksi jika perlu, Tolak jika tidak relevan.' }` —
  never a wrong reason (truth-correctness).

### Part 3 — Card render (`BaselineScreen.tsx`)

For rows where `flagExplanation(row)` is non-null, render a highlighted callout in
the card body (below the source-context line, above the parsed-data preview):

```
❓ Kenapa dicek: {why}
💡 Saran: {saran}
```

Static action captions are rendered once, beneath the three action buttons (not
per reason): **Setuju** = "pakai apa adanya di baseline" · **Tolak** = "buang dari
baseline" · **Koreksi** = "perbaiki dulu, lalu masuk". These live as constants in
the screen (or the helper module) and apply to every flagged card.

The callout uses the existing warning color tokens; captions use the
secondary-text token. No change to review/approve/publish logic.

## 5. The copy (canonical strings)

| `flag_reason` | `why` | `saran` |
|---|---|---|
| `orphan_ahs_block` | "Resep harga ini ada di sheet Analisa, tapi tidak ada baris BoQ yang memakainya." | "Tolak jika ini template sisa yang tidak dipakai; Koreksi & isi Kode BoQ jika seharusnya ada yang memakai." |
| `literal_component` | "Komponen ini berisi angka langsung tanpa rumus, jadi parser tidak bisa memastikan asal biayanya." | "Periksa angkanya. Setuju jika sudah benar; Koreksi jika perlu diperbaiki." |
| (unknown / missing, but `needs_review`) | "Baris ini ditandai untuk dicek manual." | "Periksa nilainya; Setuju jika benar, Koreksi jika perlu, Tolak jika tidak relevan." |

Action captions (static): Setuju → "pakai apa adanya di baseline"; Tolak → "buang
dari baseline"; Koreksi → "perbaiki dulu, lalu masuk".

## 6. Components / units

| Unit | Where | Responsibility | Depends on |
|---|---|---|---|
| `flag_reason` stamping | `index.ts` (2 sites) | record why a row was flagged | the `needs_review` predicates |
| `FLAG_COPY` map + `flagExplanation` | `tools/flagExplanation.ts` | reason code → `{why, saran}` or null/generic | `ImportStagingRow` (type only) |
| `ACTION_CAPTIONS` | `tools/flagExplanation.ts` (exported constant) | static button captions | — |
| callout + captions render | `BaselineScreen.tsx` | show the explanation for flagged rows | the helper + constant |

## 7. Testing

- **`flagExplanation` unit tests:** `orphan_ahs_block` → orphan copy; `literal_component` → literal copy; flagged row with no/unknown `flag_reason` → generic copy; `needs_review: false` → `null`.
- **Parser test:** an orphan `ahs_block` row gets `raw_data.flag_reason === 'orphan_ahs_block'`; a literal `ahs` component gets `'literal_component'`; a non-flagged row has no `flag_reason`.
- **Regression:** existing review/approve/publish flows and counts unchanged.

## 8. Risks

- **Copy drift vs. trigger:** if a future change adds a third `needs_review`
  trigger without a `flag_reason`, the generic fallback covers it honestly (no
  wrong reason), but the explanation is weaker. Mitigation: the parser test
  asserts the known triggers carry their codes; a new trigger that omits a code
  is a known, safe degradation.
- **Vertical space at scale:** the callout adds ~2 lines per flagged card. With
  ~100 flagged cards this is more scrolling, but it only renders for flagged rows
  (clean rows are hidden by the exceptions filter) and directly serves the goal.
  Queue grouping/batch is a separate eval follow-up, out of scope here.
- **Soft suggestion could nudge a wrong Tolak:** the `saran` for orphan blocks
  presents both Tolak and Koreksi paths rather than a single command, keeping the
  decision with the estimator.
