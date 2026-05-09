import {
  adminClient,
  cleanupTestData,
  createTestProject,
  assignToProject,
  countNotifications,
  createTestBoqItem,
  createTestMaterial,
  buildTier2Envelope,
  submitRequest,
} from './_serverGateHarness';

jest.setTimeout(30_000);

afterAll(async () => {
  await cleanupTestData();
});

describe('notification dispatch — harness smoke', () => {
  it('countNotifications returns 0 for a fresh project', async () => {
    const project = await createTestProject();
    const count = await countNotifications({ projectId: project.id });
    expect(count).toBe(0);
  });

  it('assignToProject inserts a project_assignments row', async () => {
    const project = await createTestProject();
    await assignToProject(project.id, project.ownerProfileId);

    const { data, error } = await adminClient
      .from('project_assignments')
      .select('user_id')
      .eq('project_id', project.id);
    expect(error).toBeNull();
    expect(data?.map(r => r.user_id)).toContain(project.ownerProfileId);
  });
});

describe('notification dispatch — header status', () => {
  it('AUTO_HOLD triggered by Claim 1 enqueues for all project members', async () => {
    const project = await createTestProject();
    const material = await createTestMaterial({ tier: 2, unit: 'kg' });
    const boqItem = await createTestBoqItem(project.id, { planned: 100, installed: 0 });
    await buildTier2Envelope({
      projectId: project.id,
      materialId: material.id,
      boqItemId: boqItem.id,
      totalPlanned: 100,
    });

    // Assign 3 distinct users (each createTestProject also creates an auth user).
    const second = await createTestProject();
    const third = await createTestProject();
    await assignToProject(project.id, project.ownerProfileId);
    await assignToProject(project.id, second.ownerProfileId);
    await assignToProject(project.id, third.ownerProfileId);

    // Submit an over-envelope Tier 2 request → server promotes to AUTO_HOLD.
    await submitRequest({
      projectId: project.id,
      requesterProfileId: project.ownerProfileId,
      primaryBoqItemId: boqItem.id,
      lines: [{
        tier: 2,
        materialId: material.id,
        quantity: 200, // >120% burn → CRITICAL → AUTO_HOLD
        unit: 'kg',
        allocations: [{ boqItemId: boqItem.id, allocatedQuantity: 200, basis: 'TIER2_ENVELOPE' }],
      }],
    });

    const count = await countNotifications({
      projectId: project.id,
      type: 'AUTO_HOLD',
    });
    expect(count).toBe(3); // 3 members, no actor exclusion (system-driven event)
  });

  it('APPROVED enqueues for all members except the reviewer who approved', async () => {
    const project = await createTestProject();
    const material = await createTestMaterial({ tier: 2, unit: 'kg' });
    const boqItem = await createTestBoqItem(project.id, { planned: 100, installed: 0 });
    await buildTier2Envelope({
      projectId: project.id,
      materialId: material.id,
      boqItemId: boqItem.id,
      totalPlanned: 100,
    });
    const reviewer = await createTestProject(); // borrows helper to spawn an extra user
    await assignToProject(project.id, project.ownerProfileId);
    await assignToProject(project.id, reviewer.ownerProfileId);

    const { headerId } = await submitRequest({
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

    // Reviewer approves (sets reviewed_by + status).
    await adminClient
      .from('material_request_headers')
      .update({ overall_status: 'APPROVED', reviewed_by: reviewer.ownerProfileId })
      .eq('id', headerId);

    const allMembersCount = await countNotifications({
      projectId: project.id,
      type: 'APPROVED',
    });
    expect(allMembersCount).toBe(1); // 2 members, minus the reviewer = 1

    const reviewerCount = await countNotifications({
      projectId: project.id,
      recipientUserId: reviewer.ownerProfileId,
      type: 'APPROVED',
    });
    expect(reviewerCount).toBe(0); // self-suppressed
  });

  it('REJECTED enqueues for all members except the reviewer', async () => {
    const project = await createTestProject();
    const material = await createTestMaterial({ tier: 2, unit: 'kg' });
    const boqItem = await createTestBoqItem(project.id, { planned: 100, installed: 0 });
    await buildTier2Envelope({
      projectId: project.id,
      materialId: material.id,
      boqItemId: boqItem.id,
      totalPlanned: 100,
    });
    const reviewer = await createTestProject();
    await assignToProject(project.id, project.ownerProfileId);
    await assignToProject(project.id, reviewer.ownerProfileId);

    const { headerId } = await submitRequest({
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
      .update({ overall_status: 'REJECTED', reviewed_by: reviewer.ownerProfileId })
      .eq('id', headerId);

    const count = await countNotifications({
      projectId: project.id,
      type: 'REJECTED',
    });
    expect(count).toBe(1);
  });

  it('Idempotent: resaving header with same status does NOT re-enqueue', async () => {
    const project = await createTestProject();
    const material = await createTestMaterial({ tier: 2, unit: 'kg' });
    const boqItem = await createTestBoqItem(project.id, { planned: 100, installed: 0 });
    await buildTier2Envelope({
      projectId: project.id,
      materialId: material.id,
      boqItemId: boqItem.id,
      totalPlanned: 100,
    });
    const reviewer = await createTestProject();
    await assignToProject(project.id, project.ownerProfileId);
    await assignToProject(project.id, reviewer.ownerProfileId);

    const { headerId } = await submitRequest({
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

    // First approval → 1 notification (reviewer self-suppressed).
    await adminClient
      .from('material_request_headers')
      .update({ overall_status: 'APPROVED', reviewed_by: reviewer.ownerProfileId })
      .eq('id', headerId);
    expect(await countNotifications({ projectId: project.id, type: 'APPROVED' })).toBe(1);

    // Resave WITHOUT changing status (e.g., touching reviewed_at) → no new notification.
    await adminClient
      .from('material_request_headers')
      .update({ reviewed_at: new Date().toISOString() })
      .eq('id', headerId);
    expect(await countNotifications({ projectId: project.id, type: 'APPROVED' })).toBe(1);
  });
});

describe('notification dispatch — PO and receipt events', () => {
  it('PO_READY enqueues for all project members on purchase_orders insert', async () => {
    const project = await createTestProject();
    await assignToProject(project.id, project.ownerProfileId);
    const second = await createTestProject();
    await assignToProject(project.id, second.ownerProfileId);

    const { error } = await adminClient.from('purchase_orders').insert({
      project_id: project.id,
      po_number: 'PO-TEST-001',
      boq_ref: 'BOQ-1',
      supplier: 'Test Supplier',
      material_name: 'Test Material',
      quantity: 100,
      unit: 'kg',
      ordered_date: new Date().toISOString().slice(0, 10),
    });
    expect(error).toBeNull();

    const count = await countNotifications({
      projectId: project.id,
      type: 'PO_READY',
    });
    expect(count).toBe(2);
  });

  it('RECEIPT_MISMATCH enqueues only when gate3_flag is WARNING or CRITICAL', async () => {
    const project = await createTestProject();
    const second = await createTestProject(); // additional project member, will receive the notification
    await assignToProject(project.id, project.ownerProfileId);
    await assignToProject(project.id, second.ownerProfileId);

    // First insert a PO so receipts can reference it.
    const { data: po, error: poErr } = await adminClient
      .from('purchase_orders')
      .insert({
        project_id: project.id,
        po_number: 'PO-RM-001',
        boq_ref: 'BOQ-1',
        supplier: 'Sup',
        material_name: 'Mat',
        quantity: 100,
        unit: 'kg',
        ordered_date: new Date().toISOString().slice(0, 10),
      })
      .select('id')
      .single();
    expect(poErr).toBeNull();

    // Insert receipt with gate3_flag='OK' → no notification.
    await adminClient.from('receipts').insert({
      po_id: po!.id,
      project_id: project.id,
      received_by: project.ownerProfileId,
      gate3_flag: 'OK',
    });
    expect(await countNotifications({ projectId: project.id, type: 'RECEIPT_MISMATCH' })).toBe(0);

    // Insert receipt with gate3_flag='WARNING' → 1 notification (the second
    // member; the receiver is excluded as the actor).
    await adminClient.from('receipts').insert({
      po_id: po!.id,
      project_id: project.id,
      received_by: project.ownerProfileId,
      gate3_flag: 'WARNING',
    });
    expect(await countNotifications({ projectId: project.id, type: 'RECEIPT_MISMATCH' })).toBe(1);
  });
});
