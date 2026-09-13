# report-progress-analyze

Plan A of the report-driven progress spec
(`docs/superpowers/specs/2026-09-13-report-driven-progress-design.md`): links each
line of an issued client report to a published BoQ work-area row and a stage.
Stage `link` only; Plan B adds `prefill`.

`validate.ts` is a byte copy of `tools/reportLineDraftValidate.ts` and `cost.ts` a
byte copy of `../site-event-analyze/cost.ts`. Never edit the copies: edit the
source, then

    cp tools/reportLineDraftValidate.ts supabase/functions/report-progress-analyze/validate.ts
    cp supabase/functions/site-event-analyze/cost.ts supabase/functions/report-progress-analyze/cost.ts

`tools/__tests__/reportProgressTwins.test.ts` (jest, which CI runs) fails on drift.

Deno tests: `cd supabase/functions/report-progress-analyze && deno test`. CI does not run them.

## Secrets and limits

| Secret | Required | Default | Notes |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | yes | — | shared with site-event-analyze |
| `REPORT_PROGRESS_MODEL` | no | `claude-opus-5` | must accept a forced tool call and appear in `cost.ts`, else runs are recorded with `cost_usd` unknown |
| `REPORT_PROGRESS_DAILY_CAP` | no | `60` | link calls per project per Jakarta day, counted from `progress_ai_runs` |

The request is `{ "stage": "link", "report_id": "<uuid>", "force": false }`. The
function never writes progress; it writes `client_report_lines.ai_*` and one
`progress_ai_runs` row per call. Lines the supervisor already confirmed or
dismissed are never touched, `force` or not.

Trust order (same as site-event-analyze): CORS → POST → secrets → Authorization →
caller JWT → the report read through the caller's RLS → `is_project_member` or
`is_office_role` → only then the service role.

## Deploy

    supabase functions deploy report-progress-analyze --project-ref ufntlqvacjhmddwltcxf

`ANTHROPIC_API_KEY` is already set for site-event-analyze; secrets are project-wide.
Migration 101 must be pasted first (the function inserts into the tables it creates).
