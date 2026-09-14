// SANO - Voice notes for site events (spec §5.2): hold to record, 90 s cap,
// AAC in an M4A container, mono, about 64 kbps.
//
// expo-audio (SDK 54, ~1.1.x) runs on Android, iOS and web (plan decision 6),
// so there is no hand-written MediaRecorder fallback. On web the browser picks
// the container: Chrome records WebM, Safari MP4; pickWebMimeType asks it, and
// migration 097's bucket accepts both. expo-audio re-exports its enum types as
// types only, so the options spread RecordingPresets.HIGH_QUALITY (which carries
// the iOS enum values) and override only primitive fields.

import { useCallback, useEffect, useReducer, useRef } from 'react';
import { AppState, Platform } from 'react-native';
import {
  RecordingPresets,
  getRecordingPermissionsAsync,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
  type RecordingOptions,
} from 'expo-audio';
import { VOICE_NOTE_MAX_SECONDS } from './constants';

export const VOICE_BIT_RATE = 64000;
/** Shorter than this is a tap, not a note. */
export const VOICE_MIN_MS = 800;

export type WebAudioMime = 'audio/webm' | 'audio/mp4';

export function pickWebMimeType(isTypeSupported?: (type: string) => boolean): WebAudioMime {
  if (isTypeSupported && isTypeSupported('audio/webm')) return 'audio/webm';
  if (isTypeSupported && isTypeSupported('audio/mp4')) return 'audio/mp4';
  return 'audio/webm';
}

export function buildVoiceRecordingOptions(
  os: string,
  isTypeSupported?: (type: string) => boolean,
): RecordingOptions {
  const base = RecordingPresets.HIGH_QUALITY;
  return {
    ...base,
    numberOfChannels: 1,
    bitRate: VOICE_BIT_RATE,
    isMeteringEnabled: true,
    android: { ...base.android },
    ios: { ...base.ios },
    web: {
      mimeType: pickWebMimeType(os === 'web' ? isTypeSupported : undefined),
      bitsPerSecond: VOICE_BIT_RATE,
    },
  };
}

/** The MIME type and extension the upload declares for this recording. */
export function voiceFileInfo(os: string, options: RecordingOptions): { mimeType: string; ext: string } {
  if (os === 'web') {
    return options.web?.mimeType === 'audio/mp4'
      ? { mimeType: 'audio/mp4', ext: 'm4a' }
      : { mimeType: 'audio/webm', ext: 'webm' };
  }
  return { mimeType: 'audio/mp4', ext: 'm4a' };
}

export function formatVoiceDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

export function shouldAutoStop(durationMs: number): boolean {
  return durationMs >= VOICE_NOTE_MAX_SECONDS * 1000;
}

// ─── State machine ───────────────────────────────────────────────────────────

export type VoicePhase = 'idle' | 'starting' | 'recording' | 'stopping' | 'recorded' | 'error';

export interface VoiceState {
  phase: VoicePhase;
  uri: string | null;
  durationMs: number;
  error: string | null;
  /** The finger lifted while the recorder was still starting. */
  stopRequested: boolean;
  /**
   * Only meaningful when `phase` is `error` from a denied microphone
   * permission: mirrors `PermissionResponse.canAskAgain` so the screen can
   * offer `Linking.openSettings()` when it's false, matching
   * `workflows/screens/RoomScanScreen.tsx`. Undefined for every other
   * failure.
   */
  canAskAgain?: boolean;
  /**
   * Only set with a genuine start/stop failure: the raw native error, shown
   * under the Indonesian message as "Detail teknis:" so the next field report
   * carries the real cause. Undefined for the friendly outcomes (too short,
   * empty, permission denied).
   */
  errorDetail?: string;
}

export const INITIAL_VOICE_STATE: VoiceState = {
  phase: 'idle', uri: null, durationMs: 0, error: null, stopRequested: false,
};

export type VoiceAction =
  | { type: 'start' }
  | { type: 'started' }
  | { type: 'requestStop' }
  | { type: 'tick'; durationMs: number }
  | { type: 'stopped'; uri: string | null; durationMs: number }
  | { type: 'fail'; error: string; canAskAgain?: boolean; errorDetail?: string }
  | { type: 'reset' };

export const VOICE_ERRORS = {
  tooShort: 'Rekaman terlalu singkat. Tahan tombol sambil bicara.',
  empty: 'Rekaman kosong. Coba rekam ulang.',
} as const;

export function voiceReducer(state: VoiceState, action: VoiceAction): VoiceState {
  switch (action.type) {
    case 'start':
      if (state.phase === 'starting' || state.phase === 'recording' || state.phase === 'stopping') return state;
      return { phase: 'starting', uri: null, durationMs: 0, error: null, stopRequested: false };
    case 'started':
      if (state.phase !== 'starting') return state;
      return state.stopRequested
        ? { ...state, phase: 'stopping', stopRequested: false }
        : { ...state, phase: 'recording' };
    case 'requestStop':
      if (state.phase === 'starting') return { ...state, stopRequested: true };
      if (state.phase === 'recording') return { ...state, phase: 'stopping' };
      return state;
    case 'tick':
      return state.phase === 'recording' ? { ...state, durationMs: action.durationMs } : state;
    case 'stopped':
      if (state.phase !== 'stopping') return state;
      if (!action.uri) return { ...INITIAL_VOICE_STATE, phase: 'error', error: VOICE_ERRORS.empty };
      if (action.durationMs < VOICE_MIN_MS) return { ...INITIAL_VOICE_STATE, phase: 'error', error: VOICE_ERRORS.tooShort };
      return {
        phase: 'recorded',
        uri: action.uri,
        // Clamped to the 90s cap. The file on disk can run ~200-500ms past
        // it — the 200ms poll interval plus native stop() latency both land
        // after the cap fires — so this is what the UI reports, not a claim
        // about the actual file length.
        durationMs: Math.min(action.durationMs, VOICE_NOTE_MAX_SECONDS * 1000),
        error: null,
        stopRequested: false,
      };
    case 'fail':
      return {
        ...INITIAL_VOICE_STATE,
        phase: 'error',
        error: action.error,
        canAskAgain: action.canAskAgain,
        errorDetail: action.errorDetail,
      };
    case 'reset':
      if (state.phase === 'starting' || state.phase === 'stopping') return state;
      return INITIAL_VOICE_STATE;
    default:
      return state;
  }
}

// ─── Hook ────────────────────────────────────────────────────────────────────

function browserIsTypeSupported(): ((type: string) => boolean) | undefined {
  const recorder = (globalThis as { MediaRecorder?: { isTypeSupported?: (type: string) => boolean } }).MediaRecorder;
  const check = recorder?.isTypeSupported;
  return typeof check === 'function' ? (type: string) => check.call(recorder, type) : undefined;
}

/** Pull a printable message out of a caught value without assuming it's an `Error`. */
function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** The raw native error for the "Detail teknis" line: code when it adds something, capped to stay readable. */
function errDetail(err: unknown): string {
  const code = (err as { code?: unknown } | null)?.code;
  const message = errMessage(err);
  const detail = typeof code === 'string' && code && !message.includes(code) ? `${code}: ${message}` : message;
  return detail.length > 300 ? `${detail.slice(0, 299)}…` : detail;
}

/** How long we wait for `recorder.stop()` before giving up on a hung take. */
export const VOICE_STOP_TIMEOUT_MS = 8000;

export interface VoiceRecorderApi {
  state: VoiceState;
  /** Press in. */
  start: () => void;
  /**
   * Release. Safe to call while the recorder is still starting. A release
   * sooner than VOICE_MIN_MS after recording began keeps the recorder running
   * until the minimum has passed, then ends the take as tooShort.
   */
  stop: () => void;
  /**
   * Discard the take so the supervisor can record again.
   *
   * No-op while `phase` is `starting` or `stopping` (the reducer ignores it,
   * same as `start`). A "Batal" control shown during those phases should
   * call `stop()` instead, so the take finishes landing before it's thrown
   * away — calling `reset()` there would silently do nothing.
   */
  reset: () => void;
  fileInfo: { mimeType: string; ext: string };
  /** Live input level in dB while recording, for the level bar; null otherwise. */
  meteringDb: number | null;
}

export function useVoiceRecorder(): VoiceRecorderApi {
  const optionsRef = useRef<RecordingOptions | null>(null);
  if (!optionsRef.current) {
    optionsRef.current = buildVoiceRecordingOptions(Platform.OS, Platform.OS === 'web' ? browserIsTypeSupported() : undefined);
  }
  const options = optionsRef.current;
  const recorder = useAudioRecorder(options);
  const recorderState = useAudioRecorderState(recorder, 200);
  const [state, dispatch] = useReducer(voiceReducer, INITIAL_VOICE_STATE);
  const durationRef = useRef(0);
  /** Date.now() right after record() returned; the minimum-hold clock. */
  const recordStartedAtRef = useRef(0);
  /** Whether this stopping phase has called native stop() yet (false while it waits out VOICE_MIN_MS). */
  const stopSentRef = useRef(false);

  // Mirrors state.phase for the effects below that only run at mount/unmount
  // (empty deps) and so can't close over a fresh `state.phase` themselves.
  const phaseRef = useRef(state.phase);
  useEffect(() => {
    phaseRef.current = state.phase;
  }, [state.phase]);

  // Mirror the recorder clock into the reducer and enforce the cap.
  useEffect(() => {
    if (state.phase !== 'recording') return;
    durationRef.current = recorderState.durationMillis;
    dispatch({ type: 'tick', durationMs: recorderState.durationMillis });
    if (shouldAutoStop(recorderState.durationMillis)) dispatch({ type: 'requestStop' });
  }, [recorderState.durationMillis, state.phase]);

  // starting: permission, audio mode, prepare, record.
  useEffect(() => {
    if (state.phase !== 'starting') return;
    durationRef.current = 0;
    void (async () => {
      try {
        // Only ask when the mic isn't granted yet. On Android the request always
        // goes through Activity.requestPermissions (expo-modules-core
        // PermissionsService.delegateRequestToActivity has no already-granted
        // short-circuit), which starts the system permission activity even for
        // a granted mic. SANO's activity pauses and resumes around it, AppState
        // reports 'background', and the listener below turned that into a stop
        // before record() had run: native stop() then failed on every take.
        const current = await getRecordingPermissionsAsync().catch(() => null);
        const permission = current?.granted ? current : await requestRecordingPermissionsAsync();
        if (!permission.granted) {
          dispatch({
            type: 'fail',
            error: 'Izin mikrofon ditolak. Aktifkan di pengaturan HP.',
            canAskAgain: permission.canAskAgain,
          });
          return;
        }
        await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
        await recorder.prepareToRecordAsync();
        recorder.record();
        recordStartedAtRef.current = Date.now();
        dispatch({ type: 'started' });
      } catch (err) {
        console.warn('[voiceRecorder]', errMessage(err));
        dispatch({ type: 'fail', error: 'Rekaman gagal dimulai.', errorDetail: errDetail(err) });
      }
    })();
  }, [state.phase, recorder]);

  // stopping: finalize the file. Native stop() is never called sooner than
  // VOICE_MIN_MS after record() began: Android's MediaRecorder.stop() throws
  // when no audio frames have arrived yet, which surfaced as the generic
  // "Rekaman gagal disimpan." A take released before the minimum keeps
  // recording until it has passed, then stops and reports tooShort, even if
  // that stop rejects.
  //
  // Races the stop against a timeout so a native promise that never settles
  // can't leave the UI stuck on "stopping" forever (reset()/start() are both
  // no-ops in that phase). The timer starts with the phase, so the
  // minimum-hold wait counts against it.
  useEffect(() => {
    if (state.phase !== 'stopping') return;
    let timedOut = false;
    const heldMs = Date.now() - recordStartedAtRef.current;
    const releasedEarly = heldMs < VOICE_MIN_MS;
    stopSentRef.current = false;
    const timeoutId = setTimeout(() => {
      timedOut = true;
      dispatch({
        type: 'fail',
        error: 'Rekaman gagal disimpan: waktu habis. Coba lagi.',
        errorDetail: `recorder.stop() did not settle within ${VOICE_STOP_TIMEOUT_MS} ms`,
      });
    }, VOICE_STOP_TIMEOUT_MS);
    const finalize = async () => {
      stopSentRef.current = true;
      try {
        await recorder.stop();
        if (timedOut) return; // already failed the take; ignore the late resolution
        clearTimeout(timeoutId);
        if (releasedEarly) dispatch({ type: 'fail', error: VOICE_ERRORS.tooShort });
        else dispatch({ type: 'stopped', uri: recorder.uri ?? null, durationMs: durationRef.current });
      } catch (err) {
        if (timedOut) return;
        clearTimeout(timeoutId);
        console.warn('[voiceRecorder]', errMessage(err));
        if (releasedEarly) dispatch({ type: 'fail', error: VOICE_ERRORS.tooShort });
        else dispatch({ type: 'fail', error: 'Rekaman gagal disimpan.', errorDetail: errDetail(err) });
      }
    };
    const holdId = releasedEarly ? setTimeout(() => void finalize(), VOICE_MIN_MS - heldMs) : null;
    if (!releasedEarly) void finalize();
    return () => {
      clearTimeout(timeoutId);
      if (holdId !== null) clearTimeout(holdId);
    };
  }, [state.phase, recorder]);

  // Restore the audio session once a take lands (successfully or not), so the
  // mic session doesn't stay open for other apps between takes.
  useEffect(() => {
    if (state.phase !== 'recorded' && state.phase !== 'error') return;
    setAudioModeAsync({ allowsRecording: false }).catch(() => {});
  }, [state.phase]);

  // Backgrounding mid-recording behaves like lifting the finger: request a
  // stop so the file finalizes cleanly instead of continuing to record (or
  // getting killed) while SANO isn't in the foreground. On Android any activity
  // started over SANO (the system permission prompt included) also reports
  // 'background', which is why the starting effect only requests the mic
  // permission when it isn't already granted.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next !== 'active' && (phaseRef.current === 'recording' || phaseRef.current === 'starting')) {
        dispatch({ type: 'requestStop' });
      }
    });
    return () => sub.remove();
  }, []);

  // Unmount while recording/starting, or while stopping is still waiting out
  // VOICE_MIN_MS (the stopping effect's cleanup has just cleared that timer):
  // Android's MediaRecorder.release() (what useAudioRecorder's teardown calls)
  // without a prior stop() leaves a truncated .m4a, so stop explicitly first.
  // Also always restore the audio session here, regardless of phase, so an
  // abandoned screen never leaves it open.
  useEffect(() => {
    return () => {
      const phase = phaseRef.current;
      if (phase === 'recording' || phase === 'starting' || (phase === 'stopping' && !stopSentRef.current)) {
        recorder.stop().catch(() => {});
      }
      setAudioModeAsync({ allowsRecording: false }).catch(() => {});
    };
  }, [recorder]);

  const start = useCallback(() => dispatch({ type: 'start' }), []);
  const stop = useCallback(() => dispatch({ type: 'requestStop' }), []);
  const reset = useCallback(() => dispatch({ type: 'reset' }), []);

  return {
    state,
    start,
    stop,
    reset,
    fileInfo: voiceFileInfo(Platform.OS, options),
    meteringDb: state.phase === 'recording' && typeof recorderState.metering === 'number' ? recorderState.metering : null,
  };
}
