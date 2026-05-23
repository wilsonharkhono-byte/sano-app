import type { BlockSchema, RebarDiameterWeight } from './types';
import type { BreakdownRow, BreakdownGroup } from '../boqParserV2/breakdownSheetReader.types';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function elementSuffix(hint: string | null): string {
  return (hint ?? '').toUpperCase();
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

// ---------------------------------------------------------------------------
// Task 11: expandBekisting
// ---------------------------------------------------------------------------

export interface ExpandBekistingInput {
  schema: BlockSchema;
  ratioPerM3: number;
  volume: number;
}

export function expandBekisting(input: ExpandBekistingInput): BreakdownRow[] {
  const { schema, ratioPerM3, volume } = input;
  if (schema.cycleFactor == null || schema.cycleFactor <= 0) return [];
  const factor = ratioPerM3 / schema.cycleFactor;
  const elem = elementSuffix(schema.elementHint);
  const componentGroup = `BEKISTING ${elem} (Material) — ratio ${ratioPerM3} m²`;
  return schema.subItems
    .filter((s) => s.includedInRolledUpTotal)
    .map((s) => {
      const qtyPerBoqUnit = round6(s.qtyPerNativeUnit * factor);
      const costPerBoqUnit = Math.round(qtyPerBoqUnit * s.unitPrice);
      const totalQty = round6(qtyPerBoqUnit * volume);
      const totalCost = Math.round(totalQty * s.unitPrice);
      return {
        group: 'material' as BreakdownGroup,
        componentGroup,
        materialName: s.materialName,
        specNote: s.specNote,
        qtyPerNativeUnit: s.qtyPerNativeUnit,
        nativeUnit: s.nativeUnit,
        nativeBasis: `per ${elem.toLowerCase()} (${schema.cycleFactor!} m² form / cycle)`,
        unitPrice: s.unitPrice,
        qtyPerBoqUnit,
        costPerBoqUnit,
        totalQty,
        totalCost,
      };
    });
}

// ---------------------------------------------------------------------------
// Task 12: expandPembesian
// ---------------------------------------------------------------------------

export interface ExpandPembesianInput {
  schema: BlockSchema;
  diameters: RebarDiameterWeight[];
  volume: number;
}

function findSubItem(schema: BlockSchema, predicate: (name: string) => boolean) {
  return schema.subItems.find((s) => predicate(s.materialName));
}

export function expandPembesian(input: ExpandPembesianInput): BreakdownRow[] {
  const { schema, diameters, volume } = input;
  if (diameters.length === 0) return [];

  const besi = findSubItem(schema, (n) => /^Besi beton/i.test(n));
  const decking = findSubItem(schema, (n) => /decking/i.test(n));
  const bendrat = findSubItem(schema, (n) => /bendrat/i.test(n));

  const wasteCoeff = besi ? besi.qtyPerNativeUnit - 1 : 0;
  const rawBesiPrice = besi?.unitPrice ?? 0;
  const deckingRatio = decking?.qtyPerNativeUnit ?? 0;
  const deckingPrice = decking?.unitPrice ?? 0;
  const bendratRatio = bendrat?.qtyPerNativeUnit ?? 0;
  const bendratPrice = bendrat?.unitPrice ?? 0;

  const totalRawKg = diameters.reduce((s, d) => s + d.qtyPerBoqUnit, 0);
  const totalWithWaste = totalRawKg * (1 + wasteCoeff);
  const componentGroup = `PEMBESIAN (Material) — ratio ${totalRawKg.toFixed(2)} kg/m³`;

  const rows: BreakdownRow[] = [];

  for (const d of diameters) {
    const qty = round6(d.qtyPerBoqUnit);
    rows.push({
      group: 'material',
      componentGroup,
      materialName: `Besi beton ${d.diameter}`,
      specNote: 'U24/U40 polos',
      qtyPerNativeUnit: qty,
      nativeUnit: 'kg',
      nativeBasis: 'per m3 beton',
      unitPrice: rawBesiPrice,
      qtyPerBoqUnit: qty,
      costPerBoqUnit: Math.round(qty * rawBesiPrice),
      totalQty: round6(qty * volume),
      totalCost: Math.round(qty * rawBesiPrice * volume),
    });
  }

  const wasteQty = round6(totalRawKg * wasteCoeff);
  rows.push({
    group: 'material',
    componentGroup,
    materialName: 'Besi beton — waste (5%)',
    specNote: 'applied via AHS coeff 1.05',
    qtyPerNativeUnit: wasteCoeff,
    nativeUnit: 'kg',
    nativeBasis: 'per m3 beton',
    unitPrice: rawBesiPrice,
    qtyPerBoqUnit: wasteQty,
    costPerBoqUnit: Math.round(wasteQty * rawBesiPrice),
    totalQty: round6(wasteQty * volume),
    totalCost: Math.round(wasteQty * rawBesiPrice * volume),
  });

  const deckingQty = round6(totalRawKg * deckingRatio);
  rows.push({
    group: 'material',
    componentGroup,
    materialName: 'Beton decking',
    specNote: 'spacer',
    qtyPerNativeUnit: deckingRatio,
    nativeUnit: 'kg-eq',
    nativeBasis: 'per kg besi',
    unitPrice: deckingPrice,
    qtyPerBoqUnit: deckingQty,
    costPerBoqUnit: Math.round(deckingQty * deckingPrice),
    totalQty: round6(deckingQty * volume),
    totalCost: Math.round(deckingQty * deckingPrice * volume),
  });

  const bendratQty = round6(totalWithWaste * bendratRatio);
  rows.push({
    group: 'material',
    componentGroup,
    materialName: 'Bendrat (kawat ikat)',
    specNote: '2% of besi',
    qtyPerNativeUnit: bendratRatio,
    nativeUnit: 'kg',
    nativeBasis: 'per kg besi (incl. waste)',
    unitPrice: bendratPrice,
    qtyPerBoqUnit: bendratQty,
    costPerBoqUnit: Math.round(bendratQty * bendratPrice),
    totalQty: round6(bendratQty * volume),
    totalCost: Math.round(bendratQty * bendratPrice * volume),
  });

  return rows;
}

// ---------------------------------------------------------------------------
// Task 13: expandConcrete
// ---------------------------------------------------------------------------

function concreteGroupFor(name: string): BreakdownGroup {
  if (/upah|borongan|labor/i.test(name)) return 'labor';
  if (/peralatan|alat|vibrator|pump|equipment|sewa/i.test(name)) return 'equipment';
  return 'material';
}

export interface ExpandConcreteInput {
  schema: BlockSchema;
  volume: number;
}

export function expandConcrete(input: ExpandConcreteInput): BreakdownRow[] {
  const { schema, volume } = input;
  return schema.subItems
    .filter((s) => s.includedInRolledUpTotal)
    .map((s) => {
      const group = concreteGroupFor(s.materialName);
      const componentGroup =
        group === 'material' ? 'BETON READYMIX (Material)'
        : group === 'labor' ? 'UPAH (Labor) — borongan'
        : 'PERALATAN (Equipment)';
      const qtyPerBoqUnit = round6(s.qtyPerNativeUnit);
      const totalQty = round6(qtyPerBoqUnit * volume);
      return {
        group,
        componentGroup,
        materialName: s.materialName,
        specNote: s.specNote,
        qtyPerNativeUnit: s.qtyPerNativeUnit,
        nativeUnit: s.nativeUnit,
        nativeBasis: group === 'material' ? 'per m3 beton (waste 5%)' : 'per m3 beton',
        unitPrice: s.unitPrice,
        qtyPerBoqUnit,
        costPerBoqUnit: Math.round(qtyPerBoqUnit * s.unitPrice),
        totalQty,
        totalCost: Math.round(totalQty * s.unitPrice),
      };
    });
}
