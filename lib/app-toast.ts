export type AppToastTone = 'info' | 'success' | 'error';

export type AppToastState = {
  id: number;
  message: string;
  tone: AppToastTone;
};

type Listener = (toast: AppToastState | null) => void;

const listeners = new Set<Listener>();
let hideTimer: ReturnType<typeof setTimeout> | null = null;

export function showAppToast(
  message: string,
  tone: AppToastTone = 'info',
  durationMs = 2800
): void {
  const toast: AppToastState = { id: Date.now(), message, tone };
  listeners.forEach((l) => l(toast));
  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    listeners.forEach((l) => l(null));
    hideTimer = null;
  }, durationMs);
}

export function subscribeAppToast(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
