import { describe, expect, it } from 'vitest';
import { AXIS_X_ID, AXIS_Y_ID, type EdgeRef, type SketchConstraint, type SketchParams } from '../../src/domain/model';
import { featureDependencies } from '../../src/features/registry';
import { parseNativeFile, serializeDocument } from '../../src/io/native-format';
import { addFeature, createDocument, findPart, makeSketchFeature } from '../../src/domain/document';
import { originPlaneFrame } from '../../src/math/frame';
import { addCircle, addConstraint, addLine, addRectangle, emptySketch, findCircle, findLine, pointPosition, type NewConstraint } from '../../src/sketch/model';
import { extractProfiles } from '../../src/sketch/profiles';
import {
  confirmEditor,
  deleteSelection,
  createSession,
  pointerDown,
  pointerMove,
  pointerUp,
  setEditorText,
  setPixelSize,
  setTool,
  toggleConstruction,
  type ProjectableCurve,
  type SketchSession,
} from '../../src/sketch/session';
import { classifyNewConstraint, measureConstraint, solveSketch } from '../../src/sketch/solver';

const XY = { kind: 'plane', plane: 'XY', offset: 0 } as const;

const add = (s: SketchParams, c: NewConstraint) => addConstraint(s, c).sketch;

function lineVec(s: SketchParams, id: string) {
  const l = findLine(s, id)!;
  const a = pointPosition(s, l.a)!;
  const b = pointPosition(s, l.b)!;
  return { a, b, x: b.x - a.x, y: b.y - a.y, len: Math.hypot(b.x - a.x, b.y - a.y) };
}

function solved(s: SketchParams) {
  const res = solveSketch(s);
  expect(res.converged).toBe(true);
  return res;
}

/** Deux segments libres quelconques. */
function twoLines() {
  const l1 = addLine(emptySketch(XY), { x: 0, y: 0 }, { x: 40, y: 3 });
  const l2 = addLine(l1.sketch, { x: 5, y: 20 }, { x: 30, y: 34 });
  return { sketch: l2.sketch, a: l1.lineId, b: l2.lineId };
}

describe('nouvelles contraintes du solveur', () => {
  it('parallèle et perpendiculaire retirent chacune un degré de liberté', () => {
    const { sketch, a, b } = twoLines();
    expect(solveSketch(sketch).dof).toBe(8);
    const par = solved(add(sketch, { type: 'parallel', a, b }));
    expect(par.dof).toBe(7);
    const u = lineVec(par.sketch, a);
    const v = lineVec(par.sketch, b);
    expect(Math.abs(u.x * v.y - u.y * v.x) / (u.len * v.len)).toBeLessThan(1e-9);
    const perp = solved(add(sketch, { type: 'perpendicular', a, b }));
    const p = lineVec(perp.sketch, a);
    const q = lineVec(perp.sketch, b);
    expect(Math.abs(p.x * q.x + p.y * q.y) / (p.len * q.len)).toBeLessThan(1e-9);
  });

  it('égalité de longueurs, de diamètres, et colinéarité', () => {
    const { sketch, a, b } = twoLines();
    const eq = solved(add(sketch, { type: 'equal', a, b }));
    expect(lineVec(eq.sketch, a).len).toBeCloseTo(lineVec(eq.sketch, b).len, 9);
    const c1 = addCircle(emptySketch(XY), { x: 0, y: 0 }, 4);
    const c2 = addCircle(c1.sketch, { x: 20, y: 0 }, 7);
    const circles = solved(add(add(c2.sketch, { type: 'equal', a: c1.circleId, b: c2.circleId }), { type: 'diameter', circle: c1.circleId, value: 10 }));
    expect(findCircle(circles.sketch, c2.circleId)!.radius).toBeCloseTo(5, 9);
    const col = solved(add(sketch, { type: 'collinear', a, b }));
    expect(col.dof).toBe(6);
    const u = lineVec(col.sketch, a);
    for (const p of [lineVec(col.sketch, b).a, lineVec(col.sketch, b).b]) {
      expect(Math.abs(u.x * (p.y - u.a.y) - u.y * (p.x - u.a.x)) / u.len).toBeLessThan(1e-9);
    }
  });

  it('tangence segment-cercle et cercle-cercle (extérieure et intérieure)', () => {
    const l = addLine(emptySketch(XY), { x: -20, y: 9 }, { x: 20, y: 11 });
    const c = addCircle(l.sketch, { x: 0, y: 0 }, 5);
    const tl = solved(add(c.sketch, { type: 'tangent', a: l.lineId, b: c.circleId }));
    const v = lineVec(tl.sketch, l.lineId);
    const center = pointPosition(tl.sketch, c.center)!;
    const dist = Math.abs(v.x * (center.y - v.a.y) - v.y * (center.x - v.a.x)) / v.len;
    expect(dist).toBeCloseTo(findCircle(tl.sketch, c.circleId)!.radius, 9);

    const c1 = addCircle(emptySketch(XY), { x: 0, y: 0 }, 5);
    const c2 = addCircle(c1.sketch, { x: 14, y: 1 }, 4);
    const ext = solved(add(c2.sketch, { type: 'tangent', a: c1.circleId, b: c2.circleId }));
    const d = Math.hypot(pointPosition(ext.sketch, c2.center)!.x - pointPosition(ext.sketch, c1.center)!.x, pointPosition(ext.sketch, c2.center)!.y - pointPosition(ext.sketch, c1.center)!.y);
    expect(d).toBeCloseTo(findCircle(ext.sketch, c1.circleId)!.radius + findCircle(ext.sketch, c2.circleId)!.radius, 9);

    const big = addCircle(emptySketch(XY), { x: 0, y: 0 }, 20);
    const small = addCircle(big.sketch, { x: 3, y: 2 }, 5);
    const int = solved(add(small.sketch, { type: 'tangent', a: big.circleId, b: small.circleId, internal: true }));
    const di = Math.hypot(pointPosition(int.sketch, small.center)!.x - pointPosition(int.sketch, big.center)!.x, pointPosition(int.sketch, small.center)!.y - pointPosition(int.sketch, big.center)!.y);
    expect(di).toBeCloseTo(findCircle(int.sketch, big.circleId)!.radius - findCircle(int.sketch, small.circleId)!.radius, 9);
  });

  it('point sur un segment, sur un cercle, et au milieu d’un segment', () => {
    const l = addLine(emptySketch(XY), { x: 0, y: 0 }, { x: 30, y: 10 });
    const c = addCircle(l.sketch, { x: 50, y: 0 }, 8);
    const free = addLine(c.sketch, { x: 12, y: 15 }, { x: 60, y: 20 });
    let s = add(free.sketch, { type: 'pointOn', point: free.a, curve: l.lineId });
    s = add(s, { type: 'pointOn', point: free.b, curve: c.circleId });
    const res = solved(s);
    const v = lineVec(res.sketch, l.lineId);
    const p = pointPosition(res.sketch, free.a)!;
    expect(Math.abs(v.x * (p.y - v.a.y) - v.y * (p.x - v.a.x)) / v.len).toBeLessThan(1e-9);
    const q = pointPosition(res.sketch, free.b)!;
    const cc = pointPosition(res.sketch, c.center)!;
    expect(Math.hypot(q.x - cc.x, q.y - cc.y)).toBeCloseTo(findCircle(res.sketch, c.circleId)!.radius, 9);

    const mid = solved(add(free.sketch, { type: 'midpoint', point: free.a, line: l.lineId }));
    const m = pointPosition(mid.sketch, free.a)!;
    const w = lineVec(mid.sketch, l.lineId);
    expect(m.x).toBeCloseTo((w.a.x + w.b.x) / 2, 9);
    expect(m.y).toBeCloseTo((w.a.y + w.b.y) / 2, 9);
  });

  it('cote d’angle (et angle supplémentaire) et distance point-segment', () => {
    const { sketch, a, b } = twoLines();
    const angle = (s: SketchParams, supplementary: boolean) => {
      const u = lineVec(s, a);
      const v = lineVec(s, b);
      const k = supplementary ? -1 : 1;
      return (Math.abs(Math.atan2(u.x * k * v.y - u.y * k * v.x, u.x * k * v.x + u.y * k * v.y)) * 180) / Math.PI;
    };
    const c: SketchConstraint = { id: 'k99', type: 'angle', a, b, value: 30 };
    const r1 = solved({ ...sketch, constraints: [c] });
    expect(angle(r1.sketch, false)).toBeCloseTo(30, 7);
    expect(measureConstraint(r1.sketch, c)).toBeCloseTo(30, 7);
    const r2 = solved(add(sketch, { type: 'angle', a, b, value: 120, supplementary: true }));
    expect(angle(r2.sketch, true)).toBeCloseTo(120, 7);
    expect(angle(r2.sketch, false)).toBeCloseTo(60, 7);

    const l = addLine(emptySketch(XY), { x: 0, y: 0 }, { x: 40, y: 0 });
    const pt = addCircle(l.sketch, { x: 10, y: 7 }, 2);
    const pd = solved(add(add(pt.sketch, { type: 'horizontal', line: l.lineId }), { type: 'pointLineDistance', point: pt.center, line: l.lineId, value: 12 }));
    expect(Math.abs(pointPosition(pd.sketch, pt.center)!.y - pointPosition(pd.sketch, findLine(pd.sketch, l.lineId)!.a)!.y)).toBeCloseTo(12, 9);
  });

  it('classe une contrainte déjà impliquée comme redondante', () => {
    const r = addRectangle(emptySketch(XY), { x: 0, y: 0 }, { x: 40, y: 20 });
    const s = solved(r.sketch).sketch;
    expect(classifyNewConstraint(s, { id: 'x', type: 'parallel', a: r.lines[0], b: r.lines[2] })).toBe('redundant');
    expect(classifyNewConstraint(s, { id: 'x', type: 'perpendicular', a: r.lines[0], b: r.lines[1] })).toBe('redundant');
    expect(classifyNewConstraint(s, { id: 'x', type: 'equal', a: r.lines[0], b: r.lines[1] })).toBe('independent');
  });

  it('la géométrie reprise de la pièce est fixe : ses points ne bougent pas et ne comptent pas', () => {
    const ref: EdgeRef = { faces: [{ featureId: 'ex-1', role: 'end' }, { featureId: 'ex-1', role: 'side', entityId: 'l1' }] };
    const edge = addLine(emptySketch(XY), { x: 0, y: 0 }, { x: 60, y: 0 });
    let s: SketchParams = { ...edge.sketch, entities: edge.sketch.entities.map((e) => (e.id === edge.lineId ? { ...e, reference: { edge: ref } } : e)) };
    expect(solveSketch(s).dof).toBe(0);
    const free = addCircle(s, { x: 20, y: 10 }, 3);
    s = add(free.sketch, { type: 'midpoint', point: free.center, line: edge.lineId });
    const res = solved(s);
    expect(pointPosition(res.sketch, free.center)).toEqual({ x: 30, y: 0 });
    expect(pointPosition(res.sketch, edge.b)).toEqual({ x: 60, y: 0 });
    expect(res.dof).toBe(1);
    // Ni contour ni volume : l'arête reprise est un repère.
    expect(extractProfiles(res.sketch).ok).toBe(true);
    const profile = extractProfiles(res.sketch);
    if (profile.ok) expect(profile.regions).toHaveLength(1);
  });
});

function newSession(projectable: ProjectableCurve[] = []): SketchSession {
  const s = createSession({
    featureId: 'sk-test',
    partId: 'part-test',
    isNew: true,
    frame: originPlaneFrame('XY'),
    sketch: emptySketch(XY),
    projectable,
  });
  return setPixelSize(s, 0.1);
}

const click = (s: SketchSession, x: number, y: number, opts = {}) => pointerUp(pointerDown(pointerMove(s, { x, y }), { x, y }, opts));

/** Session contenant deux segments non parallèles et un cercle. */
function sessionWithShapes(): { s: SketchSession; a: string; b: string; circle: string } {
  const l1 = addLine(emptySketch(XY), { x: 0, y: 0 }, { x: 40, y: 0 });
  const l2 = addLine(l1.sketch, { x: 0, y: 10 }, { x: 30, y: 30 });
  const c = addCircle(l2.sketch, { x: 60, y: 30 }, 5);
  const s = createSession({ featureId: 'sk', partId: 'p', isNew: true, frame: originPlaneFrame('XY'), sketch: c.sketch });
  return { s: setPixelSize(setTool(s, 'dimension'), 0.1), a: l1.lineId, b: l2.lineId, circle: c.circleId };
}

describe('outils de la session : cotes à deux éléments et contraintes', () => {
  it('cote d’angle entre deux segments cliqués l’un après l’autre', () => {
    let { s, a, b } = sessionWithShapes();
    s = click(s, 20, 0);
    expect(s.editor?.candidates.map((c) => c.constraint.type)).toEqual(['length']);
    s = click(s, 15, 20);
    expect(s.editor?.candidates.map((c) => c.constraint.type)).toEqual(['angle', 'angle']);
    expect(s.editor?.candidates[0]!.label).toBe('33,69°');
    s = setEditorText(s, '45');
    s = confirmEditor(s);
    expect(s.message?.text).toBe('Cote ajoutée : 45°.');
    const c = s.sketch.constraints.find((k) => k.type === 'angle')!;
    expect(c).toMatchObject({ a, b, value: 45 });
    expect(measureConstraint(s.sketch, c)).toBeCloseTo(45, 7);
  });

  it('distance d’un point (le centre d’un cercle) à un segment, et entre segments parallèles', () => {
    let { s, a, circle } = sessionWithShapes();
    s = click(s, 20, 0);
    s = click(s, 65, 30);
    expect(s.editor?.candidates[0]!.constraint).toMatchObject({ type: 'pointLineDistance', line: a, value: 30 });
    s = confirmEditor(setEditorText(s, '25'));
    const dim = s.sketch.constraints.find((k) => k.type === 'pointLineDistance')!;
    expect(dim).toMatchObject({ point: findCircle(s.sketch, circle)!.center, value: 25 });
    expect(measureConstraint(s.sketch, dim)).toBeCloseTo(25, 9);

    const r = addRectangle(emptySketch(XY), { x: 0, y: 0 }, { x: 40, y: 20 });
    let t = setPixelSize(setTool(createSession({ featureId: 'sk', partId: 'p', isNew: true, frame: originPlaneFrame('XY'), sketch: r.sketch }), 'dimension'), 0.1);
    t = click(t, 20, 0);
    t = click(t, 20, 20);
    expect(t.editor?.candidates.map((c) => c.constraint.type)).toEqual(['pointLineDistance']);
    t = confirmEditor(setEditorText(t, '12'));
    expect(pointPosition(t.sketch, r.corners[2])!.y - pointPosition(t.sketch, r.corners[0])!.y).toBeCloseTo(12, 9);
  });

  it('contraintes par clics successifs, ou appliquées à la sélection', () => {
    let { s, a, b, circle } = sessionWithShapes();
    s = setTool(s, 'parallel');
    s = click(s, 20, 0);
    expect(s.picks).toEqual([a]);
    expect(s.message?.text).toBe('Cliquez le second segment.');
    s = click(s, 15, 20);
    expect(s.message?.kind).toBe('success');
    expect(s.sketch.constraints.at(-1)).toMatchObject({ type: 'parallel', a, b });
    // Un mauvais élément est refusé avec une explication.
    s = setTool(s, 'equal');
    s = click(s, 20, 0);
    s = click(s, 65, 30);
    expect(s.message?.text).toBe('Choisissez deux éléments du même type : deux segments, ou deux cercles / arcs.');
    // Sélection puis outil : la contrainte s'applique tout de suite.
    s = setTool(s, 'select');
    s = click(s, 65, 30);
    const mid = lineVec(s.sketch, b);
    s = click(s, (mid.a.x + mid.b.x) / 2, (mid.a.y + mid.b.y) / 2, { shift: true });
    expect(s.selection).toHaveLength(2);
    s = setTool(s, 'tangent');
    expect(s.tool).toBe('select');
    expect(s.sketch.constraints.at(-1)).toMatchObject({ type: 'tangent', a: b, b: circle });
  });

  it('le mode construction produit des traits ignorés pour le volume, et se convertit', () => {
    let s = toggleConstruction(newSession());
    expect(s.construction).toBe(true);
    s = setTool(s, 'rectangle');
    s = click(s, 0, 0);
    s = click(s, 40, 20);
    expect(s.sketch.entities.filter((e) => e.type === 'line').every((e) => e.type === 'line' && e.construction)).toBe(true);
    expect(extractProfiles(s.sketch)).toMatchObject({ ok: false, code: 'PROFILE_EMPTY' });
    s = toggleConstruction(s);
    s = setTool(s, 'circle');
    s = click(s, 20, 10);
    s = click(s, 25, 10);
    const profile = extractProfiles(s.sketch);
    expect(profile.ok && profile.regions.length).toBe(1);
    // Sélection d'un trait de construction puis bouton : il redevient normal.
    s = setTool(s, 'select');
    s = click(s, 20, 0);
    s = toggleConstruction(s);
    expect(s.sketch.entities.filter((e) => e.type === 'line' && !e.construction)).toHaveLength(1);
    expect(s.construction).toBe(false);
  });

  it('projette une arête de la pièce : élément fixe, sélectionnable, non déplaçable', () => {
    const ref: EdgeRef = { faces: [{ featureId: 'ex-1', role: 'end' }, { featureId: 'po-1', role: 'side', entityId: 'c1' }] };
    let s = newSession([{ kind: 'circle', center: { x: 15, y: 15 }, radius: 3, ref }]);
    s = setTool(s, 'project');
    s = pointerMove(s, { x: 18.05, y: 15 });
    expect(s.projectHover).toBe(0);
    s = click(s, 18.05, 15);
    const circle = s.sketch.entities.find((e) => e.type === 'circle')!;
    expect(circle).toMatchObject({ radius: 3, reference: { edge: ref } });
    expect(s.dof).toBe(0);
    // Une seconde fois : déjà reprise.
    s = click(s, 18.05, 15);
    expect(s.message?.text).toBe('Cette arête est déjà reprise dans l’esquisse.');
    // Glisser le cercle ne le déplace pas.
    s = setTool(s, 'select');
    s = pointerDown(pointerMove(s, { x: 18, y: 15 }), { x: 18, y: 15 });
    s = pointerUp(pointerMove(s, { x: 25, y: 25 }));
    expect(findCircle(s.sketch, circle.id)!.radius).toBe(3);
    expect(pointPosition(s.sketch, (circle as { center: string }).center)).toEqual({ x: 15, y: 15 });
  });
});

describe('format natif', () => {
  it('enregistre et relit les nouvelles contraintes, la construction et la géométrie reprise', () => {
    let doc = createDocument('Contraintes');
    const part = doc.parts[0]!;
    const sk = makeSketchFeature(doc, part, XY);
    const { sketch, a, b } = twoLines();
    const ref: EdgeRef = { faces: [{ featureId: 'ex-1', role: 'end' }, { featureId: 'ex-1', role: 'side', entityId: 'l2' }] };
    const c1 = addCircle(sketch, { x: 50, y: 0 }, 5);
    const c2 = addCircle(c1.sketch, { x: 70, y: 0 }, 5);
    let params: SketchParams = {
      ...c2.sketch,
      entities: c2.sketch.entities.map((e) => (e.id === a ? { ...e, construction: true } : e.id === c2.circleId ? { ...e, reference: { edge: ref } } : e)),
    };
    const constraints: NewConstraint[] = [
      { type: 'parallel', a, b },
      { type: 'perpendicular', a, b },
      { type: 'collinear', a, b },
      { type: 'equal', a: c1.circleId, b: c2.circleId },
      { type: 'tangent', a: c1.circleId, b: c2.circleId, internal: true },
      { type: 'pointOn', point: c1.center, curve: a },
      { type: 'midpoint', point: c1.center, line: b },
      { type: 'angle', a, b, value: 30, supplementary: true },
      { type: 'pointLineDistance', point: c1.center, line: a, value: 4 },
    ];
    for (const c of constraints) params = add(params, c);
    doc = addFeature(doc, part.id, { ...sk, params });
    const parsed = parseNativeFile(serializeDocument(doc));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.doc).toEqual(doc);
    // L'esquisse dépend de l'étape qui a créé l'arête reprise.
    expect(featureDependencies(findPart(parsed.doc, part.id)!.features[0]!)).toEqual(['ex-1']);
  });
});

describe('axes X et Y de l’esquisse comme références', () => {
  it('cote d’un point ou d’un cercle depuis un axe, angle d’un segment avec un axe', () => {
    let { s, b, circle } = sessionWithShapes();
    // Axe Y (loin de tout trait), puis le cercle : distance de son centre à l'axe.
    s = click(s, 0, -20);
    expect(s.picks).toEqual([AXIS_Y_ID]);
    s = click(s, 65, 30);
    expect(s.editor?.candidates[0]!.constraint).toMatchObject({ type: 'pointLineDistance', line: AXIS_Y_ID, value: 60 });
    s = confirmEditor(setEditorText(s, '50'));
    expect(pointPosition(s.sketch, findCircle(s.sketch, circle)!.center)!.x).toBeCloseTo(50, 9);
    // Segment puis axe X : l'axe reste la référence, l'angle vaut 33,69°.
    s = click(s, 15, 20);
    s = click(s, -20, 0);
    expect(s.editor?.candidates[0]!.constraint).toMatchObject({ type: 'angle', a: AXIS_X_ID, b });
    s = confirmEditor(setEditorText(s, '30'));
    const angle = s.sketch.constraints.find((k) => k.type === 'angle')!;
    expect(measureConstraint(s.sketch, angle)).toBeCloseTo(30, 7);
    // Deux axes : aucune cote.
    s = click(s, -20, 0);
    s = click(s, 0, -20);
    expect(s.editor).toBeNull();
  });

  it('contraintes avec un axe (parallèle, colinéaire, point sur), refus des cas sans objet', () => {
    let { s, b } = sessionWithShapes();
    s = setTool(s, 'parallel');
    s = click(s, 15, 20);
    s = click(s, -20, 0);
    expect(s.sketch.constraints.at(-1)).toMatchObject({ type: 'parallel', a: b, b: AXIS_X_ID });
    expect(lineVec(s.sketch, b).y).toBeCloseTo(0, 9);
    // Le segment, désormais horizontal, ne peut pas suivre l'axe Y ; l'axe X, si.
    s = setTool(s, 'collinear');
    s = click(s, 0, -20);
    const m0 = lineVec(s.sketch, b);
    s = click(s, (m0.a.x + m0.b.x) / 2, (m0.a.y + m0.b.y) / 2);
    expect(s.message?.kind).toBe('error');
    s = click(s, -20, 0);
    const m = lineVec(s.sketch, b);
    s = click(s, (m.a.x + m.b.x) / 2, (m.a.y + m.b.y) / 2);
    expect(s.message?.kind).toBe('success');
    const l = lineVec(s.sketch, b);
    expect(l.a.y).toBeCloseTo(0, 9);
    expect(l.b.y).toBeCloseTo(0, 9);
    // Égalité ou horizontal sur un axe : refusés avec une explication.
    const before = s.sketch.constraints.length;
    s = setTool(s, 'equal');
    s = click(s, -20, 0);
    expect(s.message?.text).toMatch(/infini/);
    s = setTool(s, 'horizontal');
    s = click(s, -20, 0);
    expect(s.message?.text).toMatch(/fixes/);
    expect(s.sketch.constraints).toHaveLength(before);
    // Sélection de l'axe : ni déplaçable ni supprimable ; ses contraintes restent.
    s = setTool(s, 'select');
    s = click(s, -20, 0);
    expect(s.selection).toEqual([AXIS_X_ID]);
    s = deleteSelection(s);
    expect(s.sketch.constraints).toHaveLength(before);
  });

  it('format natif : une contrainte sur un axe est valide et relue telle quelle', () => {
    const l = addLine(emptySketch(XY), { x: 5, y: 5 }, { x: 25, y: 9 });
    const sk = add(add(l.sketch, { type: 'parallel', a: l.lineId, b: AXIS_X_ID }), { type: 'pointLineDistance', point: l.a, line: AXIS_X_ID, value: 7 });
    let doc = createDocument('Axes');
    const part = doc.parts[0]!;
    doc = addFeature(doc, part.id, { ...makeSketchFeature(doc, part, XY), params: sk });
    const parsed = parseNativeFile(serializeDocument(doc));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.doc).toEqual(doc);
    expect(parsed.warnings).toEqual([]);
    const res = solved(sk);
    expect(lineVec(res.sketch, l.lineId).a.y).toBeCloseTo(7, 9);
    expect(lineVec(res.sketch, l.lineId).b.y).toBeCloseTo(7, 9);
  });
});
