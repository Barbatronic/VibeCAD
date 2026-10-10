/**
 * Mode hors ligne (PWA). En production, un service worker met en cache l'application, l'aide
 * et le fichier WASM du noyau ; l'état de préparation est affiché dans la barre d'état.
 * En développement (`npm run dev`), aucun service worker n'est installé.
 */
import type { OfflineState } from './state';

type Listener = (state: OfflineState) => void;

export function setupOffline(onState: Listener): void {
  if (!import.meta.env.PROD) {
    onState({ status: 'dev' });
    return;
  }
  if (!('serviceWorker' in navigator) || !window.isSecureContext) {
    onState({ status: 'unsupported' });
    return;
  }
  navigator.serviceWorker.addEventListener('message', (event: MessageEvent) => {
    const data = event.data as { type?: string; done?: number; total?: number; version?: string; message?: string } | undefined;
    if (!data?.type) return;
    if (data.type === 'precache-progress') onState({ status: 'preparing', done: data.done ?? 0, total: data.total ?? 0 });
    else if (data.type === 'precache-complete' || data.type === 'status-ready') onState({ status: 'ready', version: data.version ?? '' });
    else if (data.type === 'status-not-ready') onState({ status: 'preparing', done: 0, total: 0 });
    else if (data.type === 'precache-error') onState({ status: 'error', message: data.message ?? 'Mise en cache impossible' });
  });
  onState({ status: 'preparing', done: 0, total: 0 });
  const register = () => {
    navigator.serviceWorker
      .register('./sw.js', { scope: './' })
      .then(async (registration) => {
        const ask = () => (registration.active ?? navigator.serviceWorker.controller)?.postMessage({ type: 'status' });
        if (registration.waiting && navigator.serviceWorker.controller) onState({ status: 'update-ready' });
        registration.addEventListener('updatefound', () => {
          const worker = registration.installing;
          worker?.addEventListener('statechange', () => {
            if (worker.state === 'installed' && navigator.serviceWorker.controller) onState({ status: 'update-ready' });
            if (worker.state === 'activated') ask();
          });
        });
        await navigator.serviceWorker.ready;
        ask();
      })
      .catch((err: Error) => onState({ status: 'error', message: err.message }));
  };
  // L'application démarre souvent après l'événement « load » : on enregistre alors tout de suite.
  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, { once: true });
}
