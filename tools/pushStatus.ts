// This device's push-registration outcome, readable from any screen without
// prop drilling (PushStatusLine subscribes via useSyncExternalStore).
export type PushStatus = 'unknown' | 'active' | 'denied' | 'unsupported' | 'error';

let current: PushStatus = 'unknown';
const listeners = new Set<() => void>();

export function getPushStatus(): PushStatus {
  return current;
}

export function setPushStatus(next: PushStatus): void {
  if (next === current) return;
  current = next;
  listeners.forEach(listener => listener());
}

export function subscribePushStatus(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
