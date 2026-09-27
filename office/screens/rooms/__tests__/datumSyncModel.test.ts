/**
 * The words of the Rooms-tab DATUM card (spec 2026-09-27 §8.1).
 */
// The model reads constants from tools/datumSync, which loads the client.
jest.mock('../../../../tools/supabase', () => ({ supabase: {} }));

import type { DatumRun, DatumSyncState } from '../../../../tools/datumSync';
import { DATUM_SYNC_REFUSALS, DATUM_UNPAIRED } from '../../../../tools/datumSync';
import {
  ESCALATE_AREA_UNKNOWN,
  codeHeldElsewhere,
  importBadType,
  importNoName,
} from '../../../../tools/datumSyncPlan';
import {
  DATUM_CARD_COPY,
  differenceGroups,
  importOffer,
  importResultLines,
  lastRunView,
  staffView,
  waitingLine,
} from '../datumSyncModel';

const NOW = '2026-09-27T03:30:00.000Z'; // 10.30 WIB

const run = (over: Partial<DatumRun> = {}): DatumRun => ({
  id: 'run-1', project_id: 'p1', source: 'manual', requested_by: 'u1', requester_name: 'Siti Aminah',
  started_at: '2026-09-27T03:00:00.000Z', finished_at: '2026-09-27T03:00:05.000Z', ok: true,
  counts: { steps: { areas: 'ok', link: 'ok', create: 'ok', gate_status: 'ok', staff: 'ok', escalate: 'ok' }, datum_project_name: 'Citraland K2-7 Sonny', rooms_linked: 12, rooms_created: 2, datum_only: 1 },
  differences: {}, error: null, ...over,
});
const state = (over: Partial<DatumSyncState> = {}): DatumSyncState => ({ latest: run(), latestFinished: run(), latestSync: run(), staffRun: run(), waiting: null, ...over });

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

describe("differenceGroups: the planner's and the function's reasons", () => {
  it('shows every reason as the server worded it, and never "undefined"', () => {
    // run.ts CREATE_DEFERRED and a DATUM item error, as run.ts words them (supabase/functions is not importable here).
    const deferred = 'Belum dikirim ke DATUM: waktu sinkron ini habis. Dikirim pada sinkron berikutnya.';
    const groups = differenceGroups(run({
      counts: { ...run().counts, escalate_deferred: 1 },
      differences: {
        create_failed: [
          { room_code: 'LT1-KM', reason: codeHeldElsewhere('LT1-KM', 'LT1-KM-LAMA') },
          { room_code: 'LT2-KM', reason: deferred },
          { room_code: 'LT3-KM', reason: 'DATUM menolak nama, lantai atau tipenya.' },
        ],
        import_skipped: [
          { area_code: 'ZONA-X', reason: importBadType('ZONA-X', 'rooftop') },
          { area_code: 'TANPA', reason: importNoName('TANPA') },
        ],
        escalate_skipped: [
          { event_id: 'e1', room_code: 'LT1-DAPUR', title: 'Pilih kran', reason: ESCALATE_AREA_UNKNOWN },
          { event_id: 'e2', room_code: 'LT1-DAPUR', title: 'Pilih keramik', reason: 'Gagal dikirim: Kejadian ini sudah terkirim dari proyek lain di DATUM.' },
        ],
      },
    }));
    expect(groups).toEqual([
      { title: 'Gagal dibuat di DATUM', lines: [
        'LT1-KM · Area DATUM dengan kode LT1-KM sudah tertaut ke ruangan LT1-KM-LAMA. Samakan kodenya di SANO atau DATUM.',
        'LT3-KM · DATUM menolak nama, lantai atau tipenya.',
      ] },
      { title: 'Belum dibuat di DATUM (menunggu sinkron berikutnya)', lines: [`LT2-KM · ${deferred}`] },
      { title: 'Tidak diambil dari DATUM', lines: [
        'ZONA-X · Tipe area DATUM "rooftop" untuk ZONA-X tidak dikenal SANO.',
        'TANPA · Area DATUM TANPA tidak punya nama.',
      ] },
      { title: 'Keputusan belum terkirim', lines: [
        'LT1-DAPUR · Pilih kran · DATUM tidak mengenal area ruangan ini; dicoba lagi pada sinkron berikutnya.',
        'LT1-DAPUR · Pilih keramik · Gagal dikirim: Kejadian ini sudah terkirim dari proyek lain di DATUM.',
        '1 keputusan menunggu sinkron berikutnya',
      ] },
    ]);
    expect(JSON.stringify(groups)).not.toMatch(/undefined|null/);
  });
});

describe('differenceGroups: creates the deadline deferred vs creates DATUM refused', () => {
  // run.ts's CREATE_DEFERRED, as run.ts words it (supabase/functions is not importable here).
  const DEFERRED = 'Belum dikirim ke DATUM: waktu sinkron ini habis. Dikirim pada sinkron berikutnya.';

  it('splits a run with both into two groups: refused stays "Gagal", deferred moves to "Belum dibuat"', () => {
    const groups = differenceGroups(run({ differences: { create_failed: [
      { room_code: 'LT1-KM', reason: 'DATUM menolak nama, lantai atau tipenya.' },
      { room_code: 'LT2-KM', reason: DEFERRED },
    ] } }));
    expect(groups).toEqual([
      { title: 'Gagal dibuat di DATUM', lines: ['LT1-KM · DATUM menolak nama, lantai atau tipenya.'] },
      { title: 'Belum dibuat di DATUM (menunggu sinkron berikutnya)', lines: [`LT2-KM · ${DEFERRED}`] },
    ]);
  });

  it('shows only "Belum dibuat" when every create is merely deferred, never "Gagal"', () => {
    const groups = differenceGroups(run({ differences: { create_failed: [
      { room_code: 'LT2-KM', reason: DEFERRED },
      { room_code: 'LT3-KM', reason: DEFERRED },
    ] } }));
    expect(groups).toEqual([
      { title: 'Belum dibuat di DATUM (menunggu sinkron berikutnya)', lines: [`LT2-KM · ${DEFERRED}`, `LT3-KM · ${DEFERRED}`] },
    ]);
  });

  it('shows only "Gagal dibuat di DATUM" when DATUM actually refused every create, never "Belum dibuat"', () => {
    const groups = differenceGroups(run({ differences: { create_failed: [
      { room_code: 'LT1-KM', reason: 'DATUM menolak nama, lantai atau tipenya.' },
    ] } }));
    expect(groups).toEqual([
      { title: 'Gagal dibuat di DATUM', lines: ['LT1-KM · DATUM menolak nama, lantai atau tipenya.'] },
    ]);
  });

  it('shows neither group when nothing failed or was deferred to create', () => {
    expect(differenceGroups(run({ differences: { create_failed: [] } }))).toEqual([]);
    expect(differenceGroups(run())).toEqual([]);
  });
});

describe('differenceGroups: an empty side', () => {
  it('says "(kosong)" for a floor one side left empty, never SANO ""', () => {
    expect(differenceGroups(run({ differences: { field_conflicts: [
      { room_code: 'UMUM', field: 'floor', sano: '', datum: 'Lt. 1' },
      { room_code: 'KM-2', field: 'floor', sano: 'Lt. 2', datum: '' },
    ] } }))).toEqual([
      { title: 'Berbeda dengan DATUM', lines: [
        'UMUM · lantai — SANO (kosong) · DATUM "Lt. 1"',
        'KM-2 · lantai — SANO "Lt. 2" · DATUM (kosong)',
      ] },
    ]);
  });
});

describe('differenceGroups after an import', () => {
  it('keeps the create, schedule and decision groups of the newest sync, which an import run never writes', () => {
    const sync = run({
      id: 'run-1',
      counts: { ...run().counts, escalate_deferred: 3 },
      differences: {
        datum_only: [{ area_code: 'OLD', area_name: 'Lama', floor: null, area_type: 'general' }],
        create_failed: [{ room_code: 'LT3-PANJANG', reason: 'Nama ruangan lebih dari 120 karakter; DATUM menolaknya.' }],
        escalate_skipped: [{ event_id: 'e1', room_code: 'LT1-DAPUR', title: 'Pilih kran', reason: 'Ruangan belum tertaut ke area DATUM.' }],
        schedule_warnings: [{ area_code: 'LT2-TERAS', code: 'SCHEDULE_FAILED', reason: 'Jadwal area gagal disusun.' }],
      },
    });
    const imported = run({
      id: 'run-2', source: 'import',
      counts: { steps: { import: 'ok' }, rooms_imported: 1 },
      differences: { import_skipped: [{ area_code: 'GONE-1', reason: 'Sudah ada di SANO atau tidak lagi ada di DATUM.' }] },
    });
    expect(differenceGroups(imported, sync).map((g) => [g.title, g.lines])).toEqual([
      ['Gagal dibuat di DATUM', ['LT3-PANJANG · Nama ruangan lebih dari 120 karakter; DATUM menolaknya.']],
      ['Jadwal DATUM belum tersusun', ['LT2-TERAS: Jadwal area gagal disusun.']],
      ['Tidak diambil dari DATUM', ['GONE-1 · Sudah ada di SANO atau tidak lagi ada di DATUM.']],
      ['Keputusan belum terkirim', ['LT1-DAPUR · Pilih kran · Ruangan belum tertaut ke area DATUM.', '3 keputusan menunggu sinkron berikutnya']],
    ]);
    // Everything else is the newest finished run's: the import's DATUM-only list, not the older sync's.
    expect(differenceGroups(imported, sync).some((g) => g.title === 'Hanya di DATUM')).toBe(false);
    // No finished sync yet: those groups say nothing rather than borrow the import's silence.
    expect(differenceGroups(imported, null).map((g) => g.title)).toEqual(['Tidak diambil dari DATUM']);
  });
});

describe('differenceGroups: decisions a run did not reach', () => {
  it('says how many linked decisions wait for the next sync, under the decisions not sent', () => {
    expect(differenceGroups(run({ counts: { ...run().counts, escalate_deferred: 0 } }))).toEqual([]);
    expect(differenceGroups(run({ counts: { ...run().counts, escalate_deferred: 4 } }))).toEqual([
      { title: 'Keputusan belum terkirim', lines: ['4 keputusan menunggu sinkron berikutnya'] },
    ]);
    const both = differenceGroups(run({
      counts: { ...run().counts, escalate_deferred: 2 },
      differences: { escalate_skipped: [{ event_id: 'e1', room_code: 'LT1-DAPUR', title: 'Pilih kran', reason: 'Ruangan belum tertaut ke area DATUM.' }] },
    }));
    expect(both).toEqual([
      { title: 'Keputusan belum terkirim', lines: ['LT1-DAPUR · Pilih kran · Ruangan belum tertaut ke area DATUM.', '2 keputusan menunggu sinkron berikutnya'] },
    ]);
  });
});

describe('differenceGroups: DATUM schedules not built', () => {
  it("lists each area DATUM created but could not schedule, in DATUM's own words, and says the room exists", () => {
    const groups = differenceGroups(run({ differences: { schedule_warnings: [
      { area_code: 'LT2-TERAS', code: 'SCHEDULE_FAILED', reason: 'Jadwal area gagal disusun.' },
      { area_code: 'LT2-KM', code: 'SEED_FAILED', reason: '' },
    ] } }));
    expect(groups).toEqual([
      {
        title: 'Jadwal DATUM belum tersusun',
        lines: ['LT2-TERAS: Jadwal area gagal disusun.', 'LT2-KM: SEED_FAILED'],
        note: 'Ruangannya sudah dibuat dan ditautkan di DATUM. Susun jadwalnya dengan "Hitung ulang jadwal" di DATUM.',
      },
    ]);
  });
});

describe('differenceGroups: status rows SANO could not store', () => {
  it('lists one line per gate and status, saying which side SANO does not know and for how many areas', () => {
    expect(differenceGroups(run({ differences: { gate_status_unknown: [
      { gate_code: 'Z', status: 'passed', unknown: 'gate', rows: 3 },
      { gate_code: 'B', status: 'waiting', unknown: 'status', rows: 1 },
    ] } }))).toEqual([
      { title: 'Status gerbang DATUM tidak tersimpan', lines: [
        'Gerbang Z tidak ada di SANO · status "passed" · 3 area',
        'Gerbang B · status "waiting" tidak dikenal SANO · 1 area',
      ] },
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
      tooLong: [],
      limitNote: null,
      buttonLabel: 'Ambil 2 ruangan dari DATUM',
      question: 'Ambil 2 ruangan dari DATUM proyek Citraland K2-7 Sonny? Ruangan dibuat di SANO dan ditautkan; setelah itu SANO yang menjadi acuan.',
    });
  });

  it('never sends a code longer than the request allows: it is listed apart, and 200 characters still go', () => {
    const long = `L${'X'.repeat(200)}`;
    const edge = 'E'.repeat(200);
    const offer = importOffer(state({ latestFinished: run({ differences: { datum_only: [
      { area_code: long, area_name: 'Gudang Belakang', floor: null, area_type: 'utility' },
      { area_code: edge, area_name: 'Teras', floor: 'Lt. 2', area_type: 'terrace' },
    ] } }) }));
    expect(offer?.areas.map((a) => a.area_code)).toEqual([edge]);
    expect(offer?.tooLong).toEqual([`L${'X'.repeat(39)}… · Gudang Belakang · tanpa lantai · Utilitas`]);
    expect(offer?.buttonLabel).toBe('Ambil 1 ruangan dari DATUM');
    expect(offer?.question).toMatch(/^Ambil 1 ruangan dari DATUM proyek/);

    const onlyLong = importOffer(state({ latestFinished: run({ differences: { datum_only: [
      { area_code: long, area_name: 'Gudang Belakang', floor: null, area_type: 'utility' },
    ] } }) }));
    expect(onlyLong).toMatchObject({ areas: [], buttonLabel: null });
    expect(onlyLong?.tooLong).toHaveLength(1);
  });

  it('sends at most 500 codes and says how many are left for later', () => {
    const many = Array.from({ length: 502 }, (_, i) => ({ area_code: `R-${i}`, area_name: `Ruang ${i}`, floor: null, area_type: 'general' }));
    const offer = importOffer(state({ latestFinished: run({ differences: { datum_only: many } }) }));
    expect(offer?.areas).toHaveLength(500);
    expect(offer?.areas[499].area_code).toBe('R-499');
    expect(offer?.buttonLabel).toBe('Ambil 500 ruangan dari DATUM');
    expect(offer?.limitNote).toBe('Paling banyak 500 ruangan sekali ambil. 2 ruangan lainnya bisa diambil setelah ini.');
  });

  it('says how many came in and why each other one did not', () => {
    expect(importResultLines({
      ok: true, runId: 'r', error: null,
      counts: { steps: { import: 'ok' }, rooms_imported: 1 },
      differences: { import_skipped: [{ area_code: 'GONE-1', reason: 'Sudah ada di SANO atau tidak lagi ada di DATUM.' }] },
    })).toEqual(['1 ruangan diambil', 'GONE-1: Sudah ada di SANO atau tidak lagi ada di DATUM.']);
  });
});

describe('one sentence, one label', () => {
  it('says "not paired" in the words the function uses for PAIRING_MISSING', () => {
    expect(DATUM_CARD_COPY.syncNeedsPairing).toBe(DATUM_UNPAIRED);
    expect(DATUM_SYNC_REFUSALS.PAIRING_MISSING).toBe(DATUM_UNPAIRED);
    expect(DATUM_UNPAIRED).toBe('Proyek ini belum ditautkan ke DATUM.');
  });

  it("dates a running sync as the board dates DATUM's chips: the time alone today, in WIB", () => {
    // datumAsOfLabel (tools/datumGateStatus.ts) is the one label; its own edges are tested there.
    expect(lastRunView(state({ latest: run({ started_at: '2026-09-26T03:00:00.000Z', finished_at: null, ok: null }) }), NOW).line)
      .toBe('Sinkron sedang berjalan sejak 26 Sep 10.00');
  });
});
