/**
 * Peinture des faces d'une pièce imprimée : une face peinte prend une autre fiche matière (« PLA
 * rouge »), les autres gardent la matière de la pièce. Les faces sont désignées par une référence
 * sémantique (étape + rôle), comme les supports d'esquisse : la peinture survit aux modifications de
 * la pièce tant que la face existe. Voir docs/conception-matieres.md (lot 3).
 */
import type { FaceRef, Id, Part, PartPaint } from './model';

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
 * Fiche de chaque face d'un maillage (null : la matière de la pièce). Du plus précis au plus
 * général : la peinture posée sur une zone gravée (`marks` : étapes Gravure), puis la couleur
 * donnée à la gravure, puis la peinture de la face (la dernière l'emporte). Une zone gravée garde
 * aussi l'étiquette de la face où elle est posée : sans couleur à elle, elle suit cette face.
 * Générique : sert aussi aux emplacements AMS de l'export 3MF.
 */
export function faceMaterials<T = Id>(
  paint: { faces: readonly { ref: RefLike; material: T }[] } | undefined,
  faces: readonly { tags: readonly RefLike[] }[],
  engraves: readonly { featureId: Id; material: T }[] = [],
  marks: ReadonlySet<Id> = new Set(engraves.map((e) => e.featureId)),
): (T | null)[] {
  const painted = paint?.faces ?? [];
  const last = <U>(list: readonly U[], ok: (u: U) => boolean) => {
    for (let i = list.length - 1; i >= 0; i--) if (ok(list[i]!)) return list[i]!;
    return undefined;
  };
  return faces.map((face) => {
    const on = (p: { ref: RefLike }) => face.tags.some((t) => sameFaceRef(t, p.ref));
    const hit = last(painted, (p) => marks.has(p.ref.featureId) && on(p)) ?? last(engraves, (e) => face.tags.some((t) => t.featureId === e.featureId)) ?? last(painted, on);
    return hit ? hit.material : null;
  });
}

/** Fiches utilisées par la peinture. */
export const paintMaterials = (paint: PartPaint | undefined): Id[] => [...new Set((paint?.faces ?? []).map((f) => f.material))];

/** Étapes Gravure d'une pièce : leurs zones se peignent à part de la face qui les porte. */
export const engraveSteps = (part: Pick<Part, 'features'>): Set<Id> => new Set(part.features.filter((f) => f.type === 'engrave').map((f) => f.id));
