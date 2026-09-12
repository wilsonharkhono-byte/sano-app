-- ═══════════════════════════════════════════════════════════════════════════
-- 100 - Confirming a VO re-checks its evidence against the transcript.
--
-- Spec: docs/superpowers/specs/2026-09-10-room-site-events-design.md §1.1, §4.2
-- Plan: docs/superpowers/plans/2026-09-10-site-event-capture-ai.md (task 13)
-- Decision: the user's, 2026-09-12, after the plan 2 fix pass shipped the
-- client-side block and left the server trusting the stored draft.
--
-- WHY. confirm_site_event (097) accepts a VO when ai_draft.vo.flag is
-- 'suggested' and ai_draft.vo.evidence_quotes is a non-empty array. It never
-- asks whether those quotes are still IN the transcript the human is
-- confirming. The edge function checked that when it WROTE the draft
-- (tools/siteEventDraftValidate.ts, isLiteralQuote), and
-- workflows/screens/siteEvent/confirmModel.ts staleVoQuotes checks it again in
-- the form - but a supervisor who edits the transcript, a direct PostgREST RPC
-- call, an older app build, or any future client is not bound by either. The
-- claim that reaches Catatan Perubahan, and from there an estimator's price,
-- has to be one the database itself can still point at. So the check moves to
-- where it cannot be skipped.
--
-- THE RULE, AND WHY IT IS "AT LEAST ONE" AND NOT "ALL". The validator that
-- built the draft DROPS a quote that does not match and downgrades the VO to
-- 'none' only when NONE survive (validateSiteEventDraft, filterQuotes). This
-- file implements the same rule at confirm time: each quote is re-checked, the
-- survivors are kept, and the VO is refused only when zero survive. The
-- site_changes row then records the SURVIVORS - the change_type keyword match
-- and the description read v_quotes after the filter, so a quote that no
-- longer exists can no longer steer a classification or be quoted at an
-- estimator. Refusing the whole VO because one of five quotes lost a word to
-- a transcript edit would be a different, harsher rule than the one the
-- pipeline already documents, and would refuse work a human can see is real.
--
-- The refusal re-uses the EXISTING code, SITE_EVENT_VO_NO_EVIDENCE, with the
-- existing sentence extended by "(kutipan tidak lagi ada di transkrip)".
-- tools/siteEvents.ts mapSiteEventRpcError matches on the `CODE:` prefix, so
-- the Indonesian copy the supervisor sees is unchanged and no new code has to
-- be added to RPC_ERROR_COPY. 100 introduces no new SITE_EVENT_* code.
--
-- WHAT IS CHECKED, AND AGAINST WHAT. The haystack is the transcript this
-- confirm is about to PERSIST - COALESCE(v_edited, transcript_edited,
-- transcript), the same expression that feeds the row's quoted excerpt - plus
-- the supervisor's typed note (raw_text) as a SECOND haystack. Two haystacks,
-- not one concatenated string: isLiteralQuote() asks sources.some(), so
-- "transcript || ' ' || note" would accept a quote straddling the join that
-- the validator and the form both reject.
--
-- HOW THE TWO NORMALISERS ARE KEPT IN STEP. site_event_norm_quote() below
-- mirrors normalizeForQuoteMatch() in tools/siteEventDraftValidate.ts step for
-- step. tools/__tests__/migration100.test.ts extracts the character classes
-- from the SQL text and compares them with the set of code points the TS
-- function actually folds (derived by running it, not by copying a list), so
-- the day one side gains a fold and the other does not, CI says so. Six parity
-- fixtures are in the self-check footer: paste them and every one must be true.
--
-- PASTE ORDER. AFTER 097, 098 and 099. It re-creates 097's confirm_site_event
-- verbatim plus the re-check, so pasting it before 097 leaves a function whose
-- table (site_events), helpers (is_project_member, is_office_role) and
-- notification type (098) do not exist yet.
--
-- PREREQUISITE. This Postgres must be >= 13: site_event_norm_quote() calls
-- normalize(text, form), added in PG 13, for the NFC fold that has to match
-- TypeScript's `.normalize('NFC')`. There is no SQL guard for this - an older
-- Postgres fails loudly at paste time (check_function_bodies rejects the
-- unknown function), which is the same failure mode as any other missing
-- prerequisite below, so it is stated rather than defended against.
--
-- RE-PASTE SAFETY. Two CREATE OR REPLACE FUNCTIONs, each preceded by its own
-- DROP FUNCTION IF EXISTS by full signature (092's pattern, carried over from
-- 097: CREATE OR REPLACE cannot change a parameter list, so the day either
-- signature moves the old overload must not survive carrying the GRANT - or,
-- for the helper, survive as a second, ambiguous overload), one REVOKE and
-- one GRANT for confirm_site_event, one REVOKE and no GRANT for the helper,
-- and no DDL on any table, view, policy or trigger: a second paste is a
-- no-op. SET/RESET lock_timeout bracket every statement.
--
-- WHAT A RE-PASTE OF AN EARLIER FILE UNDOES. 097 still carries its own
-- confirm_site_event. Re-pasting 097 after this file REVERTS the re-check -
-- silently, because the function still exists and still works. That is the
-- same hazard 099 documents for update_site_event_assignment. If you re-paste
-- 097, re-paste 100 after it. migration100.test.ts fails if any migration
-- numbered above 100 redefines confirm_site_event without this file being
-- brought up to date.
-- ═══════════════════════════════════════════════════════════════════════════

SET lock_timeout = '5s';

-- ───────────────────────────────────────────────────────────────────────────
-- 1. site_event_norm_quote - the SQL twin of normalizeForQuoteMatch()
--
--    Order matters and is the TS order: NFC, strip the invisibles, fold
--    apostrophes, fold double quotes, fold dashes, lower-case, collapse
--    whitespace, trim. The innermost call is the first step.
--
--    The regex classes are written in PLAIN single-quoted strings, not E''
--    strings, on purpose: in an E'' string the parser turns \u2018 into the
--    character itself, which would leave an invisible byte in this file that
--    no static test could read. In a plain string (standard_conforming_strings
--    = on, the default) the backslash survives the parser and the regex engine
--    resolves \u2018 itself - so the class stays readable text, and
--    migration100.test.ts can compare it with what the TS regexes fold.
--
--    Whitespace is spelled out rather than written '\s+'. Postgres's \s is
--    [[:space:]], which is locale-dependent and does not agree with
--    JavaScript's \s at the edges (U+00A0 and U+FEFF are whitespace to
--    JavaScript; U+180E was to older locales and is not to JavaScript); an
--    explicit class is the only way for both sides to collapse exactly the
--    same set. btrim's default trims spaces only, which is all that can be
--    left after the collapse.
--
--    IMMUTABLE: normalize(), lower(), regexp_replace() and btrim() are all
--    immutable, so this is too. VOLATILE would be a lie about a pure text
--    function and would forbid its use in an index or a generated column
--    later. SECURITY INVOKER (explicit): it reads no table and needs no
--    privilege of its own. Its only caller is confirm_site_event, which is
--    SECURITY DEFINER and therefore runs as this function's owner, so it
--    needs NO grant at all - PUBLIC's default EXECUTE is revoked and nothing
--    replaces it. A client cannot call it, and does not need to.
-- ───────────────────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS site_event_norm_quote(TEXT);

CREATE OR REPLACE FUNCTION site_event_norm_quote(p_text TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT btrim(
    regexp_replace(
      lower(
        regexp_replace(
          regexp_replace(
            regexp_replace(
              regexp_replace(
                normalize(COALESCE(p_text, ''), NFC),
                '[\u200B-\u200D\u00AD\u2060\u200E\u200F]', '', 'g'
              ),
              '[\u2018\u2019\u02BC]', '''', 'g'
            ),
            '[\u201C\u201D]', '"', 'g'
          ),
          '[\u2010-\u2015]', '-', 'g'
        )
      ),
      '[\u0009-\u000D\u0020\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]+', ' ', 'g'
    ),
    ' '
  );
$$;

REVOKE ALL ON FUNCTION site_event_norm_quote(TEXT) FROM PUBLIC, anon, authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- 2. confirm_site_event - 097 §7 verbatim, plus the VO evidence re-check
--
--    Everything outside the p_vo_confirm branch is 097's text unchanged: the
--    same signature, the same row lock, the same refusals in the same order,
--    the same narrow UPDATE, the same notification wrapper and the same
--    v_notified read-back bounded to this transaction. Only the branch that
--    turns a suggested VO into a Catatan Perubahan row is different, and only
--    by the filter below.
-- ───────────────────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS confirm_site_event(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, DATE, TEXT, BOOLEAN, BOOLEAN, UUID, TEXT
);

CREATE OR REPLACE FUNCTION confirm_site_event(
  p_event_id          UUID,
  p_event_type        TEXT,
  p_gate_code         TEXT,
  p_step_code         TEXT,
  p_title             TEXT,
  p_summary           TEXT,
  p_owner_id          UUID,
  p_due_date          DATE,
  p_downstream_impact TEXT,
  p_is_blocking       BOOLEAN,
  p_vo_confirm        BOOLEAN,
  p_related_event_id  UUID,
  p_transcript_edited TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid         UUID := auth.uid();
  v_ev          site_events%ROWTYPE;
  v_room        rooms%ROWTYPE;
  v_title       TEXT := btrim(COALESCE(p_title, ''));
  v_summary     TEXT := NULLIF(btrim(COALESCE(p_summary, '')), '');
  v_impact      TEXT := NULLIF(btrim(COALESCE(p_downstream_impact, '')), '');
  v_edited      TEXT := NULLIF(btrim(COALESCE(p_transcript_edited, '')), '');
  v_today       DATE := (now() AT TIME ZONE 'Asia/Jakarta')::date;
  v_step_gate   TEXT;
  v_ai_used     BOOLEAN;
  v_vo_flag     TEXT;
  v_change_id   UUID;
  v_change_type TEXT;
  v_quotes      JSONB;
  v_kept        JSONB;
  v_hay_text    TEXT;
  v_hay_note    TEXT;
  v_evidence    TEXT;
  v_excerpt     TEXT;
  v_location    TEXT;
  v_notified    BOOLEAN := FALSE;
BEGIN
  SELECT * INTO v_ev FROM site_events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'SITE_EVENT_NOT_FOUND: kejadian % tidak ditemukan', p_event_id;
  END IF;

  IF v_uid IS NULL AND COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'SITE_EVENT_AUTH: sesi tidak dikenali'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF v_uid IS NOT NULL AND NOT (is_project_member(v_ev.project_id) OR is_office_role()) THEN
    RAISE EXCEPTION 'SITE_EVENT_AUTH: Anda tidak ditugaskan ke proyek ini'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- A draft, or a pending event the supervisor chose to author by hand.
  IF v_ev.status NOT IN ('pending_analysis', 'draft') THEN
    RAISE EXCEPTION 'SITE_EVENT_STATE: kejadian berstatus % dan tidak bisa dikonfirmasi', v_ev.status;
  END IF;
  v_ai_used := v_ev.ai_draft IS NOT NULL;

  IF p_event_type IS NULL
     OR p_event_type NOT IN ('progres', 'isu', 'hambatan', 'cacat', 'butuh_keputusan', 'info') THEN
    RAISE EXCEPTION 'SITE_EVENT_TYPE: jenis kejadian tidak valid (%)', p_event_type;
  END IF;
  IF char_length(v_title) = 0 OR char_length(v_title) > 80 THEN
    RAISE EXCEPTION 'SITE_EVENT_TITLE: judul wajib 1 sampai 80 karakter';
  END IF;
  IF v_summary IS NOT NULL AND char_length(v_summary) > 300 THEN
    RAISE EXCEPTION 'SITE_EVENT_SUMMARY: ringkasan maksimal 300 karakter';
  END IF;
  IF v_impact IS NOT NULL AND char_length(v_impact) > 300 THEN
    RAISE EXCEPTION 'SITE_EVENT_IMPACT: dampak lanjutan maksimal 300 karakter';
  END IF;

  IF p_gate_code IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM gate_refs WHERE code = p_gate_code AND active) THEN
    RAISE EXCEPTION 'SITE_EVENT_GATE: gerbang % tidak aktif atau tidak ada', p_gate_code;
  END IF;
  -- The step must sit under the chosen gate. site_events_step_needs_gate and
  -- site_events_step_in_gate would refuse a bad pair at the UPDATE below, but
  -- with a raw constraint error; these say it in words first. A step's
  -- gate_code never changes (096), so this answer cannot go stale.
  IF p_step_code IS NOT NULL AND p_gate_code IS NULL THEN
    RAISE EXCEPTION 'SITE_EVENT_STEP_NOT_IN_GATE: langkah "%" dipilih tanpa gerbang. Pilih gerbangnya dulu.', p_step_code;
  END IF;
  IF p_step_code IS NOT NULL THEN
    SELECT gate_code INTO v_step_gate FROM gate_step_refs WHERE code = p_step_code AND active;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'SITE_EVENT_STEP: langkah "%" tidak aktif atau tidak ada', p_step_code;
    END IF;
    IF v_step_gate <> p_gate_code THEN
      RAISE EXCEPTION 'SITE_EVENT_STEP_NOT_IN_GATE: langkah "%" bukan bagian dari gerbang %.', p_step_code, p_gate_code;
    END IF;
  END IF;

  IF p_event_type IN ('isu', 'hambatan', 'cacat', 'butuh_keputusan')
     AND (p_owner_id IS NULL OR p_due_date IS NULL) THEN
    RAISE EXCEPTION 'SITE_EVENT_OWNER_REQUIRED: jenis % wajib punya pemilik dan tenggat', p_event_type;
  END IF;
  -- Owner is a project team member (spec §2 decision 5), which is also what
  -- enqueue_notification_user needs to deliver anything at all.
  IF p_owner_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM project_assignments WHERE project_id = v_ev.project_id AND user_id = p_owner_id
  ) THEN
    RAISE EXCEPTION 'SITE_EVENT_OWNER_NOT_MEMBER: pemilik harus anggota tim proyek';
  END IF;
  IF p_due_date IS NOT NULL AND p_due_date < v_today THEN
    RAISE EXCEPTION 'SITE_EVENT_DUE: tenggat % sudah lewat', p_due_date;
  END IF;

  IF p_related_event_id IS NOT NULL AND (
    p_related_event_id = p_event_id
    OR NOT EXISTS (
      SELECT 1 FROM site_events WHERE id = p_related_event_id AND project_id = v_ev.project_id
    )
  ) THEN
    RAISE EXCEPTION 'SITE_EVENT_RELATED: kejadian terkait harus kejadian lain di proyek yang sama';
  END IF;

  SELECT * INTO v_room FROM rooms WHERE id = v_ev.room_id;

  IF p_vo_confirm THEN
    -- The model does not get to assert a commercial claim it cannot point at.
    v_quotes := v_ev.ai_draft -> 'vo' -> 'evidence_quotes';
    -- Type first, in its own IF. jsonb_array_length raises a raw Postgres error
    -- on anything but an array - a draft carrying "evidence_quotes": null, a
    -- string, or an object - and that error reaches the client with no
    -- SITE_EVENT_ prefix for tools/siteEvents.ts to translate. SQL does not
    -- promise to evaluate the arms of an OR left to right, so the length test
    -- cannot ride along in the same condition.
    IF COALESCE(v_ev.ai_draft -> 'vo' ->> 'flag', 'none') <> 'suggested'
       OR v_quotes IS NULL
       OR jsonb_typeof(v_quotes) <> 'array' THEN
      RAISE EXCEPTION 'SITE_EVENT_VO_NO_EVIDENCE: VO hanya bisa dikonfirmasi bila ada kutipan dasar';
    END IF;
    IF jsonb_array_length(v_quotes) = 0 THEN
      RAISE EXCEPTION 'SITE_EVENT_VO_NO_EVIDENCE: VO hanya bisa dikonfirmasi bila ada kutipan dasar';
    END IF;

    -- 100: re-check every quote against the transcript the human is confirming.
    -- 097 trusted the stored ai_draft, so a quote the supervisor had since
    -- edited out of the transcript still confirmed a VO through a direct RPC
    -- call. v_excerpt is the text this confirm is about to PERSIST
    -- (transcript_edited = COALESCE(v_edited, transcript_edited) below), so the
    -- row's own quoted excerpt and this check read one expression, never two.
    -- The typed note is a SECOND haystack, not a concatenated one:
    -- isLiteralQuote() asks sources.some(), and "transcript || ' ' || note"
    -- would accept a quote straddling the join that the client rejects.
    v_excerpt := COALESCE(v_edited, v_ev.transcript_edited, v_ev.transcript);
    v_hay_text := site_event_norm_quote(COALESCE(v_excerpt, ''));
    v_hay_note := site_event_norm_quote(COALESCE(v_ev.raw_text, ''));

    -- The validator's own rule (tools/siteEventDraftValidate.ts): a quote that
    -- no longer matches is DROPPED, and only a VO with nothing left standing
    -- is refused. So: keep the survivors, refuse when none survive, and let
    -- the change_type keywords and the site_changes row see survivors only.
    -- position(needle IN haystack) and not LIKE: a needle carrying % or _ is
    -- an ordinary substring here, with nothing to escape and nothing to forget
    -- to escape. char_length >= 4 is DRAFT_QUOTE_MIN_CHARS, the same floor
    -- isLiteralQuote() applies to the NORMALISED needle, which also makes an
    -- empty needle (position('' IN x) = 1) impossible.
    SELECT COALESCE(jsonb_agg(k.quote ORDER BY k.ord), '[]'::jsonb)
      INTO v_kept
    FROM (
      SELECT e.quote, e.ord, site_event_norm_quote(e.quote) AS needle
      FROM jsonb_array_elements_text(v_quotes) WITH ORDINALITY AS e(quote, ord)
    ) AS k
    WHERE char_length(k.needle) >= 4
      AND (position(k.needle IN v_hay_text) > 0 OR position(k.needle IN v_hay_note) > 0);

    IF jsonb_array_length(v_kept) = 0 THEN
      RAISE EXCEPTION 'SITE_EVENT_VO_NO_EVIDENCE: VO hanya bisa dikonfirmasi bila ada kutipan dasar (kutipan tidak lagi ada di transkrip)';
    END IF;
    v_quotes := v_kept;

    SELECT btrim(regexp_replace(lower(COALESCE(string_agg(q, ' '), '')), '\s+', ' ', 'g'))
      INTO v_evidence
    FROM jsonb_array_elements_text(v_quotes) AS q;

    v_change_type := CASE
      WHEN p_event_type = 'butuh_keputusan' AND v_evidence ~ '(owner|klien|pemilik rumah|minta|permintaan)' THEN 'permintaan_owner'
      WHEN v_evidence ~ '(desain|desainer|gambar|revisi)' THEN 'revisi_desain'
      ELSE 'kondisi_lapangan'
    END;

    v_location := CASE
      WHEN v_room.floor IS NULL OR btrim(v_room.floor) = '' THEN v_room.room_name
      ELSE v_room.room_name || ' · ' || v_room.floor
    END;

    -- Pending, unpriced: the estimator prices it in the existing Catatan
    -- Perubahan review. Nothing about cost is decided here.
    INSERT INTO site_changes (
      project_id, location, description, photo_urls, change_type,
      needs_owner_approval, decision, reported_by
    ) VALUES (
      v_ev.project_id,
      v_location,
      COALESCE(v_summary, v_title)
        || CASE
             WHEN v_excerpt IS NULL THEN ''
             ELSE E'\n\nKutipan transkrip: "' || left(v_excerpt, 280)
                  || CASE WHEN char_length(v_excerpt) > 280 THEN '…"' ELSE '"' END
           END
        || E'\n\nSumber: kejadian lapangan ' || p_event_id::text,
      ARRAY(
        SELECT 'site-media:' || m.storage_path
        FROM site_event_media m
        WHERE m.event_id = p_event_id
          AND m.kind = 'photo'
          AND m.role IN ('context', 'closeup')
        ORDER BY (m.role <> 'context'), m.sort_order
      ),
      v_change_type,
      TRUE,
      'pending',
      v_ev.reporter_id
    )
    RETURNING id INTO v_change_id;
  END IF;

  v_vo_flag := CASE
    WHEN p_vo_confirm THEN 'confirmed'
    WHEN COALESCE(v_ev.ai_draft -> 'vo' ->> 'flag', 'none') = 'suggested' THEN 'rejected'
    ELSE 'none'
  END;

  UPDATE site_events SET
    event_type        = p_event_type,
    gate_code         = p_gate_code,
    step_code         = p_step_code,
    title             = v_title,
    summary           = v_summary,
    owner_id          = p_owner_id,
    due_date          = p_due_date,
    downstream_impact = v_impact,
    is_blocking       = COALESCE(p_is_blocking, FALSE),
    vo_flag           = v_vo_flag,
    site_change_id    = v_change_id,
    related_event_id  = p_related_event_id,
    transcript_edited = COALESCE(v_edited, transcript_edited),
    ai_used           = v_ai_used,
    status            = 'open',
    confirmed_at      = now()
  WHERE id = p_event_id;

  -- Spec §11: one notification type, to a different owner only, and a
  -- notification failure must never roll back the confirm.
  IF p_owner_id IS NOT NULL AND p_owner_id <> v_ev.reporter_id THEN
    BEGIN
      PERFORM enqueue_notification_user(
        v_ev.project_id,
        p_owner_id,
        'SITE_EVENT_ASSIGNED',
        left('Anda ditugaskan: ' || v_title || ' · ' || v_room.room_name, 200),
        CASE
          WHEN p_due_date IS NULL THEN 'Kejadian lapangan baru untuk Anda.'
          ELSE 'Tenggat ' || to_char(p_due_date, 'DD-MM-YYYY')
        END,
        'SiteEventDetail',
        jsonb_build_object('eventId', p_event_id, 'projectId', v_ev.project_id),
        p_event_id,
        ARRAY[v_uid]
      );
      -- enqueue_notification_user swallows nothing itself but inserts zero rows
      -- for a non-member; report what actually landed, not what was attempted.
      -- created_at >= now() bounds the read-back to THIS transaction: now() is
      -- transaction start and notifications.created_at defaults to now() (034),
      -- so a row this call enqueued passes and a row from an earlier confirm of
      -- the same event to the same owner - a re-confirm after a reopen, say -
      -- cannot be reported as this call's notification.
      v_notified := EXISTS (
        SELECT 1 FROM notifications n
        WHERE n.related_entity_id = p_event_id
          AND n.recipient_user_id = p_owner_id
          AND n.type = 'SITE_EVENT_ASSIGNED'
          AND n.created_at >= now()
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'confirm_site_event: notification failed: %', SQLERRM;
      v_notified := FALSE;
    END;
  END IF;

  RETURN jsonb_build_object(
    'event_id', p_event_id,
    'status', 'open',
    'vo_flag', v_vo_flag,
    'site_change_id', v_change_id,
    'ai_used', v_ai_used,
    'notified', v_notified
  );
END;
$$;

REVOKE ALL ON FUNCTION confirm_site_event(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, DATE, TEXT, BOOLEAN, BOOLEAN, UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION confirm_site_event(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, DATE, TEXT, BOOLEAN, BOOLEAN, UUID, TEXT) TO authenticated, service_role;

-- Close-out: every DDL statement is above this line. Hand a reused editor
-- connection back with its default lock timeout.
RESET lock_timeout;

SELECT proname, prosecdef, provolatile, has_function_privilege('anon', oid, 'EXECUTE') AS anon_exec
FROM pg_proc
WHERE proname IN ('confirm_site_event', 'site_event_norm_quote')
ORDER BY proname;

-- ═══════════════════════════════════════════════════════════════════════════
-- SELF-CHECK (run after pasting; checks 1-4 write nothing, check 5 ROLLBACKs
-- everything it writes, so no check leaves anything behind)
--
-- 1. The grid above already answers the first check:
--    EXPECTED: two rows. confirm_site_event with prosecdef = true,
--    provolatile = 'v', anon_exec = false; site_event_norm_quote with
--    prosecdef = false, provolatile = 'i', anon_exec = false.
--
-- 2. search_path is pinned on both:
--      SELECT proname, proconfig FROM pg_proc
--      WHERE proname IN ('confirm_site_event', 'site_event_norm_quote') ORDER BY proname;
--    EXPECTED: {search_path=public} on both rows.
--
-- 3. THE SIX PARITY FIXTURES. These are the same six pairs
--    tools/__tests__/migration100.test.ts feeds to the TypeScript
--    isLiteralQuote(), one per fold this normaliser performs. Paste as one
--    query:
--      SELECT site_event_norm_quote(E'Pak owner bilang \u2018pindah\u2019 sekarang')
--             = site_event_norm_quote('Pak owner bilang ''pindah'' sekarang')  AS apostrophe,
--             site_event_norm_quote(E'pla\u200Bfon belum ditutup')
--             = site_event_norm_quote('plafon belum ditutup')                  AS zero_width,
--             site_event_norm_quote(E'balok 2\u2013B dicor')
--             = site_event_norm_quote('balok 2-B dicor')                       AS en_dash,
--             site_event_norm_quote('OWNER Minta Dipindah')
--             = site_event_norm_quote('owner minta dipindah')                  AS mixed_case,
--             site_event_norm_quote(E'owner  minta\u00A0\tdipindah ')
--             = site_event_norm_quote('owner minta dipindah')                  AS spaces,
--             site_event_norm_quote(E'peke\u0301rjaan ulang')
--             = site_event_norm_quote(E'pek\u00E9rjaan ulang')                AS nfd_vs_nfc;
--    EXPECTED: one row, all six columns true. A false column means this
--    Postgres did not read the \u escapes in the classes above the way this
--    file assumes (check standard_conforming_strings = on) - and the
--    corresponding fold is NOT happening, so honest quotes will be refused.
--
-- 4. A stale quote is refused. Take a real event whose ai_draft suggests a VO,
--    and confirm it with a transcript that no longer contains any of its
--    quotes. Every check runs inside a session that HAS an identity - the SQL
--    editor is `postgres` with no JWT, so an un-wrapped call refuses at the
--    first guard with SITE_EVENT_AUTH before reaching the rule under test:
--      BEGIN;
--        SET LOCAL ROLE authenticated;
--        SELECT set_config('request.jwt.claims',
--               '{"sub":"<A_MEMBER_UUID>","role":"authenticated"}', true);
--        SELECT confirm_site_event('<DRAFT_EVENT_UUID>', 'butuh_keputusan', NULL, NULL,
--               'Uji VO', 'Uji VO', '<A_MEMBER_UUID>', current_date + 3, NULL,
--               false, true, NULL, 'transkrip baru tanpa kutipan apa pun');
--      ROLLBACK;
--    EXPECTED: ERROR  SITE_EVENT_VO_NO_EVIDENCE: ... (kutipan tidak lagi ada
--    di transkrip). Before 100 this call SUCCEEDED and wrote a site_changes
--    row.
--
-- 5. A quote that IS still there still confirms, and the row records the
--    survivors only - checked, and then undone, in ONE transaction, so this
--    check never commits a synthetic VO into live Catatan Perubahan. A
--    statement can always see what an earlier statement in the SAME
--    transaction wrote (that visibility is what "read your own writes" means;
--    only a DIFFERENT session is kept out until COMMIT), so the
--    site_change_id the first SELECT prints is there for the second SELECT to
--    read, and the ROLLBACK at the end discards both:
--      BEGIN;
--        SET LOCAL ROLE authenticated;
--        SELECT set_config('request.jwt.claims',
--               '{"sub":"<A_MEMBER_UUID>","role":"authenticated"}', true);
--        SELECT confirm_site_event('<DRAFT_EVENT_UUID>', 'butuh_keputusan', NULL, NULL,
--               'Uji VO', 'Uji VO', '<A_MEMBER_UUID>', current_date + 3, NULL,
--               false, true, NULL, '<a transcript containing one quote verbatim>');
--        -- EXPECTED: a JSON object with vo_flag = 'confirmed' and a non-null
--        -- site_change_id. Copy that id into the next statement, still inside
--        -- this same transaction.
--        SELECT change_type, left(description, 400) FROM site_changes
--        WHERE id = '<the site_change_id the previous SELECT just returned>';
--        -- EXPECTED: one pending row whose "Kutipan transkrip" is the
--        -- transcript passed above, and whose change_type was decided by the
--        -- surviving quote.
--      ROLLBACK;
--    EXPECTED (of the whole block): after the ROLLBACK, nothing from this
--    check exists - re-running the second SELECT outside the transaction
--    returns zero rows, and the draft event is still 'pending_analysis' or
--    'draft'. If a real, kept confirmation is what you actually want, replace
--    ROLLBACK with COMMIT deliberately; there is no DELETE to undo it with
--    afterwards (site_changes rows are never deleted by design - rule 3), so
--    that is a decision to make on purpose, not a leftover from testing.
--
-- 6. A client cannot call the helper directly (it needs no grant, because the
--    only caller runs as its owner):
--      SELECT has_function_privilege('authenticated', 'site_event_norm_quote(text)', 'EXECUTE');
--    EXPECTED: false.
--
-- 7. Re-paste this whole file.
--    EXPECTED: no error, and checks 3 and 4 still behave the same way.
-- ═══════════════════════════════════════════════════════════════════════════
