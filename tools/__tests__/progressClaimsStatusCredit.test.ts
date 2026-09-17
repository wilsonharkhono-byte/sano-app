// tools/__tests__/progressClaimsStatusCredit.test.ts
import { maxStatus, pctOfStatus, statusOfActivity, statusOfPct, stageStatusLabel } from '../progressClaims/statusCredit';

describe('status credit (spec 2026-09-17 §4.1)', () => {
  it('credits a running stage 50 and a finished one 100', () => {
    expect(pctOfStatus('BELUM')).toBe(0);
    expect(pctOfStatus('BERJALAN')).toBe(50);
    expect(pctOfStatus('SELESAI')).toBe(100);
  });

  it('reads a percent back as a status, and knows a typed figure from the credit', () => {
    expect(statusOfPct(0)).toEqual({ status: 'BELUM', exact: false });
    expect(statusOfPct(50)).toEqual({ status: 'BERJALAN', exact: false });
    expect(statusOfPct(100)).toEqual({ status: 'SELESAI', exact: false });
    expect(statusOfPct(35)).toEqual({ status: 'BERJALAN', exact: true });
    expect(statusOfPct(99.9)).toEqual({ status: 'BERJALAN', exact: true });
    expect(statusOfPct(null)).toEqual({ status: 'BELUM', exact: false });
    expect(statusOfPct(undefined)).toEqual({ status: 'BELUM', exact: false });
  });

  it('maps the diary states: started or continuing is running, finished is finished', () => {
    expect(statusOfActivity('MULAI')).toBe('BERJALAN');
    expect(statusOfActivity('LANJUT')).toBe('BERJALAN');
    expect(statusOfActivity('SELESAI')).toBe('SELESAI');
    expect(statusOfActivity(null)).toBe('BERJALAN');
  });

  it('orders statuses and labels them in Indonesian', () => {
    expect(maxStatus('BELUM', 'BERJALAN')).toBe('BERJALAN');
    expect(maxStatus('SELESAI', 'BERJALAN')).toBe('SELESAI');
    expect(stageStatusLabel('BELUM')).toBe('Belum');
    expect(stageStatusLabel('BERJALAN')).toBe('Berjalan');
    expect(stageStatusLabel('SELESAI')).toBe('Selesai');
  });
});
