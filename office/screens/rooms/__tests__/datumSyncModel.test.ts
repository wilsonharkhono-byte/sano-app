/**
 * The words of the Rooms-tab DATUM card (spec 2026-09-27 §8.1).
 */
import type { DatumRun, DatumSyncState } from '../../../../tools/datumSync';
import {
  differenceGroups,
  importOffer,
  importResultLines,
  lastRunView,
  staffView,
  waitingLine,
  whenLabel,
} from '../datumSyncModel';

const NOW = '2026-09-27T03:30:00.000Z'; // 10.30 WIB

const run = (over: Partial<DatumRun> = {}): DatumRun => ({
  id: 'run-1', project_id: 'p1', source: 'manual', requested_by: 'u1', requester_name: 'Siti Aminah',
  started_at: '2026-09-27T03:00:00.000Z', finished_at: '2026-09-27T03:00:05.000Z', ok: true,
  counts: { steps: { areas: 'ok', link: 'ok', create: 'ok', gate_status: 'ok', staff: 'ok', escalate: 'ok' }, datum_project_name: 'Citraland K2-7 Sonny', rooms_linked: 12, rooms_created: 2, datum_only: 1 },
  differences: {}, error: null, ...over,
});
const state = (over: Partial<DatumSyncState> = {}): DatumSyncState => ({ latest: run(), latestFinished: run(), staffRun: run(), waiting: null, ...over });

describe('lastRunView', () => {
  it("reads a good run with its non-zero parts, who started it, and DATUM's project name", () => {
    expect(lastRunView(state(), NOW)).toEqual({
      tone: 'ok',
      line: 'Sinkron terakhir: 27 Sep 10.00 · 12 ruangan ditautkan · 2 dibuat · 1 hanya di DATUM',
      details: ['oleh Siti Aminah', 'DATUM: Citraland K2-7 Sonny'],
      steps: [],
    });
    const cron = run({ source: 'cron', counts: { steps: { areas: 'ok' }, rooms_linked: 0, rooms_created: 0 } });
    expect(lastRunView(state({ latest: cron }), NOW)).toMatchObject({ line: 'Sinkron terakhir: 27 Sep 10.00 · 0 ruangan ditautkan', details: ['otomatis'] });
  });

  it('reads a failed run in the critical tone with its error and each step that was not ok', () => {
    const failed = run({
      ok: false, error: 'DATUM menolak kunci integrasi (401).',
      counts: {
        steps: { areas: 'error', link: 'skipped', create: 'skipped', gate_status: 'error', staff: 'error', escalate: 'ok' },
        step_errors: { areas: 'DATUM menolak kunci integrasi (401).', link: 'Area DATUM tidak terbaca pada sinkron ini.', create: 'Area DATUM tidak terbaca pada sinkron ini.', gate_status: 'DATUM menolak kunci integrasi (401).', staff: 'DATUM menolak kunci integrasi (401).' },
      },
    });
    const view = lastRunView(state({ latest: failed }), NOW);
    expect(view.tone).toBe('critical');
    expect(view.line).toBe('Sinkron terakhir gagal: 27 Sep 10.00 · DATUM menolak kunci integrasi (401).');
    expect(view.steps).toEqual([
      'Baca area DATUM: gagal · DATUM menolak kunci integrasi (401).',
      'Tautkan ruangan: dilewati · Area DATUM tidak terbaca pada sinkron ini.',
      'Buat area di DATUM: dilewati · Area DATUM tidak terbaca pada sinkron ini.',
      'Baca status gerbang: gagal · DATUM menolak kunci integrasi (401).',
      'Tautkan staf: gagal · DATUM menolak kunci integrasi (401).',
    ]);
  });

  it('reads an open run as running, and no run as never', () => {
    expect(lastRunView(state({ latest: run({ finished_at: null, ok: null }) }), NOW).line).toBe('Sinkron sedang berjalan sejak 10.00');
    expect(lastRunView(state({ latest: null, latestFinished: null }), NOW)).toEqual({ tone: 'muted', line: 'Belum pernah disinkronkan.', details: [], steps: [] });
  });
});

describe('waitingLine', () => {
  it('speaks only when hourly requests have waited more than 2 hours', () => {
    expect(waitingLine(state())).toBeNull();
    expect(waitingLine(state({ waiting: { count: 3, oldestAt: '2026-09-27T00:00:00.000Z' } }))).toBe(
      'Sinkron otomatis menunggu: 3 permintaan sejak 27 Sep 07.00. Periksa Database Webhook.',
    );
  });
});

describe('differenceGroups', () => {
  it('lists every group that has lines, in the card order, and nothing for an empty run', () => {
    expect(differenceGroups(run())).toEqual([]);
    const groups = differenceGroups(run({
      differences: {
        datum_only: [{ area_code: 'LT2-TERAS', area_name: 'Teras', floor: 'Lt. 2', area_type: 'terrace' }],
        field_conflicts: [
          { room_code: 'KM-1', field: 'code', sano: 'KM-1', datum: 'KM-01' },
          { room_code: 'KM-1', field: 'name', sano: 'Kamar Mandi 1', datum: 'KM Anak' },
          { room_code: 'KM-1', field: 'floor', sano: 'Lt. 1', datum: 'Lt. 2' },
          { room_code: 'KM-1', field: 'area_type', sano: 'bathroom', datum: 'general' },
        ],
        datum_duplicates: [{ key: 'X-1', area_codes: ['X-1', 'x 1'] }],
        create_failed: [{ room_code: 'LT3-PANJANG', reason: 'Nama ruangan lebih dari 120 karakter; DATUM menolaknya.' }],
        import_skipped: [{ area_code: 'GONE-1', reason: 'Sudah ada di SANO atau tidak lagi ada di DATUM.' }],
        escalate_skipped: [{ event_id: 'e1', room_code: 'LT1-DAPUR', title: 'Pilih kran', reason: 'Ruangan belum tertaut ke area DATUM.' }],
        gate_words: [{ code: 'B', field: 'description' }],
      },
    }));
    expect(groups).toEqual([
      { title: 'Hanya di DATUM', lines: ['LT2-TERAS · Teras · Lt. 2 · Teras / Balkon'] },
      { title: 'Berbeda dengan DATUM', lines: [
        'KM-1 · kode — SANO "KM-1" · DATUM "KM-01"',
        'KM-1 · nama — SANO "Kamar Mandi 1" · DATUM "KM Anak"',
        'KM-1 · lantai — SANO "Lt. 1" · DATUM "Lt. 2"',
        'KM-1 · tipe — SANO "Kamar mandi" · DATUM "Umum"',
      ] },
      { title: 'Kode ganda di DATUM', lines: ['X-1: X-1, x 1'] },
      { title: 'Gagal dibuat di DATUM', lines: ['LT3-PANJANG · Nama ruangan lebih dari 120 karakter; DATUM menolaknya.'] },
      { title: 'Tidak diambil dari DATUM', lines: ['GONE-1 · Sudah ada di SANO atau tidak lagi ada di DATUM.'] },
      { title: 'Keputusan belum terkirim', lines: ['LT1-DAPUR · Pilih kran · Ruangan belum tertaut ke area DATUM.'] },
      { title: 'Kata gerbang berbeda dengan DATUM', lines: ['Gerbang B · deskripsi'] },
    ]);
  });
});

describe('staffView', () => {
  it('shows the newest good staff step, labelled for every project, with each group and the linked count', () => {
    const view = staffView(run({
      counts: { steps: { staff: 'ok' }, staff: { linked: 28, linked_now: 2, unmatched: 1, ambiguous: 2, stale: 1 } },
      differences: { staff: {
        unmatched: [{ profile_id: 'u1', full_name: 'Ir. Budi' }],
        ambiguous: [{ profile_id: 'u2', full_name: 'Andi', side: 'datum' }, { profile_id: 'u3', full_name: 'Rina', side: 'linked_elsewhere' }],
        stale: [{ profile_id: 'u4', full_name: 'Selvi', staff_id: 's4', staff_name: 'Selvia', reason: 'name_differs' }],
      } },
    }));
    expect(view).toEqual({
      heading: 'Staf (semua proyek), per 27 Sep 10.00',
      groups: [
        { title: 'Tidak ada di DATUM', lines: ['Ir. Budi'] },
        { title: 'Nama ganda', lines: ['Andi · nama ganda di DATUM', 'Rina · staf DATUM ini sudah tertaut ke orang lain'] },
        { title: 'Tautan lama tidak cocok', lines: ['Selvi · tertaut ke "Selvia"'] },
      ],
      linkedLine: '28 staf tertaut',
    });
  });

  it('shows nothing without a finished run whose staff step was ok', () => {
    expect(staffView(null)).toBeNull();
    expect(staffView(run({ counts: { steps: { staff: 'error' } } }))).toBeNull();
    expect(staffView(run({ finished_at: null }))).toBeNull();
  });
});

describe('importOffer and importResultLines', () => {
  it("offers exactly the latest run's DATUM-only areas, naming DATUM's project", () => {
    expect(importOffer(state())).toBeNull();
    const offer = importOffer(state({ latestFinished: run({ differences: { datum_only: [
      { area_code: 'LT2-TERAS', area_name: 'Teras', floor: 'Lt. 2', area_type: 'terrace' },
      { area_code: 'FASAD', area_name: 'Fasad Depan', floor: null, area_type: 'facade' },
    ] } }) }));
    expect(offer).toEqual({
      projectName: 'Citraland K2-7 Sonny',
      areas: [
        { area_code: 'LT2-TERAS', line: 'LT2-TERAS · Teras · Lt. 2 · Teras / Balkon' },
        { area_code: 'FASAD', line: 'FASAD · Fasad Depan · tanpa lantai · Fasad' },
      ],
      buttonLabel: 'Ambil 2 ruangan dari DATUM',
      question: 'Ambil 2 ruangan dari DATUM proyek Citraland K2-7 Sonny? Ruangan dibuat di SANO dan ditautkan; setelah itu SANO yang menjadi acuan.',
    });
  });

  it('says how many came in and why each other one did not', () => {
    expect(importResultLines({
      ok: true, runId: 'r', error: null,
      counts: { steps: { import: 'ok' }, rooms_imported: 1 },
      differences: { import_skipped: [{ area_code: 'GONE-1', reason: 'Sudah ada di SANO atau tidak lagi ada di DATUM.' }] },
    })).toEqual(['1 ruangan diambil', 'GONE-1: Sudah ada di SANO atau tidak lagi ada di DATUM.']);
  });
});

describe('whenLabel', () => {
  it('drops the date only for today in WIB', () => {
    expect(whenLabel('2026-09-27T03:00:00.000Z', NOW)).toBe('10.00');
    expect(whenLabel('2026-09-26T03:00:00.000Z', NOW)).toBe('26 Sep 10.00');
  });
});
