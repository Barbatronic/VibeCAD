/**
 * Copie des pièces d'un autre projet dans le projet ouvert (composants des bibliothèques) : chaque
 * pièce garde son historique complet (esquisses, étapes, matière, couleur) ; ses identifiants
 * (pièce, étapes, ressources embarquées) sont renouvelés pour ne rien heurter dans le projet.
 */
import { createId } from './ids';
import type { CadDocument, Id, Part } from './model';

/** Tous les identifiants déjà pris dans un projet. */
function takenIds(doc: CadDocument): Set<string> {
  const ids = new Set<string>([doc.id]);
  for (const p of doc.parts) {
    ids.add(p.id);
    for (const f of p.features) ids.add(f.id);
  }
  for (const r of Object.keys(doc.resources)) ids.add(r);
  return ids;
}

/** Préfixe d'un identifiant (`sk-1` → `sk`). */
const prefixOf = (id: string) => id.slice(0, Math.max(1, id.indexOf('-'))) || 'id';

/**
 * Ajoute au projet `target` les pièces `partIds` (toutes par défaut) du projet `source`, avec leurs
 * ressources embarquées. Renvoie le projet et les identifiants des nouvelles pièces, dans l'ordre.
 */
export function copyPartsInto(target: CadDocument, source: CadDocument, partIds?: Id[]): { doc: CadDocument; partIds: Id[] } {
  const parts = source.parts.filter((p) => !partIds || partIds.includes(p.id));
  const taken = takenIds(target);
  const map = new Map<string, string>();
  const fresh = (old: string) => {
    let id = map.get(old);
    if (!id) {
      id = createId(prefixOf(old), taken);
      taken.add(id);
      map.set(old, id);
    }
    return id;
  };
  for (const p of parts) {
    fresh(p.id);
    for (const f of p.features) fresh(f.id);
  }
  // Ressources utilisées par ces pièces (fichiers importés, images) : copiées sous un nouvel id.
  const json = JSON.stringify(parts);
  const resources = Object.entries(source.resources).filter(([id]) => json.includes(`"${id}"`));
  for (const [id] of resources) fresh(id);
  // Remplacement de chaque identifiant là où il apparaît comme valeur exacte (références entre
  // étapes, arêtes, faces…) ; les identifiants internes aux esquisses ne sont pas touchés.
  const remap = <T>(value: T): T => JSON.parse(JSON.stringify(value), (_k, v) => (typeof v === 'string' && map.has(v) ? map.get(v) : v)) as T;
  const copied: Part[] = parts.map((p) => remap(p));
  const copiedResources = Object.fromEntries(resources.map(([id, r]) => [map.get(id)!, remap(r)]));
  return {
    doc: { ...target, parts: [...target.parts, ...copied], resources: { ...target.resources, ...copiedResources } },
    partIds: copied.map((p) => p.id),
  };
}
