/**
 * Choix et description des supports d'esquisse. Une face est toujours désignée par une
 * référence sémantique (fonction + rôle + élément d'esquisse), jamais par un numéro transitoire.
 */
import type { FaceRef, Part } from '../../domain/model';
import type { FaceTag } from '../../geometry/kernel';

const ROLE_RANK: Record<FaceRef['role'], number> = { end: 0, start: 1, imported: 2, side: 3, blend: 4 };

/**
 * Référence la plus stable d'une face : celle de la fonction la plus ancienne de l'historique
 * (une face fusionnée porte plusieurs étiquettes).
 */
export function pickFaceReference(tags: readonly FaceTag[], part: Part): FaceRef | null {
  if (tags.length === 0) return null;
  const order = new Map(part.features.map((f, i) => [f.id, i]));
  const sorted = [...tags].sort(
    (a, b) => (order.get(a.featureId) ?? 1e9) - (order.get(b.featureId) ?? 1e9) || ROLE_RANK[a.role] - ROLE_RANK[b.role],
  );
  const t = sorted[0]!;
  const ref: FaceRef = { featureId: t.featureId, role: t.role };
  if (t.entityId !== undefined) ref.entityId = t.entityId;
  if (t.index !== undefined) ref.index = t.index;
  return ref;
}

/** Description lisible d'une face, ex. « face d'arrivée de « Extrusion 1 » ». */
export function describeFaceRef(ref: FaceRef, part: Part | undefined): string {
  const feature = part?.features.find((f) => f.id === ref.featureId);
  const name = feature ? `« ${feature.name} »` : 'une étape supprimée';
  if (feature?.type === 'pattern') return `face de l’exemplaire n° ${(ref.index ?? 0) + 1} de ${name}`;
  if (ref.role === 'imported') return `face n° ${(ref.index ?? 0) + 1} de ${name}`;
  if (ref.role === 'blend') return feature?.type === 'chamfer' ? `face de chanfrein de ${name}` : `face arrondie de ${name}`;
  if (feature?.type === 'pocket') return ref.role === 'side' ? `paroi de ${name}` : `fond de ${name}`;
  if (ref.role === 'end') return `face d’arrivée de ${name}`;
  if (ref.role === 'start') return `face de départ de ${name}`;
  return `face latérale de ${name}`;
}
