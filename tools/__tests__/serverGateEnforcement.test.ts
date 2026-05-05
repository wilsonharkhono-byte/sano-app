import {
  adminClient,
  cleanupTestData,
  createTestProject,
  createTestBoqItem,
  createTestMaterial,
  buildTier2Envelope,
  publishTestAhsVersion,
  submitRequest,
  readState,
} from './_serverGateHarness';

// Each fixture build does ~10 round trips to remote Supabase; the default 5s
// jest timeout isn't enough for integration tests that exercise triggers.
jest.setTimeout(30_000);

describe('server gate enforcement — harness smoke', () => {
  afterAll(async () => {
    await cleanupTestData();
  });

  it('connects to Supabase with service role and creates a project', async () => {
    const project = await createTestProject();
    expect(project.id).toMatch(/^[0-9a-f-]{36}$/);

    const { data, error } = await adminClient
      .from('projects')
      .select('id, name')
      .eq('id', project.id)
      .single();
    expect(error).toBeNull();
    expect(data?.name).toBe(project.name);
  });
});

describe('server gate enforcement — Tier 2', () => {
  it('client lies about flag → server overwrites with CRITICAL when over envelope', async () => {
    const project = await createTestProject();
    const material = await createTestMaterial({ tier: 2, unit: 'kg' });
    const boqItem = await createTestBoqItem(project.id, { planned: 100, installed: 0 });
    await buildTier2Envelope({ projectId: project.id, materialId: material.id, boqItemId: boqItem.id, totalPlanned: 100 });

    // Submit a Tier 2 request for 200 kg → 200% burn → CRITICAL (>120%).
    const { headerId, lineIds } = await submitRequest({
      projectId: project.id,
      requesterProfileId: project.ownerProfileId,
      primaryBoqItemId: boqItem.id,
      clientOverallFlag: 'OK', // client lies
      lines: [{
        tier: 2,
        materialId: material.id,
        quantity: 200,
        unit: 'kg',
        clientFlag: 'OK', // client lies
        allocations: [{
          boqItemId: boqItem.id,
          allocatedQuantity: 200,
          basis: 'TIER2_ENVELOPE',
        }],
      }],
    });

    const state = await readState(headerId, lineIds[0]);
    expect(state.lineFlag).toBe('CRITICAL');
    expect(state.overallFlag).toBe('CRITICAL');
    expect(state.overallStatus).toBe('AUTO_HOLD');
  });

  it('Tier 2 within envelope → OK flag, status stays PENDING', async () => {
    const project = await createTestProject();
    const material = await createTestMaterial({ tier: 2, unit: 'kg' });
    const boqItem = await createTestBoqItem(project.id, { planned: 100, installed: 0 });
    await buildTier2Envelope({ projectId: project.id, materialId: material.id, boqItemId: boqItem.id, totalPlanned: 100 });

    const { headerId, lineIds } = await submitRequest({
      projectId: project.id,
      requesterProfileId: project.ownerProfileId,
      primaryBoqItemId: boqItem.id,
      lines: [{
        tier: 2,
        materialId: material.id,
        quantity: 30, // 30% burn → OK (≤50%)
        unit: 'kg',
        allocations: [{ boqItemId: boqItem.id, allocatedQuantity: 30, basis: 'TIER2_ENVELOPE' }],
      }],
    });

    const state = await readState(headerId, lineIds[0]);
    expect(state.lineFlag).toBe('OK');
    expect(state.overallFlag).toBe('OK');
    expect(state.overallStatus).toBe('PENDING');
  });
});

describe('server gate enforcement — Tier 3', () => {
  it('Tier 3 spend > Rp 5jt → WARNING, no auto-hold', async () => {
    const project = await createTestProject();
    const material = await createTestMaterial({ tier: 3, unit: 'pcs' });
    const boqItem = await createTestBoqItem(project.id, { planned: 100, installed: 0 });
    // Unit price 1000 × qty 6000 = 6,000,000 → over Rp 5jt cap.
    await publishTestAhsVersion({
      projectId: project.id,
      boqItemId: boqItem.id,
      prices: [{ materialId: material.id, unitPrice: 1000, tier: 3, unit: 'pcs' }],
    });

    const { headerId, lineIds } = await submitRequest({
      projectId: project.id,
      requesterProfileId: project.ownerProfileId,
      primaryBoqItemId: boqItem.id,
      lines: [{
        tier: 3,
        materialId: material.id,
        quantity: 6000,
        unit: 'pcs',
        clientFlag: 'OK',
        allocations: [{ boqItemId: boqItem.id, allocatedQuantity: 6000, basis: 'GENERAL_STOCK' }],
      }],
    });

    const state = await readState(headerId, lineIds[0]);
    expect(state.lineFlag).toBe('WARNING');
    expect(state.overallFlag).toBe('WARNING');
    expect(state.overallStatus).toBe('PENDING'); // Tier 3 WARNING does NOT auto-hold
  });

  it('Tier 3 spend ≤ Rp 5jt → OK', async () => {
    const project = await createTestProject();
    const material = await createTestMaterial({ tier: 3, unit: 'pcs' });
    const boqItem = await createTestBoqItem(project.id, { planned: 100, installed: 0 });
    await publishTestAhsVersion({
      projectId: project.id,
      boqItemId: boqItem.id,
      prices: [{ materialId: material.id, unitPrice: 1000, tier: 3, unit: 'pcs' }],
    });

    const { headerId, lineIds } = await submitRequest({
      projectId: project.id,
      requesterProfileId: project.ownerProfileId,
      primaryBoqItemId: boqItem.id,
      lines: [{
        tier: 3,
        materialId: material.id,
        quantity: 1000, // 1000 × 1000 = 1jt → under cap
        unit: 'pcs',
        allocations: [{ boqItemId: boqItem.id, allocatedQuantity: 1000, basis: 'GENERAL_STOCK' }],
      }],
    });

    const state = await readState(headerId, lineIds[0]);
    expect(state.lineFlag).toBe('OK');
    expect(state.overallFlag).toBe('OK');
    expect(state.overallStatus).toBe('PENDING');
  });
});

describe('server gate enforcement — Tier 1', () => {
  it('Tier 1 within BoQ remaining → OK after allocation insert', async () => {
    const project = await createTestProject();
    const material = await createTestMaterial({ tier: 1, unit: 'kg' });
    const boqItem = await createTestBoqItem(project.id, { planned: 1000, installed: 100 });
    // remaining = 900. Request 200 → 200/900 = 0.22 → < 0.5 → OK.

    const { headerId, lineIds } = await submitRequest({
      projectId: project.id,
      requesterProfileId: project.ownerProfileId,
      primaryBoqItemId: boqItem.id,
      lines: [{
        tier: 1,
        materialId: material.id,
        quantity: 200,
        unit: 'kg',
        allocations: [{ boqItemId: boqItem.id, allocatedQuantity: 200, basis: 'DIRECT' }],
      }],
    });

    const state = await readState(headerId, lineIds[0]);
    expect(state.lineFlag).toBe('OK');
    expect(state.overallFlag).toBe('OK');
    expect(state.overallStatus).toBe('PENDING');
  });

  it('Tier 1 over BoQ by 35% → CRITICAL + AUTO_HOLD after allocation insert', async () => {
    const project = await createTestProject();
    const material = await createTestMaterial({ tier: 1, unit: 'kg' });
    const boqItem = await createTestBoqItem(project.id, { planned: 1000, installed: 100 });
    // remaining = 900. Request 1215 → 1215/900 = 1.35 → > 1.3 → CRITICAL.

    const { headerId, lineIds } = await submitRequest({
      projectId: project.id,
      requesterProfileId: project.ownerProfileId,
      primaryBoqItemId: boqItem.id,
      lines: [{
        tier: 1,
        materialId: material.id,
        quantity: 1215,
        unit: 'kg',
        clientFlag: 'OK', // client lies
        allocations: [{ boqItemId: boqItem.id, allocatedQuantity: 1215, basis: 'DIRECT' }],
      }],
    });

    const state = await readState(headerId, lineIds[0]);
    expect(state.lineFlag).toBe('CRITICAL');
    expect(state.overallFlag).toBe('CRITICAL');
    expect(state.overallStatus).toBe('AUTO_HOLD');
  });

  it('Tier 1 line WITHOUT allocation insert → flag stays at WARNING placeholder', async () => {
    const project = await createTestProject();
    const material = await createTestMaterial({ tier: 1, unit: 'kg' });
    const boqItem = await createTestBoqItem(project.id, { planned: 1000, installed: 100 });

    // Submit a line but skip allocations.
    const { headerId, lineIds } = await submitRequest({
      projectId: project.id,
      requesterProfileId: project.ownerProfileId,
      primaryBoqItemId: boqItem.id,
      lines: [{
        tier: 1,
        materialId: material.id,
        quantity: 200,
        unit: 'kg',
        allocations: [], // intentionally none
      }],
    });

    const state = await readState(headerId, lineIds[0]);
    expect(state.lineFlag).toBe('WARNING');
    expect(state.overallFlag).toBe('WARNING');
    expect(state.overallStatus).toBe('PENDING'); // WARNING does NOT auto-hold
  });

  it('Tier 1 placeholder→real flag transition: insert line then over-budget allocation', async () => {
    const project = await createTestProject();
    const material = await createTestMaterial({ tier: 1, unit: 'kg' });
    const boqItem = await createTestBoqItem(project.id, { planned: 1000, installed: 100 });

    // Step 1: insert header + line WITHOUT allocations.
    const { headerId, lineIds } = await submitRequest({
      projectId: project.id,
      requesterProfileId: project.ownerProfileId,
      primaryBoqItemId: boqItem.id,
      lines: [{
        tier: 1,
        materialId: material.id,
        quantity: 1215, // would be CRITICAL once allocation fixes the boq link
        unit: 'kg',
        allocations: [],
      }],
    });
    const beforeAlloc = await readState(headerId, lineIds[0]);
    expect(beforeAlloc.lineFlag).toBe('WARNING'); // placeholder
    expect(beforeAlloc.overallFlag).toBe('WARNING');
    expect(beforeAlloc.overallStatus).toBe('PENDING');

    // Step 2: insert DIRECT allocation pointing at over-budget BoQ.
    const { error } = await adminClient.from('material_request_line_allocations').insert({
      request_line_id: lineIds[0],
      boq_item_id: boqItem.id,
      allocated_quantity: 1215,
      proportion_pct: 100,
      allocation_basis: 'DIRECT',
    });
    expect(error).toBeNull();

    const afterAlloc = await readState(headerId, lineIds[0]);
    expect(afterAlloc.lineFlag).toBe('CRITICAL'); // recomputed by Trigger 3
    expect(afterAlloc.overallFlag).toBe('CRITICAL');
    expect(afterAlloc.overallStatus).toBe('AUTO_HOLD');
  });
});
