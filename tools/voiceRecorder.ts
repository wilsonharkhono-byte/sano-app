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
import { Platform } from 'react-native';
import {
  RecordingPresets,
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
  | { type: 'fail'; error: string }
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
        durationMs: Math.min(action.durationMs, VOICE_NOTE_MAX_SECONDS * 1000),
        error: null,
        stopRequested: false,
      };
    case 'fail':
      return { ...INITIAL_VOICE_STATE, phase: 'error', error: action.error };
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

export interface VoiceRecorderApi {
  state: VoiceState;
  /** Press in. */
  start: () => void;
  /** Release. Safe to call while the recorder is still starting. */
  stop: () => void;
  /** Discard the take so the supervisor can record again. */
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
        const permission = await requestRecordingPermissionsAsync();
        if (!permission.granted) {
          dispatch({ type: 'fail', error: 'Izin mikrofon ditolak. Aktifkan di pengaturan HP.' });
          return;
        }
        await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
        await recorder.prepareToRecordAsync();
        recorder.record();
        dispatch({ type: 'started' });
      } catch (err) {
        dispatch({ type: 'fail', error: `Rekaman gagal dimulai: ${(err as Error).message}` });
      }
    })();
  }, [state.phase, recorder]);

  // stopping: finalize the file.
  useEffect(() => {
    if (state.phase !== 'stopping') return;
    void (async () => {
      try {
        await recorder.stop();
        dispatch({ type: 'stopped', uri: recorder.uri ?? null, durationMs: durationRef.current });
      } catch (err) {
        dispatch({ type: 'fail', error: `Rekaman gagal disimpan: ${(err as Error).message}` });
      }
    })();
  }, [state.phase, recorder]);

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
