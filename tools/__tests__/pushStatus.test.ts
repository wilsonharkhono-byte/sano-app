import { getPushStatus, setPushStatus, subscribePushStatus } from '../pushStatus';

describe('pushStatus store', () => {
  afterEach(() => setPushStatus('unknown'));

  it('starts as unknown', () => {
    expect(getPushStatus()).toBe('unknown');
  });

  it('notifies subscribers on change and stops after unsubscribe', () => {
    const seen: string[] = [];
    const unsubscribe = subscribePushStatus(() => seen.push(getPushStatus()));
    setPushStatus('active');
    unsubscribe();
    setPushStatus('denied');
    expect(seen).toEqual(['active']);
    expect(getPushStatus()).toBe('denied');
  });

  it('does not notify when the status is unchanged', () => {
    const listener = jest.fn();
    const unsubscribe = subscribePushStatus(listener);
    setPushStatus('unknown');
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });
});
