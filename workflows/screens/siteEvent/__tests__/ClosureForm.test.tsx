// workflows/screens/siteEvent/__tests__/ClosureForm.test.tsx
//
// Closure spec 2026-09-26 §3.3 and §4: the form asks for proof by type, keeps
// "Tandai selesai" disabled until it has it, and on submit only QUEUES the
// close - it never calls the RPC and never says "Selesai" itself.
import React from 'react';
import { StyleSheet } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

const mockToast = jest.fn();
jest.mock('../../../components/Toast', () => ({ useToast: () => ({ show: mockToast }) }));
jest.mock('../../../components/PhotoGalleryField', () => {
  const ReactLocal = require('react');
  const { Text, TouchableOpacity, View } = require('react-native');
  return {
    __esModule: true,
    default: (props: { photoPaths: string[]; helperText?: string; onAdd: () => void }) =>
      ReactLocal.createElement(
        View,
        null,
        ReactLocal.createElement(TouchableOpacity, { onPress: props.onAdd, accessibilityLabel: 'Ambil foto' }, ReactLocal.createElement(Text, null, 'Ambil foto')),
        ReactLocal.createElement(Text, null, props.helperText ?? ''),
        ReactLocal.createElement(Text, null, `${props.photoPaths.length} foto dipilih`),
      ),
  };
});
jest.mock('../../../../tools/storage', () => ({ pickPhoto: jest.fn() }));
jest.mock('../../../../tools/siteEvents', () => ({
  newSiteEventId: jest.fn(),
  closeSiteEventRpc: jest.fn(),
}));
jest.mock('../../../../tools/captureQueueStore', () => ({ enqueueCloseJob: jest.fn() }));
jest.mock('../../../../tools/captureQueueWorker', () => ({ triggerDrain: jest.fn() }));

import { pickPhoto } from '../../../../tools/storage';
import { closeSiteEventRpc, newSiteEventId } from '../../../../tools/siteEvents';
import { enqueueCloseJob } from '../../../../tools/captureQueueStore';
import { triggerDrain } from '../../../../tools/captureQueueWorker';
import type { SiteEventType } from '../../../../tools/types';
import { COLORS } from '../../../theme';
import { closureRequirement } from '../closureModel';
import ClosureForm from '../ClosureForm';

// Rendering suites run slowly beside the full jest run; the 5 s default flakes.
jest.setTimeout(20000);

const renderForm = (eventType: SiteEventType | null) => {
  const onQueued = jest.fn();
  const onCancel = jest.fn();
  const utils = render(
    <ClosureForm
      userId="u1"
      eventId="ev1"
      projectId="p1"
      roomId="r1"
      eventTitle="Retak acian"
      eventType={eventType}
      onQueued={onQueued}
      onCancel={onCancel}
    />,
  );
  return { ...utils, onQueued, onCancel };
};

const submitButton = (utils: ReturnType<typeof render>) => utils.getByRole('button', { name: /Tandai selesai/ });

let ids = 0;
beforeEach(() => {
  jest.clearAllMocks();
  ids = 0;
  (newSiteEventId as jest.Mock).mockImplementation(() => `id-${++ids}`);
  (pickPhoto as jest.Mock).mockResolvedValue({
    uri: 'file:///cache/closure.jpg', contentType: 'image/jpeg', ext: 'jpg', capturedAt: '2026-09-17T02:00:00.000Z',
  });
  (enqueueCloseJob as jest.Mock).mockResolvedValue({ entry: { id: 'id-2' } });
});

describe('Wajib and Opsional, per type', () => {
  it.each<[SiteEventType, string, string, string]>([
    ['cacat', 'Wajib', 'Catatan penutupan', 'Opsional'],
    ['isu', 'Wajib', 'Catatan penutupan', 'Opsional'],
    ['hambatan', 'Wajib', 'Catatan penutupan', 'Opsional'],
    ['butuh_keputusan', 'Opsional', 'Catatan keputusan', 'Wajib'],
    ['progres', 'Opsional', 'Catatan penutupan', 'Opsional'],
    ['info', 'Opsional', 'Catatan penutupan', 'Opsional'],
  ])('%s: photo %s, "%s" %s', (type, photoBadge, noteLabel, noteBadge) => {
    const utils = renderForm(type);
    const badges = utils.getAllByText(/^(Wajib|Opsional)$/).map((n) => n.props.children);
    expect(badges).toEqual([photoBadge, noteBadge]);
    expect(utils.getByText(noteLabel)).toBeTruthy();
  });

  // The colour follows the rule (closureRequirement), not the badge's wording.
  it.each<SiteEventType>(['cacat', 'isu', 'hambatan', 'butuh_keputusan', 'progres', 'info'])(
    '%s: each badge is red exactly when its requirement is wajib',
    (type) => {
      const req = closureRequirement(type);
      const [photo, note] = renderForm(type).getAllByText(/^(Wajib|Opsional)$/);
      const colour = (r: 'wajib' | 'opsional') => (r === 'wajib' ? COLORS.critical : COLORS.textSec);
      expect(StyleSheet.flatten(photo.props.style).color).toBe(colour(req.photo));
      expect(StyleSheet.flatten(note.props.style).color).toBe(colour(req.note));
    },
  );

  it('shows the on-site helper for a required photo', () => {
    expect(renderForm('cacat').getByText('Wajib. Foto hasil perbaikan, diambil di lokasi yang sama.')).toBeTruthy();
  });

  it('shows the decision hint and the minimum in the counter for butuh_keputusan', () => {
    const utils = renderForm('butuh_keputusan');
    expect(utils.getByText('Wajib, minimal 10 karakter. Apa keputusannya dan siapa yang memutuskan?')).toBeTruthy();
    expect(utils.getByText('0/500 · minimal 10')).toBeTruthy();
  });
});

describe('the button waits for the proof', () => {
  it('stays disabled for a cacat until a photo is picked', async () => {
    const utils = renderForm('cacat');
    expect(submitButton(utils).props.accessibilityState).toMatchObject({ disabled: true });
    expect(utils.getByText('Ambil foto penutupan dulu.')).toBeTruthy();

    fireEvent.press(utils.getByLabelText('Ambil foto'));
    await waitFor(() => expect(utils.getByText('1 foto dipilih')).toBeTruthy());
    expect(submitButton(utils).props.accessibilityState).toMatchObject({ disabled: false });
    expect(utils.queryByText('Ambil foto penutupan dulu.')).toBeNull();
  });

  it('stays disabled for a butuh_keputusan until the trimmed note reaches ten characters', () => {
    const utils = renderForm('butuh_keputusan');
    const field = utils.getByLabelText('Catatan keputusan');
    fireEvent.changeText(field, '   Sembilan.   ');
    expect(submitButton(utils).props.accessibilityState).toMatchObject({ disabled: true });
    expect(utils.getByText('Tulis catatan keputusan, minimal 10 karakter.')).toBeTruthy();
    expect(utils.getByText('9/500 · minimal 10')).toBeTruthy();

    fireEvent.changeText(field, '  Ganti cat!  ');
    expect(submitButton(utils).props.accessibilityState).toMatchObject({ disabled: false });
    expect(utils.getByText('10/500 · minimal 10')).toBeTruthy();
  });

  it('is enabled at once for progres and info', () => {
    expect(submitButton(renderForm('progres')).props.accessibilityState).toMatchObject({ disabled: false });
    expect(submitButton(renderForm('info')).props.accessibilityState).toMatchObject({ disabled: false });
  });
});

describe('submit queues, never closes', () => {
  it('enqueues the trimmed note and the closure photo, drains, toasts the queue sentence, and never calls the RPC', async () => {
    const utils = renderForm('cacat');
    fireEvent.press(utils.getByLabelText('Ambil foto'));
    await waitFor(() => expect(utils.getByText('1 foto dipilih')).toBeTruthy());
    fireEvent.changeText(utils.getByLabelText('Catatan penutupan'), '  Sudah ditambal  ');
    fireEvent.press(submitButton(utils));

    await waitFor(() => expect(utils.onQueued).toHaveBeenCalledTimes(1));
    expect(enqueueCloseJob).toHaveBeenCalledWith({
      userId: 'u1',
      jobId: 'id-2',
      eventId: 'ev1',
      projectId: 'p1',
      roomId: 'r1',
      eventTitle: 'Retak acian',
      note: 'Sudah ditambal',
      closurePhoto: expect.objectContaining({
        id: 'id-1', localUri: 'file:///cache/closure.jpg', kind: 'photo', role: 'closure', mimeType: 'image/jpeg', ext: 'jpg',
      }),
      nowIso: expect.any(String),
    });
    expect(triggerDrain).toHaveBeenCalledTimes(1);
    expect(mockToast).toHaveBeenCalledWith('Penutupan masuk antrean. Status menjadi Selesai setelah server menerimanya.', 'ok');
    expect(closeSiteEventRpc).not.toHaveBeenCalled();
  });

  // The web queue is memory only (captureQueueStore.ts): the native sentence
  // would promise the phone kept a close that a closed tab loses.
  it('on web, says the tab must stay open instead', async () => {
    const ReactNative = require('react-native') as typeof import('react-native');
    const platform = jest
      .spyOn(ReactNative, 'Platform', 'get')
      .mockReturnValue({ OS: 'web', select: (o: Record<string, unknown>) => o.web ?? o.default } as unknown as typeof ReactNative.Platform);
    try {
      const utils = renderForm('info');
      fireEvent.press(submitButton(utils));
      await waitFor(() => expect(utils.onQueued).toHaveBeenCalledTimes(1));
      expect(mockToast).toHaveBeenCalledTimes(1);
      expect(mockToast).toHaveBeenCalledWith(
        'Dikirim dari tab ini. Jangan tutup halaman sampai status berubah menjadi Selesai.',
        'ok',
      );
    } finally {
      platform.mockRestore();
    }
  });

  // Two taps in one frame: the second arrives before React re-renders the
  // button as disabled, so only a ref taken synchronously can stop it.
  it('queues once when Tandai selesai is pressed twice in the same frame', async () => {
    const utils = renderForm('info');
    const button = submitButton(utils);
    act(() => {
      fireEvent.press(button);
      fireEvent.press(button);
    });

    await waitFor(() => expect(utils.onQueued).toHaveBeenCalledTimes(1));
    expect(enqueueCloseJob).toHaveBeenCalledTimes(1);
    expect(triggerDrain).toHaveBeenCalledTimes(1);
    expect(mockToast).toHaveBeenCalledTimes(1);
  });

  it('can be pressed again after the phone refused to store the close', async () => {
    (enqueueCloseJob as jest.Mock).mockRejectedValueOnce(new Error('Penyimpanan HP tidak tersedia; coba lagi.'));
    const utils = renderForm('info');
    fireEvent.press(submitButton(utils));
    await waitFor(() => expect(utils.getByText(/Penutupan gagal disimpan di ponsel/)).toBeTruthy());

    fireEvent.press(submitButton(utils));
    await waitFor(() => expect(utils.onQueued).toHaveBeenCalledTimes(1));
    expect(enqueueCloseJob).toHaveBeenCalledTimes(2);
  });

  it('shows the refusal and stays open when the event already has a pending close', async () => {
    (enqueueCloseJob as jest.Mock).mockResolvedValueOnce({ error: 'Penutupan kejadian ini sudah menunggu kirim.' });
    const utils = renderForm('progres');
    fireEvent.press(submitButton(utils));

    await waitFor(() => expect(utils.getByText('Penutupan kejadian ini sudah menunggu kirim.')).toBeTruthy());
    expect(utils.onQueued).not.toHaveBeenCalled();
    expect(triggerDrain).not.toHaveBeenCalled();
    expect(mockToast).not.toHaveBeenCalled();
  });

  it('says so when the phone could not store the close', async () => {
    (enqueueCloseJob as jest.Mock).mockRejectedValueOnce(new Error('Penyimpanan HP tidak tersedia; coba lagi.'));
    const utils = renderForm('info');
    fireEvent.press(submitButton(utils));

    await waitFor(() =>
      expect(utils.getByText('Penutupan gagal disimpan di ponsel: Penyimpanan HP tidak tersedia; coba lagi.')).toBeTruthy(),
    );
    expect(utils.onQueued).not.toHaveBeenCalled();
  });
});
