// office/screens/rooms/__tests__/DatumSyncCard.test.tsx
//
// DATUM sync spec 2026-09-27 §8.1: the Rooms-tab card. Every office role may
// pair, sync and import (the owner's 2026-09-27 decision); nothing on screen
// claims a result before the server answered; a failed read is an error with
// "Coba lagi", never "Belum pernah disinkronkan."
import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

jest.mock('../../../../tools/supabase', () => ({ supabase: {} }));
jest.mock('../../../../tools/datumSync', () => {
  const actual = jest.requireActual('../../../../tools/datumSync');
  return {
    ...actual,
    getDatumSyncState: jest.fn(),
    syncDatum: jest.fn(),
    importFromDatum: jest.fn(),
    setDatumProjectCode: jest.fn(),
  };
});

import { getDatumSyncState, importFromDatum, setDatumProjectCode, syncDatum, type DatumRun, type DatumSyncState } from '../../../../tools/datumSync';
import DatumSyncCard from '../DatumSyncCard';

// Rendering suites run slowly beside the full jest run; the 5 s default flakes.
jest.setTimeout(20000);

const getState = getDatumSyncState as jest.Mock;
const sync = syncDatum as jest.Mock;
const doImport = importFromDatum as jest.Mock;
const pair = setDatumProjectCode as jest.Mock;

const project: { id: string; code: string; name: string; datum_project_code: string | null } = {
  id: 'p1', code: 'SANO-K27', name: 'Citraland K2-7', datum_project_code: 'K2-7',
};
const run = (over: Partial<DatumRun> = {}): DatumRun => ({
  id: 'run-1', project_id: 'p1', source: 'manual', requested_by: 'u1', requester_name: 'Siti Aminah',
  started_at: '2026-09-26T03:00:00.000Z', finished_at: '2026-09-26T03:00:05.000Z', ok: true,
  counts: { steps: { areas: 'ok', link: 'ok', create: 'ok', gate_status: 'ok', staff: 'ok', escalate: 'ok' }, datum_project_name: 'Citraland K2-7 Sonny', rooms_linked: 12, rooms_created: 2, datum_only: 0, staff: { linked: 28, linked_now: 0, unmatched: 1, ambiguous: 0, stale: 0 } },
  differences: { staff: { unmatched: [{ profile_id: 'u9', full_name: 'Ir. Budi' }], ambiguous: [], stale: [] } },
  error: null, ...over,
});
const state = (over: Partial<DatumSyncState> = {}): DatumSyncState => ({ latest: run(), latestFinished: run(), latestSync: run(), staffRun: run(), waiting: null, ...over });
const deferred = <T,>() => {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
};

const renderCard = (role: string, over: Partial<typeof project> = {}, onPaired = jest.fn(), onRoomsChanged = jest.fn()) =>
  render(<DatumSyncCard project={{ ...project, ...over }} role={role as never} onPaired={onPaired} onRoomsChanged={onRoomsChanged} />);

beforeEach(() => {
  jest.clearAllMocks();
  getState.mockResolvedValue(state());
});

describe('pairing', () => {
  it.each(['admin', 'principal', 'estimator'])('gives %s the field and saves through the RPC', async (role) => {
    pair.mockResolvedValueOnce({ code: 'D-18' });
    const onPaired = jest.fn();
    const utils = renderCard(role, {}, onPaired);
    await waitFor(() => expect(getState).toHaveBeenCalled());
    fireEvent.changeText(utils.getByLabelText('Kode proyek DATUM'), 'd-18');
    await act(async () => { fireEvent.press(utils.getByText('Simpan')); });
    expect(pair).toHaveBeenCalledWith('p1', 'd-18');
    expect(onPaired).toHaveBeenCalled();
  });

  it('shows a refusal as written and keeps the old code', async () => {
    pair.mockResolvedValueOnce({ error: 'Kode DATUM ini sudah dipakai proyek lain.' });
    const utils = renderCard('estimator');
    fireEvent.changeText(utils.getByLabelText('Kode proyek DATUM'), 'D-18');
    await act(async () => { fireEvent.press(utils.getByText('Simpan')); });
    expect(utils.getByText('Kode DATUM ini sudah dipakai proyek lain.')).toBeTruthy();
  });

  it('shows a supervisor the code, or Belum ditautkan, and no field', async () => {
    const paired = renderCard('supervisor');
    await waitFor(() => expect(paired.getByText('K2-7')).toBeTruthy());
    expect(paired.queryByLabelText('Kode proyek DATUM')).toBeNull();
    const unpaired = renderCard('supervisor', { datum_project_code: null });
    await waitFor(() => expect(unpaired.getByText('Belum ditautkan')).toBeTruthy());
  });
});

describe('Sinkron DATUM', () => {
  it.each(['admin', 'principal', 'estimator'])('is open to %s, shows nothing new until the server answers, then reloads', async (role) => {
    const answer = deferred<unknown>();
    sync.mockReturnValueOnce(answer.promise);
    const utils = renderCard(role);
    await waitFor(() => expect(utils.getByText(/Sinkron terakhir: 26 Sep 10.00/)).toBeTruthy());
    fireEvent.press(utils.getByText('Sinkron DATUM'));
    expect(utils.getByText('Menyinkronkan…')).toBeTruthy();
    expect(getState).toHaveBeenCalledTimes(1);
    getState.mockResolvedValueOnce(state({ latest: run({ id: 'run-2', finished_at: '2026-09-27T03:00:05.000Z', counts: { ...run().counts, rooms_linked: 13 } }) }));
    await act(async () => { answer.resolve({ run: { ok: true, runId: 'run-2', counts: { steps: {} }, differences: {}, error: null } }); });
    await waitFor(() => expect(utils.getByText(/13 ruangan ditautkan/)).toBeTruthy());
    expect(sync).toHaveBeenCalledWith('p1');
  });

  it('is disabled for a supervisor and while unpaired, saying why', async () => {
    const sup = renderCard('supervisor');
    await waitFor(() => expect(getState).toHaveBeenCalled());
    fireEvent.press(sup.getByText('Sinkron DATUM'));
    expect(sync).not.toHaveBeenCalled();
    const unpaired = renderCard('admin', { datum_project_code: null });
    await waitFor(() => expect(unpaired.getByText('Proyek ini belum ditautkan ke DATUM.')).toBeTruthy());
    fireEvent.press(unpaired.getByText('Sinkron DATUM'));
    expect(sync).not.toHaveBeenCalled();
  });

  it('shows a refusal as written', async () => {
    sync.mockResolvedValueOnce({ error: 'Sinkron DATUM untuk proyek ini sedang berjalan.', code: 'SYNC_RUNNING' });
    const utils = renderCard('admin');
    await waitFor(() => expect(getState).toHaveBeenCalled());
    await act(async () => { fireEvent.press(utils.getByText('Sinkron DATUM')); });
    expect(utils.getByText('Sinkron DATUM untuk proyek ini sedang berjalan.')).toBeTruthy();
  });
});

describe('the last run', () => {
  it('reads a failed run with its error and each step that was not ok', async () => {
    getState.mockResolvedValueOnce(state({ latest: run({ ok: false, error: 'DATUM menolak kunci integrasi (401).', counts: { steps: { areas: 'error' }, step_errors: { areas: 'DATUM menolak kunci integrasi (401).' } } }) }));
    const utils = renderCard('admin');
    await waitFor(() => expect(utils.getByText('Sinkron terakhir gagal: 26 Sep 10.00 · DATUM menolak kunci integrasi (401).')).toBeTruthy());
    expect(utils.getByText('Baca area DATUM: gagal · DATUM menolak kunci integrasi (401).')).toBeTruthy();
  });

  it('reads an open run as running and no run as never', async () => {
    getState.mockResolvedValueOnce(state({ latest: run({ finished_at: null, ok: null }) }));
    const running = renderCard('admin');
    await waitFor(() => expect(running.getByText('Sinkron sedang berjalan sejak 26 Sep 10.00')).toBeTruthy());
    getState.mockResolvedValueOnce(state({ latest: null, latestFinished: null, staffRun: null }));
    const never = renderCard('admin');
    await waitFor(() => expect(never.getByText('Belum pernah disinkronkan.')).toBeTruthy());
  });

  it('shows a read error with Coba lagi, never "Belum pernah", and retries', async () => {
    getState.mockResolvedValueOnce({ error: 'offline' });
    const utils = renderCard('admin');
    await waitFor(() => expect(utils.getByText('Status sinkron gagal dimuat.')).toBeTruthy());
    expect(utils.queryByText('Belum pernah disinkronkan.')).toBeNull();
    await act(async () => { fireEvent.press(utils.getByText('Coba lagi')); });
    await waitFor(() => expect(utils.getByText(/Sinkron terakhir:/)).toBeTruthy());
  });

  it('shows the automatic-sync line only when requests wait', async () => {
    getState.mockResolvedValueOnce(state({ waiting: { count: 2, oldestAt: '2026-09-27T00:00:00.000Z' } }));
    const utils = renderCard('admin');
    await waitFor(() => expect(utils.getByText('Sinkron otomatis menunggu: 2 permintaan sejak 27 Sep 07.00. Periksa Database Webhook.')).toBeTruthy());
  });
});

describe('Ambil dari DATUM', () => {
  const withOnly = () => state({ latestFinished: run({ differences: { datum_only: [
    { area_code: 'LT2-TERAS', area_name: 'Teras', floor: 'Lt. 2', area_type: 'terrace' },
    { area_code: 'FASAD', area_name: 'Fasad Depan', floor: null, area_type: 'facade' },
  ] } }) });

  it('is offered only with DATUM-only areas, and only to office roles', async () => {
    const none = renderCard('admin');
    await waitFor(() => expect(none.getByText(/Sinkron terakhir:/)).toBeTruthy());
    expect(none.queryByText(/Ambil \d+ ruangan dari DATUM/)).toBeNull();
    getState.mockResolvedValueOnce(withOnly());
    const sup = renderCard('supervisor');
    await waitFor(() => expect(sup.getByText(/Sinkron terakhir:/)).toBeTruthy());
    expect(sup.queryByText('Ambil 2 ruangan dari DATUM')).toBeNull();
  });

  it("confirms naming DATUM's project and every area, sends exactly those codes, and reports the answer", async () => {
    getState.mockResolvedValue(withOnly());
    const answer = deferred<unknown>();
    doImport.mockReturnValueOnce(answer.promise);
    const utils = renderCard('estimator');
    await waitFor(() => expect(utils.getByText('Ambil 2 ruangan dari DATUM')).toBeTruthy());
    fireEvent.press(utils.getByText('Ambil 2 ruangan dari DATUM'));
    expect(utils.getByText('Ambil 2 ruangan dari DATUM proyek Citraland K2-7 Sonny? Ruangan dibuat di SANO dan ditautkan; setelah itu SANO yang menjadi acuan.')).toBeTruthy();
    // Once under "Hanya di DATUM", once in the confirmation.
    expect(utils.getAllByText('LT2-TERAS · Teras · Lt. 2 · Teras / Balkon')).toHaveLength(2);
    expect(utils.getByText('FASAD · Fasad Depan · tanpa lantai · Fasad')).toBeTruthy();
    fireEvent.press(utils.getByText('Ambil'));
    expect(doImport).toHaveBeenCalledWith('p1', ['LT2-TERAS', 'FASAD']);
    expect(utils.getByText('Mengambil…')).toBeTruthy();
    fireEvent.press(utils.getByText('Mengambil…'));
    expect(doImport).toHaveBeenCalledTimes(1);
    await act(async () => {
      answer.resolve({ run: { ok: true, runId: 'r', error: null, counts: { steps: { import: 'ok' }, rooms_imported: 1 },
        differences: { import_skipped: [{ area_code: 'FASAD', reason: 'Sudah ada di SANO atau tidak lagi ada di DATUM.' }] } } });
    });
    expect(utils.getByText('1 ruangan diambil')).toBeTruthy();
    expect(utils.getByText('FASAD: Sudah ada di SANO atau tidak lagi ada di DATUM.')).toBeTruthy();
  });
});

describe('Ambil dari DATUM: what one request can carry', () => {
  it('sends only codes DATUM accepts and lists a too-long one apart, never sent', async () => {
    const long = `L${'X'.repeat(200)}`;
    getState.mockResolvedValue(state({ latestFinished: run({ differences: { datum_only: [
      { area_code: long, area_name: 'Gudang Belakang', floor: null, area_type: 'utility' },
      { area_code: 'LT2-TERAS', area_name: 'Teras', floor: 'Lt. 2', area_type: 'terrace' },
    ] } }) }));
    doImport.mockResolvedValueOnce({ run: { ok: true, runId: 'r', error: null, counts: { steps: { import: 'ok' }, rooms_imported: 1 }, differences: {} } });
    const utils = renderCard('admin');
    await waitFor(() => expect(utils.getByText('Ambil 1 ruangan dari DATUM')).toBeTruthy());
    expect(utils.getByText('Kode terlalu panjang, tidak bisa diambil')).toBeTruthy();
    expect(utils.getByText(`L${'X'.repeat(39)}… · Gudang Belakang · tanpa lantai · Utilitas`)).toBeTruthy();
    fireEvent.press(utils.getByText('Ambil 1 ruangan dari DATUM'));
    await act(async () => { fireEvent.press(utils.getByText('Ambil')); });
    expect(doImport).toHaveBeenCalledWith('p1', ['LT2-TERAS']);
  });

  it('offers no button when no code can be sent, and still says why', async () => {
    getState.mockResolvedValue(state({ latestFinished: run({ differences: { datum_only: [
      { area_code: `L${'X'.repeat(200)}`, area_name: 'Gudang Belakang', floor: null, area_type: 'utility' },
    ] } }) }));
    const utils = renderCard('admin');
    await waitFor(() => expect(utils.getByText('Kode terlalu panjang, tidak bisa diambil')).toBeTruthy());
    expect(utils.queryByText(/^Ambil \d+ ruangan dari DATUM$/)).toBeNull();
  });
});

describe('the rooms behind the card', () => {
  const withOnly = () => state({ latestFinished: run({ differences: { datum_only: [
    { area_code: 'LT2-TERAS', area_name: 'Teras', floor: 'Lt. 2', area_type: 'terrace' },
  ] } }) });
  const report = { ok: true, runId: 'r', error: null, counts: { steps: { import: 'ok' }, rooms_imported: 1 }, differences: {} };

  it('tells the screen its rooms changed after an import the server answered with a run', async () => {
    getState.mockResolvedValue(withOnly());
    doImport.mockResolvedValueOnce({ run: report });
    const onRoomsChanged = jest.fn();
    const utils = renderCard('admin', {}, jest.fn(), onRoomsChanged);
    await waitFor(() => expect(utils.getByText('Ambil 1 ruangan dari DATUM')).toBeTruthy());
    fireEvent.press(utils.getByText('Ambil 1 ruangan dari DATUM'));
    await act(async () => { fireEvent.press(utils.getByText('Ambil')); });
    expect(onRoomsChanged).toHaveBeenCalledTimes(1);
  });

  it('also after a sync answered with a run (it may link rooms), and never after a refusal', async () => {
    getState.mockResolvedValue(withOnly());
    const onRoomsChanged = jest.fn();
    const utils = renderCard('admin', {}, jest.fn(), onRoomsChanged);
    await waitFor(() => expect(utils.getByText('Ambil 1 ruangan dari DATUM')).toBeTruthy());
    doImport.mockResolvedValueOnce({ error: 'Sinkron DATUM untuk proyek ini sedang berjalan.', code: 'SYNC_RUNNING' });
    fireEvent.press(utils.getByText('Ambil 1 ruangan dari DATUM'));
    await act(async () => { fireEvent.press(utils.getByText('Ambil')); });
    sync.mockResolvedValueOnce({ error: 'Sinkron DATUM untuk proyek ini sedang berjalan.', code: 'SYNC_RUNNING' });
    await act(async () => { fireEvent.press(utils.getByText('Sinkron DATUM')); });
    expect(onRoomsChanged).not.toHaveBeenCalled();
    sync.mockResolvedValueOnce({ run: { ...report, counts: { steps: { areas: 'ok' } } } });
    await act(async () => { fireEvent.press(utils.getByText('Sinkron DATUM')); });
    expect(onRoomsChanged).toHaveBeenCalledTimes(1);
  });
});

describe('the differences after an import', () => {
  it('still shows what the newest sync could not create or send', async () => {
    const imported = run({ id: 'run-2', source: 'import', counts: { steps: { import: 'ok' }, rooms_imported: 1 }, differences: {} });
    getState.mockResolvedValueOnce(state({
      latest: imported,
      latestFinished: imported,
      latestSync: run({ differences: {
        create_failed: [{ room_code: 'LT3-PANJANG', reason: 'Nama ruangan lebih dari 120 karakter; DATUM menolaknya.' }],
        escalate_skipped: [{ event_id: 'e1', room_code: 'LT1-DAPUR', title: 'Pilih kran', reason: 'Ruangan belum tertaut ke area DATUM.' }],
      } }),
    }));
    const utils = renderCard('admin');
    await waitFor(() => expect(utils.getByText('Gagal dibuat di DATUM')).toBeTruthy());
    expect(utils.getByText('Keputusan belum terkirim')).toBeTruthy();
    expect(utils.getByText('LT1-DAPUR · Pilih kran · Ruangan belum tertaut ke area DATUM.')).toBeTruthy();
  });
});

describe('schedules DATUM could not build', () => {
  it('shows the group, one line per area, with its note', async () => {
    const synced = run({ differences: { schedule_warnings: [
      { area_code: 'LT2-TERAS', code: 'SCHEDULE_FAILED', reason: 'Jadwal area gagal disusun.' },
    ] } as DatumRun['differences'] });
    getState.mockResolvedValueOnce(state({ latestFinished: synced, latestSync: synced }));
    const utils = renderCard('admin');
    await waitFor(() => expect(utils.getByText('Jadwal DATUM belum tersusun')).toBeTruthy());
    expect(utils.getByText('LT2-TERAS: Jadwal area gagal disusun.')).toBeTruthy();
    expect(utils.getByText('Ruangannya sudah dibuat dan ditautkan di DATUM. Susun jadwalnya dengan "Hitung ulang jadwal" di DATUM.')).toBeTruthy();
  });
});

describe('differences and staff', () => {
  it('lists each difference group with the note, and the staff picture for every project', async () => {
    const synced = run({ differences: {
      field_conflicts: [{ room_code: 'KM-1', field: 'name', sano: 'Kamar Mandi 1', datum: 'KM Anak' }],
      gate_words: [{ code: 'B', field: 'description' }],
      escalate_skipped: [{ event_id: 'e1', room_code: 'LT1-DAPUR', title: 'Pilih kran', reason: 'Ruangan belum tertaut ke area DATUM.' }],
    } });
    getState.mockResolvedValueOnce(state({ latestFinished: synced, latestSync: synced }));
    const utils = renderCard('admin');
    await waitFor(() => expect(utils.getByText('Berbeda dengan DATUM')).toBeTruthy());
    expect(utils.getByText('KM-1 · nama — SANO "Kamar Mandi 1" · DATUM "KM Anak"')).toBeTruthy();
    expect(utils.getByText('Kata gerbang berbeda dengan DATUM')).toBeTruthy();
    expect(utils.getByText('Keputusan belum terkirim')).toBeTruthy();
    expect(utils.getByText('Tidak diubah otomatis. Samakan di SANO atau DATUM bila perlu.')).toBeTruthy();
    expect(utils.getByText('Staf (semua proyek), per 26 Sep 10.00')).toBeTruthy();
    expect(utils.getByText('Tidak ada di DATUM')).toBeTruthy();
    expect(utils.getByText('Ir. Budi')).toBeTruthy();
    expect(utils.getByText('28 staf tertaut')).toBeTruthy();
  });
});
