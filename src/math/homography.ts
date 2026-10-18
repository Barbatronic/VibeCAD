/**
 * Homographie du plan (transformation projective) : passe d'un quadrilatère à un autre, comme
 * une photo prise de biais ramenée à une vue de face. Matrice 3 × 3 rangée par lignes, h33 = 1.
 */
import type { Vec2 } from './vec';

export type Homography = [number, number, number, number, number, number, number, number, number];

/** Homographie qui envoie chacun des 4 points `from` sur le point `to` de même rang (null si dégénérée). */
export function homographyFrom(from: readonly Vec2[], to: readonly Vec2[]): Homography | null {
  // Système 8 × 8 : u = (a x + b y + c) / (g x + h y + 1), v = (d x + e y + f) / (g x + h y + 1).
  const A: number[][] = [];
  const B: number[] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = from[i]!;
    const { x: u, y: v } = to[i]!;
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    B.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    B.push(v);
  }
  // Élimination de Gauss avec pivot partiel.
  const n = 8;
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r]![c]!) > Math.abs(A[p]![c]!)) p = r;
    if (Math.abs(A[p]![c]!) < 1e-12) return null;
    [A[c], A[p]] = [A[p]!, A[c]!];
    [B[c], B[p]] = [B[p]!, B[c]!];
    for (let r = c + 1; r < n; r++) {
      const f = A[r]![c]! / A[c]![c]!;
      for (let k = c; k < n; k++) A[r]![k] = A[r]![k]! - f * A[c]![k]!;
      B[r] = B[r]! - f * B[c]!;
    }
  }
  const h = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = B[r]!;
    for (let k = r + 1; k < n; k++) s -= A[r]![k]! * h[k]!;
    h[r] = s / A[r]![r]!;
  }
  return [h[0]!, h[1]!, h[2]!, h[3]!, h[4]!, h[5]!, h[6]!, h[7]!, 1];
}

/** Image d'un point par l'homographie. */
export function applyHomography(H: Homography, p: Vec2): Vec2 {
  const w = H[6] * p.x + H[7] * p.y + H[8];
  return { x: (H[0] * p.x + H[1] * p.y + H[2]) / w, y: (H[3] * p.x + H[4] * p.y + H[5]) / w };
}
