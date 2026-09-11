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
