/**
 * Profils des générateurs (calculs purs, testables) : roue dentée droite à développante de cercle,
 * crémaillère, poulie crantée (courroies GT2 et T). Chaque profil est une région plane (contour
 * extérieur dans le sens trigonométrique, alésage dans l'autre sens), extrudée ensuite par le noyau.
 *
 * Roue dentée (norme ISO 53, sans déport) : module m, nombre de dents z, angle de pression α.
 * Diamètre primitif d = m·z ; tête da = d + 2m ; pied df = d − 2,5m ; base db = d·cos α. Les
 * flancs sont des développantes de cercle, approchées par des courbes de Bézier cubiques
 * (écart < 1 µm pour les modules courants) ; sous le cercle de base, le flanc descend en ligne
 * droite vers le pied (sans raccord trochoïdal : suffisant pour l'impression 3D et la découpe).
 * Deux roues (ou une roue et une crémaillère) de même module et même angle de pression engrènent ;
 * entraxe = m·(z1 + z2) / 2.
 */
import type { Bezier } from '../../sketch/curves';
import type { ProfileLoop, ProfileRegion, ProfileSegment } from '../../sketch/profiles';
import type { Vec2 } from '../../math/vec';
import type { BeltProfile } from '../../domain/model';

export type { BeltProfile };

const polar = (r: number, a: number): Vec2 => ({ x: r * Math.cos(a), y: r * Math.sin(a) });
const inv = (a: number) => Math.tan(a) - a;

/** Aire signée d'une boucle (échantillonnée) : sert aux contrôles et à l'aire de la région. */
function loopArea(segments: readonly ProfileSegment[]): number {
  const pts: Vec2[] = [];
  for (const s of segments) {
    if (s.kind === 'line') pts.push(s.start);
    else if (s.kind === 'spline') for (const b of s.beziers) for (let k = 0; k < 8; k++) pts.push(bez(b, k / 8));
    else if (s.kind === 'arc') {
      const a0 = Math.atan2(s.start.y - s.center.y, s.start.x - s.center.x);
      let a1 = Math.atan2(s.end.y - s.center.y, s.end.x - s.center.x);
      if (!s.clockwise && a1 <= a0) a1 += 2 * Math.PI;
      if (s.clockwise && a1 >= a0) a1 -= 2 * Math.PI;
      for (let k = 0; k < 16; k++) pts.push(polarAround(s.center, s.radius, a0 + ((a1 - a0) * k) / 16));
    } else if (s.kind === 'circle') return (s.clockwise ? -1 : 1) * Math.PI * s.radius * s.radius;
  }
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!;
    const q = pts[(i + 1) % pts.length]!;
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

const polarAround = (c: Vec2, r: number, a: number): Vec2 => ({ x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) });

function bez(b: Bezier, t: number): Vec2 {
  const u = 1 - t;
  const w = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
  return { x: w[0]! * b[0].x + w[1]! * b[1].x + w[2]! * b[2].x + w[3]! * b[3].x, y: w[0]! * b[0].y + w[1]! * b[1].y + w[2]! * b[2].y + w[3]! * b[3].y };
}

function region(outer: ProfileSegment[], bore: number): ProfileRegion {
  const outerLoop: ProfileLoop = { segments: outer, signedArea: loopArea(outer) };
  const holes: ProfileLoop[] =
    bore > 0 ? [{ segments: [{ kind: 'circle', entityId: 'bore', center: { x: 0, y: 0 }, radius: bore / 2, clockwise: true }], signedArea: -Math.PI * (bore / 2) ** 2 }] : [];
  return { outer: outerLoop, holes, area: outerLoop.signedArea + holes.reduce((s, h) => s + h.signedArea, 0) };
}

/** Arc de centre O, du point d'angle a0 au point d'angle a1 (sens trigonométrique). */
function arcCcw(entityId: string, r: number, a0: number, a1: number): ProfileSegment {
  return { kind: 'arc', entityId, start: polar(r, a0), end: polar(r, a1), center: { x: 0, y: 0 }, radius: r, clockwise: false };
}

// ---------------------------------------------------------------------------
// Roue dentée

export interface SpurGearGeometry {
  pitch: number;
  tip: number;
  root: number;
  base: number;
}

export function spurGeometry(module: number, teeth: number, pressureAngleDeg: number): SpurGearGeometry {
  const d = module * teeth;
  return { pitch: d, tip: d + 2 * module, root: d - 2.5 * module, base: d * Math.cos((pressureAngleDeg * Math.PI) / 180) };
}

/**
 * Développante de cercle de rayon de base rb, partant de l'angle β0 : point et dérivée pour le
 * paramètre de déroulement t (t = tan de l'angle de pression local).
 */
function involute(rb: number, beta0: number, t: number): { p: Vec2; d: Vec2 } {
  const a = beta0 + t;
  return {
    p: { x: rb * (Math.cos(a) + t * Math.sin(a)), y: rb * (Math.sin(a) - t * Math.cos(a)) },
    d: { x: rb * t * Math.cos(a), y: rb * t * Math.sin(a) },
  };
}

/** Morceaux de Bézier (Hermite) qui suivent la développante entre t0 et t1. */
function involuteBeziers(rb: number, beta0: number, t0: number, t1: number, pieces: number): Bezier[] {
  const out: Bezier[] = [];
  for (let k = 0; k < pieces; k++) {
    const ta = t0 + ((t1 - t0) * k) / pieces;
    const tb = t0 + ((t1 - t0) * (k + 1)) / pieces;
    const A = involute(rb, beta0, ta);
    const B = involute(rb, beta0, tb);
    const h = (tb - ta) / 3;
    out.push([A.p, { x: A.p.x + h * A.d.x, y: A.p.y + h * A.d.y }, { x: B.p.x - h * B.d.x, y: B.p.y - h * B.d.y }, B.p]);
  }
  return out;
}

/** Symétrique d'un point par rapport à la droite d'angle c passant par l'origine. */
function mirror(p: Vec2, c: number): Vec2 {
  const cos = Math.cos(2 * c);
  const sin = Math.sin(2 * c);
  return { x: p.x * cos + p.y * sin, y: p.x * sin - p.y * cos };
}

/** Contour d'une roue dentée droite (et son alésage). */
export function spurGearProfile(module: number, teeth: number, pressureAngleDeg: number, bore: number): ProfileRegion {
  const g = spurGeometry(module, teeth, pressureAngleDeg);
  const alpha = (pressureAngleDeg * Math.PI) / 180;
  const rp = g.pitch / 2;
  const ra = g.tip / 2;
  const rf = g.root / 2;
  const rb = g.base / 2;
  // Demi-épaisseur angulaire de la dent au primitif : π / (2z).
  const psi = Math.PI / (2 * teeth);
  const startR = Math.max(rb, rf);
  const tStart = Math.sqrt(Math.max(0, (startR / rb) ** 2 - 1));
  const tTip = Math.sqrt((ra / rb) ** 2 - 1);
  const pitchStep = (2 * Math.PI) / teeth;
  const segments: ProfileSegment[] = [];
  for (let k = 0; k < teeth; k++) {
    const c = k * pitchStep;
    // Flanc montant (côté des petits angles) : développante qui part de c − ψ − inv α.
    const beta0 = c - psi - inv(alpha);
    const rising = involuteBeziers(rb, beta0, tStart, tTip, 2);
    const risingStart = rising[0]![0];
    const tipStart = rising[rising.length - 1]![3];
    // Pied : ligne droite radiale du cercle de pied au début de la développante.
    const footAngle = Math.atan2(risingStart.y, risingStart.x);
    const footRising = polar(rf, footAngle);
    if (startR > rf + 1e-9) segments.push({ kind: 'line', entityId: `t${k}-foot-a`, start: footRising, end: risingStart });
    segments.push({ kind: 'spline', entityId: `t${k}-flank-a`, start: risingStart, end: tipStart, beziers: rising });
    // Tête, puis flanc descendant (symétrique par rapport à l'axe de la dent).
    const falling = rising.map((b) => b.map((p) => mirror(p, c)).reverse() as Bezier).reverse();
    const tipEnd = falling[0]![0];
    segments.push({ kind: 'arc', entityId: `t${k}-tip`, start: tipStart, end: tipEnd, center: { x: 0, y: 0 }, radius: ra, clockwise: false });
    const fallingEnd = falling[falling.length - 1]![3];
    segments.push({ kind: 'spline', entityId: `t${k}-flank-b`, start: tipEnd, end: fallingEnd, beziers: falling });
    const footFalling = mirror(footRising, c);
    if (startR > rf + 1e-9) segments.push({ kind: 'line', entityId: `t${k}-foot-b`, start: fallingEnd, end: footFalling });
    // Fond de denture jusqu'à la dent suivante.
    const nextFoot = polar(rf, footAngle + pitchStep);
    segments.push({ kind: 'arc', entityId: `t${k}-root`, start: footFalling, end: nextFoot, center: { x: 0, y: 0 }, radius: rf, clockwise: false });
  }
  void rp;
  return region(segments, bore);
}

// ---------------------------------------------------------------------------
// Crémaillère

/**
 * Crémaillère droite le long de X, dents vers +Y : ligne primitive à y = 0, `teeth` dents au pas
 * π·m, corps de hauteur `body` sous le pied de dent. Coin bas gauche en (−π·m/2, −1,25m − body).
 */
export function rackProfile(module: number, teeth: number, pressureAngleDeg: number, body: number): ProfileRegion {
  const p = Math.PI * module;
  const a = module;
  const d = 1.25 * module;
  const tanA = Math.tan((pressureAngleDeg * Math.PI) / 180);
  const halfTip = p / 4 - a * tanA;
  const halfRoot = p / 4 + d * tanA;
  const x0 = -p / 2;
  const x1 = x0 + teeth * p;
  const yBottom = -d - body;
  const pts: Vec2[] = [{ x: x0, y: yBottom }, { x: x1, y: yBottom }, { x: x1, y: -d }];
  // Dents parcourues de droite à gauche (sens trigonométrique du contour).
  for (let k = teeth - 1; k >= 0; k--) {
    const c = x0 + (k + 0.5) * p;
    pts.push({ x: c + halfRoot, y: -d }, { x: c + halfTip, y: a }, { x: c - halfTip, y: a }, { x: c - halfRoot, y: -d });
  }
  pts.push({ x: x0, y: -d });
  const clean = pts.filter((q, i) => {
    const prev = pts[(i + pts.length - 1) % pts.length]!;
    return Math.hypot(q.x - prev.x, q.y - prev.y) > 1e-9;
  });
  const segments: ProfileSegment[] = clean.map((q, i) => ({ kind: 'line', entityId: `r${i}`, start: q, end: clean[(i + 1) % clean.length]! }));
  return region(segments, 0);
}

// ---------------------------------------------------------------------------
// Poulie crantée


/**
 * Courroies : pas (mm), écart entre ligne primitive et diamètre extérieur de la poulie (PLD), et
 * creux de la poulie (profondeur, largeur en tête, rayon de fond). Creux légèrement plus grands que
 * la dent de la courroie (jeu d'impression). Valeurs proches des bibliothèques libres courantes
 * (poulies paramétriques OpenSCAD) : une impression d'essai reste recommandée.
 */
export const BELT_PROFILES: Record<BeltProfile, { label: string; pitch: number; pld: number; depth: number; width: number; radius: number; shape: 'round' | 'trapezoid' }> = {
  'GT2-2': { label: 'GT2, pas 2 mm', pitch: 2, pld: 0.254, depth: 0.76, width: 1.4, radius: 0.56, shape: 'round' },
  'GT2-3': { label: 'GT2, pas 3 mm', pitch: 3, pld: 0.381, depth: 1.14, width: 2.1, radius: 0.85, shape: 'round' },
  'GT2-5': { label: 'GT2, pas 5 mm', pitch: 5, pld: 0.5715, depth: 1.93, width: 3.4, radius: 1.4, shape: 'round' },
  'T2.5': { label: 'T2.5, pas 2,5 mm', pitch: 2.5, pld: 0.3, depth: 0.75, width: 1.75, radius: 0, shape: 'trapezoid' },
  T5: { label: 'T5, pas 5 mm', pitch: 5, pld: 0.5, depth: 1.25, width: 3.05, radius: 0, shape: 'trapezoid' },
  T10: { label: 'T10, pas 10 mm', pitch: 10, pld: 1, depth: 2.6, width: 6.1, radius: 0, shape: 'trapezoid' },
};

/** Diamètre extérieur d'une poulie de z dents : z·pas / π − 2·PLD. */
export function pulleyOutsideDiameter(profile: BeltProfile, teeth: number): number {
  const b = BELT_PROFILES[profile];
  return (teeth * b.pitch) / Math.PI - 2 * b.pld;
}

/** Contour d'une poulie crantée (et son alésage). */
export function pulleyProfile(profile: BeltProfile, teeth: number, bore: number): ProfileRegion {
  const b = BELT_PROFILES[profile];
  const R = pulleyOutsideDiameter(profile, teeth) / 2;
  const step = (2 * Math.PI) / teeth;
  const half = Math.asin(Math.min(0.99, b.width / 2 / R));
  const segments: ProfileSegment[] = [];
  for (let k = 0; k < teeth; k++) {
    const c = k * step;
    const left = polar(R, c - half);
    const right = polar(R, c + half);
    const dir = { x: Math.cos(c), y: Math.sin(c) };
    const tan = { x: -Math.sin(c), y: Math.cos(c) };
    if (b.shape === 'trapezoid') {
      // Flancs inclinés de 20° (angle de dent de 40°).
      const bottomHalf = Math.max(0.1, b.width / 2 - b.depth * Math.tan((20 * Math.PI) / 180));
      const depthPoint = (side: number) => ({ x: dir.x * (R - b.depth) + side * bottomHalf * tan.x, y: dir.y * (R - b.depth) + side * bottomHalf * tan.y });
      const bl = depthPoint(-1);
      const br = depthPoint(1);
      segments.push({ kind: 'line', entityId: `g${k}-a`, start: left, end: bl });
      segments.push({ kind: 'line', entityId: `g${k}-bottom`, start: bl, end: br });
      segments.push({ kind: 'line', entityId: `g${k}-b`, start: br, end: right });
    } else {
      // Creux arrondi : fond circulaire de rayon r, flancs tangents.
      const C = { x: dir.x * (R - b.depth + b.radius), y: dir.y * (R - b.depth + b.radius) };
      const tangentPoint = (T: Vec2, side: number): Vec2 => {
        const v = { x: T.x - C.x, y: T.y - C.y };
        const dist = Math.hypot(v.x, v.y);
        const theta = Math.atan2(v.y, v.x);
        const beta = Math.acos(Math.min(1, b.radius / dist));
        const cands = [theta + beta, theta - beta].map((a) => ({ x: C.x + b.radius * Math.cos(a), y: C.y + b.radius * Math.sin(a) }));
        // Point de tangence du côté de T (le plus éloigné de l'axe du creux).
        const along = (p: Vec2) => side * ((p.x - C.x) * tan.x + (p.y - C.y) * tan.y);
        return along(cands[0]!) >= along(cands[1]!) ? cands[0]! : cands[1]!;
      };
      const pl = tangentPoint(left, -1);
      const pr = tangentPoint(right, 1);
      segments.push({ kind: 'line', entityId: `g${k}-a`, start: left, end: pl });
      // Fond : de pl à pr en passant par le point le plus profond (sens horaire autour du centre du creux).
      segments.push({ kind: 'arc', entityId: `g${k}-bottom`, start: pl, end: pr, center: C, radius: b.radius, clockwise: true });
      segments.push({ kind: 'line', entityId: `g${k}-b`, start: pr, end: right });
    }
    segments.push(arcCcw(`g${k}-land`, R, c + half, c + step - half));
  }
  return region(segments, bore);
}
