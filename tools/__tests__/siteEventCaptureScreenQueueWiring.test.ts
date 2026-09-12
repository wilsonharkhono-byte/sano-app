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

/**
 * Slices exactly the `onSend` function body: from its `const onSend`
 * declaration to the next top-level `const`/`function` at the same
 * (2-space) indentation. A wider slice (e.g. to a hardcoded later
 * declaration's name) risks silently swallowing unrelated statements — such
 * as the `refusal` ternary declared right after `onSend` — into what a
 * reader assumes is just the function body.
 */
function extractOnSendBody(source: string): string {
  const startIndex = source.indexOf('const onSend');
  if (startIndex === -1) throw new Error('onSend not found in SiteEventCaptureScreen.tsx');
  const rest = source.slice(startIndex + 'const onSend'.length);
  const nextTopLevel = rest.match(/\n {2}(?:const|function)\s/);
  return nextTopLevel ? rest.slice(0, nextTopLevel.index) : rest;
}

describe('SiteEventCaptureScreen: Kirim goes through the offline queue', () => {
  it('no longer calls the plan 2 online-path orchestration function', () => {
    expect(SOURCE).not.toMatch(/createSiteEventWithMedia/);
  });

  it('enqueues, then fire-and-forgets a drain, then navigates back — in that order, inside onSend', () => {
    const onSendBody = extractOnSendBody(SOURCE);
    const enqueueIndex = onSendBody.indexOf('enqueueNewCapture(');
    const drainIndex = onSendBody.indexOf('triggerDrain()');
    const backToRoomIndex = onSendBody.indexOf('backToRoom()');
    expect(enqueueIndex).toBeGreaterThan(-1);
    expect(drainIndex).toBeGreaterThan(enqueueIndex);
    expect(backToRoomIndex).toBeGreaterThan(drainIndex);

    // The whole point of this commit is that triggerDrain() is never
    // awaited — a bare `triggerDrain();` (or `void triggerDrain();`) passes,
    // but `await triggerDrain(...)` must fail this guard even though the
    // substring `triggerDrain(` is present either way.
    expect(onSendBody).toMatch(/(^|[^\w.])(void )?triggerDrain\(\);/m);
    expect(onSendBody).not.toMatch(/await\s+triggerDrain\(/);
  });

  it('shows the exact instant-return toast for each platform, never a wait-for-AI message', () => {
    expect(SOURCE).toMatch(
      /toast\(Platform\.OS === 'web' \? WEB_QUEUED_TOAST : 'Tersimpan, dikirim saat ada sinyal', 'ok'\)/,
    );
    expect(SOURCE).not.toMatch(/Draf AI akan muncul di Beranda/);
  });

  it('renders the shared web warning constant on Platform.OS === \'web\', not an inline string', () => {
    // Index-order check rather than a character-window regex: reordering
    // JSX attributes or adding a comment between the two must not fail this
    // guard, but the web check and the constant's usage still have to exist
    // and appear in that order.
    const platformCheckIndex = SOURCE.indexOf("Platform.OS === 'web'");
    const warningUsageIndex = SOURCE.indexOf('{WEB_QUEUE_WARNING}');
    expect(platformCheckIndex).toBeGreaterThan(-1);
    expect(warningUsageIndex).toBeGreaterThan(platformCheckIndex);
    expect(SOURCE).not.toMatch(/tetap di halaman ini sampai muncul/);
  });
});
