import { beforeAll, describe, expect, it } from 'vitest';
import { addFeature, createDocument, findPart, makeAxisFeature, makePrimitiveFeature, makeRevolveFeature, makeSketchFeature, updateFeature } from '../../src/domain/document';
import { edgeRefFromPick } from '../../src/app/edges';
import type { CadDocument, Id, RevolveFeature, SketchParams, VolumeOperation } from '../../src/domain/model';
import { RecomputeEngine } from '../../src/features/engine';
import type { GeometryKernel } from '../../src/geometry/kernel';
import { parseNativeFile, serializeDocument } from '../../src/io/native-format';
import { addConstraint, addRectangle, emptySketch } from '../../src/sketch/model';
import { solveSketch } from '../../src/sketch/solver';
import { getKernel } from '../helpers/kernel';

let kernel: GeometryKernel;
beforeAll(async () => {
  kernel = await getKernel();
});

const XY = { kind: 'plane', plane: 'XY', offset: 0 } as const;

/** Rectangle de 10 × 20 entre x = 10 et x = 20 (un anneau une fois tourné autour de l'axe Y). */
function ringProfile(): { sketch: SketchParams; width: string } {
  const r = addRectangle(emptySketch(XY), { x: 10, y: 0 }, { x: 20, y: 20 });
  const w = addConstraint(r.sketch, { type: 'length', line: r.lines[0], value: 10 });
  return { sketch: solveSketch(w.sketch).sketch, width: w.id };
}

function revolveDoc(angle = 360): { doc: CadDocument; partId: Id; sketchId: Id; revolveId: Id; width: string } {
  let doc = createDocument('Révolution');
  const part = doc.parts[0]!;
  const sk = makeSketchFeature(doc, part, XY);
  const { sketch, width } = ringProfile();
  doc = addFeature(doc, part.id, { ...sk, params: { ...sketch, support: XY } });
  const rev = makeRevolveFeature(doc, findPart(doc, part.id)!, sk.id, { kind: 'sketch-y' }, angle);
  doc = addFeature(doc, part.id, rev);
  return { doc, partId: part.id, sketchId: sk.id, revolveId: rev.id, width };
}

const ringVolume = (angleDeg: number, outer = 20) => Math.PI * (outer * outer - 100) * 20 * (angleDeg / 360);

describe('révolution', () => {
  it('tour complet et révolution partielle : solides valides aux volumes exacts', () => {
    const engine = new RecomputeEngine(kernel, { get: () => undefined });
    const full = revolveDoc(360);
    const [res] = engine.evaluateDocument(full.doc);
    expect(res!.statuses.map((s) => s.state)).toEqual(['ok', 'ok']);
    expect(res!.analysis!.valid).toBe(true);
    expect(res!.analysis!.volume).toBeCloseTo(ringVolume(360), 3);
    expect(res!.analysis!.bbox!.max.x).toBeCloseTo(20, 6);
    expect(res!.analysis!.bbox!.min.z).toBeCloseTo(-20, 6);

    const quarter = revolveDoc(90);
    const [q] = engine.evaluateDocument(quarter.doc);
    expect(q!.analysis!.valid).toBe(true);
    expect(q!.analysis!.volume).toBeCloseTo(ringVolume(90), 3);
    // Sens inverse : même volume, de l'autre côté.
    const flipped = updateFeature<RevolveFeature>(quarter.doc, quarter.revolveId, (f) => ({ ...f, params: { ...f.params, reversed: true } }));
    const [qf] = engine.evaluateDocument(flipped);
    expect(qf!.analysis!.volume).toBeCloseTo(ringVolume(90), 3);
    expect(Math.sign(qf!.analysis!.bbox!.max.z + qf!.analysis!.bbox!.min.z)).toBe(-Math.sign(q!.analysis!.bbox!.max.z + q!.analysis!.bbox!.min.z));
  });

  it('suit une cote modifiée et se relit dans le format natif', () => {
    const engine = new RecomputeEngine(kernel, { get: () => undefined });
    const { doc, sketchId, width } = revolveDoc(360);
    const wider = updateFeature(doc, sketchId, (f) =>
      f.type === 'sketch' ? { ...f, params: solveSketch({ ...f.params, constraints: f.params.constraints.map((c) => (c.id === width ? { ...c, value: 15 } : c)) }).sketch } : f,
    );
    const [res] = engine.evaluateDocument(wider);
    expect(res!.analysis!.bbox!.max.x).toBeGreaterThan(20);
    const parsed = parseNativeFile(serializeDocument(doc));
    expect(parsed.ok && parsed.doc).toEqual(doc);
  });

  it('refuse un profil qui traverse l’axe, avec une explication', () => {
    const engine = new RecomputeEngine(kernel, { get: () => undefined });
    const { doc, revolveId } = revolveDoc(360);
    const crossing = updateFeature<RevolveFeature>(doc, revolveId, (f) => ({ ...f, params: { ...f.params, axis: { kind: 'sketch-x' } } }));
    // Le rectangle touche l'axe X (y = 0) sans le traverser : accepté.
    expect(engine.evaluateDocument(crossing)[0]!.statuses[1]!.state).toBe('ok');
    const moved = updateFeature(doc, doc.parts[0]!.features[0]!.id, (f) =>
      f.type === 'sketch' ? { ...f, params: { ...f.params, entities: f.params.entities.map((e) => (e.type === 'point' ? { ...e, x: e.x - 15 } : e)), constraints: [] } } : f,
    );
    const [res] = engine.evaluateDocument(moved);
    expect(res!.statuses[1]).toMatchObject({ state: 'error', code: 'REVOLVE_CROSSES_AXIS' });
  });

  it('creuser : la bague est retirée d’un bloc (gorge), garder : seule la partie commune reste', () => {
    const engine = new RecomputeEngine(kernel, { get: () => undefined });
    /** Bloc 50 × 20 × 50 centré sur l'axe Y, puis la bague tournée autour de Y. */
    const withBlock = (operation: VolumeOperation) => {
      let doc = createDocument('Gorge');
      const partId = doc.parts[0]!.id;
      const pr = makePrimitiveFeature(doc, findPart(doc, partId)!);
      doc = addFeature(doc, partId, { ...pr, params: { ...pr.params, position: { x: -25, y: 0, z: -25 }, width: 50, depth: 20, height: 50 } });
      const sk = makeSketchFeature(doc, findPart(doc, partId)!, XY);
      doc = addFeature(doc, partId, { ...sk, params: { ...ringProfile().sketch, support: XY } });
      const rev = makeRevolveFeature(doc, findPart(doc, partId)!, sk.id, { kind: 'sketch-y' }, 360);
      return addFeature(doc, partId, { ...rev, params: { ...rev.params, operation } });
    };
    const cut = engine.evaluateDocument(withBlock('cut'))[0]!;
    expect(cut.statuses.at(-1)!.state).toBe('ok');
    expect(cut.analysis!.volume).toBeCloseTo(50 * 20 * 50 - ringVolume(360), 2);
    const common = engine.evaluateDocument(withBlock('common'))[0]!;
    expect(common.statuses.at(-1)!.state).toBe('ok');
    expect(common.analysis!.volume).toBeCloseTo(ringVolume(360), 2);
  });

  it('creuser sans volume : erreur expliquée ; ancien fichier sans « operation » : ajouter', () => {
    const engine = new RecomputeEngine(kernel, { get: () => undefined });
    const { doc, revolveId } = revolveDoc(360);
    const alone = updateFeature<RevolveFeature>(doc, revolveId, (f) => ({ ...f, params: { ...f.params, operation: 'cut' } }));
    expect(engine.evaluateDocument(alone)[0]!.statuses.at(-1)).toMatchObject({ state: 'error', code: 'POCKET_WITHOUT_SOLID' });
    const json = JSON.parse(serializeDocument(doc));
    delete json.document.parts[0].features[1].params.operation;
    const parsed = parseNativeFile(JSON.stringify(json));
    expect(parsed.ok && (parsed.doc.parts[0]!.features[1] as RevolveFeature).params.operation).toBe('add');
  });

  it('autre axe : axe du repère, axe de construction écarté du plan, arête de la pièce ; axe perpendiculaire refusé', () => {
    // Rectangle 10 × 20 entre x = 10 et 20 sur le plan XY : tourné autour de l'axe Y du repère (dans le plan).
    const base = revolveDoc();
    const withAxis = (doc: CadDocument, axis: RevolveFeature['params']['axis']) =>
      updateFeature<RevolveFeature>(doc, base.revolveId, (f) => ({ ...f, params: { ...f.params, axis } }));
    const run = (doc: CadDocument) => new RecomputeEngine(kernel, { get: () => undefined }).evaluateDocument(doc)[0]!;
    const aroundY = run(withAxis(base.doc, { kind: 'axis', axis: { kind: 'axis', axis: 'Y' } }));
    expect(aroundY.statuses.at(-1)?.state).toBe('ok');
    expect(aroundY.analysis!.volume).toBeCloseTo(ringVolume(360), 0);

    // Axe de construction parallèle à Y mais au-dessus du plan (z = 30) : chaque point du rectangle
    // décrit un cercle autour de cet axe, de rayon √(x² + 30²) ; le solide monte jusqu'à 30 + √(20² + 30²).
    const axisFeature = { ...makeAxisFeature(base.doc, findPart(base.doc, base.partId)!), params: { kind: 'line' as const, position: { x: 0, y: 0, z: 30 }, direction: 'Y' as const } };
    let d = addFeature(base.doc, base.partId, axisFeature);
    // L'axe doit précéder la révolution dans l'historique.
    d = { ...d, parts: d.parts.map((p) => ({ ...p, features: [p.features[0]!, p.features.at(-1)!, p.features[1]!] })) };
    const offset = run(withAxis(d, { kind: 'axis', axis: { kind: 'datum', featureId: axisFeature.id } }));
    expect(offset.statuses.at(-1)?.state).toBe('ok');
    expect(offset.analysis!.volume).toBeCloseTo(Math.PI * (Math.hypot(20, 30) ** 2 - Math.hypot(10, 30) ** 2) * 20, 0);
    expect(offset.analysis!.bbox!.max.z).toBeCloseTo(30 + Math.hypot(20, 30), 3);

    // Axe perpendiculaire au plan de l'esquisse (Z) : refusé.
    const z = run(withAxis(base.doc, { kind: 'axis', axis: { kind: 'axis', axis: 'Z' } }));
    expect(z.statuses.at(-1)).toMatchObject({ state: 'error', code: 'INVALID_PARAMETER' });
    expect(z.statuses.at(-1)?.message).toMatch(/parallèle au plan/);

    // Arête de la pièce : le bord gauche d'un pavé posé à côté (x = −5, le long de Y, z = 0).
    let e = base.doc;
    const box = makePrimitiveFeature(e, findPart(e, base.partId)!);
    e = addFeature(e, base.partId, { ...box, params: { ...box.params, position: { x: -15, y: -40, z: 0 }, width: 10, depth: 10, height: 10 } });
    e = { ...e, parts: e.parts.map((p) => ({ ...p, features: [p.features[0]!, p.features.at(-1)!, p.features[1]!] })) };
    const ev = new RecomputeEngine(kernel, { get: () => undefined });
    const [res] = ev.evaluateDocument(e);
    const mesh = ev.meshOf(res!, { linearDeflection: 0.05, angularDeflection: 0.3 })!;
    const index = mesh.edges.findIndex((x) => x.line && Math.abs(x.line.start.x + 5) < 1e-6 && Math.abs(x.line.end.x + 5) < 1e-6 && Math.abs(x.line.start.z) < 1e-6 && Math.abs(x.line.end.z) < 1e-6);
    const ref = edgeRefFromPick(mesh, index, findPart(e, base.partId)!, null);
    if (ref.kind !== 'ref') throw new Error('arête introuvable');
    const around = run(withAxis(e, { kind: 'axis', axis: { kind: 'edge', edge: ref.ref } }));
    // Anneau autour de x = −5 (rayons 15 et 25), à côté du pavé (avertissement : deux morceaux séparés).
    expect(around.statuses.at(-1)).toMatchObject({ state: 'warning', code: 'DISJOINT_SOLID' });
    expect(around.analysis!.volume).toBeCloseTo(Math.PI * (25 * 25 - 15 * 15) * 20 + 1000, 0);
    // Aller-retour du fichier.
    const parsed = parseNativeFile(serializeDocument(withAxis(e, { kind: 'axis', axis: { kind: 'edge', edge: ref.ref } })));
    expect(parsed.ok && (parsed.doc.parts[0]!.features.at(-1) as RevolveFeature).params.axis).toEqual({ kind: 'axis', axis: { kind: 'edge', edge: ref.ref } });
  });

  it('angle de départ : un quart de tour décalé de 90° change de quadrant, même volume, faces gardées', () => {
    const base = revolveDoc(90);
    const run = (startAngle: number, reversed = false) => {
      const d = updateFeature<RevolveFeature>(base.doc, base.revolveId, (f) => ({ ...f, params: { ...f.params, startAngle, reversed } }));
      const engine = new RecomputeEngine(kernel, { get: () => undefined });
      const [r] = engine.evaluateDocument(d);
      return { r: r!, engine, d };
    };
    const from0 = run(0).r;
    const from90 = run(90);
    expect(from90.r.statuses.at(-1)?.state).toBe('ok');
    expect(from90.r.analysis!.volume).toBeCloseTo(from0.analysis!.volume, 3);
    // Sans décalage, le quart de tour touche le côté +X (le profil y est) ; décalé de 90°, il est passé de l'autre côté.
    expect(from0.analysis!.bbox!.max.x).toBeCloseTo(20, 4);
    expect(from90.r.analysis!.bbox!.max.x).toBeLessThan(1e-3);
    expect(from90.r.analysis!.bbox!.min.x).toBeCloseTo(-20, 4);
    // Les faces gardent leurs étiquettes (début, fin, côtés) : une esquisse peut s'y poser.
    const mesh = from90.engine.meshOf(from90.r, { linearDeflection: 0.05, angularDeflection: 0.3 })!;
    expect(mesh.faces.some((f) => f.tags.some((t) => t.featureId === base.revolveId && t.role === 'start'))).toBe(true);
    // Sens inverse : le décalage suit le sens de rotation (symétrique du cas précédent par rapport au plan de l'esquisse).
    const rev = run(90, true).r;
    expect(rev.analysis!.bbox!.min.x).toBeCloseTo(-20, 4);
    expect(rev.analysis!.bbox!.max.z * from90.r.analysis!.bbox!.min.z).toBeLessThanOrEqual(1e-6);
    // Aller-retour du fichier.
    const parsed = parseNativeFile(serializeDocument(from90.d));
    expect(parsed.ok && (parsed.doc.parts[0]!.features.at(-1) as RevolveFeature).params.startAngle).toBe(90);
  });
});
