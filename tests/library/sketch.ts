/**
 * Esquisses entièrement cotées pour les composants de la bibliothèque : chaque forme est dessinée
 * puis contrainte comme le ferait un utilisateur (diamètre, longueurs, position depuis l'origine),
 * pour qu'une fois insérée, chaque esquisse soit verte (0 degré de liberté) et se modifie en
 * changeant une cote.
 */
import { ORIGIN_POINT_ID, type SketchParams } from '../../src/domain/model';
import { addCircle, addConstraint, addRectangle } from '../../src/sketch/model';
import { solveSketch } from '../../src/sketch/solver';

/** Place un point par deux cotes depuis l'origine (horizontale puis verticale), ou le colle à l'origine. */
function placePoint(sketch: SketchParams, point: string, x: number, y: number): SketchParams {
  if (Math.abs(x) < 1e-9 && Math.abs(y) < 1e-9) return addConstraint(sketch, { type: 'coincident', a: ORIGIN_POINT_ID, b: point }).sketch;
  // Distance horizontale : x(b) − x(a) = valeur ≥ 0 (idem en vertical).
  let s = addConstraint(sketch, x >= 0 ? { type: 'distanceX', a: ORIGIN_POINT_ID, b: point, value: x } : { type: 'distanceX', a: point, b: ORIGIN_POINT_ID, value: -x }).sketch;
  s = addConstraint(s, y >= 0 ? { type: 'distanceY', a: ORIGIN_POINT_ID, b: point, value: y } : { type: 'distanceY', a: point, b: ORIGIN_POINT_ID, value: -y }).sketch;
  return s;
}

/** Cercle coté : diamètre, centre placé depuis l'origine. */
export function circle(sketch: SketchParams, x: number, y: number, r: number): { sketch: SketchParams; circleId: string } {
  // Dessiné un peu à côté puis contraint : c'est le solveur qui le met en place.
  const c = addCircle(sketch, { x: x + r * 0.1, y: y - r * 0.1 }, r * 0.9);
  let s = addConstraint(c.sketch, { type: 'diameter', circle: c.circleId, value: 2 * r }).sketch;
  s = placePoint(s, c.center, x, y);
  return { sketch: s, circleId: c.circleId };
}

/** Rectangle coté : largeur (X), hauteur (Y), centré en (cx, cy) (coin bas-gauche placé depuis l'origine). */
export function rectangle(sketch: SketchParams, width: number, height: number, cx = 0, cy = 0): { sketch: SketchParams; lines: [string, string, string, string] } {
  const x0 = cx - width / 2;
  const y0 = cy - height / 2;
  const r = addRectangle(sketch, { x: x0, y: y0 }, { x: x0 + width * 0.95, y: y0 + height * 1.05 });
  let s = addConstraint(r.sketch, { type: 'length', line: r.lines[0], value: width }).sketch;
  s = addConstraint(s, { type: 'length', line: r.lines[3], value: height }).sketch;
  s = placePoint(s, r.corners[0], x0, y0);
  return { sketch: s, lines: r.lines };
}

/** Plusieurs cercles cotés ; l'esquisse est résolue à la fin. */
export function circles(sketch: SketchParams, list: { x: number; y: number; r: number }[]): { sketch: SketchParams; ids: string[] } {
  let s = sketch;
  const ids: string[] = [];
  for (const c of list) {
    const r = circle(s, c.x, c.y, c.r);
    s = r.sketch;
    ids.push(r.circleId);
  }
  return { sketch: solveSketch(s).sketch, ids };
}

export const solved = (sketch: SketchParams) => solveSketch(sketch).sketch;
