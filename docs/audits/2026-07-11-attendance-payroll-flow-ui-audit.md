# SANO Attendance → Payroll — Logic & UI Audit (Final Report)

Date: 2026-07-11 · Lead/Judge: Claude Fable 5 · Method: multi-agent (Sonnet enumeration/driving, Opus verification/judgment), spec confirmed by owner before auditing.
Scope: flow/logic correctness + field UX. Security explicitly out of scope (single-line appendix only).
Evidence stores: `scratchpad/live-dump.json` (redacted live data), `scratchpad/ui-audit/shots/` (77 screenshots), `scratchpad/ui-audit/audit-log.json`, manifests `audit-test-manifest*.json` (test data — deleted post-audit).

---

## 1. Confirmed spec audited against

Owner-ratified rules (2026-07-10/11). Calculation/flow: R1 day pay = snapshotted daily rate, absent = 0, no half-day; R2 OT entered as delta hours beyond normal day; R3 OT tiers by width — first (tier2−tier1) h at tier1 rate, rest tier2; R4 normal day is always 7 h; R5/R6 snapshots frozen at entry, rates effective-dated; R7 weekly harian gross = Σ day_total (Mon–Sat, statuses SUBMITTED+), retention 0 for harian; R8 net = GREATEST(0, net_to_date − prior_paid − kasbon), prior-paid isolated per payment mode; R9 one payment type per contract-week; R10 settlement only via opname approval; R11 separation of duties (record/confirm ≠ override ≠ approve); R12 only DRAFT editable in the field, corrections are audited office overrides; R13 one row per worker per day; R14 `worker_attendance_entries` is the source of truth — office reporting must read it; R15 recording window −14/+7 days IS intended; R17 absent ⇒ zero incl. OT; R18 harian verify blocked until allocation = 100 % (AI suggests, estimator confirms); R19 week = Mon–Sat, Sunday excluded; R20 all date logic intended in WIB; R21 payroll-support progress tags intended to connect to harian allocation; R22 offline store-and-auto-sync intended. UX: U1 near-tap-only daily entry; U2-REVISED presence must be EXPLICITLY marked — absent workers never silently paid; U3 one deliberate weekly Konfirmasi; U4 Excel round-trip is the bulk path; U5 clear non-destructive partial-failure feedback; U6 settled weeks lock, corrections office-side; U7 per-worker auditable breakdown at approval.
Left BLOCKED by owner (findings dependent on them are so marked): Q1 PRD scope contradiction; Q15 rejection-state intent; Q16 enrollment authority; Q17 max-OT cap intent.
Domain corrections established in Phase 0: no punch clock (day-based HOK), no GPS/photo on attendance, no worker self-enrollment (workers have no login), no offline queue, stack is Expo/React-Native-Web + Supabase (not Next.js).

## 2. Findings table

Legend: Type = Flow-bug / Design-flaw / State / UX-blocker / UX-friction. Confidence High unless noted. "CONFIRMED" = proven by hand-calc, live probe, or live UI reproduction.

| ID | Type | Sev | Location | Evidence | Expected vs actual | Fix | Conf |
|---|---|---|---|---|---|---|---|
| F1 | Flow-bug | **Critical** | live `record_worker_attendance_batch` (pre-020 version); repo `020_batch_attendance_bulk.sql:111,142` | Per-date RPC probe: 6/7 dates rejected ("hanya boleh untuk hari ini atau kemarin"); toast `s4-02` | R15 window −14/+7; actual = server-UTC today/yesterday only. Repo 020 implements the window but is un-appliable (inserts non-existent `created_by`/`updated_at`, omits NOT NULL `recorded_by`) — production never got it | Repair 020 (use `recorded_by`, drop phantom cols), apply via Dashboard; evaluate dates in WIB | High · CONFIRMED |
| F2 | State | **Critical** | `018:74-79` (no zero-fill), `019:184-189` guard; Excel import same path (`excelAttendanceImport.ts:280-306`) | ST-4 trace | Every worked day payable; actual: any day not saved by end of next UTC day is permanently unrecordable, silently absent from gross → mandor underpaid, nothing flags the gap, frozen after approval (F8) | F1 fix + per-week expected-vs-recorded day count surfaced in opname view | High · CONFIRMED |
| F3 | Design-flaw | **Critical** | `AttendanceScreen.tsx:187,278,597` | `s2-00` (21 ✓ on load) | U2: explicit marking; actual: presence assumed — forgotten toggle pays absent worker full day (+120–150 k/day/worker) | Default cells to neutral "belum ditandai" (counts 0); keep "Semua Hadir" as the explicit blanket assertion; block Konfirmasi on unmarked days | High · CONFIRMED |
| F4 | UX-blocker | **Critical** | `AttendanceScreen.handleSaveAll` (dirty cleared only when errors===0); Konfirmasi badge counts grid cells | S5c logs; `s5c-00` ("Konfirmasi (21)" vs 3 DB rows) | U3/U5: after any partial failure the Konfirmasi button is unreachable without a manual page reload, and its count is fabricated | Reconcile dirty per-day against server read-back; badge = persisted DRAFT count | High · CONFIRMED |
| F5 | UX-blocker / Flow-bug | High | UI: `AttendanceScreen` locks only on SETTLED; DB guard `019:246`/`020:144` correct | S5d: typed OT 9→6 on SUBMITTED row; UI showed "6j OT / Rp 1.200.000" success; DB kept 9; reload reverted (`s5d-03`) | R12/U6: DB immutability is intended; the UI accepting the edit and displaying success is a truth-honesty violation | Disable inputs from SUBMITTED onward + "Terkunci — koreksi lewat kantor" | High · CONFIRMED |
| F6 | Flow-bug | High | `workerAttendance.ts:320-326` (week_end=Sunday), `AttendanceScreen.tsx:68-77` (7 cols); `confirm_weekly_attendance` = Mon–Sat (`017:580`) | Live app-created header has Sunday week_end; grid `s2-00` | R19 Mon–Sat; actual Mon–Sun: Sunday defaults present, is inside the gross date range (individually-confirmed Sunday gets paid ≈ +1 crew-day), while weekly confirm strands Sunday DRAFTs (shown, never paid) | Align: render Mon–Sat and set week_end=Saturday (or extend confirm to +6 deliberately) | High code · Med money |
| F7 | State | High | `approve_opname` `018:232-254`; `recompute_harian_opname` `018:336-363` (no status gate) | ST-1/ST-2 SQL traces | Approve should pay the verified amount; actual: approve re-derives gross from live attendance (confirm/override in the verify→approve window changes PAID vs VERIFIED, unlogged); recompute callable on APPROVED headers mutates paid totals; late-confirmed entries in an approved week = permanently unsettleable/unpayable orphans | Freeze gross at verify (store + compare at approve); status-gate recompute; alert on post-approval in-week entries | High · CONFIRMED |
| F8 | State | High | RLS: `011:801-807` (no UPDATE/DELETE policy on opname_headers); no reject/cancel/unapprove RPC exists; FK `017:121` NO ACTION | ST-3 | Mis-approved week should be correctable; actual: lifecycle is one-way, settled entries pinned; only out-of-band SQL (after manually nulling `settled_in_opname_id`) can undo | Add an audited void/reverse RPC (admin/principal, with note) | High · CONFIRMED (whether a rejection *state* is wanted = BLOCKED Q15; the stuck-state risk is objective) |
| F9 | Flow-bug | High | `018:107-112` borongan prior_paid has no `payment_type` filter (harian branch `018:89-95` does) | SQL asymmetry | R8 isolation; actual: on a campuran contract, prior harian weeks' net_to_date is deducted from a borongan week → borongan underpaid by that amount | Add `AND payment_type='borongan'` | High SQL · money PLAUSIBLE (needs campuran data) |
| F10 | Flow-bug (regression) + Design-flaw | High | `018:205-264` approve_opname omits `settle_kasbon_for_opname` (added `014:298-312`, referenced nowhere after); clamp `018:125` | A2-5/A2-6 | Approved kasbon advances should be deducted & settled at approval; actual: never deducted unless `p_kasbon` passed manually, advance row stays APPROVED forever; and any kasbon > week's net is clamped away with no carryover — company loses the remainder | Reinstate ledger settlement in approve_opname; carry unrecovered kasbon into next week's deduction | High · CONFIRMED (regression), money PLAUSIBLE |
| F11 | UX-blocker | High | Header project picker (backdrop TouchableOpacity); default-project selection | `s1-01d` (supervisor lands on unrelated real client project); picker taps below fold swallowed (reproduced, admin) | U1: entry must start in the right context; actual: wrong project by default + the tap to fix it can silently fail → attendance recorded to wrong project or user gives up | Default to assigned project; restructure modal so backdrop sits behind a scrollable, fully tappable list | High · CONFIRMED |
| F12 | Design-flaw (gap) | High | `handleSaveAll:275-288` (7 sequential RPCs, no queue, state only in React) | R22 confirmed intent; offline probe `s5-03` | Intended store-and-auto-sync; actual: offline/failed saves are honestly reported but discarded — re-key everything; partial weeks possible mid-loop | Local per-day queue with visible "menunggu sinkron" state, auto-flush on reconnect | High · CONFIRMED |
| F13 | Design-flaw | Med | `019:184,187`, `020:44`, `DEFAULT CURRENT_DATE` on worker_rates/rules/kasbon; `now()` audit stamps | Empirical: Jakarta "today" (Sabtu 11 Juli) rejected while UTC was 07-10 | R20 WIB intent; actual UTC: before 07:00 WIB "today" is unsaveable/"future"; rates/rules created pre-07:00 WIB get effective_from a day early → wrong snapshot at boundaries | Evaluate dates at `(now() AT TIME ZONE 'Asia/Jakarta')::date` everywhere | High · CONFIRMED |
| F14 | Design-flaw (gap) | Med | `harian_cost_allocations` read only by Excel export (`opname.ts:1558`) | A2-9 | R21: allocations should feed BoQ labor costing; actual: display-only — per-BoQ cost-to-complete omits all harian labor | Wire allocations into the BoQ cost rollup (owner-confirmed direction) | High · CONFIRMED gap |
| F15 | Flow-bug | Med | `OfficeReportsScreen.tsx:336-341` (+ `approval_sla_user` in `tools/reports.ts:1246+`) read legacy `mandor_attendance` | Legacy table has 0 rows live | Q8 ruling: office reads `worker_attendance_entries`; actual: HOK card always zeros / SLA report blind to per-worker actions | Point both readers at the per-worker tables | High · CONFIRMED |
| F16 | UX-friction | Med | Attendance grid | Measured: OT input 36×22 px, presence pill 34×30 (padded ~52×62), 7 cols in 360 px | U1/U2: gloved/sunlit mis-tap flips presence or injects OT = wrong pay | ≥44 px targets; separate presence tap from OT entry | Med (sizes measured; mis-tap rate inferred) |
| F17 | Flow-bug | Low-Med | `tools/opname.ts:1483` selects `worker_name` from worker_attendance_entries (column doesn't exist) | Schema probe | Harian Excel export should list workers; actual: query likely 400s (or one merged row) | Join `mandor_workers` for names | Med · PLAUSIBLE (not runtime-tested) |
| F18 | State (latent) | Med | `020:130` INNER JOIN rates | ST-5 | If 020 is repaired/applied as-is: rate-less workers silently dropped from batch insert (unpaid, no error) — unlike live paths which RAISE loudly | Use LEFT JOIN + explicit RAISE on missing rate when fixing 020 | Med · PLAUSIBLE |
| F19 | State | Low | recompute only fires on create/submit/verify/approve | A2-12 | DRAFT opname gross can lag attendance edits (display only; verify/approve recompute) | Auto-refresh on open or show "recompute" affordance (exists: "Refresh Total dari Kehadiran") | High · CONFIRMED |
| F20 | UX-friction (minor) | Low | Opname detail header blank mandor name until refetch; `LaporanScreen` "Mandor" tab unreachable by any role (dead branch) | `s6-11`; RoleRouter analysis | Cosmetic + dead code | Populate from create response; delete dead branch | Med |

**Killed in adjudication:** "per-worker breakdown missing at approval" (proposed B2-9) — refuted by screenshot `s6-14` showing "DETAIL PER PEKERJA" cards with per-day status lines; U7 is SATISFIED. Its one valid residue (no missing-days flag) lives in F2.
**BLOCKED (need owner rulings):** duplicate same-person-across-contracts double-pay risk (Q16); max-OT-hours cap (Q17); whether a formal rejection state should exist (Q15 — F8 documents the mechanical consequence regardless); PRD scope wording (Q1).

## 3. Where payroll produces a WRONG NUMBER (real conditions)

1. **Underpayment, happening by construction (F1+F2):** any worker-day not saved by the end of the next UTC day can never be recorded; the week's gross silently omits it. With the app's own weekly-grid workflow, ~6 of 7 columns fail every save. The mandor is underpaid with zero indication.
2. **Overpayment of absent workers (F3):** the moment F1 is fixed, every save of an untouched default grid pays all workers full days. One forgotten toggle = +1 full daily rate.
3. **Sunday (F6):** an individually-confirmed Sunday adds an unintended crew-day to gross; a weekly-confirmed week shows Sunday as payable but strands it (displayed ≠ paid, both directions wrong).
4. **PAID ≠ VERIFIED (F7):** any confirm/override landing between verify and approve changes the approved amount, unverified and unlogged; recompute on an approved header rewrites paid totals.
5. **Campuran underpay (F9):** first campuran contract that mixes modes across weeks will under-net its borongan weeks by the prior harian nets.
6. **Kasbon (F10):** approved advances are never auto-deducted (mandor overpaid by the advance); any advance larger than a week's net is unrecoverable thereafter.
7. **WIB boundary (F13):** rates/rules created 00:00–07:00 WIB take effect a day early → wrong snapshots on that date.
8. **Displayed-wrong (F15):** office HOK dashboard always shows zeros regardless of real attendance.

**Positive assurance:** everywhere a number actually persisted, the arithmetic was exact — all 4 live cases and all UI-created rows reconciled to 0.00 Rp, including tier-crossing OT (9 h → 3×20k + 6×30k = 240,000 verified in DB) and both waterfall branches. The pay *math* is right; the failures are about **which rows exist and when state is allowed to change**.

## 4. Mandor abandonment / self-enrollment

Self-enrollment: N/A by design (workers have no login) — owner confirmed; not audited further.
Mandor verdict (UX judge, ratified by lead): **a resistant mandor would abandon this in week one.** The natural weekly entry fails with an unexplained "6 hari gagal disimpan" (F1), the hand-off button then vanishes until an undiscoverable page reload (F4), corrections after Konfirmasi silently lie (F5), and connectivity loss discards work (F12). Trust-killers even on the happy path: default-present pays no-shows (F3), Sunday displayed-but-never-paid (F6), wrong project preselected at login (F11). Preserved strengths to keep: honest offline failure, structurally impossible OT-on-absent, genuine SETTLED locks, Excel round-trip, live pay preview (double-edged for tracking-averse users — consider collapse toggle).
Priority order for adoption: F1/F4 (make the core loop completable) → F3 (explicit presence) → F5 (lock submitted cells) → F11 → F12.

## 5. Coverage gaps

- Live Postgres function bodies and pg_policies could not be introspected (no psql; PostgREST can't) — live RPC behavior established empirically, not by source diff.
- Not runtime-reproduced: Sunday pay-out (F6 money leg), campuran contamination (F9), kasbon regression (F10), OVERRIDDEN lifecycle, harian Excel export (F17), Excel *import* end-to-end, multi-supervisor true concurrency (reasoned from SQL semantics only).
- UI driven headless on an emulated 360×740 touch profile — no real device, sunlight, or user testing; friction judgments inferred from measured geometry and flow outcomes.
- Live dataset is a synthetic seed (uniform timestamps); organic-usage timing behavior unobserved.
- Assumed-domain features (punch clock, GPS, self-enrollment, offline queue) confirmed absent — audited as N/A, not as gaps except where the owner ruled otherwise (R22).

## 6. Delegation ledger

| Task | Model | Tool calls |
|---|---|---|
| Code-flow enumeration (Phase 0.1) | Sonnet | 69 |
| Intended-rule inference (Phase 0.2) | Opus | 13 |
| Live-data dump + trace selection (A1) | Sonnet | 34 |
| Hand-verification + static branches (A2) | Opus | 24 |
| Test env + Playwright setup (B0) | Sonnet | 74 |
| Live UI drive + DB read-backs (B1) | Sonnet | 149 |
| Field-context UX judgment (B2) | Opus | 10 |
| Targeted state-integrity (Secondary) | Opus | 21 |
| Production test-data cleanup | Sonnet | (running at report time) |
| Spec ownership, probes, conflict adjudication (1 screenshot ruling), final report | Lead (Fable) | ~8 inline |

## Remediation shipped (2026-07-11, branch fix/attendance-payroll-audit)

- **Migration `081_attendance_payroll_audit_fixes.sql`** fixes F1/F7/F8/F9/F10/F13: WIB −14/+7 recording window (`sano_wib_today()`), verify-time gross freeze + approve drift guard (re-verify from VERIFIED allowed), status-gated recompute, audited `void_opname` (harian, APPROVED/PAID, note required), borongan `payment_type` prior-paid isolation, kasbon ledger auto-settlement with partial carryover (`mandor_kasbon.settled_amount` + `kasbon_settlements`), WIB date defaults. Idempotent — apply by pasting into the Dashboard SQL Editor, then run `node tmp/smoke-attendance-fixes.mjs` (gates on 069 being live; self-cleaning end-to-end tests T1–T8).
- **Client grid** fixes F3/F4/F5/F6: tri-state explicit presence (unmarked pays zero and is never saved; "Semua Hadir" = explicit blanket assert; Konfirmasi blocked while cells are unmarked), per-cell save reconciliation with failed-day naming and a truthful DRAFT-count badge, locks from SUBMITTED onward ("Terkunci — koreksi lewat kantor"), Mon–Sat week everywhere incl. `week_end`; Excel template now exports blanks and the importer skips blanks (never default-present).
- Still open (deliberately): F2 gap-indicator UI, F11 project default/picker, F12 offline queue, F14 allocation→BoQ costing, F15 legacy dashboard readers, F16 tap targets, F17 export column, F18 (avoided — 069 keeps the loud loop design), plus the BLOCKED items (Q15/Q16/Q17/Q1).

## Appendix — out-of-scope security (single line)

Supervisor role can read all projects (live `projects` RLS broader than migration 036's stated assignment-scoped intent; verified with an authenticated non-service session) — access-control issue, not audited further here; UX consequence captured in F11.
