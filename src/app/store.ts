/** Magasin d'état minimal (sans framework) et son crochet Preact. */
import { useEffect, useRef, useState } from 'preact/hooks';

export type Listener = () => void;

export class Store<S> {
  private listeners = new Set<Listener>();

  constructor(private state: S) {}

  get(): S {
    return this.state;
  }

  set(next: S): void {
    if (next === this.state) return;
    this.state = next;
    for (const l of Array.from(this.listeners)) l();
  }

  update(fn: (state: S) => S): void {
    this.set(fn(this.state));
  }

  patch(partial: Partial<S>): void {
    this.set({ ...this.state, ...partial });
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

/** Sélectionne une partie de l'état ; le composant ne se redessine que si elle change. */
export function useStore<S, T>(store: Store<S>, selector: (state: S) => T, equal: (a: T, b: T) => boolean = Object.is): T {
  const [, force] = useState(0);
  const selected = selector(store.get());
  const ref = useRef(selected);
  ref.current = selected;
  // Le sélecteur et la comparaison du dernier rendu : ils peuvent dépendre des propriétés du
  // composant (étape d'un parcours, matériau affiché…), l'abonnement doit utiliser les plus récents.
  const latest = useRef({ selector, equal });
  latest.current = { selector, equal };
  useEffect(() => {
    const check = () => {
      const next = latest.current.selector(store.get());
      if (!latest.current.equal(ref.current, next)) {
        ref.current = next;
        force((n) => n + 1);
      }
    };
    const unsubscribe = store.subscribe(check);
    // L'état a pu changer entre le premier rendu et l'abonnement (aperçu arrivé entre-temps) :
    // sans ce contrôle, ce changement serait perdu et le composant resterait figé.
    check();
    return unsubscribe;
  }, [store]);
  return selected;
}

export function shallowEqual<T>(a: T, b: T): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) return false;
  const ka = Object.keys(a as object);
  const kb = Object.keys(b as object);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => Object.is((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}
