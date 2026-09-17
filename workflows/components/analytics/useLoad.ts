// workflows/components/analytics/useLoad.ts
// SANO — one async read with its loading, error and retry state. A result that
// arrives after the inputs changed is dropped.
import { useCallback, useEffect, useRef, useState } from 'react';

export type LoadState<T> =
  | { status: 'loading'; data: null; error: null }
  | { status: 'ready'; data: T; error: null }
  | { status: 'error'; data: null; error: string };

export function useLoad<T>(load: () => Promise<T>): LoadState<T> & { reload: () => void } {
  const [state, setState] = useState<LoadState<T>>({ status: 'loading', data: null, error: null });
  const [attempt, setAttempt] = useState(0);
  const seq = useRef(0);
  useEffect(() => {
    const mine = ++seq.current;
    setState({ status: 'loading', data: null, error: null });
    load()
      .then((data) => { if (mine === seq.current) setState({ status: 'ready', data, error: null }); })
      .catch((err) => { if (mine === seq.current) setState({ status: 'error', data: null, error: (err as Error)?.message ?? 'Data gagal dimuat.' }); });
    return () => { seq.current += 1; };
  }, [load, attempt]);
  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  return { ...state, reload };
}
