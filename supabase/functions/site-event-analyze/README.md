# site-event-analyze

Turns one room capture (photos, voice note, typed note) into a draft site event.

`validate.ts` is a copy of `tools/siteEventDraftValidate.ts`, the source of truth.
Never edit the copy: edit the source, then
`cp tools/siteEventDraftValidate.ts supabase/functions/site-event-analyze/validate.ts`.
`tools/__tests__/siteEventDraftValidateTwin.test.ts` (jest, which CI runs) fails on
any drift, and also pins the quota message and the draft tool schema.

Deno tests: `cd supabase/functions/site-event-analyze && deno test`. CI does not run them.

Secrets: `OPENAI_API_KEY` (transcription), `ANTHROPIC_API_KEY` (analysis), optional
`SITE_EVENT_MODEL` to override the Claude model (`cost.ts` says what a new one must satisfy).

## Secrets and limits

| Secret | Required | Default | Notes |
|---|---|---|---|
| `OPENAI_API_KEY` | yes | — | transcription |
| `ANTHROPIC_API_KEY` | yes | — | analysis |
| `SITE_EVENT_MODEL` | no | `claude-sonnet-5` | `cost.ts` says what a new model must satisfy |
| `SITE_EVENT_DAILY_CAP` | no | `200` | analyses per project per Jakarta day |

`SITE_EVENT_DAILY_CAP` is parsed strictly (`util.ts` `parseDailyCap`): digits
only, at least 1. A malformed or empty value logs once at module load and uses
the default — it never becomes `NaN` (which would silently remove the cap) or
`0` (which would refuse every analysis). The count is read **before** the
attempt is claimed, so a quota block never shows up as a failed AI attempt.
Across different events the cap is soft: simultaneous calls all read the count
before any of them inserts a run row, so it can overshoot by roughly the
concurrency.

## Deadline

One budget for the whole invocation: `DEADLINE_MS` 110 s, of which
transcription may take at most 45 s and the analysis at most 90 s, and each
call gets whatever is smaller — its own budget or what is left. Below 20 s
remaining the function refuses to call Claude at all. A call cut short by the
deadline writes its `site_event_ai_runs` row with `error: 'timeout'` and the
usual `last_error` update, so a killed isolate is never the only record.

A 429 / 529 / 5xx from either provider is retried **once** after a short
backoff (`retry-after` when given, capped at 5 s), and only when the deadline
leaves room; `input_summary.provider_attempts` records how many calls were made.

Aborts that happen after the attempt is claimed but before either provider is
called (context load failure, no readable photo, no time left) release the claim
with the mirror of its compare-and-swap, so `analysis_attempts` only ever counts
calls the model actually saw.
