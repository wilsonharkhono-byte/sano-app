import {
  adminClient,
  cleanupTestData,
  createTestProject,
  createTestBoqItem,
  createTestMaterial,
  buildTier2Envelope,
  buildTier3Envelope,
  publishTestAhsVersion,
  submitRequest,
  readState,
  prodDbTestsEnabled,
} from './_serverGateHarness';

// Prod-DB integration suite — skips by default; opt in via ALLOW_PROD_DB_TESTS=1
// with SUPABASE_URL pointed at a disposable project (see harness).
const describeDb = prodDbTestsEnabled ? describe : describe.skip;

// Each fixture build does ~10 round trips to remote Supabase; the default 5s
// jest timeout isn't enough for integration tests that exercise triggers.
jest.setTimeout(30_000);

// File-level afterAll ensures cleanup runs after every describe block, not
// just the first one — otherwise test rows from later describes persist
// between runs.
afterAll(async () => {
  await cleanupTestData();
});

describeDb('server gate enforcement — harness smoke', () => {
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

describeDb('server gate enforcement — Tier 2', () => {
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

describeDb('server gate enforcement — Tier 3', () => {
  // Budget envelope: totalPlanned=100 pcs × benchmarkUnitPrice=10,000 = Rp 1,000,000 budget.
  // burn % = (committed + qty × effective) / budget_total × 100.

  it('Tier 3 order crosses >120% burn → CRITICAL, no auto-hold', async () => {
    const project = await createTestProject();
    const material = await createTestMaterial({ tier: 3, unit: 'pcs' });
    const boqItem = await createTestBoqItem(project.id, { planned: 100, installed: 0 });
    // budget_total = 100 × 10,000 = 1,000,000. Request 130 pcs × 10,000 = 1,300,000 → 130% → CRITICAL.
    await buildTier3Envelope({
      projectId: project.id,
      materialId: material.id,
      boqItemId: boqItem.id,
      totalPlanned: 100,
      benchmarkUnitPrice: 10_000,
      unit: 'pcs',
    });

    const { headerId, lineIds } = await submitRequest({
      projectId: project.id,
      requesterProfileId: project.ownerProfileId,
      primaryBoqItemId: boqItem.id,
      lines: [{
        tier: 3,
        materialId: material.id,
        quantity: 130, // 130 × 10,000 = 1,300,000 → 130% → CRITICAL
        unit: 'pcs',
        clientFlag: 'OK', // client lies
        allocations: [{ boqItemId: boqItem.id, allocatedQuantity: 130, basis: 'GENERAL_STOCK' }],
      }],
    });

    const state = await readState(headerId, lineIds[0]);
    expect(state.lineFlag).toBe('CRITICAL');
    expect(state.overallFlag).toBe('CRITICAL');
    expect(state.overallStatus).toBe('AUTO_HOLD'); // CRITICAL does auto-hold
  });

  it('Tier 3 order crosses >80% but ≤100% burn → WARNING, no auto-hold', async () => {
    const project = await createTestProject();
    const material = await createTestMaterial({ tier: 3, unit: 'pcs' });
    const boqItem = await createTestBoqItem(project.id, { planned: 100, installed: 0 });
    // budget_total = 100 × 10,000 = 1,000,000. Request 90 pcs × 10,000 = 900,000 → 90% → WARNING.
    await buildTier3Envelope({
      projectId: project.id,
      materialId: material.id,
      boqItemId: boqItem.id,
      totalPlanned: 100,
      benchmarkUnitPrice: 10_000,
      unit: 'pcs',
    });

    const { headerId, lineIds } = await submitRequest({
      projectId: project.id,
      requesterProfileId: project.ownerProfileId,
      primaryBoqItemId: boqItem.id,
      lines: [{
        tier: 3,
        materialId: material.id,
        quantity: 90, // 90 × 10,000 = 900,000 → 90% → WARNING
        unit: 'pcs',
        clientFlag: 'OK',
        allocations: [{ boqItemId: boqItem.id, allocatedQuantity: 90, basis: 'GENERAL_STOCK' }],
      }],
    });

    const state = await readState(headerId, lineIds[0]);
    expect(state.lineFlag).toBe('WARNING');
    expect(state.overallFlag).toBe('WARNING');
    expect(state.overallStatus).toBe('PENDING'); // WARNING does NOT auto-hold
  });

  it('Tier 3 order comfortably within budget (≤50% burn) → OK', async () => {
    const project = await createTestProject();
    const material = await createTestMaterial({ tier: 3, unit: 'pcs' });
    const boqItem = await createTestBoqItem(project.id, { planned: 100, installed: 0 });
    // budget_total = 100 × 10,000 = 1,000,000. Request 40 pcs × 10,000 = 400,000 → 40% → OK.
    await buildTier3Envelope({
      projectId: project.id,
      materialId: material.id,
      boqItemId: boqItem.id,
      totalPlanned: 100,
      benchmarkUnitPrice: 10_000,
      unit: 'pcs',
    });

    const { headerId, lineIds } = await submitRequest({
      projectId: project.id,
      requesterProfileId: project.ownerProfileId,
      primaryBoqItemId: boqItem.id,
      lines: [{
        tier: 3,
        materialId: material.id,
        quantity: 40, // 40 × 10,000 = 400,000 → 40% → OK
        unit: 'pcs',
        allocations: [{ boqItemId: boqItem.id, allocatedQuantity: 40, basis: 'GENERAL_STOCK' }],
      }],
    });

    const state = await readState(headerId, lineIds[0]);
    expect(state.lineFlag).toBe('OK');
    expect(state.overallFlag).toBe('OK');
    expect(state.overallStatus).toBe('PENDING');
  });

  it('Tier 3 material with no price-book entry → WARNING (cannot evaluate)', async () => {
    const project = await createTestProject();
    // Material with no ahs_price_book entry → v_material_budget_status has no row → WARNING.
    const material = await createTestMaterial({ tier: 3, unit: 'pcs' });
    const boqItem = await createTestBoqItem(project.id, { planned: 100, installed: 0 });
    // Intentionally do NOT call buildTier3Envelope — no price book, no planned demand.

    const { headerId, lineIds } = await submitRequest({
      projectId: project.id,
      requesterProfileId: project.ownerProfileId,
      primaryBoqItemId: boqItem.id,
      lines: [{
        tier: 3,
        materialId: material.id,
        quantity: 10,
        unit: 'pcs',
        clientFlag: 'OK', // client lies
        allocations: [{ boqItemId: boqItem.id, allocatedQuantity: 10, basis: 'GENERAL_STOCK' }],
      }],
    });

    const state = await readState(headerId, lineIds[0]);
    expect(state.lineFlag).toBe('WARNING'); // no price-book → block (never silent pass)
    expect(state.overallFlag).toBe('WARNING');
    expect(state.overallStatus).toBe('PENDING'); // WARNING does NOT auto-hold
  });
});

describeDb('server gate enforcement — Tier 4', () => {
  it('Tier 4 untracked consumable always → OK regardless of spend', async () => {
    const project = await createTestProject();
    const material = await createTestMaterial({ tier: 4, unit: 'pcs' });
    const boqItem = await createTestBoqItem(project.id, { planned: 100, installed: 0 });

    // No envelope needed — Tier 4 is explicitly untracked (mirrors evaluateTier4Untracked).
    const { headerId, lineIds } = await submitRequest({
      projectId: project.id,
      requesterProfileId: project.ownerProfileId,
      primaryBoqItemId: boqItem.id,
      lines: [{
        tier: 4,
        materialId: material.id,
        quantity: 999_999, // enormous quantity — must still be OK for untracked tier
        unit: 'pcs',
        clientFlag: 'OK',
        allocations: [{ boqItemId: boqItem.id, allocatedQuantity: 999_999, basis: 'GENERAL_STOCK' }],
      }],
    });

    const state = await readState(headerId, lineIds[0]);
    expect(state.lineFlag).toBe('OK'); // dispatch_line_flag returns 'OK' for tier 4
    expect(state.overallFlag).toBe('OK');
    expect(state.overallStatus).toBe('PENDING');
  });
});

describeDb('server gate enforcement — Tier 1', () => {
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

  // Regression test: catches a previous bug where compute_tier1_flag included
  // the current allocation in 'already_ordered', causing self-counting.
  // Pre-fix: 540/360 ratio = 1.5 → CRITICAL. Post-fix: 540/900 = 0.6 → INFO.
  it('Tier 1 borderline 540/900 → INFO (does not double-count current request)', async () => {
    const project = await createTestProject();
    const material = await createTestMaterial({ tier: 1, unit: 'kg' });
    const boqItem = await createTestBoqItem(project.id, { planned: 1000, installed: 100 });
    // remaining = 900. Request 540 → 540/900 = 0.6 → > 0.5 → INFO.

    const { headerId, lineIds } = await submitRequest({
      projectId: project.id,
      requesterProfileId: project.ownerProfileId,
      primaryBoqItemId: boqItem.id,
      lines: [{
        tier: 1,
        materialId: material.id,
        quantity: 540,
        unit: 'kg',
        allocations: [{ boqItemId: boqItem.id, allocatedQuantity: 540, basis: 'DIRECT' }],
      }],
    });

    const state = await readState(headerId, lineIds[0]);
    expect(state.lineFlag).toBe('INFO');
    expect(state.overallFlag).toBe('INFO');
    expect(state.overallStatus).toBe('PENDING'); // INFO does not auto-hold
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

describeDb('server gate enforcement — reviewer status preservation', () => {
  it('header in APPROVED status survives line UPDATE (flag updates, status stays)', async () => {
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
        quantity: 30, // OK initially
        unit: 'kg',
        allocations: [{ boqItemId: boqItem.id, allocatedQuantity: 30, basis: 'TIER2_ENVELOPE' }],
      }],
    });

    // Reviewer manually approves.
    await adminClient
      .from('material_request_headers')
      .update({ overall_status: 'APPROVED' })
      .eq('id', headerId);

    // Estimator updates the line quantity to over-envelope.
    await adminClient
      .from('material_request_lines')
      .update({ quantity: 200 })
      .eq('id', lineIds[0]);

    const state = await readState(headerId, lineIds[0]);
    expect(state.lineFlag).toBe('CRITICAL'); // flag updates to current truth
    expect(state.overallFlag).toBe('CRITICAL');
    expect(state.overallStatus).toBe('APPROVED'); // reviewer decision preserved
  });

  it('header in REJECTED status survives line UPDATE', async () => {
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
        quantity: 30,
        unit: 'kg',
        allocations: [{ boqItemId: boqItem.id, allocatedQuantity: 30, basis: 'TIER2_ENVELOPE' }],
      }],
    });

    await adminClient
      .from('material_request_headers')
      .update({ overall_status: 'REJECTED' })
      .eq('id', headerId);

    await adminClient
      .from('material_request_lines')
      .update({ quantity: 200 })
      .eq('id', lineIds[0]);

    const state = await readState(headerId, lineIds[0]);
    expect(state.lineFlag).toBe('CRITICAL');
    expect(state.overallStatus).toBe('REJECTED');
  });
});

describeDb('server gate enforcement — edge cases', () => {
  it('UPDATE line quantity recomputes flag and re-aggregates header', async () => {
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
        quantity: 30, // OK
        unit: 'kg',
        allocations: [{ boqItemId: boqItem.id, allocatedQuantity: 30, basis: 'TIER2_ENVELOPE' }],
      }],
    });

    expect((await readState(headerId, lineIds[0])).lineFlag).toBe('OK');

    // Estimator edits line up to over-envelope.
    await adminClient.from('material_request_lines').update({ quantity: 200 }).eq('id', lineIds[0]);

    const after = await readState(headerId, lineIds[0]);
    expect(after.lineFlag).toBe('CRITICAL');
    expect(after.overallStatus).toBe('AUTO_HOLD');
  });

  it('DELETE allocation regresses Tier 1 line to WARNING placeholder', async () => {
    const project = await createTestProject();
    const material = await createTestMaterial({ tier: 1, unit: 'kg' });
    const boqItem = await createTestBoqItem(project.id, { planned: 1000, installed: 100 });

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

    expect((await readState(headerId, lineIds[0])).lineFlag).toBe('OK');

    // Delete the only allocation.
    const { error } = await adminClient
      .from('material_request_line_allocations')
      .delete()
      .eq('request_line_id', lineIds[0]);
    expect(error).toBeNull();

    const after = await readState(headerId, lineIds[0]);
    expect(after.lineFlag).toBe('WARNING');
    expect(after.overallFlag).toBe('WARNING');
  });

  it('DELETE last line aggregates header flag to OK', async () => {
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
        quantity: 200, // CRITICAL
        unit: 'kg',
        allocations: [{ boqItemId: boqItem.id, allocatedQuantity: 200, basis: 'TIER2_ENVELOPE' }],
      }],
    });
    expect((await readState(headerId)).overallFlag).toBe('CRITICAL');

    await adminClient.from('material_request_lines').delete().eq('id', lineIds[0]);

    const after = await readState(headerId);
    expect(after.overallFlag).toBe('OK'); // no lines = no risk
    // Note: status was AUTO_HOLD, stays AUTO_HOLD per "preserve previous state" rule.
    expect(after.overallStatus).toBe('AUTO_HOLD');
  });

  it('Tier 2 with material_id=null → flag = OK (graceful degradation)', async () => {
    const project = await createTestProject();
    const boqItem = await createTestBoqItem(project.id, { planned: 100, installed: 0 });

    const { headerId, lineIds } = await submitRequest({
      projectId: project.id,
      requesterProfileId: project.ownerProfileId,
      primaryBoqItemId: boqItem.id,
      lines: [{
        tier: 2,
        materialId: null,
        customName: 'custom-tier2',
        quantity: 9999, // would be CRITICAL if we had material context
        unit: 'kg',
        allocations: [{ boqItemId: boqItem.id, allocatedQuantity: 9999, basis: 'TIER2_ENVELOPE' }],
      }],
    });

    const state = await readState(headerId, lineIds[0]);
    expect(state.lineFlag).toBe('OK');
    expect(state.overallStatus).toBe('PENDING');
  });
});
