# report-progress-analyze

Plan A of the report-driven progress spec
(`docs/superpowers/specs/2026-09-13-report-driven-progress-design.md`): links each
line of an issued client report to a published BoQ work-area row and a stage.
Stage `link` only; Plan B adds `prefill`.

`validate.ts` is a byte copy of `tools/reportLineDraftValidate.ts` and `cost.ts` a
byte copy of `../site-event-analyze/cost.ts` (its header therefore still talks
about `site_event_ai_runs` / `SITE_EVENT_MODEL`; the arithmetic is what is shared).
Never edit the copies: edit the source, then

    cp tools/reportLineDraftValidate.ts supabase/functions/report-progress-analyze/validate.ts
    cp supabase/functions/site-event-analyze/cost.ts supabase/functions/report-progress-analyze/cost.ts

`tools/__tests__/reportProgressTwins.test.ts` (jest, which CI runs) fails on drift.

Deno tests: `cd supabase/functions/report-progress-analyze && deno test`. CI does not run them.
`index.ts` holds only I/O; every rule with a decision in it lives in `context.ts`,
`prompt.ts`, `validate.ts`, `util.ts` and is tested there.

## Secrets and limits

| Secret | Required | Default | Notes |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | yes | — | shared with site-event-analyze |
| `REPORT_PROGRESS_MODEL` | no | `claude-opus-5` | must accept a forced tool call and appear in `cost.ts`, else runs are recorded with `cost_usd` unknown |
| `REPORT_PROGRESS_DAILY_CAP` | no | `60` | link calls per project per Jakarta day, counted from `progress_ai_runs` (failed and rejected runs count: money left) |

## Request and response contract

Request: `{ "stage": "link", "report_id": "<uuid>", "force": false }`.

- The function never writes progress. It writes `client_report_lines.ai_*` and one
  `progress_ai_runs` row per call. Lines the supervisor already confirmed or
  dismissed are never touched, `force` or not — every `ai_*` UPDATE carries
  `status = 'SUGGESTED'` in the statement.
- `ALREADY_LINKED` means the line rows already exist. That covers three states the
  client must tell apart by reading the lines: suggestions present (`ai_run_id`
  set), a run that failed before writing (`ai_model` NULL — the card shows
  "Jalankan AI"), or a run in flight. **A retry after a failure needs
  `force: true`**; a forced run only re-suggests lines still SUGGESTED.
- `LINK_IN_PROGRESS` (409): another call holds the report's lease
  (`client_progress_reports.link_claimed_at`, 2-minute TTL). Wait and reload.
- `NO_BOQ`: the project has no published rows; `CONTEXT` (500): a query failed —
  the two are never conflated.
- Photos are read only from this project's own folders (`client-report/<projectId>/`,
  `daily-log/<projectId>/`, `site-media:site-events/<projectId>/`); anything else in
  the member-editable snapshot is counted as `photos_out_of_scope` and never read.
- Quotes validate against the frozen `client_report_lines.line_text`, which is also
  what the prompt shows — a snapshot edited after issue cannot move the target.

Trust order (same as site-event-analyze): CORS → POST → secrets → Authorization →
caller JWT → the report read through the caller's RLS → `is_project_member` or
`is_office_role` → only then the service role.

## Deploy

    supabase functions deploy report-progress-analyze --project-ref ufntlqvacjhmddwltcxf

`ANTHROPIC_API_KEY` is already set for site-event-analyze; secrets are project-wide.
Migration 101 must be pasted first (the function inserts into the tables it creates
and takes the lease column it adds).
