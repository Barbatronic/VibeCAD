import { createContext } from 'preact';
import { useContext } from 'preact/hooks';
import type { AppController } from '../app/controller';
import type { AppState } from '../app/state';
import { useStore } from '../app/store';

export const ControllerContext = createContext<AppController | null>(null);

export function useController(): AppController {
  const c = useContext(ControllerContext);
  if (!c) throw new Error('Contrôleur absent');
  return c;
}

export function useAppState<T>(selector: (s: AppState) => T, equal?: (a: T, b: T) => boolean): T {
  const c = useController();
  return useStore(c.store, selector, equal);
}
