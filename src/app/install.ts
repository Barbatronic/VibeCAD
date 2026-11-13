/**
 * Installation de l'application sur l'ordinateur (PWA) : icône sur le bureau, fenêtre dédiée,
 * fonctionnement hors ligne. Chrome et Edge proposent l'installation par l'événement
 * `beforeinstallprompt`, qu'on garde pour l'offrir dans la barre d'état ; Safari s'installe par
 * son propre menu (on indique où) ; Firefox ne sait pas installer d'application web.
 */

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/** `prompt` : installation proposée par le navigateur ; `safari` : par le menu de Safari. */
export type InstallOffer = { kind: 'none' } | { kind: 'prompt' } | { kind: 'safari'; mobile: boolean };

type Listener = (offer: InstallOffer) => void;

let deferred: InstallPromptEvent | null = null;
let offer: InstallOffer = { kind: 'none' };
const listeners = new Set<Listener>();

function set(next: InstallOffer): void {
  offer = next;
  for (const l of listeners) l(offer);
}

function isStandalone(): boolean {
  return window.matchMedia?.('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
}

function safariOffer(): InstallOffer {
  const ua = navigator.userAgent;
  const safari = /Safari\//.test(ua) && !/Chrome|Chromium|CriOS|Edg|FxiOS|Firefox|OPR/.test(ua);
  if (!safari) return { kind: 'none' };
  const mobile = /iPhone|iPad|iPod/.test(ua) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(ua));
  return { kind: 'safari', mobile };
}

/** À appeler au démarrage, avant l'affichage : l'événement peut arriver très tôt. */
export function setupInstall(): void {
  if (!import.meta.env.PROD || isStandalone()) return;
  set(safariOffer());
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as InstallPromptEvent;
    set({ kind: 'prompt' });
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    set({ kind: 'none' });
  });
}

export function installOffer(): InstallOffer {
  return offer;
}

export function onInstallOffer(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Ouvre la fenêtre d'installation du navigateur (Chrome, Edge). */
export async function promptInstall(): Promise<void> {
  const event = deferred;
  if (!event) return;
  deferred = null;
  await event.prompt();
  const choice = await event.userChoice.catch(() => ({ outcome: 'dismissed' as const }));
  // Une fois refusée, Chrome ne repropose l'installation qu'après un nouvel événement.
  if (choice.outcome === 'accepted') set({ kind: 'none' });
  else set(safariOffer());
}
