/**
 * Les objets Open CASCADE créés depuis JavaScript ne sont pas libérés automatiquement :
 * chaque enveloppe doit être détruite par `delete()`. Une portée regroupe les objets
 * temporaires d'un calcul et les libère en une fois.
 */
export interface Deletable {
  delete(): void;
}

export class Scope {
  private items: Deletable[] = [];

  track<T extends Deletable>(item: T): T {
    this.items.push(item);
    return item;
  }

  /** Retire un objet de la portée (il survivra à `dispose`, l'appelant en devient responsable). */
  release<T extends Deletable>(item: T): T {
    const i = this.items.lastIndexOf(item);
    if (i >= 0) this.items.splice(i, 1);
    return item;
  }

  dispose(): void {
    for (let i = this.items.length - 1; i >= 0; i--) {
      try {
        this.items[i]!.delete();
      } catch {
        // Objet déjà libéré : rien à faire.
      }
    }
    this.items = [];
  }
}

export function withScope<T>(fn: (scope: Scope) => T): T {
  const scope = new Scope();
  try {
    return fn(scope);
  } finally {
    scope.dispose();
  }
}
