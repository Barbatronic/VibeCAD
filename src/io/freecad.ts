/**
 * Export vers FreeCAD.
 *
 * - `freecadScript` : un script Python que FreeCAD exécute pour reconstruire le projet **avec son
 *   historique** : un corps Part Design par pièce, les esquisses Sketcher (géométrie, contraintes,
 *   cotes), puis les étapes qui ont un équivalent (protrusion, cavité, révolution, gorge, congé,
 *   chanfrein, perçage, répétitions, symétrie, formes toutes faites, plans et axes de
 *   référence). Une étape sans équivalent est reprise comme forme figée : la suite de la pièce
 *   repart d'un nouveau corps posé sur cette forme. Les paramètres du projet deviennent une
 *   feuille de calcul « Parametres » reliée aux cotes et aux champs. L'assemblage est reproduit
 *   par des liens placés (sans les liaisons). Le script enregistre le document à côté de lui.
 * - `freecadFcstd` : un document FreeCAD (.FCStd) qui ne contient que les formes finales (comme le
 *   STEP), avec les noms et l'arborescence de l'assemblage : il s'ouvre d'un double-clic.
 *
 * Voir docs/export-freecad.md.
 */
import type { CadDocument, Feature, Id, Part, ProjectParameter, SketchConstraint, SketchParams } from '../domain/model';
import { patternSources } from '../domain/document';
import { AXIS_X_ID, AXIS_Y_ID, ORIGIN_POINT_ID } from '../domain/model';
import { expressionNames } from '../domain/units';
import { holeDiameter } from '../features/hole/definition';
import type { Frame3D } from '../math/frame';
import type { Vec2, Vec3 } from '../math/vec';
import { ellipseOf, findLine, pointPosition, standalonePoints } from '../sketch/model';
import { createZip } from './zip';

/** Ce que le worker fournit pour une pièce (formes et repères calculés). */
export interface FreecadPartInput {
  part: Part;
  /** Solide final (BREP), null s'il n'y a pas de volume. */
  brep: string | null;
  /** Repère et géométrie résolue de chaque esquisse. */
  sketches: ReadonlyMap<Id, { frame: Frame3D; solved: SketchParams }>;
  /** Plans et axes de construction calculés. */
  datums: ReadonlyMap<Id, Frame3D>;
  axes: ReadonlyMap<Id, { point: Vec3; dir: Vec3 }>;
  /** Solide juste après chaque étape figée (voir `freecadPlan`). */
  frozen: ReadonlyMap<Id, string>;
  /** Points au milieu des arêtes désignées (congé, chanfrein ; axe d'une répétition sur une arête). */
  edgePoints: ReadonlyMap<Id, Vec3[]>;
  /** Plan des faces désignées (symétrie par une face), dans le monde. */
  planes: ReadonlyMap<Id, { origin: Vec3; normal: Vec3 }>;
  /** Première étape en erreur : elle et la suite ne sont pas reprises. */
  failedFeatureId: Id | null;
}

/** Pièce placée de l'assemblage (dépliée), `group` : le bloc de premier niveau qui la contient. */
export interface FreecadLeaf {
  name: string;
  partId: Id;
  matrix: readonly number[];
  group: string | null;
  /** Forme placée (BREP, position portée par la forme) pour le document .FCStd, fournie par le worker. */
  brep?: string;
}

export interface FreecadInput {
  name: string;
  parts: FreecadPartInput[];
  parameters: readonly ProjectParameter[];
  leaves: readonly FreecadLeaf[];
}

// ---------------------------------------------------------------------------
// Ce qui se traduit

/** Étapes traduites en vraies fonctions FreeCAD, ou reprises comme formes figées. */
export function freecadPlan(part: Part, failedFeatureId: Id | null): { frozen: Set<Id>; skipped: Set<Id> } {
  const frozen = new Set<Id>();
  const skipped = new Set<Id>();
  // Étapes déjà créées dans le corps en cours (une répétition ou une symétrie d'étape les vise).
  let inBody = new Set<Id>();
  let failed = false;
  for (const f of part.features) {
    if (failed || f.id === failedFeatureId) {
      failed = true;
      skipped.add(f.id);
      continue;
    }
    if (f.type === 'sketch' || f.type === 'plane' || f.type === 'axis') continue;
    if (nativeFeature(f, inBody)) {
      inBody.add(f.id);
      continue;
    }
    frozen.add(f.id);
    inBody = new Set();
  }
  return { frozen, skipped };
}

function nativeFeature(f: Feature, inBody: ReadonlySet<Id>): boolean {
  switch (f.type) {
    case 'extrude':
      return !f.params.upTo;
    case 'pocket':
      return f.params.direction !== 'twoSides';
    case 'revolve':
    case 'primitive':
      return f.params.operation !== 'common';
    case 'fillet':
    case 'chamfer':
    case 'hole':
      return true;
    case 'pattern':
      return !f.params.second && patternSources(f.params).every((id) => inBody.has(id));
    case 'mirror':
      return f.params.source.kind === 'part' || inBody.has(f.params.source.featureId);
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// Script Python

const py = (s: string) => JSON.stringify(s);
const num = (v: number) => (Number.isFinite(v) ? String(Math.round(v * 1e9) / 1e9) : '0');
const vec = (v: { x: number; y: number; z?: number }) => `V(${num(v.x)}, ${num(v.y)}, ${num(v.z ?? 0)})`;
const triple = (v: Vec3) => `(${num(v.x)}, ${num(v.y)}, ${num(v.z)})`;
const frameCall = (f: Frame3D) => `frame(${triple(f.origin)}, ${triple(f.xAxis)}, ${triple(f.yAxis)}, ${triple(f.normal)})`;
const matrixCall = (m: readonly number[]) => `App.Placement(App.Matrix(${[m[0], m[4], m[8], m[12], m[1], m[5], m[9], m[13], m[2], m[6], m[10], m[14]].map((v) => num(v!)).join(', ')}, 0, 0, 0, 1))`;

/** Alias de feuille de calcul (lettres sans accent, chiffres, _), unique, sans ressembler à une cellule. */
function aliasesOf(params: readonly ProjectParameter[]): Map<string, string> {
  const out = new Map<string, string>();
  const used = new Set<string>();
  for (const p of params) {
    let a = p.name
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^A-Za-z0-9_]/g, '_');
    if (!/^[A-Za-z]/.test(a)) a = `p_${a}`;
    if (/^[A-Za-z]{1,3}[0-9]+$/.test(a)) a = `${a}_`;
    let unique = a;
    for (let n = 2; used.has(unique.toLowerCase()); n++) unique = `${a}_${n}`;
    used.add(unique.toLowerCase());
    out.set(p.name.toLowerCase(), unique);
  }
  return out;
}

/** Équation VibeCAD → expression FreeCAD (`Parametres.alias`, point décimal). */
function fcExpression(expr: string, aliases: ReadonlyMap<string, string>): string | null {
  if (expressionNames(expr).some((n) => !aliases.has(n))) return null;
  return expr
    .replace(/×/g, '*')
    .replace(/÷/g, '/')
    .replace(/π/g, 'pi')
    .replace(/(\d),(\d)/g, '$1.$2')
    .replace(/[\p{L}_][\p{L}\p{N}_]*/gu, (name) => (name.toLowerCase() === 'pi' ? 'pi' : aliases.has(name.toLowerCase()) ? `Parametres.${aliases.get(name.toLowerCase())}` : name));
}

/** Champ d'une étape (nom dans le panneau) → propriété FreeCAD qui le porte. */
function fcProperty(f: Feature, field: string): string | null {
  const table: Partial<Record<Feature['type'], Record<string, string>>> = {
    extrude: { distance: 'Length', distance2: 'Length2' },
    pocket: { distance: 'Length' },
    fillet: { size: 'Radius' },
    chamfer: { size: 'Size' },
    revolve: { angle: 'Angle' },
    hole: { depth: 'Depth', diameter: 'Diameter', headDiameter: 'HoleCutDiameter', headDepth: 'HoleCutDepth' },
    pattern: { count: 'Occurrences', spacing: 'Offset', angle: 'Angle' },
  };
  return table[f.type]?.[field] ?? null;
}

const PRELUDE = `# -*- coding: utf-8 -*-
import os, json
import FreeCAD as App
import Part, Sketcher

V = App.Vector
REPORT = {"bodies": [], "frozen": [], "constraintErrors": 0, "featureErrors": []}

def frame(o, x, y, n):
    return App.Placement(App.Matrix(x[0], y[0], n[0], o[0], x[1], y[1], n[1], o[1], x[2], y[2], n[2], o[2], 0, 0, 0, 1))

def brep(text):
    s = Part.Shape()
    s.importBrepFromString(text)
    return s

def origin(body, role):
    for o in body.Origin.OriginFeatures:
        if o.Role == role:
            return o

def edge_near(obj, p):
    DOC.recompute()
    best, name = None, None
    vertex = Part.Vertex(V(*p))
    for i, e in enumerate(obj.Shape.Edges):
        d = e.distToShape(vertex)[0]
        if best is None or d < best:
            best, name = d, "Edge%d" % (i + 1)
    return name

def con(sk, *args):
    try:
        return sk.addConstraint(Sketcher.Constraint(*args))
    except Exception:
        REPORT["constraintErrors"] += 1
        return -1

def expr(obj, prop, text):
    try:
        obj.setExpression(prop, text)
    except Exception:
        pass

def new_body(label, base=None):
    body = DOC.addObject("PartDesign::Body", "Body")
    body.Label = label
    if base is not None:
        feat = DOC.addObject("Part::Feature", "Base")
        feat.Label = label + " (forme figée)"
        feat.Shape = brep(base)
        body.BaseFeature = feat
    return body
`;

/** Écrit l'esquisse dans le corps ; renvoie le nom de variable et l'index FreeCAD de chaque contrainte. */
function sketchCode(
  lines: string[],
  v: string,
  body: string,
  label: string,
  sketch: { frame: Frame3D; solved: SketchParams },
  constraintExprs: Map<string, string>,
  aliases: ReadonlyMap<string, string>,
): Map<string, number> {
  const s = sketch.solved;
  lines.push(`${v} = ${body}.newObject("Sketcher::SketchObject", "Sketch")`, `${v}.Label = ${py(label)}`, `${v}.MapMode = "Deactivated"`, `${v}.Placement = ${frameCall(sketch.frame)}`);
  // Géométrie : chaque point de l'esquisse est repéré par (géométrie, sommet) FreeCAD.
  const occurrences = new Map<string, [number, number][]>();
  const geoOf = new Map<string, number>();
  const at = (id: string, g: number, pos: number) => occurrences.set(id, [...(occurrences.get(id) ?? []), [g, pos]]);
  let g = 0;
  const add = (expr: string, construction: boolean) => {
    lines.push(`${v}.addGeometry(${expr}, ${construction ? 'True' : 'False'})`);
    return g++;
  };
  const blocked: number[] = [];
  for (const e of s.entities) {
    const construction = e.type !== 'point' && (!!e.construction || !!e.reference);
    if (e.type === 'line') {
      const a = pointPosition(s, e.a);
      const b = pointPosition(s, e.b);
      if (!a || !b) continue;
      const i = add(`Part.LineSegment(${vec(a)}, ${vec(b)})`, construction);
      geoOf.set(e.id, i);
      at(e.a, i, 1);
      at(e.b, i, 2);
      if (e.reference) blocked.push(i);
    } else if (e.type === 'circle') {
      const c = pointPosition(s, e.center);
      if (!c) continue;
      const i = add(`Part.Circle(${vec(c)}, V(0, 0, 1), ${num(e.radius)})`, construction);
      geoOf.set(e.id, i);
      at(e.center, i, 3);
      if (e.reference) blocked.push(i);
    } else if (e.type === 'arc') {
      const c = pointPosition(s, e.center);
      const a = pointPosition(s, e.start);
      const b = pointPosition(s, e.end);
      if (!c || !a || !b) continue;
      const r = Math.hypot(a.x - c.x, a.y - c.y);
      const a0 = Math.atan2(a.y - c.y, a.x - c.x);
      let a1 = Math.atan2(b.y - c.y, b.x - c.x);
      while (a1 <= a0 + 1e-12) a1 += 2 * Math.PI;
      const i = add(`Part.ArcOfCircle(Part.Circle(${vec(c)}, V(0, 0, 1), ${num(r)}), ${num(a0)}, ${num(a1)})`, construction);
      geoOf.set(e.id, i);
      at(e.center, i, 3);
      at(e.start, i, 1);
      at(e.end, i, 2);
      if (e.reference) blocked.push(i);
    } else if (e.type === 'ellipse') {
      const el = ellipseOf(s, e);
      if (!el) continue;
      // FreeCAD veut le grand axe d'abord.
      const [major, minor, angle] = el.a >= el.b ? [el.a, el.b, el.angle] : [el.b, el.a, el.angle + Math.PI / 2];
      const p1 = { x: el.center.x + major * Math.cos(angle), y: el.center.y + major * Math.sin(angle) };
      const p2 = { x: el.center.x - minor * Math.sin(angle), y: el.center.y + minor * Math.cos(angle) };
      const i = add(`Part.Ellipse(${vec(p1)}, ${vec(p2)}, ${vec(el.center)})`, construction);
      geoOf.set(e.id, i);
      at(e.center, i, 3);
    } else if (e.type === 'spline') {
      const pts = e.points.map((id) => pointPosition(s, id)).filter((p): p is Vec2 => !!p);
      if (pts.length < 2) continue;
      lines.push(`_bs = Part.BSplineCurve()`, `_bs.interpolate([${pts.map(vec).join(', ')}], PeriodicFlag=${e.closed ? 'True' : 'False'})`);
      const i = add('_bs', construction);
      geoOf.set(e.id, i);
      if (!e.closed) {
        at(e.points[0]!, i, 1);
        at(e.points[e.points.length - 1]!, i, 2);
      }
    }
  }
  for (const p of standalonePoints(s)) {
    const i = add(`Part.Point(${vec(p)})`, false);
    geoOf.set(p.id, i);
    at(p.id, i, 1);
  }
  // Un point partagé par plusieurs courbes : coïncidences entre ses sommets FreeCAD.
  for (const list of occurrences.values()) for (let k = 1; k < list.length; k++) lines.push(`con(${v}, "Coincident", ${list[0]![0]}, ${list[0]![1]}, ${list[k]![0]}, ${list[k]![1]})`);
  for (const i of blocked) lines.push(`con(${v}, "Block", ${i})`);
  const pt = (id: string): [number, number] | null => (id === ORIGIN_POINT_ID ? [-1, 1] : (occurrences.get(id)?.[0] ?? null));
  // Axes de l'esquisse : géométries -1 (axe horizontal) et -2 (axe vertical) de FreeCAD.
  const geo = (id: string) => (id === AXIS_X_ID ? -1 : id === AXIS_Y_ID ? -2 : (geoOf.get(id) ?? null));
  const index = new Map<string, number>();
  const push = (c: SketchConstraint, args: string) => {
    const k = `_c${index.size}`;
    lines.push(`${k} = con(${v}, ${args})`);
    if ('value' in c) index.set(c.id, index.size);
    const e = 'expression' in c && c.expression ? fcExpression(c.expression, aliases) : null;
    if (e) constraintExprs.set(k, e);
  };
  for (const c of s.constraints) {
    const P = (id: string) => pt(id);
    switch (c.type) {
      case 'coincident': {
        const a = P(c.a);
        const b = P(c.b);
        if (a && b) push(c, `"Coincident", ${a[0]}, ${a[1]}, ${b[0]}, ${b[1]}`);
        break;
      }
      case 'horizontal':
      case 'vertical': {
        const l = geo(c.line);
        if (l !== null) push(c, `${py(c.type === 'horizontal' ? 'Horizontal' : 'Vertical')}, ${l}`);
        break;
      }
      case 'length': {
        const l = geo(c.line);
        if (l !== null) push(c, `"Distance", ${l}, ${num(c.value)}`);
        break;
      }
      case 'distance':
      case 'distanceX':
      case 'distanceY': {
        const a = P(c.a);
        const b = P(c.b);
        const kind = c.type === 'distance' ? 'Distance' : c.type === 'distanceX' ? 'DistanceX' : 'DistanceY';
        if (a && b) push(c, `"${kind}", ${a[0]}, ${a[1]}, ${b[0]}, ${b[1]}, ${num(c.value)}`);
        break;
      }
      case 'diameter':
      case 'radius': {
        const l = geo(c.circle);
        if (l !== null) push(c, `${py(c.type === 'diameter' ? 'Diameter' : 'Radius')}, ${l}, ${num(c.value)}`);
        break;
      }
      case 'parallel':
      case 'perpendicular':
      case 'equal':
      case 'tangent': {
        const a = geo(c.a);
        const b = geo(c.b);
        const kind = { parallel: 'Parallel', perpendicular: 'Perpendicular', equal: 'Equal', tangent: 'Tangent' }[c.type];
        if (a !== null && b !== null) push(c, `"${kind}", ${a}, ${b}`);
        break;
      }
      case 'collinear': {
        // Le point posé sur l'autre droite est pris sur un segment, jamais sur un axe.
        const [a, b] = geo(c.b)! < 0 ? [geo(c.b), geo(c.a)] : [geo(c.a), geo(c.b)];
        if (a !== null && b !== null) {
          push(c, `"Parallel", ${a}, ${b}`);
          lines.push(`con(${v}, "PointOnObject", ${b}, 1, ${a})`);
        }
        break;
      }
      case 'pointOn': {
        const p = P(c.point);
        const k = geo(c.curve);
        if (p && k !== null) push(c, `"PointOnObject", ${p[0]}, ${p[1]}, ${k}`);
        break;
      }
      case 'midpoint': {
        const p = P(c.point);
        const l = geo(c.line);
        if (p && l !== null) push(c, `"Symmetric", ${l}, 1, ${l}, 2, ${p[0]}, ${p[1]}`);
        break;
      }
      case 'pointLineDistance': {
        const p = P(c.point);
        const l = geo(c.line);
        if (p && l !== null) push(c, `"Distance", ${p[0]}, ${p[1]}, ${l}, ${num(c.value)}`);
        break;
      }
      case 'angle': {
        // Angle orienté (sens trigonométrique) de la direction de a vers celle de b, mesuré sur la
        // géométrie résolue : FreeCAD le retrouve tel quel.
        const la = findLine(s, c.a);
        const lb = findLine(s, c.b);
        const a = geo(c.a);
        const b = geo(c.b);
        if (!la || !lb || a === null || b === null) break;
        const dir = (l: NonNullable<typeof la>) => {
          const p = pointPosition(s, l.a)!;
          const q = pointPosition(s, l.b)!;
          return Math.atan2(q.y - p.y, q.x - p.x);
        };
        let ang = dir(lb) + (c.supplementary ? Math.PI : 0) - dir(la);
        while (ang > Math.PI) ang -= 2 * Math.PI;
        while (ang <= -Math.PI) ang += 2 * Math.PI;
        push(c, `"Angle", ${a}, ${b}, ${num(ang)}`);
        break;
      }
      default:
        break;
    }
  }
  return index;
}

/** Script Python FreeCAD qui reconstruit le projet. */
export function freecadScript(input: FreecadInput): string {
  const out: string[] = [PRELUDE];
  const lines: string[] = [];
  const aliases = aliasesOf(input.parameters);
  lines.push(`DOC = App.newDocument("VibeCAD")`, `DOC.Label = ${py(input.name)}`);
  // Paramètres : une feuille de calcul, une ligne par paramètre (nom, valeur ou équation).
  if (input.parameters.length) {
    lines.push(`SHEET = DOC.addObject("Spreadsheet::Sheet", "Parametres")`, `SHEET.Label = "Parametres"`);
    input.parameters.forEach((p, i) => {
      const alias = aliases.get(p.name.toLowerCase())!;
      const e = fcExpression(p.expression, aliases)?.replace(/Parametres\./g, '') ?? '0';
      lines.push(`SHEET.set("A${i + 1}", ${py(p.name)})`, `SHEET.set("B${i + 1}", ${py(`=${e}`)})`, `SHEET.setAlias("B${i + 1}", ${py(alias)})`);
    });
    lines.push('DOC.recompute()');
  }
  const finalBody = new Map<Id, string>();
  let counter = 0;
  const id = (prefix: string) => `${prefix}${++counter}`;
  for (const p of input.parts) {
    const part = p.part;
    const plan = freecadPlan(part, p.failedFeatureId);
    let body = id('b');
    lines.push('', `# ${part.name}`, `${body} = new_body(${py(part.name)})`);
    lines.push(`REPORT["bodies"].append(${body}.Name)`);
    // Objets FreeCAD du corps en cours : esquisses, plans, axes et étapes (par identifiant VibeCAD).
    let objects = new Map<Id, string>();
    const sketchIndex = new Map<string, Map<string, number>>();
    const featureName = (fid: Id) => part.features.find((f) => f.id === fid)?.name ?? 'Esquisse';
    const sketchVar = (sid: Id): string | null => {
      const known = objects.get(sid);
      if (known) return known;
      const sk = p.sketches.get(sid);
      if (!sk) return null;
      const v = id('s');
      const exprs = new Map<string, string>();
      sketchIndex.set(v, sketchCode(lines, v, body, featureName(sid), sk, exprs, aliases));
      lines.push(`try:\n    ${v}.autoRemoveRedundants(False)\nexcept Exception:\n    pass`);
      for (const [k, e] of exprs) lines.push(`if ${k} >= 0: expr(${v}, "Constraints[%d]" % ${k}, ${py(e)})`);
      objects.set(sid, v);
      return v;
    };
    const datumVar = (did: Id): string | null => {
      const known = objects.get(did);
      if (known) return known;
      const v = id('d');
      const frame = p.datums.get(did);
      const axis = p.axes.get(did);
      if (frame) lines.push(`${v} = ${body}.newObject("PartDesign::Plane", "Plane")`, `${v}.Label = ${py(featureName(did))}`, `${v}.MapMode = "Deactivated"`, `${v}.Placement = ${frameCall(frame)}`);
      else if (axis) lines.push(`${v} = ${body}.newObject("PartDesign::Line", "Line")`, `${v}.Label = ${py(featureName(did))}`, `${v}.MapMode = "Deactivated"`, `${v}.Placement = App.Placement(${vec(axis.point)}, App.Rotation(V(0, 0, 1), ${vec(axis.dir)}))`);
      else return null;
      objects.set(did, v);
      return v;
    };
    const exprs = (f: Feature, v: string) => {
      for (const [field, e] of Object.entries(f.expressions ?? {})) {
        const prop = fcProperty(f, field);
        const fe = fcExpression(e, aliases);
        if (prop && fe) lines.push(`expr(${v}, ${py(prop)}, ${py(fe)})`);
      }
    };
    const axisRef = (axis: { kind: 'axis'; axis: 'X' | 'Y' | 'Z' } | { kind: 'edge' } | { kind: 'datum'; featureId: Id }, fid: Id): string | null => {
      if (axis.kind === 'axis') return `(origin(${body}, "${axis.axis}_Axis"), [""])`;
      if (axis.kind === 'datum') {
        const d = datumVar(axis.featureId);
        return d ? `(${d}, [""])` : null;
      }
      const pt = p.edgePoints.get(fid)?.[0];
      return pt ? `(${body}.Tip, [edge_near(${body}.Tip, ${triple(pt)})])` : null;
    };
    for (const f of part.features) {
      if (plan.skipped.has(f.id)) continue;
      if (plan.frozen.has(f.id)) {
        const shape = p.frozen.get(f.id);
        if (!shape) continue;
        // Étape sans équivalent : la suite repart d'un nouveau corps posé sur la forme obtenue.
        body = id('b');
        lines.push('', `# ${f.name} : forme figée`, `${body} = new_body(${py(`${part.name} — après « ${f.name} »`)}, ${py(shape)})`, `REPORT["bodies"].append(${body}.Name)`, `REPORT["frozen"].append(${py(f.name)})`);
        objects = new Map();
        continue;
      }
      const v = id('f');
      const label = `${v}.Label = ${py(f.name)}`;
      switch (f.type) {
        case 'sketch':
          break;
        case 'plane':
        case 'axis':
          datumVar(f.id);
          break;
        case 'extrude': {
          const sk = sketchVar(f.params.sketchId);
          if (!sk) break;
          lines.push(`${v} = ${body}.newObject("PartDesign::Pad", "Pad")`, label, `${v}.Profile = ${sk}`, `${v}.Length = ${num(f.params.distance)}`);
          if (f.params.direction === 'reversed') lines.push(`${v}.Reversed = True`);
          if (f.params.direction === 'symmetric') lines.push(`${v}.SideType = "Symmetric"`);
          if (f.params.direction === 'twoSides') lines.push(`${v}.SideType = "Two sides"`, `${v}.Length2 = ${num(f.params.distance2 ?? f.params.distance)}`);
          exprs(f, v);
          objects.set(f.id, v);
          break;
        }
        case 'pocket': {
          const sk = sketchVar(f.params.sketchId);
          if (!sk) break;
          lines.push(`${v} = ${body}.newObject("PartDesign::Pocket", "Pocket")`, label, `${v}.Profile = ${sk}`);
          if (f.params.extent.kind === 'throughAll') lines.push(`${v}.Type = "ThroughAll"`);
          else lines.push(`${v}.Length = ${num(f.params.extent.distance)}`);
          if (f.params.direction === 'reversed') lines.push(`${v}.Reversed = True`);
          if (f.params.direction === 'symmetric') lines.push(`${v}.SideType = "Symmetric"`);
          exprs(f, v);
          objects.set(f.id, v);
          break;
        }
        case 'revolve': {
          const sk = sketchVar(f.params.sketchId);
          if (!sk) break;
          const a = f.params.axis;
          const ref = a.kind === 'sketch-x' ? '"H_Axis"' : a.kind === 'sketch-y' ? '"V_Axis"' : `"Edge%d" % (${(sketchIndexGeo(p, f.params.sketchId, a.lineId) ?? 0) + 1})`;
          lines.push(`${v} = ${body}.newObject(${py(f.params.operation === 'cut' ? 'PartDesign::Groove' : 'PartDesign::Revolution')}, "Revolution")`, label, `${v}.Profile = ${sk}`, `${v}.ReferenceAxis = (${sk}, [${ref}])`, `${v}.Angle = ${num(f.params.angle)}`);
          if (f.params.reversed) lines.push(`${v}.Reversed = True`);
          exprs(f, v);
          objects.set(f.id, v);
          break;
        }
        case 'fillet':
        case 'chamfer': {
          const pts = p.edgePoints.get(f.id) ?? [];
          if (pts.length === 0) break;
          lines.push(`_tip = ${body}.Tip`, `_edges = sorted(set(edge_near(_tip, q) for q in [${pts.map(triple).join(', ')}]))`);
          lines.push(`${v} = ${body}.newObject(${py(f.type === 'fillet' ? 'PartDesign::Fillet' : 'PartDesign::Chamfer')}, ${py(f.type === 'fillet' ? 'Fillet' : 'Chamfer')})`, label, `${v}.Base = (_tip, _edges)`);
          lines.push(f.type === 'fillet' ? `${v}.Radius = ${num(f.params.radius)}` : `${v}.Size = ${num(f.params.distance)}`);
          exprs(f, v);
          objects.set(f.id, v);
          break;
        }
        case 'hole': {
          const sk = sketchVar(f.params.sketchId);
          if (!sk) break;
          const hp = f.params;
          // Le perçage lit la forme de base dès sa création : elle doit être calculée.
          lines.push('DOC.recompute()');
          lines.push(`${v} = ${body}.newObject("PartDesign::Hole", "Hole")`, label, `${v}.Profile = ${sk}`, `${v}.ThreadType = "None"`, `${v}.Threaded = False`, `${v}.DrillPoint = "Flat"`, `${v}.Diameter = ${num(holeDiameter(hp))}`);
          lines.push(hp.through ? `${v}.DepthType = "ThroughAll"` : `${v}.DepthType = "Dimension"\n${v}.Depth = ${num(hp.depth)}`);
          if (hp.kind === 'counterbore') lines.push(`${v}.HoleCutType = "Counterbore"`, `${v}.HoleCutDiameter = ${num(hp.headDiameter)}`, `${v}.HoleCutDepth = ${num(hp.headDepth)}`);
          if (hp.kind === 'countersink') lines.push(`${v}.HoleCutType = "Countersink"`, `${v}.HoleCutDiameter = ${num(hp.headDiameter)}`, `${v}.HoleCutCountersinkAngle = 90`);
          if (hp.reversed) lines.push(`${v}.Reversed = True`);
          exprs(f, v);
          objects.set(f.id, v);
          break;
        }
        case 'primitive': {
          const pr = f.params;
          const sub = pr.operation === 'cut';
          const kind = { box: 'Box', cylinder: 'Cylinder', sphere: 'Sphere', torus: 'Torus' }[pr.shape];
          lines.push(`${v} = ${body}.newObject("PartDesign::${sub ? 'Subtractive' : 'Additive'}${kind}", ${py(kind)})`, label, `${v}.MapMode = "Deactivated"`, `${v}.Placement = App.Placement(${vec(pr.position)}, App.Rotation())`);
          if (pr.shape === 'box') lines.push(`${v}.Length = ${num(pr.width)}`, `${v}.Width = ${num(pr.depth)}`, `${v}.Height = ${num(pr.height)}`);
          if (pr.shape === 'cylinder') lines.push(`${v}.Radius = ${num(pr.diameter / 2)}`, `${v}.Height = ${num(pr.height)}`);
          if (pr.shape === 'sphere') lines.push(`${v}.Radius = ${num(pr.diameter / 2)}`);
          if (pr.shape === 'torus') lines.push(`${v}.Radius1 = ${num(pr.diameter / 2)}`, `${v}.Radius2 = ${num(pr.thickness / 2)}`);
          objects.set(f.id, v);
          break;
        }
        case 'pattern': {
          const originals = patternSources(f.params).map((id) => objects.get(id));
          const ax = axisRef(f.params.axis, f.id);
          if (originals.some((o) => !o) || !ax) break;
          const src = originals.join(', ');
          lines.push('DOC.recompute()');
          if (f.params.kind === 'linear') {
            lines.push(`${v} = ${body}.newObject("PartDesign::LinearPattern", "LinearPattern")`, label, `${v}.Originals = [${src}]`, `${v}.Direction = ${ax}`, `${v}.Mode = "Spacing"`, `${v}.Offset = ${num(f.params.spacing)}`, `${v}.Occurrences = ${f.params.count}`);
          } else {
            lines.push(`${v} = ${body}.newObject("PartDesign::PolarPattern", "PolarPattern")`, label, `${v}.Originals = [${src}]`, `${v}.Axis = ${ax}`, `${v}.Angle = ${num(f.params.angle)}`, `${v}.Occurrences = ${f.params.count}`);
          }
          if (f.params.reversed) lines.push(`${v}.Reversed = True`);
          exprs(f, v);
          objects.set(f.id, v);
          break;
        }
        case 'mirror': {
          const pl = f.params.plane;
          let plane: string | null = null;
          if (pl.kind === 'plane') plane = `(origin(${body}, "${pl.plane}_Plane"), [""])`;
          else if (pl.kind === 'datum') {
            const d = datumVar(pl.featureId);
            plane = d ? `(${d}, [""])` : null;
          } else {
            const fp = p.planes.get(f.id);
            if (fp) {
              const d = id('d');
              lines.push(`${d} = ${body}.newObject("PartDesign::Plane", "Plane")`, `${d}.MapMode = "Deactivated"`, `${d}.Placement = App.Placement(${vec(fp.origin)}, App.Rotation(V(0, 0, 1), ${vec(fp.normal)}))`);
              plane = `(${d}, [""])`;
            }
          }
          if (!plane) break;
          lines.push('DOC.recompute()');
          lines.push(`${v} = ${body}.newObject("PartDesign::Mirrored", "Mirrored")`, label, `${v}.MirrorPlane = ${plane}`);
          if (f.params.source.kind === 'part') lines.push(`${v}.TransformMode = "Whole shape"`);
          else {
            const src = objects.get(f.params.source.featureId);
            if (src) lines.push(`${v}.Originals = [${src}]`);
          }
          objects.set(f.id, v);
          break;
        }
        default:
          break;
      }
      // Chaque étape devient l'extrémité du corps : la suivante s'appuie sur elle.
      if (objects.get(f.id) === v && f.type !== 'plane' && f.type !== 'axis') lines.push(`${body}.Tip = ${v}`);
    }
    finalBody.set(part.id, body);
    lines.push(`REPORT.setdefault("final", {})[${py(part.id)}] = ${body}.Name`);
    void sketchIndex;
  }
  // Assemblage : un lien placé par pièce insérée (les blocs regroupés), les corps rangés à part.
  if (input.leaves.length) {
    lines.push('', '# Assemblage (positions figées, sans les liaisons)', `PIECES = DOC.addObject("App::DocumentObjectGroup", "Pieces")`, `PIECES.Label = "Pièces"`);
    for (const [, b] of finalBody) lines.push(`PIECES.addObject(${b})`);
    lines.push(`for _o in DOC.Objects:`, `    if _o.TypeId == "PartDesign::Body" and _o not in PIECES.Group:`, `        PIECES.addObject(_o)`);
    lines.push(`ASM = DOC.addObject("App::Part", "Assemblage")`, `ASM.Label = ${py(`${input.name} — assemblage`)}`);
    const groups = new Map<string, string>();
    for (const leaf of input.leaves) {
      const b = finalBody.get(leaf.partId);
      if (!b) continue;
      let parent = 'ASM';
      if (leaf.group) {
        parent = groups.get(leaf.group) ?? '';
        if (!parent) {
          parent = id('g');
          lines.push(`${parent} = DOC.addObject("App::Part", "Bloc")`, `${parent}.Label = ${py(leaf.group)}`, `ASM.addObject(${parent})`);
          groups.set(leaf.group, parent);
        }
      }
      const l = id('l');
      lines.push(`${l} = DOC.addObject("App::Link", "Lien")`, `${l}.LinkedObject = ${b}`, `${l}.Label = ${py(leaf.name)}`, `${l}.Placement = ${matrixCall(leaf.matrix)}`, `${parent}.addObject(${l})`);
    }
  }
  lines.push(
    '',
    'DOC.recompute()',
    'for _o in DOC.Objects:',
    '    if not _o.isValid():',
    '        REPORT["featureErrors"].append(_o.Label)',
    'REPORT["volumes"] = dict((b, DOC.getObject(b).Shape.Volume if DOC.getObject(b).Shape.Solids else 0) for b in REPORT["bodies"])',
    'try:',
    '    _path = os.path.splitext(os.path.abspath(__file__))[0] + ".FCStd"',
    'except NameError:',
    '    _path = None',
    'if _path:',
    '    DOC.saveAs(_path)',
    'if App.GuiUp:',
    '    import FreeCADGui',
    '    FreeCADGui.activeDocument().activeView().viewIsometric()',
    '    FreeCADGui.SendMsgToActiveView("ViewFit")',
    'print("VIBECAD_REPORT " + json.dumps(REPORT))',
  );
  out.push(...lines);
  return `${out.join('\n')}\n`;
}

/** Index de la géométrie d'un segment dans l'esquisse FreeCAD (même ordre que `sketchCode`). */
function sketchIndexGeo(p: FreecadPartInput, sketchId: Id, lineId: string): number | null {
  const s = p.sketches.get(sketchId)?.solved;
  if (!s) return null;
  let g = 0;
  for (const e of s.entities) {
    if (e.type === 'point') continue;
    if (e.id === lineId) return g;
    g++;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Document .FCStd (formes figées)

const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Placement FreeCAD (position + quaternion) d'une matrice 4 × 4 par colonnes. */
function placementXml(m: readonly number[] | null): string {
  const t = m ?? [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const [r00, r10, r20, , r01, r11, r21, , r02, r12, r22] = t as number[];
  const trace = r00! + r11! + r22!;
  let qx: number, qy: number, qz: number, qw: number;
  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2;
    qw = s / 4;
    qx = (r21! - r12!) / s;
    qy = (r02! - r20!) / s;
    qz = (r10! - r01!) / s;
  } else if (r00! > r11! && r00! > r22!) {
    const s = Math.sqrt(1 + r00! - r11! - r22!) * 2;
    qw = (r21! - r12!) / s;
    qx = s / 4;
    qy = (r01! + r10!) / s;
    qz = (r02! + r20!) / s;
  } else if (r11! > r22!) {
    const s = Math.sqrt(1 + r11! - r00! - r22!) * 2;
    qw = (r02! - r20!) / s;
    qx = (r01! + r10!) / s;
    qy = s / 4;
    qz = (r12! + r21!) / s;
  } else {
    const s = Math.sqrt(1 + r22! - r00! - r11!) * 2;
    qw = (r10! - r01!) / s;
    qx = (r02! + r20!) / s;
    qy = (r12! + r21!) / s;
    qz = s / 4;
  }
  const angle = 2 * Math.acos(Math.max(-1, Math.min(1, qw)));
  const sn = Math.sqrt(Math.max(0, 1 - qw * qw));
  const [ox, oy, oz] = sn > 1e-9 ? [qx / sn, qy / sn, qz / sn] : [0, 0, 1];
  const f = (v: number) => v.toFixed(16);
  return `<PropertyPlacement Px="${f(t[12]!)}" Py="${f(t[13]!)}" Pz="${f(t[14]!)}" Q0="${f(qx)}" Q1="${f(qy)}" Q2="${f(qz)}" Q3="${f(qw)}" A="${f(angle)}" Ox="${f(ox)}" Oy="${f(oy)}" Oz="${f(oz)}"/>`;
}

/**
 * Document FreeCAD avec les formes finales : une forme par pièce (ou par pièce placée de
 * l'assemblage, rangées par bloc), au nom de la pièce. Pas d'historique : comme le STEP.
 */
export async function freecadFcstd(doc: CadDocument, input: FreecadInput): Promise<Uint8Array> {
  type Obj = { name: string; type: string; label: string; shapeFile?: string; placement?: readonly number[] | null; group?: string[] };
  const objects: Obj[] = [];
  const files: { name: string; data: Uint8Array }[] = [];
  const enc = new TextEncoder();
  // Un fichier BREP par objet : FreeCAD ne lit un fichier joint qu'une fois.
  const breps = new Map<Id, Uint8Array>(input.parts.flatMap((p) => (p.brep ? [[p.part.id, enc.encode(p.brep)] as const] : [])));
  let n = 0;
  const next = (prefix: string) => `${prefix}${++n}`;
  const shapeFileFor = (partId: Id, objectName: string): string | undefined => {
    const data = breps.get(partId);
    if (!data) return undefined;
    const file = `${objectName}.Shape.brp`;
    files.push({ name: file, data });
    return file;
  };
  if (input.leaves.length) {
    const groups = new Map<string, Obj>();
    const top: string[] = [];
    for (const leaf of input.leaves) {
      const name = next('Piece');
      let file: string | undefined;
      if (leaf.brep) {
        file = `${name}.Shape.brp`;
        files.push({ name: file, data: enc.encode(leaf.brep) });
      } else file = shapeFileFor(leaf.partId, name);
      if (!file) continue;
      const o: Obj = { name, type: 'Part::Feature', label: leaf.name, shapeFile: file, placement: leaf.matrix };
      objects.push(o);
      if (leaf.group) {
        let g = groups.get(leaf.group);
        if (!g) {
          g = { name: next('Bloc'), type: 'App::DocumentObjectGroup', label: leaf.group, group: [] };
          groups.set(leaf.group, g);
          objects.push(g);
          top.push(g.name);
        }
        g.group!.push(o.name);
      } else top.push(o.name);
    }
    objects.push({ name: 'Assemblage', type: 'App::DocumentObjectGroup', label: `${input.name} — assemblage`, group: top });
  } else {
    for (const p of input.parts) {
      const name = next('Piece');
      const file = shapeFileFor(p.part.id, name);
      if (file) objects.push({ name, type: 'Part::Feature', label: p.part.name, shapeFile: file, placement: null });
    }
  }
  const prop = (name: string, type: string, inner: string) => `                <Property name="${name}" type="${type}">\n                    ${inner}\n                </Property>`;
  const data = objects.map((o) => {
    const props = [prop('Label', 'App::PropertyString', `<String value="${xml(o.label)}"/>`)];
    if (o.type === 'Part::Feature') {
      // La forme d'abord : relire la forme recale le placement sur elle ; le placement lu ensuite la déplace.
      props.push(prop('Shape', 'Part::PropertyPartShape', `<Part file="${o.shapeFile}"/>`));
      props.push(prop('Placement', 'App::PropertyPlacement', placementXml(o.placement ?? null)));
    } else props.push(prop('Group', 'App::PropertyLinkList', `<LinkList count="${o.group!.length}">${o.group!.map((g) => `<Link value="${g}"/>`).join('')}</LinkList>`));
    return `        <Object name="${o.name}">\n            <Properties Count="${props.length}" TransientCount="0">\n${props.join('\n')}\n            </Properties>\n        </Object>`;
  });
  const deps = objects.map((o) => (o.group?.length ? `        <ObjectDeps Name="${o.name}" Count="${o.group.length}">${o.group.map((g) => `<Dep Name="${g}"/>`).join('')}</ObjectDeps>` : `        <ObjectDeps Name="${o.name}" Count="0"/>`));
  const decl = objects.map((o, i) => `        <Object type="${o.type}" name="${o.name}" id="${i + 1}" />`);
  const documentXml = `<?xml version='1.0' encoding='utf-8'?>
<!-- Document FreeCAD écrit par VibeCAD (${xml(doc.name)}) : formes finales, sans historique. -->
<Document SchemaVersion="4" ProgramVersion="1.0" FileVersion="1">
    <Properties Count="1" TransientCount="0">
        <Property name="Label" type="App::PropertyString">
            <String value="${xml(input.name)}"/>
        </Property>
    </Properties>
    <Objects Count="${objects.length}" Dependencies="1">
${deps.join('\n')}
${decl.join('\n')}
    </Objects>
    <ObjectData Count="${objects.length}">
${data.join('\n')}
    </ObjectData>
</Document>
`;
  return createZip([{ name: 'Document.xml', data: enc.encode(documentXml) }, ...files]);
}
