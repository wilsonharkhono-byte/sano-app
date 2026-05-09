import {
  adminClient,
  cleanupTestData,
  createTestProject,
  assignToProject,
  countNotifications,
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
