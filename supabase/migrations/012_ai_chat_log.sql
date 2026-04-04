-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 012 — AI Chat Usage Log
-- Records every AI assistant interaction for auditing and cost tracking.
-- Table is append-only; the app only INSERTs, never updates or deletes rows.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.ai_chat_log (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id     uuid        REFERENCES public.projects(id) ON DELETE SET NULL,
  user_id        uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  model          text        NOT NULL CHECK (model IN ('haiku', 'sonnet')),
  input_tokens   integer     NOT NULL DEFAULT 0 CHECK (input_tokens  >= 0),
  output_tokens  integer     NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  user_role      text        NOT NULL DEFAULT '',
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- ── Indexes ───────────────────────────────────────────────────────────────────

-- Usage report: costs per project/month
CREATE INDEX IF NOT EXISTS ai_chat_log_project_created
  ON public.ai_chat_log (project_id, created_at DESC);

-- Usage report: costs per user
CREATE INDEX IF NOT EXISTS ai_chat_log_user_created
  ON public.ai_chat_log (user_id, created_at DESC);

-- ── Row-Level Security ────────────────────────────────────────────────────────

ALTER TABLE public.ai_chat_log ENABLE ROW LEVEL SECURITY;

-- Users can only INSERT their own rows (logging only — no SELECT, UPDATE, DELETE)
CREATE POLICY "ai_chat_log_insert_own"
  ON public.ai_chat_log
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users can read their own usage history
CREATE POLICY "ai_chat_log_select_own"
  ON public.ai_chat_log
  FOR SELECT
  USING (auth.uid() = user_id);

-- Admins and principals on the same project can read all project logs
-- (for cost oversight; role is on profiles, not project_assignments)
CREATE POLICY "ai_chat_log_select_project_admin"
  ON public.ai_chat_log
  FOR SELECT
  USING (
    project_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.project_assignments pa
      JOIN public.profiles pr ON pr.id = auth.uid()
      WHERE pa.project_id = ai_chat_log.project_id
        AND pa.user_id    = auth.uid()
        AND pr.role       IN ('admin', 'principal', 'estimator')
    )
  );

-- ── Comment ───────────────────────────────────────────────────────────────────

COMMENT ON TABLE public.ai_chat_log IS
  'Append-only log of SANO AI assistant interactions. Used for token cost tracking and usage auditing. Rows are never modified after insertion.';
