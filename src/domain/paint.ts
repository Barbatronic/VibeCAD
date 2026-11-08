/**
 * Peinture des faces d'une pièce imprimée : une face peinte prend une autre fiche matière (« PLA
 * rouge »), les autres gardent la matière de la pièce. Les faces sont désignées par une référence
 * sémantique (étape + rôle), comme les supports d'esquisse : la peinture survit aux modifications de
 * la pièce tant que la face existe. Voir docs/conception-matieres.md (lot 3).
 */
import type { FaceRef, Id, PartPaint } from './model';

type RefLike = Pick<FaceRef, 'featureId' | 'role' | 'entityId' | 'index'>;

/** Même face désignée ? (les champs absents doivent l'être des deux côtés). */
export function sameFaceRef(a: RefLike, b: RefLike): boolean {
  return a.featureId === b.featureId && a.role === b.role && a.entityId === b.entityId && a.index === b.index;
}

/** Peint une face avec une fiche (`null` : elle reprend la matière de la pièce). */
export function paintFace(paint: PartPaint | undefined, ref: FaceRef, material: Id | null, base: Id | undefined): PartPaint | undefined {
  const faces = (paint?.faces ?? []).filter((f) => !sameFaceRef(f.ref, ref));
  if (material && material !== base) faces.push({ ref, material });
  return faces.length ? { faces } : undefined;
}

/**
 * Fiche de chaque face d'un maillage (null : la matière de la pièce). Une face peinte prend sa
 * peinture (la dernière l'emporte) ; sinon, une face créée par une gravure colorée prend sa matière.
 */
export function faceMaterials(
  paint: PartPaint | undefined,
  faces: readonly { tags: readonly RefLike[] }[],
  engraves: readonly { featureId: Id; material: Id }[] = [],
): (Id | null)[] {
  const painted = paint?.faces ?? [];
  return faces.map((face) => {
    for (let i = painted.length - 1; i >= 0; i--) {
      const p = painted[i]!;
      if (face.tags.some((t) => sameFaceRef(t, p.ref))) return p.material;
    }
    for (let i = engraves.length - 1; i >= 0; i--) {
      if (face.tags.some((t) => t.featureId === engraves[i]!.featureId)) return engraves[i]!.material;
    }
    return null;
  });
}

/** Fiches utilisées par la peinture. */
export const paintMaterials = (paint: PartPaint | undefined): Id[] => [...new Set((paint?.faces ?? []).map((f) => f.material))];
