/**
 * The recording hook itself needs a device, so this suite covers everything
 * around it that can be wrong without one: the options handed to expo-audio
 * (mono, about 64 kbps, metering on, the preset's platform enums kept), the
 * browser MIME choice on web, the file type the upload will declare, and the
 * reducer that turns press-in / press-out into a recording. The reducer is
 * where "hold to record" goes wrong in practice: a quick tap must not leave a
 * recorder running, and a half-second blip must not be sent as a voice note.
 */
jest.mock('expo-audio', () => ({
  RecordingPresets: {
    HIGH_QUALITY: {
      extension: '.m4a',
      sampleRate: 44100,
      numberOfChannels: 2,
      bitRate: 128000,
      android: { outputFormat: 'mpeg4', audioEncoder: 'aac' },
      ios: { outputFormat: 'aac ', audioQuality: 127 },
      web: { mimeType: 'audio/webm', bitsPerSecond: 128000 },
    },
  },
  getRecordingPermissionsAsync: jest.fn(),
  requestRecordingPermissionsAsync: jest.fn(),
  setAudioModeAsync: jest.fn(),
  useAudioRecorder: jest.fn(),
  useAudioRecorderState: jest.fn(),
}));
jest.mock('react-native', () => ({
  Platform: { OS: 'android' },
  AppState: { addEventListener: jest.fn(() => ({ remove: jest.fn() })) },
}));

import * as fs from 'fs';
import * as path from 'path';
import { act, renderHook } from '@testing-library/react-native';
import { AppState } from 'react-native';
import {
  getRecordingPermissionsAsync,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import {
  INITIAL_VOICE_STATE,
  VOICE_BIT_RATE,
  VOICE_ERRORS,
  VOICE_MIN_MS,
  buildVoiceRecordingOptions,
  formatVoiceDuration,
  pickWebMimeType,
  shouldAutoStop,
  useVoiceRecorder,
  voiceFileInfo,
  voiceReducer,
  type VoiceAction,
  type VoiceState,
} from '../voiceRecorder';

const run = (actions: VoiceAction[], from: VoiceState = INITIAL_VOICE_STATE): VoiceState =>
  actions.reduce(voiceReducer, from);

describe('recording options', () => {
  it('records mono at about 64 kbps with metering, keeping the preset platform enums', () => {
    const options = buildVoiceRecordingOptions('android');
    expect(options.numberOfChannels).toBe(1);
    expect(options.bitRate).toBe(VOICE_BIT_RATE);
    expect(VOICE_BIT_RATE).toBe(64000);
    expect(options.isMeteringEnabled).toBe(true);
    expect(options.extension).toBe('.m4a');
    expect(options.android).toEqual({ outputFormat: 'mpeg4', audioEncoder: 'aac' });
    expect(options.ios).toEqual({ outputFormat: 'aac ', audioQuality: 127 });
  });

  it('asks the browser which container it can record on web', () => {
    expect(pickWebMimeType((t) => t === 'audio/webm')).toBe('audio/webm');
    expect(pickWebMimeType((t) => t === 'audio/mp4')).toBe('audio/mp4');
    expect(pickWebMimeType(undefined)).toBe('audio/webm');
    expect(buildVoiceRecordingOptions('web', (t) => t === 'audio/mp4').web).toEqual({ mimeType: 'audio/mp4', bitsPerSecond: 64000 });
  });

  it('declares the file type the upload and the storage bucket will see', () => {
    expect(voiceFileInfo('android', buildVoiceRecordingOptions('android'))).toEqual({ mimeType: 'audio/mp4', ext: 'm4a' });
    expect(voiceFileInfo('web', buildVoiceRecordingOptions('web', (t) => t === 'audio/webm'))).toEqual({ mimeType: 'audio/webm', ext: 'webm' });
    expect(voiceFileInfo('web', buildVoiceRecordingOptions('web', (t) => t === 'audio/mp4'))).toEqual({ mimeType: 'audio/mp4', ext: 'm4a' });
  });
});

describe('timer', () => {
  it('formats minutes and seconds', () => {
    expect(formatVoiceDuration(0)).toBe('0:00');
    expect(formatVoiceDuration(7400)).toBe('0:07');
    expect(formatVoiceDuration(90000)).toBe('1:30');
  });

  it('stops at the 90 second cap', () => {
    expect(shouldAutoStop(89_999)).toBe(false);
    expect(shouldAutoStop(90_000)).toBe(true);
  });
});

describe('voiceReducer', () => {
  it('walks a normal hold: start, started, ticks, release, stopped', () => {
    const s = run([
      { type: 'start' },
      { type: 'started' },
      { type: 'tick', durationMs: 5000 },
      { type: 'tick', durationMs: 12000 },
      { type: 'requestStop' },
      { type: 'stopped', uri: 'file:///v.m4a', durationMs: 12000 },
    ]);
    expect(s).toEqual({ phase: 'recorded', uri: 'file:///v.m4a', durationMs: 12000, error: null, stopRequested: false });
  });

  it('turns a release during start-up into a stop, never a runaway recording', () => {
    const starting = run([{ type: 'start' }, { type: 'requestStop' }]);
    expect(starting).toMatchObject({ phase: 'starting', stopRequested: true });
    expect(voiceReducer(starting, { type: 'started' })).toMatchObject({ phase: 'stopping', stopRequested: false });
  });

  it('refuses a blip shorter than 0.8 seconds and a recording with no file', () => {
    const stopping = run([{ type: 'start' }, { type: 'started' }, { type: 'requestStop' }]);
    expect(voiceReducer(stopping, { type: 'stopped', uri: 'file:///v.m4a', durationMs: 400 })).toMatchObject({
      phase: 'error', error: VOICE_ERRORS.tooShort, uri: null,
    });
    expect(voiceReducer(stopping, { type: 'stopped', uri: null, durationMs: 5000 })).toMatchObject({
      phase: 'error', error: VOICE_ERRORS.empty,
    });
  });

  it('ignores a second start while busy, and a reset mid-stop', () => {
    const recording = run([{ type: 'start' }, { type: 'started' }]);
    expect(voiceReducer(recording, { type: 'start' })).toBe(recording);
    const stopping = voiceReducer(recording, { type: 'requestStop' });
    expect(voiceReducer(stopping, { type: 'reset' })).toBe(stopping);
  });

  it('re-records: reset from recorded goes back to idle, and start from error starts again', () => {
    const recorded = run([{ type: 'start' }, { type: 'started' }, { type: 'requestStop' }, { type: 'stopped', uri: 'file:///a.m4a', durationMs: 3000 }]);
    expect(voiceReducer(recorded, { type: 'reset' })).toEqual(INITIAL_VOICE_STATE);
    const failed = voiceReducer(INITIAL_VOICE_STATE, { type: 'fail', error: 'Izin mikrofon ditolak. Aktifkan di pengaturan HP.' });
    expect(failed).toMatchObject({ phase: 'error', error: 'Izin mikrofon ditolak. Aktifkan di pengaturan HP.' });
    expect(voiceReducer(failed, { type: 'start' })).toMatchObject({ phase: 'starting', error: null });
  });

  it('never reports more than the 90 second cap', () => {
    const s = run([{ type: 'start' }, { type: 'started' }, { type: 'requestStop' }, { type: 'stopped', uri: 'file:///a.m4a', durationMs: 90_600 }]);
    expect(s.durationMs).toBe(90_000);
  });

  it('only ticks while recording', () => {
    expect(voiceReducer(INITIAL_VOICE_STATE, { type: 'tick', durationMs: 4000 })).toBe(INITIAL_VOICE_STATE);
  });

  it('carries canAskAgain through a fail so the screen can offer Settings on a permanent denial', () => {
    const permanentlyDenied = voiceReducer(INITIAL_VOICE_STATE, {
      type: 'fail',
      error: 'Izin mikrofon ditolak. Aktifkan di pengaturan HP.',
      canAskAgain: false,
    });
    expect(permanentlyDenied).toMatchObject({ phase: 'error', canAskAgain: false });

    const askAgain = voiceReducer(INITIAL_VOICE_STATE, {
      type: 'fail',
      error: 'Izin mikrofon ditolak. Aktifkan di pengaturan HP.',
      canAskAgain: true,
    });
    expect(askAgain.canAskAgain).toBe(true);

    // Failures unrelated to permission (e.g. a stop() timeout) carry no
    // canAskAgain at all — the field stays undefined, not false.
    const timeout = voiceReducer(INITIAL_VOICE_STATE, {
      type: 'fail',
      error: 'Rekaman gagal disimpan: waktu habis. Coba lagi.',
    });
    expect(timeout.canAskAgain).toBeUndefined();
  });
});

/**
 * Hook-level coverage with expo-audio and AppState mocked. renderHook works
 * fine under this repo's ts-jest setup (testEnvironment: node, ts-jest
 * preset, react-native/jest/setup in setupFiles) with a minimal { Platform,
 * AppState } mock of 'react-native' — no jsdom or fuller RN mock needed.
 * The one gotcha: a dispatch that arms an effect's setTimeout (requestStop
 * here) needs its own `act()` before advancing fake timers past it, or the
 * timer may not exist yet when the advance runs.
 */
describe('useVoiceRecorder (hook)', () => {
  const mockUseAudioRecorder = useAudioRecorder as jest.Mock;
  const mockUseAudioRecorderState = useAudioRecorderState as jest.Mock;
  const mockRequestPermission = requestRecordingPermissionsAsync as jest.Mock;
  const mockSetAudioMode = setAudioModeAsync as jest.Mock;
  const mockGetPermission = getRecordingPermissionsAsync as jest.Mock;

  function makeRecorder(stopImpl: () => Promise<void> = () => Promise.resolve()) {
    return {
      prepareToRecordAsync: jest.fn().mockResolvedValue(undefined),
      record: jest.fn(),
      stop: jest.fn(stopImpl),
      uri: 'file:///take.m4a',
    };
  }

  beforeEach(() => {
    jest.useFakeTimers();
    mockUseAudioRecorderState.mockReturnValue({ durationMillis: 0, metering: null });
    mockSetAudioMode.mockResolvedValue(undefined);
    // Not yet granted by default, so the tests below that predate the
    // already-granted check still walk the request path they were written for.
    mockGetPermission.mockResolvedValue({ granted: false, canAskAgain: true, status: 'undetermined' });
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it('stops the recorder once and restores the audio mode on unmount while recording', async () => {
    const recorder = makeRecorder();
    mockUseAudioRecorder.mockReturnValue(recorder);
    mockRequestPermission.mockResolvedValue({ granted: true, canAskAgain: true });

    const { result, unmount } = renderHook(() => useVoiceRecorder());

    await act(async () => {
      result.current.start();
      await jest.advanceTimersByTimeAsync(0);
    });
    expect(result.current.state.phase).toBe('recording');

    unmount();

    expect(recorder.stop).toHaveBeenCalledTimes(1);
    expect(mockSetAudioMode).toHaveBeenCalledWith({ allowsRecording: false });
  });

  it('fails with the Indonesian timeout message when stop() never resolves', async () => {
    const recorder = makeRecorder(() => new Promise(() => {}));
    mockUseAudioRecorder.mockReturnValue(recorder);
    mockRequestPermission.mockResolvedValue({ granted: true, canAskAgain: true });

    const { result } = renderHook(() => useVoiceRecorder());

    await act(async () => {
      result.current.start();
      await jest.advanceTimersByTimeAsync(0);
    });
    expect(result.current.state.phase).toBe('recording');

    // Flush the requestStop dispatch (and the effect that arms the 8s timer)
    // in its own act() before advancing timers, so the setTimeout exists
    // before we fast-forward past it.
    await act(async () => {
      result.current.stop();
    });
    expect(result.current.state.phase).toBe('stopping');

    await act(async () => {
      await jest.advanceTimersByTimeAsync(8000);
    });

    expect(result.current.state.phase).toBe('error');
    expect(result.current.state.error).toBe('Rekaman gagal disimpan: waktu habis. Coba lagi.');
  });

  it('lands in error with canAskAgain === false on a permanent permission denial', async () => {
    const recorder = makeRecorder();
    mockUseAudioRecorder.mockReturnValue(recorder);
    mockRequestPermission.mockResolvedValue({ granted: false, canAskAgain: false });

    const { result } = renderHook(() => useVoiceRecorder());

    await act(async () => {
      result.current.start();
      await jest.advanceTimersByTimeAsync(0);
    });

    expect(result.current.state.phase).toBe('error');
    expect(result.current.state.canAskAgain).toBe(false);
  });

  /** Calls every AppState 'change' listener the hook registered. */
  function emitAppState(next: 'active' | 'background') {
    for (const [, listener] of (AppState.addEventListener as jest.Mock).mock.calls) {
      (listener as (state: string) => void)(next);
    }
  }

  /**
   * What requestRecordingPermissionsAsync does on Android: expo-modules-core's
   * PermissionsService hands every request to Activity.requestPermissions (no
   * already-granted short-circuit), which starts the system permission
   * activity. SANO's activity pauses and resumes around it, so AppState
   * reports 'background' then 'active' before the promise resolves (RN
   * delivers the result only once resumed).
   */
  function requestThatPausesTheActivity() {
    return async () => {
      emitAppState('background');
      emitAppState('active');
      return { granted: true, canAskAgain: true, status: 'granted' };
    };
  }

  /** MediaRecorder.stop() throws when no audio frames arrived yet, e.g. right after start(). */
  const stopFailed = () =>
    Promise.reject(new Error("Call to function 'AudioRecorder.stop' has been rejected.\n→ Caused by: stop failed."));

  it('does not re-request an already granted mic, so the permission activity cannot end the take before it starts', async () => {
    const recorder = makeRecorder(stopFailed);
    mockUseAudioRecorder.mockReturnValue(recorder);
    mockGetPermission.mockResolvedValue({ granted: true, canAskAgain: true, status: 'granted' });
    mockRequestPermission.mockImplementation(requestThatPausesTheActivity());

    const { result } = renderHook(() => useVoiceRecorder());

    await act(async () => {
      result.current.start();
      await jest.advanceTimersByTimeAsync(0);
    });

    expect(mockRequestPermission).not.toHaveBeenCalled();
    expect(recorder.record).toHaveBeenCalledTimes(1);
    expect(recorder.stop).not.toHaveBeenCalled();
    expect(result.current.state).toMatchObject({ phase: 'recording', error: null });
  });

  it('first-time grant: the permission dialog ends the take as too short, and native stop waits for the minimum', async () => {
    const recorder = makeRecorder(stopFailed);
    mockUseAudioRecorder.mockReturnValue(recorder);
    mockRequestPermission.mockImplementation(requestThatPausesTheActivity());

    const { result } = renderHook(() => useVoiceRecorder());

    await act(async () => {
      result.current.start();
      await jest.advanceTimersByTimeAsync(0);
    });
    expect(recorder.record).toHaveBeenCalledTimes(1);
    expect(recorder.stop).not.toHaveBeenCalled();

    await act(async () => {
      await jest.advanceTimersByTimeAsync(VOICE_MIN_MS);
    });

    expect(recorder.stop).toHaveBeenCalledTimes(1);
    expect(result.current.state).toMatchObject({ phase: 'error', error: VOICE_ERRORS.tooShort, uri: null });
  });

  it('never calls native stop() before the minimum when the finger lifts while the recorder is still starting', async () => {
    const recorder = makeRecorder();
    mockUseAudioRecorder.mockReturnValue(recorder);
    mockRequestPermission.mockResolvedValue({ granted: true, canAskAgain: true });

    const { result } = renderHook(() => useVoiceRecorder());

    // Press in, then lift before permission and prepare have resolved.
    act(() => {
      result.current.start();
    });
    act(() => {
      result.current.stop();
    });
    expect(result.current.state).toMatchObject({ phase: 'starting', stopRequested: true });

    await act(async () => {
      await jest.advanceTimersByTimeAsync(0);
    });
    expect(recorder.record).toHaveBeenCalledTimes(1);
    expect(recorder.stop).not.toHaveBeenCalled();

    await act(async () => {
      await jest.advanceTimersByTimeAsync(VOICE_MIN_MS - 1);
    });
    expect(recorder.stop).not.toHaveBeenCalled();

    await act(async () => {
      await jest.advanceTimersByTimeAsync(1);
    });
    expect(recorder.stop).toHaveBeenCalledTimes(1);
    expect(result.current.state).toMatchObject({ phase: 'error', error: VOICE_ERRORS.tooShort, uri: null });
  });

  it('maps a native stop() rejection on a take shorter than the minimum to too short, not a save failure', async () => {
    const recorder = makeRecorder(stopFailed);
    mockUseAudioRecorder.mockReturnValue(recorder);
    mockRequestPermission.mockResolvedValue({ granted: true, canAskAgain: true });

    const { result } = renderHook(() => useVoiceRecorder());

    await act(async () => {
      result.current.start();
      await jest.advanceTimersByTimeAsync(0);
    });
    expect(result.current.state.phase).toBe('recording');

    await act(async () => {
      await jest.advanceTimersByTimeAsync(300);
    });
    await act(async () => {
      result.current.stop();
    });
    await act(async () => {
      await jest.advanceTimersByTimeAsync(VOICE_MIN_MS);
    });

    expect(recorder.stop).toHaveBeenCalledTimes(1);
    expect(result.current.state).toMatchObject({ phase: 'error', error: VOICE_ERRORS.tooShort });
    expect(result.current.state.errorDetail).toBeUndefined();
  });

  it('keeps the Indonesian message on a genuine stop failure and carries the raw native error as errorDetail', async () => {
    const recorder = makeRecorder(stopFailed);
    mockUseAudioRecorder.mockReturnValue(recorder);
    mockRequestPermission.mockResolvedValue({ granted: true, canAskAgain: true });

    const { result } = renderHook(() => useVoiceRecorder());

    await act(async () => {
      result.current.start();
      await jest.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      await jest.advanceTimersByTimeAsync(VOICE_MIN_MS + 4000);
    });
    await act(async () => {
      result.current.stop();
      await jest.advanceTimersByTimeAsync(0);
    });

    // A take past the minimum stops at once; only the failure is reported.
    expect(recorder.stop).toHaveBeenCalledTimes(1);
    expect(result.current.state).toMatchObject({ phase: 'error', error: 'Rekaman gagal disimpan.' });
    expect(result.current.state.errorDetail).toContain('stop failed.');
  });

  it('carries the raw native error as errorDetail when the recorder fails to start', async () => {
    const recorder = makeRecorder();
    recorder.prepareToRecordAsync.mockRejectedValue(new Error('Failed to prepare the AudioRecorder'));
    mockUseAudioRecorder.mockReturnValue(recorder);
    mockRequestPermission.mockResolvedValue({ granted: true, canAskAgain: true });

    const { result } = renderHook(() => useVoiceRecorder());

    await act(async () => {
      result.current.start();
      await jest.advanceTimersByTimeAsync(0);
    });

    expect(result.current.state).toMatchObject({ phase: 'error', error: 'Rekaman gagal dimulai.' });
    expect(result.current.state.errorDetail).toContain('Failed to prepare the AudioRecorder');
  });
});

/**
 * VoiceNoteField is not rendered in jest (see siteEventCaptureScreenQueueWiring
 * for why screens get static guards), so the field-diagnosis line is pinned
 * here: the next field report must carry the native cause, not only
 * "Rekaman gagal disimpan."
 */
describe('VoiceNoteField: field diagnosis', () => {
  const FIELD = fs.readFileSync(path.join(__dirname, '../../workflows/screens/siteEvent/VoiceNoteField.tsx'), 'utf8');

  it('shows the raw native error under the Indonesian message, labelled "Detail teknis:"', () => {
    const messageIndex = FIELD.indexOf('{rec.state.error}');
    const detailIndex = FIELD.indexOf('Detail teknis:');
    expect(messageIndex).toBeGreaterThan(-1);
    expect(detailIndex).toBeGreaterThan(messageIndex);
    expect(FIELD).toMatch(/rec\.state\.errorDetail/);
  });
});
