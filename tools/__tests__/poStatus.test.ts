import {
  isPoClosed,
  isPoReceivable,
  isPoOpenForDelivery,
  poStatusLabel,
} from '../poStatus';
import { POStatus, PO_STATUS_LABELS } from '../constants';

describe('poStatus helpers', () => {
  describe('isPoClosed — terminal states that drop out of the receive list', () => {
    it('is true for CANCELLED and CLOSED_SHORT', () => {
      expect(isPoClosed('CANCELLED')).toBe(true);
      expect(isPoClosed('CLOSED_SHORT')).toBe(true);
    });
    it('is false for open/partial/fully', () => {
      expect(isPoClosed('OPEN')).toBe(false);
      expect(isPoClosed('PARTIAL_RECEIVED')).toBe(false);
      expect(isPoClosed('FULLY_RECEIVED')).toBe(false);
    });
    it('is false for null/unknown', () => {
      expect(isPoClosed(null)).toBe(false);
      expect(isPoClosed(undefined)).toBe(false);
    });
  });

  describe('isPoReceivable — a receive form may still be opened', () => {
    it('is true only for OPEN and PARTIAL_RECEIVED', () => {
      expect(isPoReceivable('OPEN')).toBe(true);
      expect(isPoReceivable('PARTIAL_RECEIVED')).toBe(true);
    });
    it('is false for terminal states (fully/cancelled/short-closed)', () => {
      expect(isPoReceivable('FULLY_RECEIVED')).toBe(false);
      expect(isPoReceivable('CANCELLED')).toBe(false);
      expect(isPoReceivable('CLOSED_SHORT')).toBe(false);
    });
    it('is false for null/undefined', () => {
      expect(isPoReceivable(null)).toBe(false);
      expect(isPoReceivable(undefined)).toBe(false);
    });
  });

  describe('isPoOpenForDelivery — the dashboard "open PO" count', () => {
    // Mirrors BerandaScreen / LaporanScreen: open = OPEN || PARTIAL_RECEIVED.
    // CLOSED_SHORT and CANCELLED are closed and must NOT be counted as open.
    it('counts OPEN and PARTIAL_RECEIVED', () => {
      expect(isPoOpenForDelivery('OPEN')).toBe(true);
      expect(isPoOpenForDelivery('PARTIAL_RECEIVED')).toBe(true);
    });
    it('does not count FULLY_RECEIVED, CANCELLED, CLOSED_SHORT', () => {
      expect(isPoOpenForDelivery('FULLY_RECEIVED')).toBe(false);
      expect(isPoOpenForDelivery('CANCELLED')).toBe(false);
      expect(isPoOpenForDelivery('CLOSED_SHORT')).toBe(false);
    });
  });

  describe('poStatusLabel — Indonesian display label', () => {
    it('maps every storable status to its Indonesian label', () => {
      expect(poStatusLabel('OPEN')).toBe('Terbuka');
      expect(poStatusLabel('PARTIAL_RECEIVED')).toBe('Diterima sebagian');
      expect(poStatusLabel('FULLY_RECEIVED')).toBe('Diterima penuh');
      expect(poStatusLabel('CLOSED_SHORT')).toBe('Ditutup (kurang kirim)');
      expect(poStatusLabel('CANCELLED')).toBe('Dibatalkan');
    });
    it('falls back to the raw code for an unknown/null value', () => {
      expect(poStatusLabel('WEIRD')).toBe('WEIRD');
      expect(poStatusLabel(null)).toBe('');
      expect(poStatusLabel(undefined)).toBe('');
    });
    it('has a label for every value in the POStatus enum', () => {
      for (const value of Object.values(POStatus)) {
        expect(PO_STATUS_LABELS[value]).toBeTruthy();
      }
    });
  });
});
