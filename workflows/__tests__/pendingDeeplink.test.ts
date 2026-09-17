// workflows/__tests__/pendingDeeplink.test.ts
import { queueDeeplink, routeDeeplink, takeDeeplink } from '../pendingDeeplink';

const ctx = (currentProjectId: string | null, visible: string[] = ['p1', 'p2']) => ({
  currentProjectId,
  visibleProjectIds: visible,
  setActiveProject: jest.fn(),
  navigate: jest.fn(),
});

beforeEach(() => {
  takeDeeplink();
});

describe('routeDeeplink', () => {
  it('navigates at once, with a fresh params object, on the current project', () => {
    const c = ctx('p1');
    const params = { projectId: 'p1', claimId: 'c1', module: 'progress' };
    expect(routeDeeplink('Progres', params, c)).toBe('navigated');
    expect(c.navigate).toHaveBeenCalledWith('Progres', params);
    expect(c.navigate.mock.calls[0][1]).not.toBe(params);
    expect(c.setActiveProject).not.toHaveBeenCalled();
    expect(takeDeeplink()).toBeNull();
  });

  it('switches to another visible project first and queues the navigation once', () => {
    const c = ctx('p1');
    expect(routeDeeplink('Reports', { projectId: 'p2', initialSection: 'klaim' }, c)).toBe('queued');
    expect(c.setActiveProject).toHaveBeenCalledWith('p2');
    expect(c.navigate).not.toHaveBeenCalled();
    expect(takeDeeplink()).toEqual({ screen: 'Reports', params: { projectId: 'p2', initialSection: 'klaim' } });
    expect(takeDeeplink()).toBeNull();
  });

  it('navigates without switching when the named project is not visible to the user', () => {
    const c = ctx('p1', ['p1']);
    expect(routeDeeplink('Progres', { projectId: 'p9' }, c)).toBe('navigated');
    expect(c.setActiveProject).not.toHaveBeenCalled();
  });

  it('navigates when no project is active yet or the params name none', () => {
    const noProject = ctx(null);
    expect(routeDeeplink('Progres', { projectId: 'p2' }, noProject)).toBe('navigated');
    const noParams = ctx('p1');
    expect(routeDeeplink('Approvals', null, noParams)).toBe('navigated');
    expect(noParams.navigate).toHaveBeenCalledWith('Approvals', {});
  });

  it('keeps only the newest queued deeplink', () => {
    queueDeeplink('Progres', { a: 1 });
    queueDeeplink('Reports', { b: 2 });
    expect(takeDeeplink()).toEqual({ screen: 'Reports', params: { b: 2 } });
  });
});
