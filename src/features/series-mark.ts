/**
 * Marquage d'une série d'essais : la valeur essayée est gravée sur une face plane de chaque
 * version de la pièce, pour la reconnaître une fois imprimée. Le texte est centré sur la face
 * (d'après le maillage de la pièce) et rétréci s'il ne tient pas.
 */
import { addFeature, findPart, makeEngraveFeature, makeSketchFeature } from '../domain/document';
import type { CadDocument, FaceRef, Id } from '../domain/model';
import type { BoundingBox, FaceTag, MeshData } from '../geometry/kernel';
import { canonicalFrame, worldToFrame } from '../math/frame';
import type { Vec2, Vec3 } from '../math/vec';
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

/** Marge laissée autour du texte, jusqu'au bord de la matière (mm). */
const MARK_PAD = 0.5;
/** Hauteur occupée par une ligne de chiffres, virgule comprise (qui descend sous la ligne de base). */
const LINE = 1.3;
const DESCENT = 0.3;

/**
 * Place le texte sur la face plane désignée, là où il y a de la matière : la face est découpée en
 * petites cases (ses triangles, dans le repère de l'esquisse), puis on cherche le plus grand
 * rectangle de texte qui tient entièrement dans la matière (trous évités), au plus près du centre.
 * La hauteur demandée est réduite si besoin. Null si la face n'existe plus, n'est pas plane ou est
 * hors de la zone `clip` ; `tooSmall` si le texte deviendrait illisible.
 */
export function markLayout(mesh: MeshData, face: FaceRef, text: string, height: number, depth: number, clip?: BoundingBox | null): (VariantMark & { tooSmall: boolean }) | null {
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
  if (!frame || pts.length < 3) return null;
  let [x0, x1, y0, y1] = [Math.min(...pts.map((p) => p.x)), Math.max(...pts.map((p) => p.x)), Math.min(...pts.map((p) => p.y)), Math.max(...pts.map((p) => p.y))];
  // Zone d'essai : le texte reste dans la partie de la face qui est imprimée.
  if (clip) {
    const corners = [0, 1, 2, 3, 4, 5, 6, 7].map((n) => worldToFrame(frame!, { x: n & 1 ? clip.max.x : clip.min.x, y: n & 2 ? clip.max.y : clip.min.y, z: n & 4 ? clip.max.z : clip.min.z }));
    x0 = Math.max(x0, Math.min(...corners.map((c) => c.x)));
    x1 = Math.min(x1, Math.max(...corners.map((c) => c.x)));
    y0 = Math.max(y0, Math.min(...corners.map((c) => c.y)));
    y1 = Math.min(y1, Math.max(...corners.map((c) => c.y)));
    if (x1 <= x0 || y1 <= y0) return null;
  }
  // Cases pleines : centre de la case dans un triangle de la face.
  const cell = Math.max(x1 - x0, y1 - y0) / 80;
  const nx = Math.max(1, Math.ceil((x1 - x0) / cell));
  const ny = Math.max(1, Math.ceil((y1 - y0) / cell));
  const full = new Uint8Array(nx * ny);
  for (let t = 0; t + 2 < pts.length; t += 3) {
    const [a, b, c] = [pts[t]!, pts[t + 1]!, pts[t + 2]!];
    const i0 = Math.max(0, Math.floor((Math.min(a.x, b.x, c.x) - x0) / cell));
    const i1 = Math.min(nx - 1, Math.ceil((Math.max(a.x, b.x, c.x) - x0) / cell));
    const j0 = Math.max(0, Math.floor((Math.min(a.y, b.y, c.y) - y0) / cell));
    const j1 = Math.min(ny - 1, Math.ceil((Math.max(a.y, b.y, c.y) - y0) / cell));
    const area = (b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y);
    if (Math.abs(area) < 1e-12) continue;
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const px = x0 + (i + 0.5) * cell;
        const py = y0 + (j + 0.5) * cell;
        const w1 = ((b.x - px) * (c.y - py) - (c.x - px) * (b.y - py)) / area;
        const w2 = ((c.x - px) * (a.y - py) - (a.x - px) * (c.y - py)) / area;
        if (w1 >= -1e-9 && w2 >= -1e-9 && w1 + w2 <= 1 + 1e-9) full[j * nx + i] = 1;
      }
    }
  }
  // Somme cumulée : un rectangle de cases est plein si sa somme vaut son aire.
  const sum = new Float64Array((nx + 1) * (ny + 1));
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) sum[(j + 1) * (nx + 1) + i + 1] = full[j * nx + i]! + sum[j * (nx + 1) + i + 1]! + sum[(j + 1) * (nx + 1) + i]! - sum[j * (nx + 1) + i]!;
  const filled = (i: number, j: number, w: number, h: number) => sum[(j + h) * (nx + 1) + i + w]! - sum[j * (nx + 1) + i + w]! - sum[(j + h) * (nx + 1) + i]! + sum[j * (nx + 1) + i]! === w * h;
  const ratio = textWidth(text, 1);
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  for (let h = height; h >= 0.3; h *= 0.97) {
    const w = Math.ceil((ratio * h + 2 * MARK_PAD) / cell);
    const hh = Math.ceil((LINE * h + 2 * MARK_PAD) / cell);
    if (w > nx || hh > ny) continue;
    let best: { i: number; j: number; d: number } | null = null;
    for (let j = 0; j + hh <= ny; j++) {
      for (let i = 0; i + w <= nx; i++) {
        if (!filled(i, j, w, hh)) continue;
        const d = Math.hypot(x0 + (i + w / 2) * cell - cx, y0 + (j + hh / 2) * cell - cy);
        if (!best || d < best.d) best = { i, j, d };
      }
    }
    if (!best) continue;
    const hr = Math.round(h * 100) / 100;
    // Texte centré dans son rectangle ; la virgule descend sous la ligne de base.
    const rx = x0 + (best.i + w / 2) * cell;
    const ry = y0 + (best.j + hh / 2) * cell;
    return { face, text, anchor: { x: rx - (ratio * hr) / 2, y: ry - (LINE * hr) / 2 + DESCENT * hr }, height: hr, depth, tooSmall: hr < MARK_MIN_HEIGHT };
  }
  return { face, text, anchor: { x: cx, y: cy }, height: 0, depth, tooSmall: true };
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

/**
 * Boîte de la zone d'essai : l'encombrement des faces désignées (toutes celles qui portent la
 * référence, un cylindre pouvant être en deux moitiés), agrandi de `margin` dans toutes les
 * directions. Null si la face n'existe plus.
 */
export function zoneBox(mesh: MeshData, face: FaceRef, margin: number): BoundingBox | null {
  const min: Vec3 = { x: Infinity, y: Infinity, z: Infinity };
  const max: Vec3 = { x: -Infinity, y: -Infinity, z: -Infinity };
  let found = false;
  for (const f of mesh.faces) {
    if (!f.tags.some((t) => sameTag(t, face))) continue;
    for (let k = f.start; k < f.start + f.count; k++) {
      const i = mesh.indices[k]! * 3;
      const x = mesh.positions[i]!;
      const y = mesh.positions[i + 1]!;
      const z = mesh.positions[i + 2]!;
      min.x = Math.min(min.x, x);
      min.y = Math.min(min.y, y);
      min.z = Math.min(min.z, z);
      max.x = Math.max(max.x, x);
      max.y = Math.max(max.y, y);
      max.z = Math.max(max.z, z);
      found = true;
    }
  }
  if (!found) return null;
  const m = Math.max(0, margin);
  return { min: { x: min.x - m, y: min.y - m, z: min.z - m }, max: { x: max.x + m, y: max.y + m, z: max.z + m } };
}
