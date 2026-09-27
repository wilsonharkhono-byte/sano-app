/**
 * The "Selesai" form restates migration 105's rule so it can say what is
 * missing before the round trip (closure spec 2026-09-26 §3). The database
 * still decides; these pin that the form asks for the same thing, counted the
 * same way Postgres counts it.
 */
import {
  CLOSE_QUEUED_TOAST,
  CLOSURE_NOTE_MAX,
  CLOSURE_NOTE_MIN,
  WEB_CLOSE_QUEUED_TOAST,
  closureBlocker,
  closureCopy,
  closureRequirement,
  noteLength,
} from '../screens/siteEvent/closureModel';
import type { SiteEventType } from '../../tools/types';

describe('closureRequirement', () => {
  it.each<[SiteEventType, 'wajib' | 'opsional', 'wajib' | 'opsional']>([
    ['cacat', 'wajib', 'opsional'],
    ['isu', 'wajib', 'opsional'],
    ['hambatan', 'wajib', 'opsional'],
    ['butuh_keputusan', 'opsional', 'wajib'],
    ['progres', 'opsional', 'opsional'],
    ['info', 'opsional', 'opsional'],
  ])('%s: photo %s, note %s', (type, photo, note) => {
    expect(closureRequirement(type)).toEqual({ photo, note });
  });

  it('asks nothing of an event with no type, as 105 does', () => {
    expect(closureRequirement(null)).toEqual({ photo: 'opsional', note: 'opsional' });
  });
});

describe('noteLength counts code points, like Postgres char_length', () => {
  it('counts an emoji once, not twice', () => {
    expect('🙂'.length).toBe(2);
    expect(noteLength('🙂')).toBe(1);
    expect(noteLength('Cat ulang 🙂')).toBe(11);
  });

  it('agrees with the bounds 105 uses', () => {
    expect(CLOSURE_NOTE_MIN).toBe(10);
    expect(CLOSURE_NOTE_MAX).toBe(500);
  });
});

describe('closureBlocker', () => {
  it('holds a cacat, isu or hambatan back until a photo is picked', () => {
    for (const type of ['cacat', 'isu', 'hambatan'] as const) {
      expect(closureBlocker({ type, hasPhoto: false, sentNote: 'Sudah ditambal rapi' })).toBe('Ambil foto penutupan dulu.');
      expect(closureBlocker({ type, hasPhoto: true, sentNote: '' })).toBeNull();
    }
  });

  it('holds a butuh_keputusan back until the sent note has ten code points', () => {
    const blocked = 'Tulis catatan keputusan, minimal 10 karakter.';
    expect(closureBlocker({ type: 'butuh_keputusan', hasPhoto: true, sentNote: '' })).toBe(blocked);
    expect(closureBlocker({ type: 'butuh_keputusan', hasPhoto: false, sentNote: 'Sembilan.' })).toBe(blocked);
    expect(closureBlocker({ type: 'butuh_keputusan', hasPhoto: false, sentNote: 'Ganti cat!' })).toBeNull();
    // Nine visible characters plus an emoji is ten code points, as the server counts it.
    expect(closureBlocker({ type: 'butuh_keputusan', hasPhoto: false, sentNote: 'Cat ulang🙂' })).toBeNull();
    expect(closureBlocker({ type: 'butuh_keputusan', hasPhoto: false, sentNote: 'Cat ulan🙂' })).toBe(blocked);
  });

  it('never holds a progres or info back', () => {
    expect(closureBlocker({ type: 'progres', hasPhoto: false, sentNote: '' })).toBeNull();
    expect(closureBlocker({ type: 'info', hasPhoto: false, sentNote: '' })).toBeNull();
  });
});

describe('closureCopy', () => {
  it('labels the photo Wajib, with the on-site helper, for the three photo types', () => {
    for (const type of ['cacat', 'isu', 'hambatan'] as const) {
      const copy = closureCopy(type);
      expect(copy.photoBadge).toBe('Wajib');
      expect(copy.photoHelper).toBe('Wajib. Foto hasil perbaikan, diambil di lokasi yang sama.');
      expect(copy.noteLabel).toBe('Catatan penutupan');
      expect(copy.noteBadge).toBe('Opsional');
      expect(copy.noteHint).toBeNull();
      expect(copy.counter(3)).toBe('3/500');
    }
  });

  it('asks for a decision note on butuh_keputusan, with the minimum in the counter', () => {
    const copy = closureCopy('butuh_keputusan');
    expect(copy.photoBadge).toBe('Opsional');
    expect(copy.photoHelper).toBe('Opsional. Bukti bahwa masalahnya sudah beres.');
    expect(copy.noteLabel).toBe('Catatan keputusan');
    expect(copy.noteBadge).toBe('Wajib');
    expect(copy.noteHint).toBe('Wajib, minimal 10 karakter. Apa keputusannya dan siapa yang memutuskan?');
    expect(copy.counter(4)).toBe('4/500 · minimal 10');
  });

  it("keeps today's optional wording for progres and info", () => {
    for (const type of ['progres', 'info'] as const) {
      const copy = closureCopy(type);
      expect(copy.photoBadge).toBe('Opsional');
      expect(copy.noteLabel).toBe('Catatan penutupan');
      expect(copy.notePlaceholder).toBe('Opsional. Apa yang dikerjakan?');
    }
  });
});

describe('toasts never claim Selesai', () => {
  it('says the close is queued, and that the status follows the server', () => {
    expect(CLOSE_QUEUED_TOAST).toBe('Penutupan masuk antrean. Status menjadi Selesai setelah server menerimanya.');
    expect(WEB_CLOSE_QUEUED_TOAST).toBe('Dikirim dari tab ini. Jangan tutup halaman sampai status berubah menjadi Selesai.');
  });
});
