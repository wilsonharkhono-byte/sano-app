// The words of the Rooms-tab "DATUM" card (spec 2026-09-27 §8.1), pure, so
// the card stays thin and every sentence is tested. Nothing here claims more
// than the run row says: a failed run reads as failed with its reason, an
// open run as running, no run as "never", and differences are listed, never
// resolved.

import { AREA_TYPE_LABELS } from '../../../tools/constants';
import type { AreaType } from '../../../tools/types';
import type { DatumRun, DatumSyncState } from '../../../tools/datumSync';
import type { ConflictField, GateStatusUnknownItem, GateWordDiff, RunReport, SyncStep } from '../../../tools/datumSyncPlan';
import { STEP_ORDER } from '../../../tools/datumSyncPlan';
import { formatWibShort, todayIsoWIB } from '../../../tools/timeWindow';

export const DATUM_CARD_COPY = {
  title: 'DATUM',
  pairingLabel: 'Kode proyek DATUM',
  pairingPlaceholder: 'mis. K2-7',
  pairingSave: 'Simpan',
  pairingSaving: 'Menyimpan…',
  unpaired: 'Belum ditautkan',
  sync: 'Sinkron DATUM',
  syncing: 'Menyinkronkan…',
  syncNeedsPairing: 'Proyek ini belum ditautkan ke DATUM.',
  never: 'Belum pernah disinkronkan.',
  readError: 'Status sinkron gagal dimuat.',
  retry: 'Coba lagi',
  loading: 'Memuat status sinkron…',
  differencesNote: 'Tidak diubah otomatis. Samakan di SANO atau DATUM bila perlu.',
  staffNote: 'Samakan nama di SANO atau DATUM, lalu sinkron lagi. Kartu dari orang yang belum tertaut dibuat atas nama SANO (sistem).',
  importCancel: 'Batal',
  importConfirm: 'Ambil',
  importing: 'Mengambil…',
} as const;

export const STEP_LABELS: Record<SyncStep, string> = {
  areas: 'Baca area DATUM',
  link: 'Tautkan ruangan',
  create: 'Buat area di DATUM',
  import: 'Ambil ruangan dari DATUM',
  gate_status: 'Baca status gerbang',
  staff: 'Tautkan staf',
  escalate: 'Kirim keputusan',
};

const OUTCOME_WORDS = { ok: 'berhasil', error: 'gagal', skipped: 'dilewati' } as const;
const FIELD_WORDS: Record<ConflictField, string> = { code: 'kode', name: 'nama', floor: 'lantai', area_type: 'tipe' };
const GATE_FIELD_WORDS: Record<GateWordDiff['field'], string> = {
  name: 'nama',
  description: 'deskripsi',
  missing_in_sano: 'tidak ada di SANO',
};
const SIDE_WORDS = {
  datum: 'nama ganda di DATUM',
  sano: 'nama ganda di SANO',
  linked_elsewhere: 'staf DATUM ini sudah tertaut ke orang lain',
} as const;

/** "10.00" today (WIB), "27 Sep 10.00" otherwise. */
export function whenLabel(iso: string, nowIso: string): string {
  const full = formatWibShort(iso);
  return todayIsoWIB(new Date(iso)) === todayIsoWIB(new Date(nowIso)) ? full.slice(full.lastIndexOf(' ') + 1) : full;
}

export function areaTypeLabel(t: string): string {
  return AREA_TYPE_LABELS[t as AreaType] ?? t;
}

export interface LastRunView {
  tone: 'ok' | 'critical' | 'muted';
  line: string;
  /** Who started it, and DATUM's own name for the project. */
  details: string[];
  /** Each step that was not ok, with its reason. */
  steps: string[];
}

function whoLine(run: DatumRun): string {
  return run.source === 'cron' ? 'otomatis' : `oleh ${run.requester_name ?? 'pengguna tidak dikenal'}`;
}

export function lastRunView(state: DatumSyncState, nowIso: string): LastRunView {
  const latest = state.latest;
  if (!latest) return { tone: 'muted', line: DATUM_CARD_COPY.never, details: [], steps: [] };
  if (latest.finished_at === null) {
    return { tone: 'muted', line: `Sinkron sedang berjalan sejak ${whenLabel(latest.started_at, nowIso)}`, details: [whoLine(latest)], steps: [] };
  }
  const when = formatWibShort(latest.finished_at);
  const details = [whoLine(latest)];
  if (latest.counts.datum_project_name) details.push(`DATUM: ${latest.counts.datum_project_name}`);
  if (latest.ok !== true) {
    const steps = STEP_ORDER.filter((s) => latest.counts.steps[s] && latest.counts.steps[s] !== 'ok').map((s) => {
      const reason = latest.counts.step_errors?.[s];
      return `${STEP_LABELS[s]}: ${OUTCOME_WORDS[latest.counts.steps[s]!]}${reason ? ` · ${reason}` : ''}`;
    });
    return { tone: 'critical', line: `Sinkron terakhir gagal: ${when} · ${latest.error ?? 'tanpa keterangan'}`, details, steps };
  }
  const c = latest.counts;
  const parts = [`${c.rooms_linked ?? 0} ruangan ditautkan`];
  if (c.rooms_created) parts.push(`${c.rooms_created} dibuat`);
  if (c.rooms_imported) parts.push(`${c.rooms_imported} diambil dari DATUM`);
  if (c.datum_only) parts.push(`${c.datum_only} hanya di DATUM`);
  if (c.escalated) parts.push(`${c.escalated} keputusan dikirim`);
  return { tone: 'ok', line: `Sinkron terakhir: ${when} · ${parts.join(' · ')}`, details, steps: [] };
}

export function waitingLine(state: DatumSyncState): string | null {
  if (!state.waiting) return null;
  return `Sinkron otomatis menunggu: ${state.waiting.count} permintaan sejak ${formatWibShort(state.waiting.oldestAt)}. Periksa Database Webhook.`;
}

export interface DifferenceGroup { title: string; lines: string[] }

/** A gate SANO has no gate_refs row for, or a status that is none of DATUM's six words: counted, never stored. */
function gateStatusUnknownLine(x: GateStatusUnknownItem): string {
  const areas = `${x.rows} area`;
  return x.unknown === 'gate'
    ? `Gerbang ${x.gate_code} tidak ada di SANO · status "${x.status}" · ${areas}`
    : `Gerbang ${x.gate_code} · status "${x.status}" tidak dikenal SANO · ${areas}`;
}

export function differenceGroups(run: DatumRun | null): DifferenceGroup[] {
  if (!run) return [];
  const d = run.differences;
  const groups: DifferenceGroup[] = [
    {
      title: 'Hanya di DATUM',
      lines: (d.datum_only ?? []).map((a) => [a.area_code, a.area_name, a.floor, areaTypeLabel(a.area_type)].filter(Boolean).join(' · ')),
    },
    {
      title: 'Berbeda dengan DATUM',
      lines: (d.field_conflicts ?? []).map((f) =>
        f.field === 'area_type'
          ? `${f.room_code} · ${FIELD_WORDS[f.field]} — SANO "${areaTypeLabel(f.sano)}" · DATUM "${areaTypeLabel(f.datum)}"`
          : `${f.room_code} · ${FIELD_WORDS[f.field]} — SANO "${f.sano}" · DATUM "${f.datum}"`),
    },
    { title: 'Kode ganda di DATUM', lines: (d.datum_duplicates ?? []).map((x) => `${x.key}: ${x.area_codes.join(', ')}`) },
    { title: 'Gagal dibuat di DATUM', lines: (d.create_failed ?? []).map((x) => `${x.room_code} · ${x.reason}`) },
    { title: 'Tidak diambil dari DATUM', lines: (d.import_skipped ?? []).map((x) => `${x.area_code} · ${x.reason}`) },
    { title: 'Keputusan belum terkirim', lines: (d.escalate_skipped ?? []).map((x) => `${x.room_code} · ${x.title} · ${x.reason}`) },
    { title: 'Kata gerbang berbeda dengan DATUM', lines: (d.gate_words ?? []).map((g) => `Gerbang ${g.code} · ${GATE_FIELD_WORDS[g.field]}`) },
    { title: 'Status gerbang DATUM tidak tersimpan', lines: (d.gate_status_unknown ?? []).map(gateStatusUnknownLine) },
  ];
  return groups.filter((g) => g.lines.length > 0);
}

export interface StaffView { heading: string; groups: DifferenceGroup[]; linkedLine: string }

export function staffView(run: DatumRun | null): StaffView | null {
  if (!run || !run.finished_at || run.counts.steps.staff !== 'ok') return null;
  const staff = run.differences.staff ?? { unmatched: [], ambiguous: [], stale: [] };
  const groups: DifferenceGroup[] = [
    { title: 'Tidak ada di DATUM', lines: staff.unmatched.map((s) => s.full_name || '(tanpa nama)') },
    { title: 'Nama ganda', lines: staff.ambiguous.map((s) => `${s.full_name || '(tanpa nama)'} · ${SIDE_WORDS[s.side]}`) },
    {
      title: 'Tautan lama tidak cocok',
      lines: staff.stale.map((s) => `${s.full_name || '(tanpa nama)'} · ${s.staff_name ? `tertaut ke "${s.staff_name}"` : 'staf DATUM-nya tidak aktif lagi'}`),
    },
  ].filter((g) => g.lines.length > 0);
  return {
    heading: `Staf (semua proyek), per ${formatWibShort(run.finished_at)}`,
    groups,
    linkedLine: `${run.counts.staff?.linked ?? 0} staf tertaut`,
  };
}

export interface ImportOffer {
  projectName: string;
  areas: Array<{ area_code: string; line: string }>;
  buttonLabel: string;
  question: string;
}

/** "Ambil {n} ruangan dari DATUM": only when the latest finished run lists DATUM-only areas. */
export function importOffer(state: DatumSyncState): ImportOffer | null {
  const run = state.latestFinished;
  const only = run?.differences.datum_only ?? [];
  if (!run || only.length === 0) return null;
  const projectName = run.counts.datum_project_name ?? 'ini';
  return {
    projectName,
    areas: only.map((a) => ({
      area_code: a.area_code,
      line: [a.area_code, a.area_name, a.floor ?? 'tanpa lantai', areaTypeLabel(a.area_type)].join(' · '),
    })),
    buttonLabel: `Ambil ${only.length} ruangan dari DATUM`,
    question: `Ambil ${only.length} ruangan dari DATUM proyek ${projectName}? Ruangan dibuat di SANO dan ditautkan; setelah itu SANO yang menjadi acuan.`,
  };
}

/** What the card says after the import answered. */
export function importResultLines(report: RunReport): string[] {
  const lines = [`${report.counts.rooms_imported ?? 0} ruangan diambil`];
  for (const s of report.differences.import_skipped ?? []) lines.push(`${s.area_code}: ${s.reason}`);
  if (!report.ok && report.error) lines.push(`Gagal: ${report.error}`);
  return lines;
}
