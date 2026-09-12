/**
 * The worker's start/stop lifecycle lives in workflows/App.tsx, which
 * renders once per app launch and is not otherwise unit-tested (no screen in
 * this repo is rendered in jest, per its own convention). A static guard on
 * the source text is the practical way to pin: the worker starts once a
 * session exists, stops on sign-out, and the effect is keyed on the user id
 * (not the whole session object, which is a new reference every refresh).
 */
import * as fs from 'fs';
import * as path from 'path';

const SOURCE = fs.readFileSync(path.join(__dirname, '../../workflows/App.tsx'), 'utf8');

describe('App.tsx capture queue worker wiring', () => {
  it('imports both lifecycle functions from tools/captureQueueWorker', () => {
    expect(SOURCE).toMatch(/import\s*\{\s*startCaptureQueueWorker,\s*stopCaptureQueueWorker\s*\}\s*from\s*'\.\.\/tools\/captureQueueWorker'/);
  });

  it('starts the worker with the signed-in user id, guarded so it is never called with null', () => {
    expect(SOURCE).toMatch(/if\s*\(session\?\.user\.id\)\s*\{\s*startCaptureQueueWorker\(session\.user\.id\);/);
  });

  it('stops the worker in the same effect, on the else branch', () => {
    const startIndex = SOURCE.indexOf('startCaptureQueueWorker(session.user.id)');
    const stopIndex = SOURCE.indexOf('stopCaptureQueueWorker()');
    expect(startIndex).toBeGreaterThan(-1);
    expect(stopIndex).toBeGreaterThan(startIndex);
  });

  it('keys the effect on session?.user.id, not the session object itself', () => {
    expect(SOURCE).toMatch(/\},\s*\[session\?\.user\.id\]\);/);
  });
});
