# Material Usage Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an inline `MaterialUsagePanel` component to every Permintaan card in `ApprovalsScreen`, showing remaining vs used material per tier (Tier 1 BoQ-quantity, Tier 2 envelope quantity + Rupiah, Tier 3 spend cap, plus a fallback for unlinked materials).

**Architecture:** Pure presentational component fed by pre-fetched data. New helper in `tools/envelopes.ts` does a single batch fetch for envelope rows + AHS-line baseline prices keyed by material_id. ApprovalsScreen mounts → fetch → pass into one panel per `material_request_lines[]` entry.

**Tech Stack:** React Native + TypeScript, Jest with ts-jest preset, Supabase JS client (PostgREST). Reuses existing `summarizeAhsBaselinePrices` from `workflows/gates/gate2.ts` for Rupiah derivation.

**Spec:** [docs/superpowers/specs/2026-05-02-material-usage-panel-design.md](../specs/2026-05-02-material-usage-panel-design.md)

**Note on data source for Tier 2 Rupiah:** The spec referenced `material_catalog.reference_price` but that column doesn't exist in the schema. Real source is `ahs_lines.unit_price` (median across the material's baseline lines). Already implemented in `summarizeAhsBaselinePrices` — we reuse it directly. No DB migration.

---

## File Structure

**Create:**
- `office/screens/components/MaterialUsagePanel.tsx` — presentational, ~270 LOC
- `office/screens/components/__tests__/MaterialUsagePanel.test.tsx` — unit tests, ~200 LOC
- `tools/__tests__/envelopes.batch.test.ts` — unit tests for the batch fetcher, ~80 LOC

**Modify:**
- `tools/envelopes.ts` — add `getEnvelopesByMaterialIds(projectId, materialIds)` returning a Map of envelope + baseline price merged
- `office/screens/ApprovalsScreen.tsx` — collect material_ids from rendered request lines, batch fetch, render `<MaterialUsagePanel>` per line

---

## Task 1: Batch envelope + baseline price fetcher

**Files:**
- Modify: `tools/envelopes.ts` — add `getEnvelopesByMaterialIds` and supporting types
- Create: `tools/__tests__/envelopes.batch.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tools/__tests__/envelopes.batch.test.ts`:

```typescript
import { mergeEnvelopeWithBaselinePrice } from '../envelopes';
import type { MaterialEnvelopeStatus } from '../types';
import type { MaterialBaselinePriceSummary } from '../../workflows/gates/gate2';

describe('mergeEnvelopeWithBaselinePrice', () => {
  const env = (m: Partial<MaterialEnvelopeStatus>): MaterialEnvelopeStatus => ({
    material_id: 'mat-1',
    project_id: 'proj-1',
    material_code: 'CODE',
    material_name: 'Bata ringan 7.5 cm',
    tier: 2,
    unit: 'pcs',
    total_planned: 5000,
    total_ordered: 200,
    total_received: 0,
    remaining_to_order: 4800,
    burn_pct: 4,
    boq_item_count: 8,
    ...m,
  });

  const price = (m: Partial<MaterialBaselinePriceSummary>): MaterialBaselinePriceSummary => ({
    material_id: 'mat-1',
    baseline_unit_price: 6000,
    min_unit_price: 5800,
    max_unit_price: 6200,
    sample_count: 3,
    spread_pct: 6.7,
    ...m,
  });

  it('attaches baseline_unit_price when present', () => {
    const merged = mergeEnvelopeWithBaselinePrice(env({}), price({ baseline_unit_price: 6000 }));
    expect(merged.baseline_unit_price).toBe(6000);
    expect(merged.envelope_total_rupiah).toBe(30_000_000);  // 5000 × 6000
    expect(merged.envelope_used_rupiah).toBe(1_200_000);    // 200 × 6000
    expect(merged.envelope_remaining_rupiah).toBe(28_800_000);
  });

  it('returns null Rupiah fields when baseline price is missing', () => {
    const merged = mergeEnvelopeWithBaselinePrice(env({}), null);
    expect(merged.baseline_unit_price).toBeNull();
    expect(merged.envelope_total_rupiah).toBeNull();
    expect(merged.envelope_used_rupiah).toBeNull();
    expect(merged.envelope_remaining_rupiah).toBeNull();
  });

  it('returns null Rupiah fields when baseline price is zero or negative', () => {
    const merged = mergeEnvelopeWithBaselinePrice(env({}), price({ baseline_unit_price: 0 }));
    expect(merged.envelope_total_rupiah).toBeNull();
  });

  it('preserves all envelope fields verbatim', () => {
    const e = env({ total_ordered: 999, burn_pct: 19.98 });
    const merged = mergeEnvelopeWithBaselinePrice(e, null);
    expect(merged.total_ordered).toBe(999);
    expect(merged.burn_pct).toBe(19.98);
    expect(merged.material_name).toBe('Bata ringan 7.5 cm');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tools/__tests__/envelopes.batch.test.ts`
Expected: FAIL with "Cannot find module" or "mergeEnvelopeWithBaselinePrice is not a function".

- [ ] **Step 3: Add types and pure helper to `tools/envelopes.ts`**

Append the following to `tools/envelopes.ts` (after the existing `checkTier3SpendCap` function):

```typescript
import { summarizeAhsBaselinePrices, type MaterialBaselinePriceSummary } from '../workflows/gates/gate2';
import type { AhsLine } from './types';

export interface EnvelopeWithPrice extends MaterialEnvelopeStatus {
  baseline_unit_price: number | null;       // null = no AHS lines for this material
  envelope_total_rupiah: number | null;     // total_planned × baseline_unit_price
  envelope_used_rupiah: number | null;      // total_ordered × baseline_unit_price
  envelope_remaining_rupiah: number | null; // total - used
}

export function mergeEnvelopeWithBaselinePrice(
  envelope: MaterialEnvelopeStatus,
  price: MaterialBaselinePriceSummary | null,
): EnvelopeWithPrice {
  const unitPrice = price?.baseline_unit_price && price.baseline_unit_price > 0
    ? price.baseline_unit_price
    : null;

  if (unitPrice === null) {
    return {
      ...envelope,
      baseline_unit_price: null,
      envelope_total_rupiah: null,
      envelope_used_rupiah: null,
      envelope_remaining_rupiah: null,
    };
  }

  const total = envelope.total_planned * unitPrice;
  const used = envelope.total_ordered * unitPrice;
  return {
    ...envelope,
    baseline_unit_price: unitPrice,
    envelope_total_rupiah: total,
    envelope_used_rupiah: used,
    envelope_remaining_rupiah: total - used,
  };
}

/**
 * Batch fetch envelope rows + AHS-line baseline prices for a set of
 * materials in a single round trip. Returns a Map keyed by material_id
 * for O(1) lookup at render time.
 *
 * Used by ApprovalsScreen to populate `<MaterialUsagePanel>` per
 * request line without per-component fetches.
 */
export async function getEnvelopesByMaterialIds(
  projectId: string,
  materialIds: string[],
): Promise<Map<string, EnvelopeWithPrice>> {
  const out = new Map<string, EnvelopeWithPrice>();
  if (materialIds.length === 0) return out;

  // Fetch envelopes
  const { data: envRows } = await supabase
    .from('v_material_envelope_status')
    .select('*')
    .eq('project_id', projectId)
    .in('material_id', materialIds);

  // Fetch ahs_lines for current ahs_version of this project, filtered to materials we care about
  const { data: versionRow } = await supabase
    .from('ahs_versions')
    .select('id')
    .eq('project_id', projectId)
    .eq('is_current', true)
    .maybeSingle();

  const ahsLines: Array<Pick<AhsLine, 'material_id' | 'unit_price' | 'line_type'>> = [];
  if (versionRow?.id) {
    const { data: lineRows } = await supabase
      .from('ahs_lines')
      .select('material_id, unit_price, line_type')
      .eq('ahs_version_id', versionRow.id)
      .in('material_id', materialIds);
    if (lineRows) ahsLines.push(...lineRows as typeof ahsLines);
  }

  const priceMap = summarizeAhsBaselinePrices(ahsLines);

  for (const row of (envRows ?? []) as MaterialEnvelopeStatus[]) {
    out.set(row.material_id, mergeEnvelopeWithBaselinePrice(row, priceMap.get(row.material_id) ?? null));
  }
  return out;
}
```

- [ ] **Step 4: Run unit test to verify it passes**

Run: `npx jest tools/__tests__/envelopes.batch.test.ts`
Expected: PASS — all 4 cases.

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 6: Commit**

```bash
git add tools/envelopes.ts tools/__tests__/envelopes.batch.test.ts
git commit -m "feat(envelopes): batch fetch with merged baseline price for Material Usage Panel"
```

---

## Task 2: MaterialUsagePanel component skeleton + props

**Files:**
- Create: `office/screens/components/MaterialUsagePanel.tsx`
- Create: `office/screens/components/__tests__/MaterialUsagePanel.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `office/screens/components/__tests__/MaterialUsagePanel.test.tsx`:

```typescript
import React from 'react';
import { render } from '@testing-library/react-native';
import { MaterialUsagePanel } from '../MaterialUsagePanel';
import type { EnvelopeWithPrice } from '../../../tools/envelopes';

describe('MaterialUsagePanel', () => {
  it('renders unlinked-material warning when materialId is null', () => {
    const { getByText } = render(
      <MaterialUsagePanel
        materialId={null}
        customMaterialName="Material X"
        tier={null}
        requestedQuantity={50}
        requestedUnit="unit"
        envelope={null}
      />,
    );
    expect(getByText(/tidak terdaftar di katalog/i)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest office/screens/components/__tests__/MaterialUsagePanel.test.tsx`
Expected: FAIL with "Cannot find module '../MaterialUsagePanel'".

- [ ] **Step 3: Create component skeleton**

Create `office/screens/components/MaterialUsagePanel.tsx`:

```typescript
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { COLORS, FONTS, RADIUS, SPACE, TYPE } from '../../../workflows/theme';
import type { EnvelopeWithPrice } from '../../../tools/envelopes';

export interface MaterialUsagePanelProps {
  materialId: string | null;
  customMaterialName?: string | null;
  tier: 1 | 2 | 3 | null;
  requestedQuantity: number;
  requestedUnit: string;
  boqItemId?: string | null;
  envelope: EnvelopeWithPrice | null;
  boqItem?: { planned: number; installed: number; code: string; label: string } | null;
}

export function MaterialUsagePanel(props: MaterialUsagePanelProps): React.ReactElement {
  if (!props.materialId || props.tier == null) {
    return (
      <View style={[styles.panel, styles.panelWarning]}>
        <Text style={styles.warningText}>
          ⚠ Material tidak terdaftar di katalog. Tambahkan di Material Catalog
          untuk tracking envelope.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.panel}>
      <Text>Tier {props.tier} placeholder</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    marginTop: SPACE.sm,
    padding: SPACE.md,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS,
    borderLeftWidth: 3,
    borderLeftColor: COLORS.border,
  },
  panelWarning: {
    borderLeftColor: COLORS.warning,
    backgroundColor: '#fff8e1',
  },
  warningText: {
    fontSize: TYPE.sm,
    color: COLORS.text,
    fontFamily: FONTS.regular,
  },
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest office/screens/components/__tests__/MaterialUsagePanel.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add office/screens/components/MaterialUsagePanel.tsx office/screens/components/__tests__/MaterialUsagePanel.test.tsx
git commit -m "feat(approvals): MaterialUsagePanel skeleton with unlinked-material state"
```

---

## Task 3: Tier 2 rendering (most common case)

**Files:**
- Modify: `office/screens/components/MaterialUsagePanel.tsx`
- Modify: `office/screens/components/__tests__/MaterialUsagePanel.test.tsx`

- [ ] **Step 1: Add failing tests for Tier 2**

Append to `office/screens/components/__tests__/MaterialUsagePanel.test.tsx`:

```typescript
import type { EnvelopeWithPrice } from '../../../tools/envelopes';

const tier2Envelope = (m: Partial<EnvelopeWithPrice> = {}): EnvelopeWithPrice => ({
  material_id: 'mat-bata',
  project_id: 'proj-1',
  material_code: 'AAC-BL07',
  material_name: 'Bata ringan 7.5 cm',
  tier: 2,
  unit: 'pcs',
  total_planned: 5000,
  total_ordered: 200,
  total_received: 0,
  remaining_to_order: 4800,
  burn_pct: 4,
  boq_item_count: 8,
  baseline_unit_price: 6000,
  envelope_total_rupiah: 30_000_000,
  envelope_used_rupiah: 1_200_000,
  envelope_remaining_rupiah: 28_800_000,
  ...m,
});

describe('MaterialUsagePanel — Tier 2', () => {
  it('renders quantity envelope with burn percent', () => {
    const { getByText } = render(
      <MaterialUsagePanel
        materialId="mat-bata"
        tier={2}
        requestedQuantity={200}
        requestedUnit="pcs"
        envelope={tier2Envelope()}
      />,
    );
    expect(getByText(/200 \/ 5,000 pcs/)).toBeTruthy();
    expect(getByText(/4%/)).toBeTruthy();
    expect(getByText(/Sisa: 4,800 pcs/)).toBeTruthy();
  });

  it('renders Rupiah envelope when baseline_unit_price is present', () => {
    const { getByText } = render(
      <MaterialUsagePanel
        materialId="mat-bata"
        tier={2}
        requestedQuantity={200}
        requestedUnit="pcs"
        envelope={tier2Envelope()}
      />,
    );
    expect(getByText(/Rp 1\.2 jt \/ Rp 30 jt/)).toBeTruthy();
    expect(getByText(/Sisa: Rp 28\.8 jt/)).toBeTruthy();
  });

  it('hides Rupiah block when baseline_unit_price is null', () => {
    const { getByText, queryByText } = render(
      <MaterialUsagePanel
        materialId="mat-bata"
        tier={2}
        requestedQuantity={200}
        requestedUnit="pcs"
        envelope={tier2Envelope({ baseline_unit_price: null, envelope_total_rupiah: null, envelope_used_rupiah: null, envelope_remaining_rupiah: null })}
      />,
    );
    expect(queryByText(/Rp/)).toBeNull();
    expect(getByText(/Anggaran tidak tersedia/i)).toBeTruthy();
  });

  it('shows red warning when burn percent exceeds 100', () => {
    const { getByText } = render(
      <MaterialUsagePanel
        materialId="mat-bata"
        tier={2}
        requestedQuantity={500}
        requestedUnit="pcs"
        envelope={tier2Envelope({ total_ordered: 5500, burn_pct: 110, remaining_to_order: -500, envelope_used_rupiah: 33_000_000, envelope_remaining_rupiah: -3_000_000 })}
      />,
    );
    expect(getByText(/⚠ Envelope sudah terlampaui/i)).toBeTruthy();
  });

  it('shows envelope-empty state when envelope is null', () => {
    const { getByText } = render(
      <MaterialUsagePanel
        materialId="mat-bata"
        tier={2}
        requestedQuantity={200}
        requestedUnit="pcs"
        envelope={null}
      />,
    );
    expect(getByText(/Envelope belum ada di baseline/i)).toBeTruthy();
  });

  it('renders boq_item_count when present', () => {
    const { getByText } = render(
      <MaterialUsagePanel
        materialId="mat-bata"
        tier={2}
        requestedQuantity={200}
        requestedUnit="pcs"
        envelope={tier2Envelope({ boq_item_count: 8 })}
      />,
    );
    expect(getByText(/Melayani 8 item BoQ/i)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest office/screens/components/__tests__/MaterialUsagePanel.test.tsx`
Expected: FAIL — Tier 2 not yet rendered, only the placeholder is.

- [ ] **Step 3: Implement Tier 2 rendering**

Replace the contents of `office/screens/components/MaterialUsagePanel.tsx` with:

```typescript
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { COLORS, FONTS, RADIUS, SPACE, TYPE } from '../../../workflows/theme';
import type { EnvelopeWithPrice } from '../../../tools/envelopes';

export interface MaterialUsagePanelProps {
  materialId: string | null;
  customMaterialName?: string | null;
  tier: 1 | 2 | 3 | null;
  requestedQuantity: number;
  requestedUnit: string;
  boqItemId?: string | null;
  envelope: EnvelopeWithPrice | null;
  boqItem?: { planned: number; installed: number; code: string; label: string } | null;
}

function fmtNum(n: number): string {
  return n.toLocaleString('id-ID', { maximumFractionDigits: 2 });
}

function fmtRp(n: number): string {
  // Compact format: Rp 30 jt, Rp 1.2 jt, Rp 750rb, Rp 5
  if (Math.abs(n) >= 1_000_000) {
    const juta = n / 1_000_000;
    const rounded = juta.toFixed(juta < 10 ? 1 : 0);
    return `Rp ${rounded.replace(/\.0$/, '')} jt`;
  }
  if (Math.abs(n) >= 1000) {
    const ribu = Math.round(n / 1000);
    return `Rp ${ribu}rb`;
  }
  return `Rp ${Math.round(n)}`;
}

function burnColor(burnPct: number): string {
  if (burnPct > 100) return COLORS.critical;
  if (burnPct > 80) return COLORS.critical;
  if (burnPct > 50) return COLORS.warning;
  return COLORS.text;
}

export function MaterialUsagePanel(props: MaterialUsagePanelProps): React.ReactElement {
  // Unlinked material
  if (!props.materialId || props.tier == null) {
    return (
      <View style={[styles.panel, styles.panelWarning]}>
        <Text style={styles.warningText}>
          ⚠ Material tidak terdaftar di katalog. Tambahkan di Material Catalog
          untuk tracking envelope.
        </Text>
      </View>
    );
  }

  // Envelope not yet built (no baseline published, or material not in any AHS)
  if (!props.envelope) {
    return (
      <View style={[styles.panel, styles.panelInfo]}>
        <Text style={styles.infoText}>
          Envelope belum ada di baseline. Material ini belum dipakai di AHS manapun.
        </Text>
      </View>
    );
  }

  const env = props.envelope;

  if (props.tier === 2) {
    const overBudget = env.burn_pct > 100;
    const burnTextColor = burnColor(env.burn_pct);
    return (
      <View style={[styles.panel, overBudget && styles.panelCritical]}>
        <Text style={styles.sectionLabel}>Envelope kuantitas</Text>
        <Text style={[styles.lineMain, { color: burnTextColor }]}>
          Terpakai: {fmtNum(env.total_ordered)} / {fmtNum(env.total_planned)} {env.unit} ({env.burn_pct.toFixed(0)}%)
        </Text>
        <Text style={styles.lineSub}>
          Sisa: {fmtNum(env.remaining_to_order)} {env.unit}
        </Text>

        {env.baseline_unit_price != null && env.envelope_total_rupiah != null ? (
          <>
            <Text style={[styles.sectionLabel, { marginTop: SPACE.sm }]}>Anggaran</Text>
            <Text style={[styles.lineMain, { color: burnTextColor }]}>
              Terpakai: {fmtRp(env.envelope_used_rupiah ?? 0)} / {fmtRp(env.envelope_total_rupiah)}
            </Text>
            <Text style={styles.lineSub}>
              Sisa: {fmtRp(env.envelope_remaining_rupiah ?? 0)}
            </Text>
          </>
        ) : (
          <Text style={[styles.lineSub, styles.muted, { marginTop: SPACE.sm }]}>
            Anggaran tidak tersedia (harga acuan kosong di AHS).
          </Text>
        )}

        {env.boq_item_count > 0 && (
          <Text style={[styles.lineSub, styles.muted, { marginTop: SPACE.xs }]}>
            Melayani {env.boq_item_count} item BoQ
          </Text>
        )}

        {overBudget && (
          <Text style={styles.criticalText}>
            ⚠ Envelope sudah terlampaui ({env.burn_pct.toFixed(0)}%)
          </Text>
        )}
      </View>
    );
  }

  // Tier 1 and Tier 3 placeholders — implemented in Tasks 4 and 5
  return (
    <View style={styles.panel}>
      <Text>Tier {props.tier} placeholder</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    marginTop: SPACE.sm,
    padding: SPACE.md,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS,
    borderLeftWidth: 3,
    borderLeftColor: COLORS.border,
  },
  panelWarning: {
    borderLeftColor: COLORS.warning,
    backgroundColor: '#fff8e1',
  },
  panelInfo: {
    borderLeftColor: COLORS.info,
    backgroundColor: '#e3f2fd',
  },
  panelCritical: {
    borderLeftColor: COLORS.critical,
    backgroundColor: '#ffebee',
  },
  warningText: { fontSize: TYPE.sm, color: COLORS.text, fontFamily: FONTS.regular },
  infoText: { fontSize: TYPE.sm, color: COLORS.text, fontFamily: FONTS.regular },
  sectionLabel: { fontSize: TYPE.xs, color: COLORS.textSec, fontFamily: FONTS.bold, marginBottom: 2 },
  lineMain: { fontSize: TYPE.sm, color: COLORS.text, fontFamily: FONTS.regular },
  lineSub: { fontSize: TYPE.xs, color: COLORS.textSec, fontFamily: FONTS.regular },
  muted: { fontStyle: 'italic' },
  criticalText: { fontSize: TYPE.xs, color: COLORS.critical, fontFamily: FONTS.bold, marginTop: SPACE.xs },
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest office/screens/components/__tests__/MaterialUsagePanel.test.tsx`
Expected: PASS — all Tier 2 tests + the unlinked test from Task 2.

- [ ] **Step 5: Commit**

```bash
git add office/screens/components/MaterialUsagePanel.tsx office/screens/components/__tests__/MaterialUsagePanel.test.tsx
git commit -m "feat(approvals): MaterialUsagePanel Tier 2 rendering with quantity + Rupiah"
```

---

## Task 4: Tier 1 rendering (BoQ-bound)

**Files:**
- Modify: `office/screens/components/MaterialUsagePanel.tsx`
- Modify: `office/screens/components/__tests__/MaterialUsagePanel.test.tsx`

- [ ] **Step 1: Add failing tests for Tier 1**

Append to `office/screens/components/__tests__/MaterialUsagePanel.test.tsx`:

```typescript
const tier1BoqItem = (m: Partial<{ planned: number; installed: number; code: string; label: string }> = {}) => ({
  planned: 10.2,
  installed: 3.2,
  code: 'III.A.1',
  label: 'Sloof S24-1',
  ...m,
});

describe('MaterialUsagePanel — Tier 1', () => {
  it('renders BoQ planned/installed/remaining', () => {
    const { getByText } = render(
      <MaterialUsagePanel
        materialId="mat-beton"
        tier={1}
        requestedQuantity={2.5}
        requestedUnit="m3"
        boqItemId="boq-1"
        envelope={tier2Envelope({ tier: 1, material_name: 'Beton K-225', unit: 'm3', total_planned: 10.2, total_ordered: 3.2, remaining_to_order: 7.0, burn_pct: 31.4 })}
        boqItem={tier1BoqItem()}
      />,
    );
    expect(getByText(/III\.A\.1 — Sloof S24-1/)).toBeTruthy();
    expect(getByText(/Volume rencana:\s+10\.2 m3/)).toBeTruthy();
    expect(getByText(/Sudah dipasang:\s+3\.2 m3/)).toBeTruthy();
    expect(getByText(/Sisa BoQ:\s+7 m3/)).toBeTruthy();
    expect(getByText(/Setelah request:\s+4\.5 m3 tersisa/)).toBeTruthy();
  });

  it('renders red warning when request exceeds remaining', () => {
    const { getByText } = render(
      <MaterialUsagePanel
        materialId="mat-beton"
        tier={1}
        requestedQuantity={10}
        requestedUnit="m3"
        boqItemId="boq-1"
        envelope={tier2Envelope({ tier: 1, material_name: 'Beton K-225', unit: 'm3' })}
        boqItem={tier1BoqItem()}
      />,
    );
    expect(getByText(/⚠ Akan melampaui BoQ rencana/i)).toBeTruthy();
  });

  it('falls back to envelope view when boqItem is null', () => {
    const { getByText } = render(
      <MaterialUsagePanel
        materialId="mat-beton"
        tier={1}
        requestedQuantity={2.5}
        requestedUnit="m3"
        boqItemId="boq-orphan"
        envelope={tier2Envelope({ tier: 1, material_name: 'Beton K-225', unit: 'm3' })}
        boqItem={null}
      />,
    );
    // Falls back to envelope-style display; should not crash, should show envelope numbers
    expect(getByText(/Envelope kuantitas/i)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest office/screens/components/__tests__/MaterialUsagePanel.test.tsx`
Expected: FAIL — Tier 1 still on placeholder.

- [ ] **Step 3: Refactor — extract `renderTier2Like` helper, then add Tier 1 branch**

Replace the **entire** `MaterialUsagePanel.tsx` file contents (including all helpers and styles) with:

```typescript
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { COLORS, FONTS, RADIUS, SPACE, TYPE } from '../../../workflows/theme';
import type { EnvelopeWithPrice } from '../../../tools/envelopes';

export interface MaterialUsagePanelProps {
  materialId: string | null;
  customMaterialName?: string | null;
  tier: 1 | 2 | 3 | null;
  requestedQuantity: number;
  requestedUnit: string;
  boqItemId?: string | null;
  envelope: EnvelopeWithPrice | null;
  boqItem?: { planned: number; installed: number; code: string; label: string } | null;
}

function fmtNum(n: number): string {
  return n.toLocaleString('id-ID', { maximumFractionDigits: 2 });
}

function fmtRp(n: number): string {
  if (Math.abs(n) >= 1_000_000) {
    const juta = n / 1_000_000;
    const rounded = juta.toFixed(juta < 10 ? 1 : 0);
    return `Rp ${rounded.replace(/\.0$/, '')} jt`;
  }
  if (Math.abs(n) >= 1000) {
    const ribu = Math.round(n / 1000);
    return `Rp ${ribu}rb`;
  }
  return `Rp ${Math.round(n)}`;
}

function burnColor(burnPct: number): string {
  if (burnPct > 100) return COLORS.critical;
  if (burnPct > 80) return COLORS.critical;
  if (burnPct > 50) return COLORS.warning;
  return COLORS.text;
}

function renderTier2Like(env: EnvelopeWithPrice): React.ReactElement {
  const overBudget = env.burn_pct > 100;
  const burnTextColor = burnColor(env.burn_pct);
  return (
    <View style={[styles.panel, overBudget && styles.panelCritical]}>
      <Text style={styles.sectionLabel}>Envelope kuantitas</Text>
      <Text style={[styles.lineMain, { color: burnTextColor }]}>
        Terpakai: {fmtNum(env.total_ordered)} / {fmtNum(env.total_planned)} {env.unit} ({env.burn_pct.toFixed(0)}%)
      </Text>
      <Text style={styles.lineSub}>Sisa: {fmtNum(env.remaining_to_order)} {env.unit}</Text>
      {env.baseline_unit_price != null && env.envelope_total_rupiah != null ? (
        <>
          <Text style={[styles.sectionLabel, { marginTop: SPACE.sm }]}>Anggaran</Text>
          <Text style={[styles.lineMain, { color: burnTextColor }]}>
            Terpakai: {fmtRp(env.envelope_used_rupiah ?? 0)} / {fmtRp(env.envelope_total_rupiah)}
          </Text>
          <Text style={styles.lineSub}>Sisa: {fmtRp(env.envelope_remaining_rupiah ?? 0)}</Text>
        </>
      ) : (
        <Text style={[styles.lineSub, styles.muted, { marginTop: SPACE.sm }]}>
          Anggaran tidak tersedia (harga acuan kosong di AHS).
        </Text>
      )}
      {env.boq_item_count > 0 && (
        <Text style={[styles.lineSub, styles.muted, { marginTop: SPACE.xs }]}>
          Melayani {env.boq_item_count} item BoQ
        </Text>
      )}
      {overBudget && (
        <Text style={styles.criticalText}>⚠ Envelope sudah terlampaui ({env.burn_pct.toFixed(0)}%)</Text>
      )}
    </View>
  );
}

export function MaterialUsagePanel(props: MaterialUsagePanelProps): React.ReactElement {
  // Unlinked material
  if (!props.materialId || props.tier == null) {
    return (
      <View style={[styles.panel, styles.panelWarning]}>
        <Text style={styles.warningText}>
          ⚠ Material tidak terdaftar di katalog. Tambahkan di Material Catalog
          untuk tracking envelope.
        </Text>
      </View>
    );
  }

  // Envelope not yet built
  if (!props.envelope) {
    return (
      <View style={[styles.panel, styles.panelInfo]}>
        <Text style={styles.infoText}>
          Envelope belum ada di baseline. Material ini belum dipakai di AHS manapun.
        </Text>
      </View>
    );
  }

  const env = props.envelope;

  if (props.tier === 2) {
    return renderTier2Like(env);
  }

  if (props.tier === 1) {
    if (!props.boqItem) {
      // BoQ allocation orphan — defensive fallback to envelope-style render
      return renderTier2Like(env);
    }
    const remaining = props.boqItem.planned - props.boqItem.installed;
    const afterRequest = remaining - props.requestedQuantity;
    const overBoq = props.requestedQuantity > remaining;
    return (
      <View style={[styles.panel, overBoq && styles.panelCritical]}>
        <Text style={styles.sectionLabel}>BoQ {props.boqItem.code} — {props.boqItem.label}</Text>
        <Text style={styles.lineMain}>
          Volume rencana:   {fmtNum(props.boqItem.planned)} {props.requestedUnit}
        </Text>
        <Text style={styles.lineMain}>
          Sudah dipasang:    {fmtNum(props.boqItem.installed)} {props.requestedUnit}
        </Text>
        <Text style={styles.lineMain}>
          Sisa BoQ:          {fmtNum(remaining)} {props.requestedUnit}
        </Text>
        <Text style={[styles.lineMain, overBoq && { color: COLORS.critical }]}>
          Setelah request:   {fmtNum(afterRequest)} {props.requestedUnit} tersisa
        </Text>
        {overBoq && (
          <Text style={styles.criticalText}>
            ⚠ Akan melampaui BoQ rencana ({fmtNum(props.requestedQuantity - remaining)} {props.requestedUnit} over)
          </Text>
        )}
      </View>
    );
  }

  // Tier 3 placeholder — implemented in Task 5
  return (
    <View style={styles.panel}>
      <Text>Tier {props.tier} placeholder</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    marginTop: SPACE.sm,
    padding: SPACE.md,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS,
    borderLeftWidth: 3,
    borderLeftColor: COLORS.border,
  },
  panelWarning: { borderLeftColor: COLORS.warning, backgroundColor: '#fff8e1' },
  panelInfo: { borderLeftColor: COLORS.info, backgroundColor: '#e3f2fd' },
  panelCritical: { borderLeftColor: COLORS.critical, backgroundColor: '#ffebee' },
  warningText: { fontSize: TYPE.sm, color: COLORS.text, fontFamily: FONTS.regular },
  infoText: { fontSize: TYPE.sm, color: COLORS.text, fontFamily: FONTS.regular },
  sectionLabel: { fontSize: TYPE.xs, color: COLORS.textSec, fontFamily: FONTS.bold, marginBottom: 2 },
  lineMain: { fontSize: TYPE.sm, color: COLORS.text, fontFamily: FONTS.regular },
  lineSub: { fontSize: TYPE.xs, color: COLORS.textSec, fontFamily: FONTS.regular },
  muted: { fontStyle: 'italic' },
  criticalText: { fontSize: TYPE.xs, color: COLORS.critical, fontFamily: FONTS.bold, marginTop: SPACE.xs },
});
```

This is a complete file replacement — `renderTier2Like` is extracted as a helper, the main component dispatches by tier, and Tier 3 stays on the placeholder until Task 5.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest office/screens/components/__tests__/MaterialUsagePanel.test.tsx`
Expected: PASS — all Tier 1 + Tier 2 + skeleton tests.

- [ ] **Step 5: Commit**

```bash
git add office/screens/components/MaterialUsagePanel.tsx office/screens/components/__tests__/MaterialUsagePanel.test.tsx
git commit -m "feat(approvals): MaterialUsagePanel Tier 1 BoQ-bound rendering"
```

---

## Task 5: Tier 3 rendering (spend cap)

**Files:**
- Modify: `office/screens/components/MaterialUsagePanel.tsx`
- Modify: `office/screens/components/__tests__/MaterialUsagePanel.test.tsx`

- [ ] **Step 1: Add failing tests for Tier 3**

Append to `office/screens/components/__tests__/MaterialUsagePanel.test.tsx`:

```typescript
describe('MaterialUsagePanel — Tier 3', () => {
  it('renders spend cap with estimated cost', () => {
    const { getByText } = render(
      <MaterialUsagePanel
        materialId="mat-paku"
        tier={3}
        requestedQuantity={5}
        requestedUnit="kg"
        envelope={tier2Envelope({ tier: 3, material_name: 'Paku 7 cm', unit: 'kg', baseline_unit_price: 15_000, envelope_total_rupiah: null, envelope_used_rupiah: null, envelope_remaining_rupiah: null })}
      />,
    );
    expect(getByText(/Estimasi biaya:\s+Rp 75rb/i)).toBeTruthy();
    expect(getByText(/Spend cap per request:\s+Rp 5 jt/i)).toBeTruthy();
    expect(getByText(/1\.5%/)).toBeTruthy();   // 75k / 5jt = 1.5%
  });

  it('renders fallback when baseline_unit_price is missing', () => {
    const { getByText } = render(
      <MaterialUsagePanel
        materialId="mat-paku"
        tier={3}
        requestedQuantity={5}
        requestedUnit="kg"
        envelope={tier2Envelope({ tier: 3, material_name: 'Paku 7 cm', unit: 'kg', baseline_unit_price: null, envelope_total_rupiah: null, envelope_used_rupiah: null, envelope_remaining_rupiah: null })}
      />,
    );
    expect(getByText(/Estimasi biaya tidak tersedia/i)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest office/screens/components/__tests__/MaterialUsagePanel.test.tsx`
Expected: FAIL — Tier 3 still on placeholder.

- [ ] **Step 3: Implement Tier 3 rendering**

In `office/screens/components/MaterialUsagePanel.tsx`, replace the Tier 3 placeholder (the final `return` block) with:

```typescript
  if (props.tier === 3) {
    const TIER3_CAP = 5_000_000;
    if (env.baseline_unit_price == null) {
      return (
        <View style={styles.panel}>
          <Text style={[styles.lineSub, styles.muted]}>Estimasi biaya tidak tersedia (harga acuan kosong di AHS).</Text>
        </View>
      );
    }
    const estimatedCost = props.requestedQuantity * env.baseline_unit_price;
    const capPct = (estimatedCost / TIER3_CAP) * 100;
    const overCap = estimatedCost > TIER3_CAP;
    return (
      <View style={[styles.panel, overCap && styles.panelCritical]}>
        <Text style={styles.lineMain}>
          Estimasi biaya: {fmtRp(estimatedCost)}
        </Text>
        <Text style={styles.lineSub}>
          Spend cap per request: {fmtRp(TIER3_CAP)} ({capPct.toFixed(1)}% terpakai)
        </Text>
        {overCap && (
          <Text style={styles.criticalText}>⚠ Melampaui cap per request</Text>
        )}
      </View>
    );
  }

  // Defensive fallback: unknown tier
  return (
    <View style={[styles.panel, styles.panelWarning]}>
      <Text style={styles.warningText}>Material tier tidak terdefinisi.</Text>
    </View>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest office/screens/components/__tests__/MaterialUsagePanel.test.tsx`
Expected: PASS — all tier states green.

- [ ] **Step 5: Commit**

```bash
git add office/screens/components/MaterialUsagePanel.tsx office/screens/components/__tests__/MaterialUsagePanel.test.tsx
git commit -m "feat(approvals): MaterialUsagePanel Tier 3 spend cap rendering"
```

---

## Task 6: Wire MaterialUsagePanel into ApprovalsScreen

**Files:**
- Modify: `office/screens/ApprovalsScreen.tsx`

- [ ] **Step 1: Add import + state for envelope/boqItem maps**

Modify `office/screens/ApprovalsScreen.tsx`. Add to the imports near the top (around line 10):

```typescript
import { getEnvelopesByMaterialIds, type EnvelopeWithPrice } from '../../tools/envelopes';
import { MaterialUsagePanel } from './components/MaterialUsagePanel';
```

Add new state declarations next to the existing useState calls (after `setLoading` around line 134):

```typescript
  const [envelopeMap, setEnvelopeMap] = useState<Map<string, EnvelopeWithPrice>>(new Map());
  const [boqItemMap, setBoqItemMap] = useState<Map<string, { planned: number; installed: number; code: string; label: string }>>(new Map());
```

- [ ] **Step 2: Extend `loadData` to batch-fetch envelopes + BoQ items**

In the `loadData` callback (starts around line 136), after the existing data is loaded and `setRequests(nextRequests)` is called, add:

```typescript
      // Collect material_ids and boq_item_ids referenced by request lines
      const materialIds = new Set<string>();
      const boqItemIds = new Set<string>();
      for (const req of nextRequests) {
        for (const line of req.material_request_lines ?? []) {
          if (line.material_id) materialIds.add(line.material_id);
          for (const alloc of line.material_request_line_allocations ?? []) {
            if (alloc.boq_item_id) boqItemIds.add(alloc.boq_item_id);
          }
        }
      }

      // Batch fetch envelopes
      const envelopes = await getEnvelopesByMaterialIds(project.id, Array.from(materialIds));
      setEnvelopeMap(envelopes);

      // Batch fetch BoQ items (planned + installed for Tier 1)
      if (boqItemIds.size > 0) {
        const { data: boqRows } = await supabase
          .from('boq_items')
          .select('id, planned, installed, code, label')
          .in('id', Array.from(boqItemIds));
        const map = new Map<string, { planned: number; installed: number; code: string; label: string }>();
        for (const row of (boqRows ?? []) as Array<{ id: string; planned: number; installed: number; code: string; label: string }>) {
          map.set(row.id, { planned: row.planned, installed: row.installed, code: row.code, label: row.label });
        }
        setBoqItemMap(map);
      } else {
        setBoqItemMap(new Map());
      }
```

- [ ] **Step 3: Render `<MaterialUsagePanel>` per request line**

Find the Permintaan tab render block (around line 488-509). Replace the line-listing block:

```typescript
                {(request.material_request_lines ?? []).slice(0, 3).map(line => {
                  const allocationCount = line.material_request_line_allocations?.filter(allocation => allocation.boq_item_id).length ?? 0;
                  return (
                    <Text key={line.id} style={styles.meta}>
                      {getLineMaterialName(line)} · {line.quantity} {line.unit} · {line.tier === 2 ? `${allocationCount} item bulk` : line.tier === 3 ? 'stok umum' : 'BoQ spesifik'}
                    </Text>
                  );
                })}
                {(request.material_request_lines?.length ?? 0) > 3 && (
                  <Text style={styles.meta}>+{(request.material_request_lines?.length ?? 0) - 3} line material lainnya</Text>
                )}
```

with:

```typescript
                {(request.material_request_lines ?? []).map(line => {
                  const envelope = line.material_id ? envelopeMap.get(line.material_id) ?? null : null;
                  const firstAllocation = line.material_request_line_allocations?.find(a => a.boq_item_id);
                  const boqItem = firstAllocation?.boq_item_id ? boqItemMap.get(firstAllocation.boq_item_id) ?? null : null;
                  return (
                    <View key={line.id} style={{ marginTop: SPACE.sm }}>
                      <Text style={styles.itemSub}>
                        {getLineMaterialName(line)} — {line.quantity} {line.unit}{' '}
                        <Text style={styles.meta}>(Tier {line.tier})</Text>
                      </Text>
                      <MaterialUsagePanel
                        materialId={line.material_id}
                        customMaterialName={line.custom_material_name}
                        tier={line.tier}
                        requestedQuantity={line.quantity}
                        requestedUnit={line.unit}
                        boqItemId={firstAllocation?.boq_item_id ?? null}
                        envelope={envelope}
                        boqItem={boqItem}
                      />
                    </View>
                  );
                })}
```

(The `slice(0, 3)` truncation is removed because each line now gets a full panel — estimator needs to see all lines to make an informed decision.)

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 5: Run full test suite to confirm no regressions**

Run: `npx jest`
Expected: all passing tests still pass; new MaterialUsagePanel tests included.

- [ ] **Step 6: Commit**

```bash
git add office/screens/ApprovalsScreen.tsx
git commit -m "feat(approvals): wire MaterialUsagePanel into Permintaan cards with batch fetch"
```

---

## Task 7: Integration smoke test

**Files:**
- Create: `office/screens/components/__tests__/ApprovalsScreen.materialUsage.test.tsx`

This test exercises the data flow without rendering the full screen — it asserts the helper integration produces the data shape `MaterialUsagePanel` expects.

- [ ] **Step 1: Write the integration smoke test**

Create `office/screens/components/__tests__/ApprovalsScreen.materialUsage.test.tsx`:

```typescript
import { mergeEnvelopeWithBaselinePrice } from '../../../tools/envelopes';
import type { MaterialEnvelopeStatus } from '../../../tools/types';
import type { MaterialBaselinePriceSummary } from '../../../workflows/gates/gate2';

// Smoke test for the data flow ApprovalsScreen → MaterialUsagePanel
// without booting the React tree. We verify the helper produces the
// shape the component reads.
describe('Material usage data flow', () => {
  const env: MaterialEnvelopeStatus = {
    material_id: 'mat-bata',
    project_id: 'proj-1',
    material_code: 'AAC-BL07',
    material_name: 'Bata ringan 7.5 cm',
    tier: 2,
    unit: 'pcs',
    total_planned: 5000,
    total_ordered: 200,
    total_received: 0,
    remaining_to_order: 4800,
    burn_pct: 4,
    boq_item_count: 8,
  };

  const price: MaterialBaselinePriceSummary = {
    material_id: 'mat-bata',
    baseline_unit_price: 6000,
    min_unit_price: 5800,
    max_unit_price: 6200,
    sample_count: 3,
    spread_pct: 6.7,
  };

  it('produces shape compatible with MaterialUsagePanel.envelope prop', () => {
    const merged = mergeEnvelopeWithBaselinePrice(env, price);
    // Required fields read by Tier 2 render
    expect(typeof merged.total_ordered).toBe('number');
    expect(typeof merged.total_planned).toBe('number');
    expect(typeof merged.remaining_to_order).toBe('number');
    expect(typeof merged.burn_pct).toBe('number');
    expect(typeof merged.unit).toBe('string');
    expect(typeof merged.boq_item_count).toBe('number');
    // Required fields read by Rupiah block
    expect(typeof merged.envelope_total_rupiah).toBe('number');
    expect(typeof merged.envelope_used_rupiah).toBe('number');
    expect(typeof merged.envelope_remaining_rupiah).toBe('number');
    // Required field read by Tier 3 render
    expect(typeof merged.baseline_unit_price).toBe('number');
  });

  it('handles missing baseline price without crashing the component contract', () => {
    const merged = mergeEnvelopeWithBaselinePrice(env, null);
    expect(merged.baseline_unit_price).toBeNull();
    expect(merged.envelope_total_rupiah).toBeNull();
    // All envelope quantity fields still present
    expect(merged.total_ordered).toBe(200);
  });
});
```

- [ ] **Step 2: Run the test**

Run: `npx jest office/screens/components/__tests__/ApprovalsScreen.materialUsage.test.tsx`
Expected: PASS — both cases.

- [ ] **Step 3: Run full test suite as final check**

Run: `npx jest`
Expected: all green; no regressions.

- [ ] **Step 4: Commit**

```bash
git add office/screens/components/__tests__/ApprovalsScreen.materialUsage.test.tsx
git commit -m "test(approvals): smoke test material usage data flow"
```

---

## Final verification

- [ ] **Step 1: Type-check**

Run: `npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 2: All tests pass**

Run: `npx jest`
Expected: all passing.

- [ ] **Step 3: Manual QA on Vercel preview** (post-PR open)

- Login estimator → Approvals → Permintaan tab
- See card with at least one Tier 2 line (e.g. Bata ringan): verify envelope kuantitas + Rupiah render
- See card with at least one Tier 1 line (Beton/Besi): verify BoQ planned/installed/remaining math
- See card with custom_material_name (no material_id): verify warning state
- Approve a request → refresh → verify envelope `total_ordered` increased

- [ ] **Step 4: Commit summary**

Run: `git log --oneline origin/main..HEAD`
Expected: 7 commits matching the per-task commits above.

---

## Phase 2 follow-up (post-merge, separate spec/plan)

Once Phase 1 is in production:

1. Add `material_id UUID REFERENCES material_catalog(id)` to `mtns` table
2. Backfill via fuzzy match using `tools/boqParserV2/aiAssist/matchMaterialName.ts`
3. Render `<MaterialUsagePanel>` in MTN cards with the same data flow
4. Make `material_id` required on new MTN inserts after backfill is verified

This is intentionally a separate plan — Phase 1 ships value to estimator first.
