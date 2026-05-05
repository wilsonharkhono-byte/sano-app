import {
  adminClient,
  cleanupTestData,
  createTestProject,
} from './_serverGateHarness';

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
