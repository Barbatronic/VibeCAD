/** Point d'entrée : composition de l'application (état, worker de calcul, stockage, interface). */
import { render } from 'preact';
import './styles/app.css';
import { AppController } from './app/controller';
import { installKeyboard } from './app/keyboard';
import { setupOffline } from './app/offline';
import { initialState, type AppState } from './app/state';
import { Store } from './app/store';
import { GeometryClient } from './geometry/client';
import { ProjectStore } from './persistence/db';
import { WorkerSimRunner } from './sim/runner';
import { App } from './ui/App';
import { ControllerContext } from './ui/context';

async function boot(): Promise<void> {
  const store = new Store<AppState>(initialState());
  const client = new GeometryClient(() => new Worker(new URL('./workers/geometry.worker.ts', import.meta.url), { type: 'module', name: 'calcul-geometrique' }));
  const projects = await ProjectStore.open().catch(() => null);
  const simulation = new WorkerSimRunner(() => new Worker(new URL('./workers/sim.worker.ts', import.meta.url), { type: 'module', name: 'simulation' }));
  const controller = new AppController(store, { client, projects, simulation });
  setupOffline((offline) => store.patch({ offline }));
  installKeyboard(controller);
  window.addEventListener('beforeunload', (e) => {
    const s = store.get();
    if (s.project.savedRevision !== s.revision && s.revision > 0 && s.project.autosave.kind !== 'saved') {
      e.preventDefault();
    }
  });
  const root = document.getElementById('app')!;
  root.textContent = '';
  render(
    <ControllerContext.Provider value={controller}>
      <App />
    </ControllerContext.Provider>,
    root,
  );
  await controller.start();
  // Accès de diagnostic pour les tests de bout en bout et l'enseignant (console du navigateur).
  (window as unknown as { vibecad?: unknown }).vibecad = { controller, store };
}

void boot();
