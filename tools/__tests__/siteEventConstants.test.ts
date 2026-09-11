/**
 * The labels a supervisor reads and the list of types that demand an owner are
 * constants other layers depend on: the validator and migration 097 accept the
 * same six codes, and siteEventRules and 097 enforce the same four actionable
 * types. A drift here shows up as a chip with no label, or as an owner rule the
 * form and the database disagree about.
 */
import {
  ACTIONABLE_EVENT_TYPES,
  SITE_EVENT_MANUAL_AFTER_ATTEMPTS,
  SITE_EVENT_MAX_CLOSEUPS,
  SITE_EVENT_STATUS_LABELS,
  SITE_EVENT_TYPES,
  SITE_EVENT_TYPE_LABELS,
  SITE_MEDIA_BUCKET,
  VOICE_NOTE_MAX_SECONDS,
} from '../constants';
import { SITE_EVENT_TYPE_CODES } from '../siteEventDraftValidate';

describe('site event constants', () => {
  it('labels exactly the six event types the validator and 097 accept, in Indonesian', () => {
    expect(SITE_EVENT_TYPE_LABELS).toEqual({
      progres: 'Progres', isu: 'Isu', hambatan: 'Hambatan', cacat: 'Cacat', butuh_keputusan: 'Butuh keputusan', info: 'Info',
    });
    expect(Object.keys(SITE_EVENT_TYPE_LABELS).sort()).toEqual([...SITE_EVENT_TYPE_CODES].sort());
    expect(SITE_EVENT_TYPES.map((t) => t.value)).toEqual([...SITE_EVENT_TYPE_CODES]);
  });

  it('treats exactly four types as actionable', () => {
    expect([...ACTIONABLE_EVENT_TYPES]).toEqual(['isu', 'hambatan', 'cacat', 'butuh_keputusan']);
  });

  it('labels every status', () => {
    expect(Object.keys(SITE_EVENT_STATUS_LABELS).sort()).toEqual(['discarded', 'done', 'draft', 'open', 'pending_analysis']);
  });

  it('holds the capture limits from spec §5.2 and §6', () => {
    expect(VOICE_NOTE_MAX_SECONDS).toBe(90);
    expect(SITE_EVENT_MAX_CLOSEUPS).toBe(5);
    expect(SITE_EVENT_MANUAL_AFTER_ATTEMPTS).toBe(3);
  });

  it('names the private bucket migration 097 creates', () => {
    expect(SITE_MEDIA_BUCKET).toBe('site-media');
  });
});
