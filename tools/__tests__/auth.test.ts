const mockOrder: string[] = [];

jest.mock('../notifications', () => ({
  unregisterPushToken: jest.fn(async () => { mockOrder.push('unregister'); }),
}));

jest.mock('../supabase', () => ({
  supabase: {
    auth: {
      signOut: jest.fn(async () => { mockOrder.push('signOut'); return { error: null }; }),
    },
  },
}));

import { signOut } from '../auth';

describe('signOut', () => {
  it("removes this phone's push token while the session can still delete it", async () => {
    await signOut();
    expect(mockOrder).toEqual(['unregister', 'signOut']);
  });
});
