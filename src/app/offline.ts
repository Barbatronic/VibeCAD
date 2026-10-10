/**
 * Mode hors ligne (PWA). En production, un service worker met en cache l'application, l'aide
 * et le fichier WASM du noyau ; l'état de préparation est affiché dans la barre d'état.
 * En développement (`npm run dev`), aucun service worker n'est installé.
 */
import type { OfflineState } from './state';

type Listener = (state: OfflineState) => void;

let registrationRef: ServiceWorkerRegistration | null = null;

/**
 * Installe la nouvelle version tout de suite : le service worker en attente prend la main, puis
 * la page se recharge une seule fois (le travail en cours est déjà sauvegardé automatiquement).
 */
export function applyUpdate(): void {
  const waiting = registrationRef?.waiting;
  if (!waiting) {
    window.location.reload();
    return;
  }
  navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload(), { once: true });
  waiting.postMessage({ type: 'skip-waiting' });
}

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
    // Messages d'une nouvelle version en cours de téléchargement : ils ne concernent pas la version utilisée.
    const controller = navigator.serviceWorker.controller;
    if (controller && event.source !== controller && data.type !== 'status-ready') return;
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
        registrationRef = registration;
        // Vérifie s'il existe une nouvelle version au démarrage, puis toutes les 30 minutes.
        void registration.update().catch(() => undefined);
        window.setInterval(() => void registration.update().catch(() => undefined), 30 * 60 * 1000);
        const ask = () => (registration.active ?? navigator.serviceWorker.controller)?.postMessage({ type: 'status' });
        // Une nouvelle version peut déjà être en cours d'installation (vérifiée par le navigateur au chargement).
        const track = (worker: ServiceWorker | null) => {
          if (!worker) return;
          const check = () => {
            if (worker.state === 'installed' && navigator.serviceWorker.controller) onState({ status: 'update-ready' });
            if (worker.state === 'activated') ask();
          };
          worker.addEventListener('statechange', check);
          check();
        };
        if (registration.waiting && navigator.serviceWorker.controller) onState({ status: 'update-ready' });
        track(registration.installing);
        registration.addEventListener('updatefound', () => track(registration.installing));
        await navigator.serviceWorker.ready;
        ask();
      })
      .catch((err: Error) => onState({ status: 'error', message: err.message }));
  };
  // L'application démarre souvent après l'événement « load » : on enregistre alors tout de suite.
  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, { once: true });
}
