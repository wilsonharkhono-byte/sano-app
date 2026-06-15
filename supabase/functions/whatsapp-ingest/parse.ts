// whatsapp-ingest — pure parsing & project-disambiguation helpers.
//
// No Deno / network / DB imports here on purpose: everything in this file is a
// pure function so it can be unit-tested with the project's jest harness
// (run: npx jest --testPathIgnorePatterns "/node_modules/" \
//   supabase/functions/whatsapp-ingest/parse.test.ts).
//
// The HTTP handler (index.ts) wires these together with the Claude call, the
// Supabase service-role client, and the WhatsApp provider reply.

// ── Types ──────────────────────────────────────────────────────────────────

export interface CandidateProject {
  id: string;
  code: string;
  name: string;
  client_name?: string | null;
  status?: string | null;
}

export type DecisionType =
  | 'material' | 'vendor' | 'approval' | 'change_order' | 'scope' | 'schedule';

export type DecisionStatus = 'pending' | 'confirmed' | 'rejected' | 'superseded';

export interface ParsedDecision {
  project_code: string | null;
  decision_type: DecisionType;
  room: string | null;
  item_category: string | null;
  current_spec: string | null;
  proposed_spec: string | null;
  status: DecisionStatus;
  confidence: number;
}

export type ResolutionStatus = 'resolved' | 'ambiguous' | 'reject';

export interface ProjectResolution {
  status: ResolutionStatus;
  projectId?: string;
  project?: CandidateProject;
  candidates?: CandidateProject[];
  needsConfirm?: boolean;
  reason?: string;
}

export type ConfidenceTier = 'high' | 'medium' | 'low';

// ── Phone normalization ──────────────────────────────────────────────────────
// Indonesian numbers arrive in several shapes: "08123...", "+628123...",
// "628123...", "62 812-3456". Normalize to digits-only with a leading 62.

export function normalizePhone(raw: string): string {
  const digits = (raw ?? '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('62')) return digits;
  if (digits.startsWith('0')) return '62' + digits.slice(1);
  if (digits.startsWith('8')) return '62' + digits; // bare "8123..."
  return digits;
}

// ── Project-code extraction ──────────────────────────────────────────────────
// Looks for an explicit known code anywhere in the message as a whole token,
// case-insensitively. Returns the canonical (catalog) spelling, not the
// user's casing. Longest match wins so "GA17" beats "GA1" when both exist.

const CODE_TOKEN_RE = /[A-Za-z]+[A-Za-z0-9.\-]*\d|[A-Za-z]{2,}\d+/;

export function extractProjectCode(text: string, knownCodes: string[]): string | null {
  if (!text) return null;
  const upper = text.toUpperCase();
  const sorted = [...knownCodes].sort((a, b) => b.length - a.length);
  for (const code of sorted) {
    const c = code.toUpperCase();
    // whole-token match: not flanked by alphanumerics
    const re = new RegExp(`(^|[^A-Z0-9])${escapeRegExp(c)}([^A-Z0-9]|$)`);
    if (re.test(upper)) return code;
  }
  return null;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Heuristic: does the message look like it leads with *some* code token?
// Used only to decide whether to ask "unknown code" vs "which project".
export function looksLikeHasCode(text: string): boolean {
  const firstToken = (text ?? '').trim().split(/\s+/)[0] ?? '';
  return CODE_TOKEN_RE.test(firstToken.toUpperCase());
}

// ── Three-tier project resolution ────────────────────────────────────────────
// Mirrors blueprint §5:
//   1. Explicit code in message → match against known projects.
//   2. Sender's active projects → exactly one ⇒ default (confirm); many ⇒ ask.
//   3. Otherwise reject for human review.

export function resolveProject(params: {
  text: string;
  knownCodes: string[];          // all project codes (for explicit-code match)
  knownById: Map<string, CandidateProject>;
  senderActiveProjects: CandidateProject[];
}): ProjectResolution {
  const { text, knownCodes, senderActiveProjects } = params;

  // Tier 1 — explicit known code.
  const explicit = extractProjectCode(text, knownCodes);
  if (explicit) {
    const match = senderActiveProjects.find(p => p.code.toUpperCase() === explicit.toUpperCase())
      ?? findByCode(params.knownById, explicit);
    if (match) {
      return { status: 'resolved', projectId: match.id, project: match, needsConfirm: false };
    }
  }

  // Tier 1b — message leads with a code-like token that we don't recognize.
  // Reject rather than silently default to the sender's project: the user named
  // a (wrong/unknown) project on purpose, and mis-attributing the log would be
  // worse than asking again.
  const firstToken = text.trim().split(/\s+/)[0] ?? '';
  if (!explicit && looksLikeHasCode(firstToken)) {
    return { status: 'reject', reason: `Kode proyek "${firstToken}" tidak dikenal.` };
  }

  // Tier 2 — fall back to sender's active assignments.
  if (senderActiveProjects.length === 1) {
    const only = senderActiveProjects[0];
    return { status: 'resolved', projectId: only.id, project: only, needsConfirm: true };
  }
  if (senderActiveProjects.length > 1) {
    return { status: 'ambiguous', candidates: senderActiveProjects };
  }

  // Tier 3 — no code, no assignments.
  return { status: 'reject', reason: 'Tidak ada kode proyek dan pengirim tidak punya proyek aktif.' };
}

function findByCode(byId: Map<string, CandidateProject>, code: string): CandidateProject | undefined {
  for (const p of byId.values()) {
    if (p.code.toUpperCase() === code.toUpperCase()) return p;
  }
  return undefined;
}

// ── Confidence routing ────────────────────────────────────────────────────────
// blueprint §6: >0.85 high (write), 0.5–0.85 medium (write + flag), <0.5 low (ask).

export function routeByConfidence(confidence: number): ConfidenceTier {
  if (!Number.isFinite(confidence)) return 'low';
  if (confidence > 0.85) return 'high';
  if (confidence >= 0.5) return 'medium';
  return 'low';
}

// ── Claude JSON extraction ────────────────────────────────────────────────────
// Claude may wrap the JSON object in prose or a ```json fence. Pull the first
// balanced object out and validate the shape. Returns null if unparseable.

export function parseClaudeJson(text: string): ParsedDecision | null {
  if (!text) return null;
  const raw = extractJsonObject(text);
  if (!raw) return null;
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(raw);
  } catch {
    return null;
  }
  return coerceDecision(obj);
}

function extractJsonObject(text: string): string | null {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fence ? fence[1] : text;
  const start = body.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  for (let i = start; i < body.length; i++) {
    if (body[i] === '{') depth++;
    else if (body[i] === '}') {
      depth--;
      if (depth === 0) return body.slice(start, i + 1);
    }
  }
  return null;
}

const DECISION_TYPES: DecisionType[] =
  ['material', 'vendor', 'approval', 'change_order', 'scope', 'schedule'];
const DECISION_STATUSES: DecisionStatus[] =
  ['pending', 'confirmed', 'rejected', 'superseded'];

function coerceDecision(obj: Record<string, unknown>): ParsedDecision | null {
  const dt = String(obj.decision_type ?? '').toLowerCase();
  const st = String(obj.status ?? 'pending').toLowerCase();
  const conf = Number(obj.confidence);
  return {
    project_code: nullableStr(obj.project_code),
    decision_type: (DECISION_TYPES as string[]).includes(dt) ? (dt as DecisionType) : 'material',
    room: nullableStr(obj.room),
    item_category: nullableStr(obj.item_category),
    current_spec: nullableStr(obj.current_spec),
    proposed_spec: nullableStr(obj.proposed_spec),
    status: (DECISION_STATUSES as string[]).includes(st) ? (st as DecisionStatus) : 'pending',
    confidence: Number.isFinite(conf) ? clamp01(conf) : 0,
  };
}

function nullableStr(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

// ── Reply message builders (Bahasa Indonesia) ────────────────────────────────

export function buildClarificationMessage(candidates: CandidateProject[]): string {
  const lines = candidates
    .map((p, i) => `${i + 1}) ${p.code} - ${p.client_name ?? p.name}`)
    .join('\n');
  return `Project mana?\n${lines}\n\nBalas dengan kode proyek di awal pesan, contoh: "${candidates[0]?.code ?? 'GA7'} keramik kamar mandi sudah dipilih".`;
}

export function buildConfirmationMessage(params: {
  project: CandidateProject;
  decision: ParsedDecision;
  loggedBy: string;
  at: Date;
  flagged: boolean;
}): string {
  const { project, decision, loggedBy, at, flagged } = params;
  const time = formatJamWIB(at);
  const item = decision.item_category ?? decision.proposed_spec ?? 'catatan';
  const room = decision.room ? ` (${decision.room})` : '';
  const head = flagged ? 'Tercatat ⚠ (perlu cek)' : 'Tercatat ✓';
  return `${head} ${project.code} — ${item}${room}, status: ${translateStatus(decision.status)}. Logged by ${loggedBy} ${time}.`;
}

export function buildLowConfidenceReply(): string {
  return 'Maaf, pesannya belum jelas untuk dicatat. Mohon kirim ulang dengan format: KODE_PROYEK — ruangan — item/keputusan. Contoh: "GA7 — kamar mandi utama — keramik lantai Roman 60x60 sudah dipilih".';
}

export function buildUnknownSenderReply(): string {
  return 'Nomor tidak terdaftar. Hubungi admin WHAstudio untuk didaftarkan.';
}

function translateStatus(s: DecisionStatus): string {
  switch (s) {
    case 'confirmed': return 'dikonfirmasi';
    case 'rejected': return 'ditolak';
    case 'superseded': return 'diganti';
    default: return 'menunggu';
  }
}

function formatJamWIB(d: Date): string {
  // WIB = UTC+7. Render HH:MM in 24h.
  const wib = new Date(d.getTime() + 7 * 3600 * 1000);
  const hh = String(wib.getUTCHours()).padStart(2, '0');
  const mm = String(wib.getUTCMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

// ── System prompt for the parser persona ──────────────────────────────────────

export function buildParserSystemPrompt(senderProjects: CandidateProject[]): string {
  const projectList = senderProjects.length
    ? senderProjects.map(p => `  - ${p.code}: ${p.name}${p.client_name ? ` (klien: ${p.client_name})` : ''}`).join('\n')
    : '  (pengirim belum punya proyek aktif yang terdaftar)';

  return `Kamu adalah parser pesan lapangan untuk WHAstudio, firma design-build di Surabaya.
Tugasmu: ubah pesan WhatsApp informal berbahasa Indonesia (kadang campur slang/Jawa) dari PIC atau supervisor menjadi SATU objek JSON keputusan proyek yang terstruktur.

Proyek aktif milik pengirim:
${projectList}

Keluarkan HANYA objek JSON (tanpa penjelasan, tanpa teks lain) dengan field:
{
  "project_code": string|null,   // kode proyek bila disebut/dikenali, jika tidak ada -> null
  "decision_type": "material"|"vendor"|"approval"|"change_order"|"scope"|"schedule",
  "room": string|null,           // nama ruangan bila ada, mis. "kamar mandi utama"
  "item_category": string|null,  // kategori singkat, mis. "keramik lantai", "cat dinding"
  "current_spec": string|null,   // spesifikasi lama bila disebut
  "proposed_spec": string|null,  // spesifikasi/keputusan baru, mis. "Roman 60x60 abu"
  "status": "pending"|"confirmed"|"rejected"|"superseded",
  "confidence": number           // 0..1, seberapa yakin kamu pada hasil parsing
}

Aturan:
- JANGAN mengarang detail yang tidak ada di pesan. Field yang tidak disebut -> null.
- "sudah dipilih/sudah fix/approved/ok pak" -> status "confirmed".
- "tolong cek/usul/rencana/mau pakai" tanpa kepastian -> status "pending".
- "ganti dari X ke Y" -> current_spec X, proposed_spec Y, decision_type "change_order".
- Bila pesan tidak jelas atau bukan keputusan proyek, set confidence rendah (<0.5).
- confidence tinggi (>0.85) hanya bila project, item, dan keputusan jelas.`;
}
