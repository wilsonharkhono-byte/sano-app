/**
 * Small rules with visible consequences: "Selesai" only on an open event;
 * "Buka konfirmasi" only where the confirm route exists (the office and
 * principal navigators do not register it); overdue only for open events;
 * and a VO line that never claims more than the row records.
 */
import { detailActions, draftCardLine, isOverdue, voStatusText } from '../screens/siteEvent/detailModel';

const SUPERVISOR_ROUTES = ['Beranda', 'Room', 'SiteEventCapture', 'SiteEventConfirm', 'SiteEventDetail'];
const OFFICE_ROUTES = ['Home', 'Approvals', 'RoomDetail', 'SiteEventDetail'];

describe('detailActions', () => {
  it('offers Selesai only on an open event', () => {
    expect(detailActions({ status: 'open' }, SUPERVISOR_ROUTES)).toEqual({ canClose: true, canOpenConfirm: false });
    expect(detailActions({ status: 'done' }, SUPERVISOR_ROUTES)).toEqual({ canClose: false, canOpenConfirm: false });
    expect(detailActions({ status: 'discarded' }, SUPERVISOR_ROUTES)).toEqual({ canClose: false, canOpenConfirm: false });
  });

  it('offers Buka konfirmasi for a draft only where the confirm screen is registered', () => {
    expect(detailActions({ status: 'draft' }, SUPERVISOR_ROUTES).canOpenConfirm).toBe(true);
    expect(detailActions({ status: 'pending_analysis' }, SUPERVISOR_ROUTES).canOpenConfirm).toBe(true);
    expect(detailActions({ status: 'draft' }, OFFICE_ROUTES).canOpenConfirm).toBe(false);
  });
});

describe('isOverdue', () => {
  it('is true only for an open event whose due date is before today', () => {
    expect(isOverdue({ status: 'open', due_date: '2026-09-09' }, '2026-09-10')).toBe(true);
    expect(isOverdue({ status: 'open', due_date: '2026-09-10' }, '2026-09-10')).toBe(false);
    expect(isOverdue({ status: 'done', due_date: '2026-09-01' }, '2026-09-10')).toBe(false);
    expect(isOverdue({ status: 'open', due_date: null }, '2026-09-10')).toBe(false);
  });
});

describe('voStatusText and draftCardLine', () => {
  it('describes each VO state without overstating it', () => {
    expect(voStatusText({ vo_flag: 'confirmed' })).toBe('VO dikonfirmasi. Catatan Perubahan menunggu review estimator.');
    expect(voStatusText({ vo_flag: 'rejected' })).toBe('Usulan VO dari AI tidak dilanjutkan.');
    expect(voStatusText({ vo_flag: 'suggested' })).toBe('AI mengusulkan VO; belum dikonfirmasi.');
    expect(voStatusText({ vo_flag: 'none' })).toBeNull();
  });

  it('labels a Beranda draft row by what the supervisor needs to do', () => {
    expect(draftCardLine({ status: 'draft', draft_title: 'Nat retak', last_error: null, room_name: 'KM Utama' })).toEqual({
      title: 'Nat retak', line: 'KM Utama · siap dikonfirmasi', tone: 'ok',
    });
    expect(draftCardLine({ status: 'pending_analysis', draft_title: null, last_error: 'Transkripsi gagal. timeout', room_name: null })).toEqual({
      title: 'Analisis belum berhasil', line: 'Ruangan · Transkripsi gagal. timeout', tone: 'warning',
    });
    expect(draftCardLine({ status: 'pending_analysis', draft_title: null, last_error: null, room_name: 'Dapur' })).toEqual({
      title: 'Menunggu analisis AI', line: 'Dapur · sedang dianalisis', tone: 'info',
    });
  });
});
