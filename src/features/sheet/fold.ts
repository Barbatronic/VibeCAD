/**
 * Pliage d'une tôle (calcul, worker). La tôle est gardée « à plat » (son développé) avec la liste
 * de ses plis ; la pièce pliée est reconstruite à chaque fois à partir du plat :
 *
 * - chaque pli est une ligne du plan de la tôle ; la bande de matière qui part de cette ligne, du
 *   côté qui se plie, a la longueur développée du pli (θ · (r + K · t)) ;
 * - la tôle est coupée à l'entrée et à la sortie de la bande ; la section à l'entrée tourne autour
 *   de l'axe du pli (révolution : l'arrondi) ; ce qui est au-delà de la bande est ramené sur la
 *   ligne puis tourné de l'angle du pli ;
 * - plusieurs plis : chaque morceau garde le placement accumulé des plis qui l'ont déplacé (un pli
 *   s'applique dans le repère « à plat », puis les plis précédents le déplacent).
 *
 * Le développé est donc exact : c'est la tôle à plat elle-même. Les lignes de pli ne doivent pas se
 * croiser dans la matière.
 */
import type { Id } from '../../domain/model';
import type { GeometryKernel, KernelShape } from '../../geometry/kernel';
import type { Frame3D } from '../../math/frame';
import { identity4, multiply4, translation4, type Mat4 } from '../../math/mat4';
import { add3, cross3, normalize3, scale3, type Vec2, type Vec3 } from '../../math/vec';
import { halfSpace } from '../half-space';

export interface FoldSpec {
  featureId: Id;
  /** Ligne de pli dans le plan de la tôle (coordonnées du repère de la tôle) : point, direction unitaire. */
  point: Vec2;
  dir: Vec2;
  /** Côté qui se plie : +1 à gauche de la direction, −1 à droite. */
  side: 1 | -1;
  /** Angle signé (radians) : positif, la partie pliée monte du côté de la normale de la tôle. */
  angle: number;
  /** Rayon intérieur (mm) et facteur K. */
  radius: number;
  k: number;
}

/** Tôle en cours de construction : la base, son plat et ses plis (repère : plan de la tôle, épaisseur le long de la normale). */
export interface SheetState {
  baseId: Id;
  frame: Frame3D;
  thickness: number;
  materialId: string;
  radius: number;
  /** Tôle à plat (développé), détenue par l'étape qui l'a créée. */
  flat: KernelShape;
  folds: FoldSpec[];
  /** Étapes qui ont modifié la pièce pliée après un pli : elles ne sont pas dans le développé. */
  later: Id[];
}

const toWorld = (f: Frame3D, p: Vec2): Vec3 => add3(f.origin, add3(scale3(f.xAxis, p.x), scale3(f.yAxis, p.y)));
const dirWorld = (f: Frame3D, d: Vec2): Vec3 => add3(scale3(f.xAxis, d.x), scale3(f.yAxis, d.y));

/** Longueur développée d'un pli. */
export function foldAllowance(fold: FoldSpec, thickness: number): number {
  return Math.abs(fold.angle) * (fold.radius + fold.k * thickness);
}

/** Rotation d'angle `angle` autour de l'axe (point, direction unitaire), en matrice 4 × 4 par colonnes. */
export function rotationAbout4(point: Vec3, dir: Vec3, angle: number): Mat4 {
  const { x, y, z } = normalize3(dir);
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const t = 1 - c;
  const r = [t * x * x + c, t * x * y + s * z, t * x * z - s * y, 0, t * x * y - s * z, t * y * y + c, t * y * z + s * x, 0, t * x * z + s * y, t * y * z - s * x, t * z * z + c, 0, 0, 0, 0, 1];
  return multiply4(translation4(point), multiply4(r, translation4(scale3(point, -1))));
}

/** Géométrie d'un pli dans l'espace (repère « à plat ») : côté plié, axe, déplacement de la partie pliée. */
export function foldGeometry(frame: Frame3D, thickness: number, fold: FoldSpec): { start: Vec3; side: Vec3; allowance: number; axis: { origin: Vec3; direction: Vec3 }; move: Mat4 } {
  const start = toWorld(frame, fold.point);
  const d = normalize3(dirWorld(frame, fold.dir));
  const side = normalize3(scale3(cross3(frame.normal, d), fold.side));
  const allowance = foldAllowance(fold, thickness);
  const up = fold.angle >= 0;
  // Axe parallèle à la ligne, à r de la face intérieure (dessus si le pli monte, dessous sinon).
  const origin = add3(start, scale3(frame.normal, up ? thickness + fold.radius : -fold.radius));
  // La direction de l'axe fait tourner le côté plié vers la normale (ou vers son opposé).
  const direction = normalize3(cross3(side, up ? frame.normal : scale3(frame.normal, -1)));
  const angle = Math.abs(fold.angle);
  const move = multiply4(rotationAbout4(origin, direction, angle), translation4(scale3(side, -allowance)));
  return { start, side, allowance, axis: { origin, direction }, move };
}

/** Pièce pliée à partir du plat (le plat n'est pas libéré ; le résultat appartient à l'appelant). */
export function foldSheet(kernel: GeometryKernel, sheet: Pick<SheetState, 'flat' | 'frame' | 'thickness' | 'folds'>): KernelShape {
  const folds = sheet.folds.filter((f) => Math.abs(f.angle) > 1e-9);
  if (folds.length === 0) return kernel.transformed(sheet.flat, identity4(), { keep: true });
  const size = 1e4;
  type Piece = { shape: KernelShape; owned: boolean; m: Mat4 };
  let pieces: Piece[] = [{ shape: sheet.flat, owned: false, m: identity4() }];
  const bends: Piece[] = [];
  const release = (p: Piece) => {
    if (p.owned) kernel.dispose(p.shape);
    p.owned = false;
  };
  const nonEmpty = (s: KernelShape) => kernel.volumeOf(s).solidCount > 0;
  try {
    for (const fold of folds) {
      const g = foldGeometry(sheet.frame, sheet.thickness, fold);
      const end = add3(g.start, scale3(g.side, g.allowance));
      const next: Piece[] = [];
      for (const piece of pieces) {
        // Côté fixe (avant la ligne), bande du pli (remplacée par l'arrondi), côté plié (après la bande).
        const before = halfSpace(kernel, fold.featureId, g.start, g.side, size, 'opposite');
        const after = halfSpace(kernel, fold.featureId, end, g.side, size, 'normal');
        let fixed: KernelShape | null = null;
        let moving: KernelShape | null = null;
        try {
          fixed = kernel.common(piece.shape, before);
          moving = kernel.common(piece.shape, after);
        } finally {
          kernel.dispose(before);
          kernel.dispose(after);
        }
        if (nonEmpty(fixed)) {
          const bend = kernel.revolveSection(fixed, { origin: g.start, normal: g.side }, g.axis, Math.abs(fold.angle), fold.featureId);
          if (bend) bends.push({ shape: bend, owned: true, m: piece.m });
          next.push({ shape: fixed, owned: true, m: piece.m });
        } else kernel.dispose(fixed);
        if (nonEmpty(moving)) next.push({ shape: moving, owned: true, m: multiply4(piece.m, g.move) });
        else kernel.dispose(moving);
        release(piece);
      }
      pieces = next;
    }
    const placed = [...pieces, ...bends].map((p) => kernel.transformed(p.shape, p.m, { keep: true }));
    try {
      return placed.length === 1 ? kernel.transformed(placed[0]!, identity4(), { keep: true }) : kernel.fuseMany(placed[0]!, placed.slice(1));
    } finally {
      for (const s of placed) kernel.dispose(s);
    }
  } finally {
    for (const p of pieces) release(p);
    for (const b of bends) release(b);
  }
}

/** Lignes de pli du développé (début et fin de chaque bande), dans le repère de la tôle. */
export function foldLines(sheet: Pick<SheetState, 'folds' | 'thickness'>): { featureId: Id; start: Vec2; end: Vec2; dir: Vec2; angle: number }[] {
  return sheet.folds.map((f) => {
    const side = { x: -f.dir.y * f.side, y: f.dir.x * f.side };
    const a = foldAllowance(f, sheet.thickness);
    return { featureId: f.featureId, start: f.point, end: { x: f.point.x + side.x * a, y: f.point.y + side.y * a }, dir: f.dir, angle: f.angle };
  });
}
