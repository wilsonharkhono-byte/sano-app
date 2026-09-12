/**
 * SiteEventCaptureScreen is not rendered in jest (the repo keeps screens
 * thin and tests their model files instead), so the "Kirim" rewrite from
 * plan 2's synchronous three-call orchestration to the offline queue is
 * pinned with a static guard: the old online-path call is gone, the new
 * enqueue-and-drain call is present in the right order, and the web-only
 * limitation copy is shown from the shared constant (never re-typed inline,
 * so the capture screen and any future queue UI cannot drift apart).
 */
import * as fs from 'fs';
import * as path from 'path';

const SOURCE = fs.readFileSync(path.join(__dirname, '../../workflows/screens/SiteEventCaptureScreen.tsx'), 'utf8');

describe('SiteEventCaptureScreen: Kirim goes through the offline queue', () => {
  it('no longer calls the plan 2 online-path orchestration function', () => {
    expect(SOURCE).not.toMatch(/createSiteEventWithMedia/);
  });

  it('enqueues before triggering a drain, inside onSend', () => {
    const onSendBody = SOURCE.slice(SOURCE.indexOf('const onSend'), SOURCE.indexOf('const sendDisabled'));
    const enqueueIndex = onSendBody.indexOf('enqueueNewCapture(');
    const drainIndex = onSendBody.indexOf('triggerDrain()');
    expect(enqueueIndex).toBeGreaterThan(-1);
    expect(drainIndex).toBeGreaterThan(enqueueIndex);
  });

  it('shows the exact instant-return toast, never a wait-for-AI message', () => {
    expect(SOURCE).toMatch(/toast\('Tersimpan, dikirim saat ada sinyal', 'ok'\)/);
    expect(SOURCE).not.toMatch(/Draf AI akan muncul di Beranda/);
  });

  it('renders the shared web warning constant on Platform.OS === \'web\', not an inline string', () => {
    expect(SOURCE).toMatch(/Platform\.OS === 'web'[\s\S]{0,80}\{WEB_QUEUE_WARNING\}/);
    expect(SOURCE).not.toMatch(/tetap di halaman ini sampai muncul/);
  });
});
