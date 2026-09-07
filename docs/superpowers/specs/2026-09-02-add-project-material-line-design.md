# Tambah Material Proyek — incremental plan line without re-publish

Date: 2026-09-02 (revised 2026-09-07 after adversarial review). Status: approved direction. User decisions: "proceed with the add one project line"; "estimator can create a brand new catalogue item in the app".

## 1. Problem

A published project's plan changes only through a full re-publish of the SANO Input workbook (`tools/publishBaselineV2.ts`). Publish is whole-plan replacement: planned rows come only from the uploaded file, and when the file carries Others rows the project's `ahs_price_book` is deleted and rebuilt (`:1558-1563`). So the common case, one material the estimator forgot that a supervisor needs now, forces the riskiest operation in the app. The 2026-08-15 incident (Others volumes read as 0, thirteen materials vanished, publish reported success) is the failure mode.

A catalogue item created after publish can already be requested (gates return soft INFO/WARNING), but it has no planned quantity and no benchmark price until the next publish, so every request for it shows "belum ada rencana" and no envelope or budget exists.

## 2. Scope

In: an estimator adds ONE new project-level material (Tier 2, 3 or 4, `boq_item_id NULL`) to the CURRENT master of an already-published project, atomically, with audit trail and supervisor notification. Plus a publish-time guard so an incrementally added material that is missing from the next uploaded file is called out before it is dropped.

Out (unchanged paths): Tier 1 materials (need a work-area BoQ mapping → workbook), changing an existing material's quantity or price (→ re-publish, so the diff/ceiling machinery applies), removing lines, the supervisor-side "ask-and-resolve" flow (next spec), catalogue creation UI (exists: `office/screens/MaterialCatalogScreen.tsx` `handleAddMaterial`; `workflows/screens/MaterialCatalogScreen.tsx` is alias-only).

## 3. Architecture

Four units:

1. **Migration 095** — partial unique index on project-level master lines, and `add_project_material_line(...)` SECURITY DEFINER RPC doing every write in one transaction.
2. **`tools/addProjectMaterialLine.ts`** — pure input validation (`validateAddLineInput`), RPC wrapper (`addProjectMaterialLine`), error mapping to Indonesian copy (`mapAddLineError`), and `findIncrementalAddsMissingFromStaging` (pure) for the publish guard.
3. **`workflows/screens/BaselineScreen.tsx`** — card "Tambah material proyek" in the `sessions` view with an inline form (user preference: inline under the tapped card, never a modal; this screen does have a modal elsewhere, which is not the precedent), shown only when the project has a current master. Corrects the Panduan text at `:1686-1688` that points mid-project material changes at "Catatan Perubahan" (an unrelated feature). Adds the publish-time guard.
4. **Docs** — this spec, the estimator guide (`docs/guides/2026-09-02-panduan-estimator-katalog-baseline.md`), plan.

## 4. Migration 095

### 4.1 Unique index

```sql
CREATE UNIQUE INDEX IF NOT EXISTS uq_pmml_project_level_material
  ON project_material_master_lines (master_id, material_id)
  WHERE boq_item_id IS NULL AND material_id IS NOT NULL;
```

Safe: `buildProjectMaterialLines` already merges same-material Others rows into one line per material (`publishBaselineV2.ts:682-693`), so existing masters satisfy it. It is the durable backstop for the concurrency case in 4.3(a).

### 4.2 RPC contract

```
add_project_material_line(
  p_project_id   uuid,
  p_material_id  uuid,
  p_planned_qty  numeric,
  p_unit_price   numeric default null,
  p_note         text    default null
) returns jsonb
-- { line_id, revision_id, master_id, material_name, unit, tier,
--   planned_after, price_book_written, snapshot_written, notified }
```

Guards, in order, each `RAISE EXCEPTION` with a stable prefix the client maps:

| Prefix | Condition | Copy (id) |
|---|---|---|
| `ADD_LINE_AUTH` | `auth.uid()` NOT NULL and NOT `is_office_role()` | Hanya estimator/admin yang dapat menambah material proyek. |
| (assert_project_access) | reuse existing guard | — |
| `ADD_LINE_NO_MASTER` | no `project_material_master` for project | Proyek belum dipublish. Gunakan Publish untuk rencana pertama. |
| `ADD_LINE_MATERIAL` | material id not in `material_catalog` | Material tidak ditemukan di katalog. |
| `ADD_LINE_ASSET` | `material_catalog.is_asset = true` | Alat/aset dicatat di tab Alat, bukan di rencana material. |
| `ADD_LINE_TIER1` | `material_catalog.tier = 1` | Material Tier 1 harus lewat file SANO Input (butuh area kerja). |
| `ADD_LINE_UNIT` | `material_catalog.unit` blank | Satuan material di katalog kosong. Perbaiki katalog dulu. |
| `ADD_LINE_EXISTS` | material already has a line in the current master (any `boq_item_id`) | Material sudah ada di rencana. Ubah jumlah lewat re-publish. |
| `ADD_LINE_QTY` | `p_planned_qty` null or `<= 0` | Jumlah rencana harus lebih dari 0. |
| `ADD_LINE_PRICE_REQUIRED` | tier = 3 and price null | Tier 3 adalah anggaran Rupiah: harga satuan wajib diisi. |
| `ADD_LINE_PRICE` | price provided and `<= 0` | Harga satuan harus lebih dari 0. |
| `ADD_LINE_RACE` | latest master changed during the call | Rencana proyek berubah saat menyimpan (ada publish lain). Coba lagi. |
| `ADD_LINE_PUBLISH_IN_PROGRESS` | current `ahs_versions.is_current` id ≠ latest master's `ahs_version_id` (publish mid-flight or interrupted; checked before any write) | Ada publish yang sedang berjalan atau terputus untuk proyek ini. Selesaikan atau ulangi publish dari file master, lalu coba lagi. |

Access rule (deliberate): office roles for ANY project, because `is_office_role()` (036:33-45) is global, so `assert_project_access` cannot fail for a caller who passed `ADD_LINE_AUTH`; it stays as belt-and-suspenders. Service role / Dashboard (`auth.uid() IS NULL`) is allowed, matching 061:99-102, 079:159-162, 088:421; `published_by` is then NULL, which `plan_revisions` permits.

Current master = `ORDER BY created_at DESC, id DESC LIMIT 1` (the 084/094 tiebreak). Current version = `ahs_versions WHERE project_id = p_project_id AND is_current`, falling back to the master's `ahs_version_id`.

### 4.3 Concurrency

(a) Two adds of the same material: the `ADD_LINE_EXISTS` probe is a read and the lines table had no unique key, so under READ COMMITTED both would insert and `v_material_envelopes` would `SUM` a doubled ceiling. The function takes `pg_advisory_xact_lock(hashtextextended(p_project_id::text, 0))` before the probe, and the partial unique index (4.1) backs it.

(b) An add racing a re-publish: publish inserts its new master from the client (`publishBaselineV2.ts:1481-1484`), so it takes no lock this function could share, and `FOR UPDATE` on the current master cannot block the INSERT of a newer one. After the line is inserted the function re-reads the latest master id and raises `ADD_LINE_RACE` if it moved. Best-effort: a publish committing after the re-read is invisible under READ COMMITTED; the residual window is milliseconds and the audit row plus the publish-time guard still surface the outcome. Losing loudly beats a plan line no reader can see (every reader scopes to latest master: 084:224-229, 094:277-283, 094:310-315).

(c) The wider publish window: publish flips `is_current` and inserts the new `ahs_versions` row several round-trips before it inserts the new master. While the current version and the latest master disagree, or forever if publish crashed between them, the function raises `ADD_LINE_PUBLISH_IN_PROGRESS` before writing anything. Projects published before migration 032 have no `is_current` row and skip this check.

### 4.4 Writes (single transaction)

1. `project_material_master_lines` — `{master_id, material_id, boq_item_id: NULL, planned_quantity, unit: material_catalog.unit}`. Unit is read server-side from the catalogue (base unit; rebar would be kg, but Tier 1 is refused so this is mostly moot), never trusted from the client.
2. `ahs_price_book` — when a price is given: if a row exists for `(project_id, material_id)` UPDATE `unit_price, unit, tier, material_name, effective_from = now()`; else INSERT. UPDATE rather than a second row because `v_material_budget_status` picks `ORDER BY effective_from DESC LIMIT 1` (047:75-82), non-deterministic on ties. `price_book_written` reports which happened (`'inserted' | 'updated' | 'skipped'`).
3. `material_baseline_snapshots` — INSERT `ON CONFLICT (project_id, material_id) DO NOTHING`. First-publish-wins: if the material existed in a PRIOR master and was removed since, the old baseline stands and Signal-2 drift may show at once. `snapshot_written` reports it so the UI can say so.
4. `plan_revisions` — `{project_id, old_ahs_version_id: v, new_ahs_version_id: v, published_by: auth.uid(), acknowledged_at: now(), summary}` where summary carries the full `PlanRevisionSummary` numeric keys (`added: 1`, all others 0, `warningCount: 0`) plus `kind: 'INCREMENTAL_ADD', material_id, material_name, unit, tier, planned_after, unit_price, note`. Same version id on both sides records "revision within the current version"; no new `ahs_versions` row is minted.
5. `plan_revision_lines` — `{revision_id, material_id, planned_before: 0, planned_after, ordered_at_time: 0, requested_at_time: 0, classification: 'ADDED'}`.
6. `notify_plan_revised(p_project_id, revision_id, 'Material baru ditambahkan ke rencana: <name> <qty> <unit>', 0)` — supervisors get PLAN_REVISED; principal not pinged (raise count 0). Wrapped non-fatally: a notification failure never rolls back the line; the result reports `notified: false` and the UI tells the estimator to inform supervisors directly.

No triggers exist on any of these tables (all 30 `CREATE TRIGGER` sites checked), so no double-notify.

Ceiling gate (`assert_ceiling_raise_gate`) is not called: a material absent from the current master has no envelope row and cannot be an overage-absolving raise (079:207-213 requires `total_planned > 0`); materials already present are refused. The header comment states this.

### 4.5 Not durable across re-publish

Publish rebuilds master lines from the file alone and deletes the project's price book when the file carries Others rows. The estimator MUST append the row to the project's SANO Input master file; otherwise the next publish drops it. The RPC header, the UI success message, and the guide all say this. The publish-time guard (6.3) makes the omission loud.

Hygiene: `SET search_path = public`, `REVOKE ALL ... FROM PUBLIC; GRANT EXECUTE ... TO authenticated, service_role`, idempotent (`CREATE OR REPLACE`; `DROP FUNCTION IF EXISTS` of the same signature first is unnecessary and avoided so grants survive). Ends with self-check queries in the 094 style.

## 5. Client module `tools/addProjectMaterialLine.ts`

- `validateAddLineInput({ materialId, tier, isAsset, unit, plannedQty, unitPrice })` → `{ ok: true }` or `{ ok: false, code, message }`; mirrors the server guards so the form refuses before the round trip. Pure.
- `addProjectMaterialLine(client, input)` → `client.rpc('add_project_material_line', {...})`; returns the jsonb result typed as `AddProjectMaterialLineResult`.
- `mapAddLineError(err)` → Indonesian message by prefix; unknown → the raw message (never swallow). Also maps the unique-index violation (`uq_pmml_project_level_material`) to the `ADD_LINE_EXISTS` copy.
- `findIncrementalAddsMissingFromStaging(revisions, stagedMaterialIds)` → list of `{material_id, material_name}` from `plan_revisions.summary` rows with `kind = 'INCREMENTAL_ADD'` whose material is absent from the staged rows. Pure.

## 6. UI (BaselineScreen)

### 6.1 Card

In the `sessions` view, below the upload card, shown only when the project has a current master. The screen's existing `fetchCurrentMaster` returns `{isRepublish, lines}` without an id and runs only inside publish, so the card has its own state: `currentMasterId` loaded by an effect on project change (`project_material_master` select `id` order `created_at desc, id desc` limit 1).

Card title "Tambah material proyek", hint: "Untuk satu material baru Tier 2/3/4 tanpa area kerja. Perubahan jumlah, penghapusan, atau material Tier 1 tetap lewat re-publish file SANO Input."

### 6.2 Inline form

- Cari material: search over `material_catalog` (`is_asset = false`) by name, code, and alias (`material_aliases`), showing tier badge and base unit. Tier 1 rows render disabled with "lewat file SANO Input".
- Jumlah rencana (numeric) with the unit label read-only ("satuan dasar katalog").
- Harga satuan (Rp); label adds "wajib untuk Tier 3".
- Catatan (optional).
- Submit → success toast "Material ditambahkan ke rencana. Supervisor diberi tahu." followed by a persistent inline notice: "Tambahkan juga baris ini ke file master SANO Input proyek. Re-publish hanya membaca file." When `snapshot_written` is false, append "Baseline awal material ini sudah pernah dicatat; angka drift mengikuti baseline lama."

### 6.3 Publish-time guard

Before `computePlanRevisionDiff` in `handlePublish` on a re-publish: load `plan_revisions` for the project where `summary->>'kind' = 'INCREMENTAL_ADD'` and `new_ahs_version_id` = the current version; compute missing materials against the staged rows' resolved material ids. If any, show a blocking confirm listing them: "Material berikut ditambahkan lewat Tambah material proyek tetapi tidak ada di file yang diunggah. Lanjut publish berarti material ini dihapus dari rencana." Buttons: "Batal" / "Lanjut, hapus dari rencana". Cancel aborts publish.

### 6.4 Panduan fix

Replace the sentence pointing at "Catatan Perubahan" with: mid-project single material → "Tambah material proyek"; quantity, removal, Tier 1, mutu beton → re-publish from the master file.

## 7. Error handling

RPC raises are surfaced after prefix mapping. Because it is an RPC, the RLS "0 rows, no error" silent no-op cannot occur. A network failure after commit is handled by `ADD_LINE_EXISTS` on retry (loud, no duplicate). `ADD_LINE_RACE` tells the estimator to retry after the concurrent publish finishes.

## 8. Testing

- `tools/__tests__/migration095.test.ts` — static guards on the SQL text: `SECURITY DEFINER`; `SET search_path = public`; every prefix present; `pg_advisory_xact_lock`; the partial unique index with `WHERE boq_item_id IS NULL`; `ON CONFLICT (project_id, material_id) DO NOTHING`; latest-master `ORDER BY created_at DESC, id DESC`; `classification` `'ADDED'`; `notify_plan_revised` called with raise count 0; `boq_item_id` NULL literal in the insert; no `DELETE FROM ahs_price_book`; no `assert_ceiling_raise_gate` call; REVOKE/GRANT lines; the re-read race check.
- `tools/__tests__/addProjectMaterialLine.test.ts` — validation matrix (tier 1, asset, blank unit, qty ≤ 0, tier-3 without price, negative price, valid tier 2 without price, valid tier 3), error mapping for every prefix, the unique-index violation, and an unknown error; `findIncrementalAddsMissingFromStaging` with present/missing/non-incremental revisions.
- Existing suite green; `tsc --noEmit` clean. Run jest from inside the worktree (`testPathIgnorePatterns` excludes `.claude/worktrees` from the main checkout).
- Manual after paste: add a Tier-3 line on a test project; confirm it appears in Permintaan Material Umum with a budget panel; supervisor PLAN_REVISED arrives; re-upload the old file and confirm the guard lists the material.

## 9. Deploy

Paste 095 in the Dashboard before deploying the app build. Depends on 036 (`is_office_role`), 061 (`assert_project_access`), 077, 078 (`notify_plan_revised`) being live, which they are. No re-paste hazards created.

## 10. Guide alignment

Estimator rule: one new Tier 2/3/4 material → Tambah material proyek, then append the same row to the master file. Anything else → re-publish from the project's single master file, appended rows only.
