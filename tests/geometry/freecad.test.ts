/**
 * Vérification des exports STEP dans FreeCAD (facultative).
 * Activée si la variable FREECAD_APPIMAGE (AppImage FreeCAD) ou FREECAD_CMD (freecadcmd) est définie :
 *   FREECAD_APPIMAGE=~/FreeCAD_1.1.4.AppImage npx vitest run tests/geometry/freecad.test.ts
 * Les fichiers générés restent dans tests/output/ pour un contrôle visuel dans FreeCAD.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { addFeature, createDocument, findPart, insertFeatureAfter, makeChamferFeature, makeExtrudeFeature, makeFilletFeature, makePatternFeature, makeRevolveFeature, makeSketchFeature } from '../../src/domain/document';
import type { SketchParams } from '../../src/domain/model';
import { projectableCurves } from '../../src/app/projection';
import { addCircle, addConstraint, addRectangle } from '../../src/sketch/model';
import { solveSketch } from '../../src/sketch/solver';
import { RecomputeEngine } from '../../src/features/engine';
import type { GeometryKernel } from '../../src/geometry/kernel';
import { getKernel } from '../helpers/kernel';
import { stadium } from '../helpers/shapes';
import { buildPlateDocument, cornerEdge, setDimension, topFrontEdge } from '../helpers/plate';

const appImage = process.env.FREECAD_APPIMAGE;
const freecadCmd = process.env.FREECAD_CMD;
const enabled = !!(appImage || freecadCmd);
const outDir = resolve('tests/output');
const script = resolve('scripts/freecad/check_step.py');

interface FreeCadObject {
  label: string;
  solids: number;
  valid: boolean;
  volume: number;
  bbox: number[];
}

function checkInFreeCad(file: string): FreeCadObject[] {
  const [cmd, args] = appImage ? [appImage, ['freecadcmd', script, file]] : [freecadCmd!, [script, file]];
  const out = execFileSync(cmd, args, { env: { ...process.env, QT_QPA_PLATFORM: 'offscreen' }, encoding: 'utf8', timeout: 240_000 });
  const line = out.split('\n').find((l) => l.startsWith('RESULT_JSON '));
  if (!line) throw new Error(`Réponse FreeCAD inattendue :\n${out}`);
  return JSON.parse(line.slice('RESULT_JSON '.length));
}

let kernel: GeometryKernel;
beforeAll(async () => {
  kernel = await getKernel();
  mkdirSync(outDir, { recursive: true });
});

describe.runIf(enabled)('ouverture des exports STEP dans FreeCAD', () => {
  it('la plaque percée 60 × 30 × 5 (Ø 6) puis 80 × 30 × 5 s’ouvre avec un solide valide et les bonnes dimensions', () => {
    const { doc, ids } = buildPlateDocument();
    const engine = new RecomputeEngine(kernel, { get: () => undefined });
    const variants = [
      { file: 'plaque-percee-60.step', doc, width: 60 },
      { file: 'plaque-percee-80.step', doc: setDimension(doc, ids.sketch1, ids.widthConstraint, 80), width: 80 },
    ];
    for (const v of variants) {
      const [part] = engine.evaluateDocument(v.doc);
      const p = findPart(v.doc, ids.partId)!;
      const step = kernel.exportStep([{ name: 'Plaque percée', color: p.color, shape: part!.shape! }]);
      const file = join(outDir, v.file);
      writeFileSync(file, step);
      const objects = checkInFreeCad(file);
      expect(objects).toHaveLength(1);
      const o = objects[0]!;
      expect(o.label).toBe('Plaque percée');
      expect(o.solids).toBe(1);
      expect(o.valid).toBe(true);
      expect(o.volume).toBeCloseTo(v.width * 30 * 5 - Math.PI * 9 * 5, 3);
      expect(o.bbox).toEqual([0, 0, 0, v.width, 30, 5]);
    }
  });

  it('la plaque avec un congé R 2 et un chanfrein de 3 mm s’ouvre avec un solide valide et le bon volume', () => {
    const { doc: base, ids } = buildPlateDocument();
    let doc = addFeature(base, ids.partId, makeFilletFeature(base, findPart(base, ids.partId)!, [topFrontEdge(base, ids.sketch1, ids.extrude)], 2));
    doc = addFeature(doc, ids.partId, makeChamferFeature(doc, findPart(doc, ids.partId)!, [cornerEdge(doc, ids.sketch1, ids.extrude)], 3));
    const engine = new RecomputeEngine(kernel, { get: () => undefined });
    const [part] = engine.evaluateDocument(doc);
    expect(part!.statuses.every((s) => s.state === 'ok')).toBe(true);
    const file = join(outDir, 'plaque-conge-chanfrein.step');
    writeFileSync(file, kernel.exportStep([{ name: 'Plaque arrondie', color: '#3b82f6', shape: part!.shape! }]));
    const [o] = checkInFreeCad(file);
    expect(o!.solids).toBe(1);
    expect(o!.valid).toBe(true);
    expect(o!.volume).toBeCloseTo(part!.analysis!.volume, 3);
  });

  it('pièce avec chanfrein inséré avant le trou (frise) et bossage centré sur le trou projeté', () => {
    const { doc: base, ids } = buildPlateDocument();
    const engine = new RecomputeEngine(kernel, { get: () => undefined });
    // Chanfrein inséré juste après l'extrusion, comme depuis la frise de l'historique.
    let doc = insertFeatureAfter(base, ids.partId, ids.extrude, makeChamferFeature(base, findPart(base, ids.partId)!, [topFrontEdge(base, ids.sketch1, ids.extrude)], 2));
    const [plate] = engine.evaluateDocument(doc);
    const part = findPart(doc, ids.partId)!;
    const sk = makeSketchFeature(doc, part, { kind: 'face', ref: { featureId: ids.extrude, role: 'end' } });
    const frame = plate!.sketches.find((x) => x.featureId === ids.sketch2)!.frame!;
    const hole = projectableCurves(engine.meshOf(plate!, { linearDeflection: 0.05, angularDeflection: 0.3 }), frame, part, sk.id).find((c) => c.kind === 'circle')!;
    const ref = addCircle(sk.params, { x: 15, y: 15 }, 3);
    let params: SketchParams = { ...ref.sketch, entities: ref.sketch.entities.map((e) => (e.id === ref.circleId ? { ...e, reference: { edge: hole.ref } } : e)) };
    const boss = addCircle(params, { x: 16, y: 14 }, 4);
    params = addConstraint(boss.sketch, { type: 'coincident', a: ref.center, b: boss.center }).sketch;
    params = solveSketch(addConstraint(params, { type: 'diameter', circle: boss.circleId, value: 10 }).sketch).sketch;
    doc = addFeature(doc, ids.partId, { ...sk, params });
    doc = addFeature(doc, ids.partId, makeExtrudeFeature(doc, findPart(doc, ids.partId)!, sk.id, 2));
    const [res] = engine.evaluateDocument(doc);
    expect(res!.statuses.every((st) => st.state === 'ok')).toBe(true);
    const file = join(outDir, 'plaque-chanfrein-bossage.step');
    writeFileSync(file, kernel.exportStep([{ name: 'Plaque bossage', color: '#d9774f', shape: res!.shape! }]));
    const [o] = checkInFreeCad(file);
    expect(o!.solids).toBe(1);
    expect(o!.valid).toBe(true);
    expect(o!.volume).toBeCloseTo(9000 - 120 - Math.PI * 9 * 5 + Math.PI * 25 * 2, 3);
    expect(o!.bbox[5]).toBeCloseTo(7, 6);
  });

  it('pièce oblongue (segments + arcs) : solide valide, volume exact dans FreeCAD', () => {
    const { sketch } = stadium();
    let doc = createDocument('Oblong');
    const part = doc.parts[0]!;
    const sk = makeSketchFeature(doc, part, { kind: 'plane', plane: 'XY', offset: 0 });
    doc = addFeature(doc, part.id, { ...sk, params: { ...sketch, support: sk.params.support } });
    doc = addFeature(doc, part.id, makeExtrudeFeature(doc, findPart(doc, part.id)!, sk.id, 5));
    const [res] = new RecomputeEngine(kernel, { get: () => undefined }).evaluateDocument(doc);
    const file = join(outDir, 'oblong-arcs.step');
    writeFileSync(file, kernel.exportStep([{ name: 'Oblong', color: '#d9774f', shape: res!.shape! }]));
    const [o] = checkInFreeCad(file);
    expect(o!.solids).toBe(1);
    expect(o!.valid).toBe(true);
    expect(o!.volume).toBeCloseTo(5 * (800 + Math.PI * 100), 3);
  });

  it('révolution partielle (90°) d’un profil rectangulaire : solide valide, volume exact', () => {
    let doc = createDocument('Révolution');
    const part = doc.parts[0]!;
    const sk = makeSketchFeature(doc, part, { kind: 'plane', plane: 'XY', offset: 0 });
    const r = addRectangle(sk.params, { x: 10, y: 0 }, { x: 20, y: 20 });
    doc = addFeature(doc, part.id, { ...sk, params: solveSketch(r.sketch).sketch });
    doc = addFeature(doc, part.id, makeRevolveFeature(doc, findPart(doc, part.id)!, sk.id, { kind: 'sketch-y' }, 90));
    const [res] = new RecomputeEngine(kernel, { get: () => undefined }).evaluateDocument(doc);
    const file = join(outDir, 'revolution-90.step');
    writeFileSync(file, kernel.exportStep([{ name: 'Quart d’anneau', color: '#1f2126', shape: res!.shape! }]));
    const [o] = checkInFreeCad(file);
    expect(o!.solids).toBe(1);
    expect(o!.valid).toBe(true);
    expect(o!.volume).toBeCloseTo((Math.PI * (400 - 100) * 20) / 4, 3);
  });

  it('répétition en grille (3 × 2 trous) : solide valide, six perçages dans le volume', () => {
    const { doc, ids } = buildPlateDocument();
    const base = makePatternFeature(doc, findPart(doc, ids.partId)!, ids.pocket);
    const pattern = { ...base, params: { ...base.params, count: 3, spacing: 15, second: { axis: { kind: 'axis' as const, axis: 'Y' as const }, count: 2, spacing: 10, reversed: false } } };
    const withPattern = addFeature(doc, ids.partId, pattern);
    const [res] = new RecomputeEngine(kernel, { get: () => undefined }).evaluateDocument(withPattern);
    const file = join(outDir, 'repetition-grille.step');
    writeFileSync(file, kernel.exportStep([{ name: 'Plaque à six trous', color: '#3d6fb6', shape: res!.shape! }]));
    const [o] = checkInFreeCad(file);
    expect(o!.solids).toBe(1);
    expect(o!.valid).toBe(true);
    expect(o!.volume).toBeCloseTo(9000 - 6 * Math.PI * 9 * 5, 3);
  });
});
