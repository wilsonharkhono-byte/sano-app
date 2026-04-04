import type { BoqItem, GateResult } from '../../tools/types';

export function computeGate4Info(item: BoqItem, qty: number): GateResult | null {
  const newInstalled = item.installed + qty;
  const newPct = Math.min(100, (newInstalled / item.planned) * 100);

  if (item.tier1_material) {
    return {
      flag: 'INFO',
      check: '4a',
      msg: `Sistem akan memverifikasi bahwa ${item.tier1_material} yang diterima cukup untuk ${qty} ${item.unit} pekerjaan ini.`,
    };
  }

  if (newPct > 100) {
    return {
      flag: 'WARNING',
      check: '4a',
      msg: `Progres kumulatif ${newInstalled.toFixed(2)} melebihi planned ${item.planned} ${item.unit}.`,
    };
  }

  return null;
}
