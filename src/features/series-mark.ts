/**
 * Marquage d'une série d'essais : la valeur essayée est gravée sur une face plane de chaque
 * version de la pièce, pour la reconnaître une fois imprimée. Le texte est centré sur la face
 * (d'après le maillage de la pièce) et rétréci s'il ne tient pas.
 */
import { addFeature, findPart, makeEngraveFeature, makeSketchFeature } from '../domain/document';
import type { CadDocument, FaceRef, Id } from '../domain/model';
import type { FaceTag, MeshData } from '../geometry/kernel';
import { canonicalFrame, worldToFrame } from '../math/frame';
import type { Vec2 } from '../math/vec';
import { addText } from '../sketch/model';
import { textWidth } from '../sketch/text';

/** Marquage d'une version : texte, position et taille dans le repère de l'esquisse posée sur la face. */
export interface VariantMark {
  face: FaceRef;
  text: string;
  anchor: Vec2;
  height: number;
  depth: number;
}

/** Hauteur de texte en dessous de laquelle l'imprimante ne rend plus les chiffres lisibles (mm). */
export const MARK_MIN_HEIGHT = 1.5;

const sameTag = (t: FaceTag, r: FaceRef) =>
  t.featureId === r.featureId && t.role === r.role && (t.entityId ?? null) === (r.entityId ?? null) && (t.index ?? null) === (r.index ?? null);

/**
 * Place le texte au centre de la face plane désignée : hauteur demandée, réduite pour tenir dans
 * 85 % de la largeur et 60 % de la hauteur de la face. Null si la face n'existe plus ou n'est pas
 * plane ; `tooSmall` si le texte deviendrait illisible.
 */
export function markLayout(mesh: MeshData, face: FaceRef, text: string, height: number, depth: number): (VariantMark & { tooSmall: boolean }) | null {
  const f = mesh.faces.find((x) => x.plane && x.tags.some((t) => sameTag(t, face)));
  if (!f?.plane) return null;
  const pts: Vec2[] = [];
  let frame = null;
  for (let k = f.start; k < f.start + f.count; k++) {
    const i = mesh.indices[k]! * 3;
    const p = { x: mesh.positions[i]!, y: mesh.positions[i + 1]!, z: mesh.positions[i + 2]! };
    frame ??= canonicalFrame(p, f.plane.normal);
    pts.push(worldToFrame(frame, p));
  }
  if (!frame || pts.length === 0) return null;
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  let h = Math.min(height, 0.6 * (y1 - y0));
  const w = textWidth(text, h);
  if (w > 0.85 * (x1 - x0)) h *= (0.85 * (x1 - x0)) / w;
  h = Math.round(h * 100) / 100;
  const width = textWidth(text, h);
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  return { face, text, anchor: { x: cx - width / 2, y: cy - h / 2 }, height: h, depth, tooSmall: h < MARK_MIN_HEIGHT };
}

/** Projet où la pièce porte le marquage : une esquisse sur la face, avec le texte, gravée à la fin. */
export function markedDocument(doc: CadDocument, partId: Id, mark: VariantMark): CadDocument {
  const part = findPart(doc, partId);
  if (!part || mark.height <= 0) return doc;
  const sketch = makeSketchFeature(doc, part, { kind: 'face', ref: mark.face });
  const withText = addText(sketch.params, mark.anchor, mark.text, mark.height);
  let out = addFeature(doc, partId, { ...sketch, name: 'Marquage', visible: false, params: withText.sketch });
  const engrave = makeEngraveFeature(out, findPart(out, partId)!, sketch.id, mark.depth);
  out = addFeature(out, partId, { ...engrave, name: 'Marquage gravé' });
  return out;
}
