/**
 * Solveur de contraintes d'esquisse.
 *
 * Inconnues : coordonnées des points (sauf l'origine, fixe) et rayons des cercles.
 * Chaque contrainte fournit une ou deux équations f(q) = 0 avec leur gradient analytique.
 *
 * Méthode : Newton avec pas de norme minimale pondérée
 *   Δ = W⁻¹·Jᵀ·(J·W⁻¹·Jᵀ + μI)⁻¹·(−r)
 * Les variables peu contraintes bougent le moins possible ; un poids élevé « retient » une
 * variable (point déplacé à la souris, point d'ancrage d'une cote modifiée).
 * Après convergence, une réduction de Gauss-Jordan de J donne le nombre de degrés de liberté
 * et les éléments encore libres.
 */
import { ORIGIN_POINT_ID, type SketchConstraint, type SketchParams } from '../domain/model';
import { TOLERANCES } from '../domain/tolerances';
import { choleskySolve, rowReduce } from '../math/linalg';

type PointRef = { kind: 'var'; ix: number; iy: number } | { kind: 'const'; x: number; y: number };

interface Equation {
  constraintId: string;
  value: (q: Float64Array) => number;
  gradient: (q: Float64Array, add: (index: number, value: number) => void) => void;
}

export interface VariableInfo {
  entityId: string;
  component: 'x' | 'y' | 'r';
}

interface System {
  q: Float64Array;
  variables: VariableInfo[];
  equations: Equation[];
  /** Contraintes qui référencent un élément absent (ignorées, signalées). */
  invalidConstraints: string[];
}

const px = (q: Float64Array, p: PointRef) => (p.kind === 'var' ? q[p.ix]! : p.x);
const py = (q: Float64Array, p: PointRef) => (p.kind === 'var' ? q[p.iy]! : p.y);
const addX = (p: PointRef, add: (i: number, v: number) => void, v: number) => {
  if (p.kind === 'var') add(p.ix, v);
};
const addY = (p: PointRef, add: (i: number, v: number) => void, v: number) => {
  if (p.kind === 'var') add(p.iy, v);
};

/** Rayon : variable (cercle), constante (cercle repris de la pièce) ou distance centre-départ (arc). */
type RadiusRef = { kind: 'var'; i: number } | { kind: 'const'; r: number } | { kind: 'dist'; c: PointRef; p: PointRef };
const rv = (q: Float64Array, r: RadiusRef) =>
  r.kind === 'var' ? q[r.i]! : r.kind === 'const' ? r.r : Math.hypot(px(q, r.p) - px(q, r.c), py(q, r.p) - py(q, r.c));
const addR = (r: RadiusRef, add: (i: number, v: number) => void, v: number, q?: Float64Array) => {
  if (r.kind === 'var') add(r.i, v);
  else if (r.kind === 'dist') {
    const dx = q ? px(q, r.p) - px(q, r.c) : 1;
    const dy = q ? py(q, r.p) - py(q, r.c) : 0;
    const len = Math.max(Math.hypot(dx, dy), 1e-12);
    addX(r.p, add, (v * dx) / len);
    addY(r.p, add, (v * dy) / len);
    addX(r.c, add, (-v * dx) / len);
    addY(r.c, add, (-v * dy) / len);
  }
};

interface LineRef {
  a: PointRef;
  b: PointRef;
}
interface CircleRef {
  c: PointRef;
  r: RadiusRef;
}

const EPS = 1e-12;
const DEG = 180 / Math.PI;

/** Direction d'un segment (b − a) et sa longueur. */
function dir(q: Float64Array, l: LineRef) {
  const x = px(q, l.b) - px(q, l.a);
  const y = py(q, l.b) - py(q, l.a);
  return { x, y, len: Math.max(Math.hypot(x, y), EPS) };
}

/** Reporte une dérivée par rapport à la direction d'un segment sur ses deux extrémités. */
function addDir(l: LineRef, add: (i: number, v: number) => void, gx: number, gy: number) {
  addX(l.b, add, gx);
  addX(l.a, add, -gx);
  addY(l.b, add, gy);
  addY(l.a, add, -gy);
}

/** Distance signée d'un point à la droite portant un segment, et son gradient. */
function signedDistance(q: Float64Array, p: PointRef, l: LineRef): number {
  const d = dir(q, l);
  const vx = px(q, p) - px(q, l.a);
  const vy = py(q, p) - py(q, l.a);
  return (d.x * vy - d.y * vx) / d.len;
}

function signedDistanceGradient(q: Float64Array, p: PointRef, l: LineRef, add: (i: number, v: number) => void, factor: number) {
  const d = dir(q, l);
  const vx = px(q, p) - px(q, l.a);
  const vy = py(q, p) - py(q, l.a);
  const sd = (d.x * vy - d.y * vx) / d.len;
  const gdx = vy / d.len - (sd * d.x) / (d.len * d.len);
  const gdy = -vx / d.len - (sd * d.y) / (d.len * d.len);
  const gvx = -d.y / d.len;
  const gvy = d.x / d.len;
  addX(l.b, add, factor * gdx);
  addY(l.b, add, factor * gdy);
  addX(l.a, add, factor * (-gdx - gvx));
  addY(l.a, add, factor * (-gdy - gvy));
  addX(p, add, factor * gvx);
  addY(p, add, factor * gvy);
}

/** Sinus (parallélisme) ou cosinus (perpendicularité) de l'angle entre deux segments. */
function lineAngleEquation(id: string, la: LineRef, lb: LineRef, kind: 'sin' | 'cos'): Equation {
  const value = (q: Float64Array) => {
    const a = dir(q, la);
    const b = dir(q, lb);
    const num = kind === 'sin' ? a.x * b.y - a.y * b.x : a.x * b.x + a.y * b.y;
    return num / (a.len * b.len);
  };
  return {
    constraintId: id,
    value,
    gradient: (q, add) => {
      const a = dir(q, la);
      const b = dir(q, lb);
      const f = value(q);
      const ll = a.len * b.len;
      const [gax, gay, gbx, gby] =
        kind === 'sin' ? [b.y / ll, -b.x / ll, -a.y / ll, a.x / ll] : [b.x / ll, b.y / ll, a.x / ll, a.y / ll];
      addDir(la, add, gax - (f * a.x) / (a.len * a.len), gay - (f * a.y) / (a.len * a.len));
      addDir(lb, add, gbx - (f * b.x) / (b.len * b.len), gby - (f * b.y) / (b.len * b.len));
    },
  };
}

export const variableKey = (v: VariableInfo) => `${v.entityId}.${v.component}`;

function buildSystem(sketch: SketchParams, constraints: readonly SketchConstraint[] = sketch.constraints): System {
  const values: number[] = [];
  const variables: VariableInfo[] = [];
  const points = new Map<string, PointRef>();
  points.set(ORIGIN_POINT_ID, { kind: 'const', x: 0, y: 0 });
  // Les éléments repris de la pièce sont fixes : leurs points et rayons sont des constantes.
  const fixedPoints = new Set<string>();
  for (const e of sketch.entities) {
    if (e.type === 'line' && e.reference) fixedPoints.add(e.a).add(e.b);
    if (e.type === 'circle' && e.reference) fixedPoints.add(e.center);
    if (e.type === 'arc' && e.reference) fixedPoints.add(e.center).add(e.start).add(e.end);
  }
  for (const e of sketch.entities) {
    if (e.type !== 'point') continue;
    if (fixedPoints.has(e.id)) {
      points.set(e.id, { kind: 'const', x: e.x, y: e.y });
      continue;
    }
    points.set(e.id, { kind: 'var', ix: values.length, iy: values.length + 1 });
    values.push(e.x, e.y);
    variables.push({ entityId: e.id, component: 'x' }, { entityId: e.id, component: 'y' });
  }
  const lines = new Map<string, LineRef>();
  const circles = new Map<string, CircleRef>();
  for (const e of sketch.entities) {
    if (e.type === 'circle') {
      const c = points.get(e.center);
      let r: RadiusRef;
      if (e.reference) r = { kind: 'const', r: e.radius };
      else {
        r = { kind: 'var', i: values.length };
        values.push(e.radius);
        variables.push({ entityId: e.id, component: 'r' });
      }
      if (c) circles.set(e.id, { c, r });
    } else if (e.type === 'line') {
      const a = points.get(e.a);
      const b = points.get(e.b);
      if (a && b) lines.set(e.id, { a, b });
    } else if (e.type === 'arc') {
      const c = points.get(e.center);
      const st = points.get(e.start);
      if (c && st) circles.set(e.id, { c, r: { kind: 'dist', c, p: st } });
    }
  }

  const equations: Equation[] = [];
  const invalidConstraints: string[] = [];
  const pointPair = (c: { a: string; b: string }) => {
    const a = points.get(c.a);
    const b = points.get(c.b);
    return a && b ? { a, b } : undefined;
  };
  const distanceEquation = (id: string, a: PointRef, b: PointRef, target: number): Equation => ({
    constraintId: id,
    value: (q) => Math.hypot(px(q, b) - px(q, a), py(q, b) - py(q, a)) - target,
    gradient: (q, add) => {
      const dx = px(q, b) - px(q, a);
      const dy = py(q, b) - py(q, a);
      const len = Math.hypot(dx, dy);
      const ux = len > 1e-12 ? dx / len : 1;
      const uy = len > 1e-12 ? dy / len : 0;
      addX(b, add, ux);
      addX(a, add, -ux);
      addY(b, add, uy);
      addY(a, add, -uy);
    },
  });
  /** |distance(centre, point)| − rayon (point sur cercle). */
  const onCircleEquation = (id: string, p: PointRef, circle: CircleRef): Equation => {
    const base = distanceEquation(id, circle.c, p, 0);
    return {
      constraintId: id,
      value: (q) => base.value(q) - rv(q, circle.r),
      gradient: (q, add) => {
        base.gradient(q, add);
        addR(circle.r, add, -1, q);
      },
    };
  };
  /** Distance signée point-droite (éventuellement en valeur absolue) moins une cible. */
  const pointLineEquation = (id: string, p: PointRef, l: LineRef, target: (q: Float64Array) => number, addTarget: (add: (i: number, v: number) => void, q: Float64Array) => void, abs: boolean): Equation => ({
    constraintId: id,
    value: (q) => {
      const sd = signedDistance(q, p, l);
      return (abs ? Math.abs(sd) : sd) - target(q);
    },
    gradient: (q, add) => {
      const sd = signedDistance(q, p, l);
      signedDistanceGradient(q, p, l, add, abs && sd < 0 ? -1 : 1);
      addTarget(add, q);
    },
  });
  const zero = () => 0;
  const noTarget = () => {};

  // Équation propre à chaque arc : le point d'arrivée reste sur le cercle de l'arc.
  for (const e of sketch.entities) {
    if (e.type !== 'arc') continue;
    const circle = circles.get(e.id);
    const end = points.get(e.end);
    if (circle && end) equations.push(onCircleEquation(`arc:${e.id}`, end, circle));
  }

  for (const c of constraints) {
    const fail = () => invalidConstraints.push(c.id);
    switch (c.type) {
      case 'coincident': {
        const pair = pointPair(c);
        if (!pair) {
          fail();
          break;
        }
        const { a, b } = pair;
        equations.push(
          {
            constraintId: c.id,
            value: (q) => px(q, b) - px(q, a),
            gradient: (_q, add) => {
              addX(b, add, 1);
              addX(a, add, -1);
            },
          },
          {
            constraintId: c.id,
            value: (q) => py(q, b) - py(q, a),
            gradient: (_q, add) => {
              addY(b, add, 1);
              addY(a, add, -1);
            },
          },
        );
        break;
      }
      case 'horizontal':
      case 'vertical': {
        const line = lines.get(c.line);
        if (!line) {
          fail();
          break;
        }
        const { a, b } = line;
        if (c.type === 'horizontal') {
          equations.push({
            constraintId: c.id,
            value: (q) => py(q, b) - py(q, a),
            gradient: (_q, add) => {
              addY(b, add, 1);
              addY(a, add, -1);
            },
          });
        } else {
          equations.push({
            constraintId: c.id,
            value: (q) => px(q, b) - px(q, a),
            gradient: (_q, add) => {
              addX(b, add, 1);
              addX(a, add, -1);
            },
          });
        }
        break;
      }
      case 'length': {
        const line = lines.get(c.line);
        if (!line) {
          fail();
          break;
        }
        equations.push(distanceEquation(c.id, line.a, line.b, c.value));
        break;
      }
      case 'distance': {
        const pair = pointPair(c);
        if (!pair) {
          fail();
          break;
        }
        equations.push(distanceEquation(c.id, pair.a, pair.b, c.value));
        break;
      }
      case 'distanceX':
      case 'distanceY': {
        const pair = pointPair(c);
        if (!pair) {
          fail();
          break;
        }
        const { a, b } = pair;
        const target = c.value;
        if (c.type === 'distanceX') {
          equations.push({
            constraintId: c.id,
            value: (q) => px(q, b) - px(q, a) - target,
            gradient: (_q, add) => {
              addX(b, add, 1);
              addX(a, add, -1);
            },
          });
        } else {
          equations.push({
            constraintId: c.id,
            value: (q) => py(q, b) - py(q, a) - target,
            gradient: (_q, add) => {
              addY(b, add, 1);
              addY(a, add, -1);
            },
          });
        }
        break;
      }
      case 'diameter':
      case 'radius': {
        const circle = circles.get(c.circle);
        if (!circle) {
          fail();
          break;
        }
        const factor = c.type === 'diameter' ? 2 : 1;
        const target = c.value;
        equations.push({
          constraintId: c.id,
          value: (q) => factor * rv(q, circle.r) - target,
          gradient: (q, add) => addR(circle.r, add, factor, q),
        });
        break;
      }
      case 'parallel':
      case 'perpendicular': {
        const la = lines.get(c.a);
        const lb = lines.get(c.b);
        if (!la || !lb) {
          fail();
          break;
        }
        equations.push(lineAngleEquation(c.id, la, lb, c.type === 'parallel' ? 'sin' : 'cos'));
        break;
      }
      case 'collinear': {
        const la = lines.get(c.a);
        const lb = lines.get(c.b);
        if (!la || !lb) {
          fail();
          break;
        }
        // Parallèles, et une extrémité de b sur la droite de a.
        equations.push(lineAngleEquation(c.id, la, lb, 'sin'), pointLineEquation(c.id, lb.a, la, zero, noTarget, false));
        break;
      }
      case 'equal': {
        const la = lines.get(c.a);
        const lb = lines.get(c.b);
        if (la && lb) {
          equations.push({
            constraintId: c.id,
            value: (q) => dir(q, la).len - dir(q, lb).len,
            gradient: (q, add) => {
              const a = dir(q, la);
              const b = dir(q, lb);
              addDir(la, add, a.x / a.len, a.y / a.len);
              addDir(lb, add, -b.x / b.len, -b.y / b.len);
            },
          });
          break;
        }
        const ca = circles.get(c.a);
        const cb = circles.get(c.b);
        if (ca && cb) {
          equations.push({
            constraintId: c.id,
            value: (q) => rv(q, ca.r) - rv(q, cb.r),
            gradient: (q, add) => {
              addR(ca.r, add, 1, q);
              addR(cb.r, add, -1, q);
            },
          });
          break;
        }
        fail();
        break;
      }
      case 'tangent': {
        const cb = circles.get(c.b);
        const la = lines.get(c.a);
        const ca = circles.get(c.a);
        if (cb && la) {
          // Distance du centre à la droite = rayon.
          equations.push(pointLineEquation(c.id, cb.c, la, (q) => rv(q, cb.r), (add, q) => addR(cb.r, add, -1, q), true));
          break;
        }
        if (cb && ca) {
          const internal = !!c.internal;
          const centers = distanceEquation(c.id, ca.c, cb.c, 0);
          equations.push({
            constraintId: c.id,
            value: (q) => {
              const d = centers.value(q);
              const ra = rv(q, ca.r);
              const rb = rv(q, cb.r);
              return internal ? d - Math.abs(ra - rb) : d - ra - rb;
            },
            gradient: (q, add) => {
              centers.gradient(q, add);
              if (internal) {
                const sgn = rv(q, ca.r) >= rv(q, cb.r) ? 1 : -1;
                addR(ca.r, add, -sgn, q);
                addR(cb.r, add, sgn, q);
              } else {
                addR(ca.r, add, -1, q);
                addR(cb.r, add, -1, q);
              }
            },
          });
          break;
        }
        fail();
        break;
      }
      case 'pointOn': {
        const p = points.get(c.point);
        const line = lines.get(c.curve);
        const circle = circles.get(c.curve);
        if (p && line) equations.push(pointLineEquation(c.id, p, line, zero, noTarget, false));
        else if (p && circle) equations.push(onCircleEquation(c.id, p, circle));
        else fail();
        break;
      }
      case 'midpoint': {
        const p = points.get(c.point);
        const line = lines.get(c.line);
        if (!p || !line) {
          fail();
          break;
        }
        equations.push(
          {
            constraintId: c.id,
            value: (q) => px(q, p) - (px(q, line.a) + px(q, line.b)) / 2,
            gradient: (_q, add) => {
              addX(p, add, 1);
              addX(line.a, add, -0.5);
              addX(line.b, add, -0.5);
            },
          },
          {
            constraintId: c.id,
            value: (q) => py(q, p) - (py(q, line.a) + py(q, line.b)) / 2,
            gradient: (_q, add) => {
              addY(p, add, 1);
              addY(line.a, add, -0.5);
              addY(line.b, add, -0.5);
            },
          },
        );
        break;
      }
      case 'angle': {
        const la = lines.get(c.a);
        const lb = lines.get(c.b);
        if (!la || !lb) {
          fail();
          break;
        }
        const flip = c.supplementary ? -1 : 1;
        const target = c.value;
        const theta = (q: Float64Array) => {
          const a = dir(q, la);
          const b = dir(q, lb);
          const bx = flip * b.x;
          const by = flip * b.y;
          return Math.atan2(a.x * by - a.y * bx, a.x * bx + a.y * by);
        };
        equations.push({
          constraintId: c.id,
          value: (q) => Math.abs(theta(q)) * DEG - target,
          gradient: (q, add) => {
            const a = dir(q, la);
            const b = dir(q, lb);
            const bx = flip * b.x;
            const by = flip * b.y;
            const cr = a.x * by - a.y * bx;
            const dt = a.x * bx + a.y * by;
            const den = Math.max(cr * cr + dt * dt, EPS);
            const k = (theta(q) < 0 ? -1 : 1) * DEG;
            // dθ = (dt·dcr − cr·ddt) / (cr² + dt²)
            const gax = (dt * by - cr * bx) / den;
            const gay = (dt * -bx - cr * by) / den;
            const gbx = (dt * -a.y - cr * a.x) / den;
            const gby = (dt * a.x - cr * a.y) / den;
            addDir(la, add, k * gax, k * gay);
            addDir(lb, add, k * flip * gbx, k * flip * gby);
          },
        });
        break;
      }
      case 'pointLineDistance': {
        const p = points.get(c.point);
        const line = lines.get(c.line);
        if (!p || !line) {
          fail();
          break;
        }
        const target = c.value;
        equations.push(pointLineEquation(c.id, p, line, () => target, noTarget, true));
        break;
      }
    }
  }
  return { q: Float64Array.from(values), variables, equations, invalidConstraints };
}

/**
 * Composante indépendante du système : variables reliées entre elles par des équations.
 * Chaque contour non relié aux autres forme sa propre composante, résolue séparément : le coût
 * reste faible même pour une esquisse comportant beaucoup de contours.
 */
interface Component {
  vars: number[];
  eqs: number[];
}

function equationVariables(sys: System): number[][] {
  return sys.equations.map((e) => {
    const idx = new Set<number>();
    e.gradient(sys.q, (j) => idx.add(j));
    return Array.from(idx);
  });
}

function findComponents(sys: System, eqVars: number[][]): Component[] {
  const n = sys.q.length;
  const parent = Int32Array.from({ length: n }, (_v, i) => i);
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]!]!;
      x = parent[x]!;
    }
    return x;
  };
  for (const vars of eqVars) for (let k = 1; k < vars.length; k++) parent[find(vars[k]!)] = find(vars[0]!);
  const byRoot = new Map<number, Component>();
  for (let j = 0; j < n; j++) {
    const root = find(j);
    let c = byRoot.get(root);
    if (!c) byRoot.set(root, (c = { vars: [], eqs: [] }));
    c.vars.push(j);
  }
  const constantEqs: number[] = [];
  eqVars.forEach((vars, i) => {
    if (vars.length === 0) constantEqs.push(i);
    else byRoot.get(find(vars[0]!))!.eqs.push(i);
  });
  const out = Array.from(byRoot.values());
  // Équations sans inconnue (ex. coïncidence de l'origine avec elle-même) : vérifiées telles quelles.
  if (constantEqs.length > 0) out.push({ vars: [], eqs: constantEqs });
  return out;
}

/** Jacobienne restreinte à une composante (m_c × n_c), variables renumérotées localement. */
function localJacobian(sys: System, comp: Component, q: Float64Array, local: Map<number, number>): Float64Array {
  const m = comp.eqs.length;
  const n = comp.vars.length;
  const J = new Float64Array(m * n);
  comp.eqs.forEach((ei, i) => {
    sys.equations[ei]!.gradient(q, (j, v) => {
      const lj = local.get(j);
      if (lj !== undefined) J[i * n + lj] = J[i * n + lj]! + v;
    });
  });
  return J;
}

function localResiduals(sys: System, comp: Component, q: Float64Array): Float64Array {
  const r = new Float64Array(comp.eqs.length);
  comp.eqs.forEach((ei, i) => {
    r[i] = sys.equations[ei]!.value(q);
  });
  return r;
}

const maxAbs = (r: Float64Array) => r.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
const norm2sq = (r: Float64Array) => r.reduce((s, v) => s + v * v, 0);

export interface SolveOptions {
  /** Poids par variable (`p3.x`, `c1.r`…) : plus il est grand, moins la variable bouge. */
  weights?: ReadonlyMap<string, number>;
  maxIterations?: number;
}

export interface SolveResult {
  sketch: SketchParams;
  converged: boolean;
  maxResidual: number;
  iterations: number;
  /** Degrés de liberté restants (0 = esquisse entièrement contrainte). */
  dof: number;
  /** Éléments (points, cercles) qui peuvent encore bouger. */
  freeEntities: Set<string>;
  /** Contraintes non satisfaites après résolution (conflit probable). */
  unsatisfied: string[];
  /** Contraintes ignorées car elles visent un élément absent. */
  invalidConstraints: string[];
}

/** Newton à pas de norme minimale pondérée sur une composante ; modifie `q` sur place. */
function newtonComponent(sys: System, comp: Component, q: Float64Array, winvAll: Float64Array, maxIterations: number): number {
  const n = comp.vars.length;
  const m = comp.eqs.length;
  if (m === 0 || n === 0) return 0;
  const local = new Map<number, number>();
  comp.vars.forEach((j, lj) => local.set(j, lj));
  const winv = Float64Array.from(comp.vars, (j) => winvAll[j]!);
  let r = localResiduals(sys, comp, q);
  let iterations = 0;
  let mu = 0;
  // On poursuit au-delà de la tolérance (« polissage ») pour obtenir des cotes exactes.
  const polish = 1e-13;
  while (iterations < maxIterations && maxAbs(r) > polish) {
    iterations++;
    const J = localJacobian(sys, comp, q, local);
    // A = J W⁻¹ Jᵀ
    const A = new Float64Array(m * m);
    let diagMax = 0;
    for (let i = 0; i < m; i++) {
      for (let k = 0; k <= i; k++) {
        let s = 0;
        for (let j = 0; j < n; j++) {
          const a = J[i * n + j]!;
          if (a !== 0) s += a * winv[j]! * J[k * n + j]!;
        }
        A[i * m + k] = s;
        A[k * m + i] = s;
      }
      diagMax = Math.max(diagMax, A[i * m + i]!);
    }
    const baseMu = Math.max(diagMax, 1e-12) * 1e-12;
    mu = Math.max(mu, baseMu);
    const rhs = r.map((v) => -v);
    let accepted = false;
    for (let attempt = 0; attempt < 12 && !accepted; attempt++) {
      const Areg = Float64Array.from(A);
      for (let i = 0; i < m; i++) Areg[i * m + i] = Areg[i * m + i]! + mu;
      const y = choleskySolve(Areg, m, rhs);
      if (!y) {
        mu *= 100;
        continue;
      }
      const delta = new Float64Array(n);
      for (let j = 0; j < n; j++) {
        let s = 0;
        for (let i = 0; i < m; i++) s += J[i * n + j]! * y[i]!;
        delta[j] = winv[j]! * s;
      }
      const before = norm2sq(r);
      const saved = Float64Array.from(comp.vars, (j) => q[j]!);
      let step = 1;
      for (let ls = 0; ls < 10; ls++) {
        comp.vars.forEach((j, lj) => {
          q[j] = saved[lj]! + step * delta[lj]!;
        });
        const rt = localResiduals(sys, comp, q);
        if (norm2sq(rt) < before || maxAbs(rt) <= polish) {
          r = rt;
          accepted = true;
          break;
        }
        step /= 2;
      }
      if (!accepted) {
        comp.vars.forEach((j, lj) => {
          q[j] = saved[lj]!;
        });
        mu = Math.max(mu * 100, 1e-9);
      } else mu = Math.max(baseMu, mu / 10);
    }
    if (!accepted) break;
  }
  return iterations;
}

function applyValues(sketch: SketchParams, sys: System, q: Float64Array): SketchParams {
  const pointValues = new Map<string, { x: number; y: number }>();
  const radiusValues = new Map<string, number>();
  sys.variables.forEach((v, i) => {
    if (v.component === 'r') radiusValues.set(v.entityId, q[i]!);
    else {
      const cur = pointValues.get(v.entityId) ?? { x: 0, y: 0 };
      cur[v.component] = q[i]!;
      pointValues.set(v.entityId, cur);
    }
  });
  return {
    ...sketch,
    entities: sketch.entities.map((e) => {
      if (e.type === 'point') {
        const p = pointValues.get(e.id);
        return p ? { ...e, x: cleanValue(p.x), y: cleanValue(p.y) } : e;
      }
      if (e.type === 'circle') {
        const r = radiusValues.get(e.id);
        return r !== undefined ? { ...e, radius: cleanValue(r) } : e;
      }
      return e;
    }),
  };
}

/** Supprime le bruit numérique (ex. 59.99999999999999 → 60) sans altérer les valeurs réelles. */
function cleanValue(v: number): number {
  const rounded = Math.round(v * 1e9) / 1e9;
  return Math.abs(rounded - v) < 1e-10 ? (Object.is(rounded, -0) ? 0 : rounded) : v;
}

/** Rang de la jacobienne d'une composante et variables encore libres. */
function componentFreedom(sys: System, comp: Component, q: Float64Array): { rank: number; free: number[] } {
  if (comp.vars.length === 0) return { rank: 0, free: [] };
  if (comp.eqs.length === 0) return { rank: 0, free: comp.vars };
  const local = new Map<number, number>();
  comp.vars.forEach((j, lj) => local.set(j, lj));
  const J = localJacobian(sys, comp, q, local);
  const red = rowReduce(J, comp.eqs.length, comp.vars.length, 1e-9);
  const free = new Set<number>();
  for (const basis of red.nullBasis) {
    basis.forEach((value, lj) => {
      if (Math.abs(value) > 1e-9) free.add(comp.vars[lj]!);
    });
  }
  return { rank: red.rank, free: Array.from(free) };
}

/** Résout l'esquisse et renvoie la géométrie mise à jour avec un diagnostic complet. */
export function solveSketch(sketch: SketchParams, options: SolveOptions = {}): SolveResult {
  const sys = buildSystem(sketch);
  const q = Float64Array.from(sys.q);
  const winv = new Float64Array(q.length);
  sys.variables.forEach((v, i) => {
    winv[i] = 1 / (options.weights?.get(variableKey(v)) ?? 1);
  });
  const comps = findComponents(sys, equationVariables(sys));
  let iterations = 0;
  for (const comp of comps) iterations = Math.max(iterations, newtonComponent(sys, comp, q, winv, options.maxIterations ?? 60));
  const r = new Float64Array(sys.equations.length);
  sys.equations.forEach((e, i) => {
    r[i] = e.value(q);
  });
  const converged = maxAbs(r) <= TOLERANCES.solver;
  const solved = applyValues(sketch, sys, q);
  const unsatisfied = Array.from(
    new Set(sys.equations.filter((_e, i) => Math.abs(r[i]!) > TOLERANCES.solver * 10).map((e) => e.constraintId)),
  );
  let rank = 0;
  const freeEntities = new Set<string>();
  for (const comp of comps) {
    const f = componentFreedom(sys, comp, q);
    rank += f.rank;
    for (const j of f.free) freeEntities.add(sys.variables[j]!.entityId);
  }
  return {
    sketch: solved,
    converged,
    maxResidual: maxAbs(r),
    iterations,
    dof: q.length - rank,
    freeEntities,
    unsatisfied,
    invalidConstraints: sys.invalidConstraints,
  };
}

export type ConstraintAddition = 'independent' | 'redundant' | 'conflicting';

/**
 * Classe une contrainte avant de l'ajouter, à la configuration actuelle :
 * - `independent` : elle retire au moins un degré de liberté ;
 * - `redundant` : elle est déjà imposée par les autres contraintes ;
 * - `conflicting` : elle contredit les autres contraintes.
 * Seule la composante concernée par la nouvelle contrainte est analysée.
 */
export function classifyNewConstraint(sketch: SketchParams, constraint: SketchConstraint): ConstraintAddition {
  const withNew = buildSystem(sketch, [...sketch.constraints, constraint]);
  const eqVars = equationVariables(withNew);
  const comps = findComponents(withNew, eqVars);
  const newEqs = new Set(withNew.equations.flatMap((e, i) => (e.constraintId === constraint.id ? [i] : [])));
  const touched = comps.filter((c) => c.eqs.some((i) => newEqs.has(i)));
  const q = withNew.q;
  let r0 = 0;
  let r1 = 0;
  for (const comp of touched) {
    r1 += componentFreedom(withNew, comp, q).rank;
    r0 += componentFreedom(withNew, { vars: comp.vars, eqs: comp.eqs.filter((i) => !newEqs.has(i)) }, q).rank;
  }
  if (r1 > r0) return 'independent';
  const residual = Array.from(newEqs).reduce((mx, i) => Math.max(mx, Math.abs(withNew.equations[i]!.value(q))), 0);
  return residual <= 1e-7 ? 'redundant' : 'conflicting';
}

/** Valeur actuelle mesurée d'une contrainte dimensionnelle (pour préremplir une saisie). */
export function measureConstraint(sketch: SketchParams, constraint: SketchConstraint): number | undefined {
  const sys = buildSystem(sketch, [constraint]);
  const eq = sys.equations[0];
  if (!eq || !('value' in constraint)) return undefined;
  return eq.value(sys.q) + constraint.value;
}
