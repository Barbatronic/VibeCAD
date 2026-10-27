/**
 * Export FreeCAD : le script reconstruit les pièces dans FreeCAD avec le même volume.
 * Activé si FREECAD_APPIMAGE (AppImage FreeCAD) ou FREECAD_CMD (freecadcmd) est défini :
 *   FREECAD_APPIMAGE=~/FreeCAD.AppImage npx vitest run tests/geometry/freecad-export.test.ts
 * Sans FreeCAD, seule la génération est vérifiée. Les scripts restent dans tests/output/.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { addFeature, findPart, makeChamferFeature, makeExtrudeFeature, makeFilletFeature, makeHoleFeature, makeMirrorFeature, makeMoveFeature, makePatternFeature, makePlaneFeature, makePocketFeature, makePrimitiveFeature, makeRevolveFeature, makeSketchFeature } from '../../src/domain/document';
import { AXIS_X_ID, AXIS_Y_ID, type CadDocument, type Feature, type SketchConstraint, type SketchFeature } from '../../src/domain/model';
import { addPoint, addRectangle } from '../../src/sketch/model';
import { solveSketch } from '../../src/sketch/solver';
import { applyParameters } from '../../src/features/parameters';
import { RecomputeEngine } from '../../src/features/engine';
import type { GeometryKernel } from '../../src/geometry/kernel';
import { documentForWorker } from '../../src/geometry/protocol';
import { GeometryService } from '../../src/workers/geometry-service';
import { getKernel } from '../helpers/kernel';
import { buildPlateDocument, cornerEdge, holeSketch, topFrontEdge } from '../helpers/plate';
import { flattenAssembly, solveAssembly } from '../../src/app/assembly';
import { parseNativeFile } from '../../src/io/native-format';
import type { MeshData } from '../../src/geometry/kernel';

const appImage = process.env.FREECAD_APPIMAGE;
const freecadCmd = process.env.FREECAD_CMD;
const withFreecad = !!(appImage || freecadCmd);
const outDir = resolve('tests/output');

let kernel: GeometryKernel;
beforeAll(async () => {
  kernel = await getKernel();
  mkdirSync(outDir, { recursive: true });
});

interface Report {
  bodies: string[];
  frozen: string[];
  constraintErrors: number;
  featureErrors: string[];
  volumes: Record<string, number>;
  final: Record<string, string>;
}

function runInFreecad(script: string, name: string): Report {
  const file = join(outDir, `${name}.py`);
  writeFileSync(file, script);
  const [cmd, args] = appImage ? [appImage, ['freecadcmd', file]] : [freecadCmd!, [file]];
  const out = execFileSync(cmd, args, { env: { ...process.env, QT_QPA_PLATFORM: 'offscreen' }, encoding: 'utf8', timeout: 240_000 });
  const line = out.split('\n').find((l) => l.startsWith('VIBECAD_REPORT '));
  if (!line) throw new Error(`Réponse FreeCAD inattendue :\n${out}`);
  return JSON.parse(line.slice('VIBECAD_REPORT '.length)) as Report;
}

/** Script et volumes VibeCAD de chaque pièce. */
async function exportDoc(doc: CadDocument) {
  const service = new GeometryService(kernel);
  const r = await service.exportFreecad(documentForWorker(doc), doc.parts.map((p) => p.id), []);
  const volumes = new Map(new RecomputeEngine(kernel, { get: () => undefined }).evaluateDocument(doc).map((e) => [e.partId, e.analysis?.volume ?? 0]));
  return { ...r, volumes };
}

async function check(doc: CadDocument, name: string, expectFrozen = 0) {
  const { script, volumes } = await exportDoc(doc);
  expect(script).toContain('PartDesign::Body');
  if (!withFreecad) return null;
  const report = runInFreecad(script, name);
  expect(report.featureErrors, JSON.stringify(report)).toEqual([]);
  expect(report.constraintErrors).toBe(0);
  expect(report.frozen.length).toBe(expectFrozen);
  for (const part of doc.parts) {
    const body = report.final[part.id]!;
    expect(report.volumes[body], `${part.name} (${body})`).toBeCloseTo(volumes.get(part.id)!, 1);
  }
  return report;
}

describe('export FreeCAD (script Python)', () => {
  it('plaque percée : esquisse cotée, protrusion, esquisse sur la face, cavité traversante', async () => {
    await check(buildPlateDocument().doc, 'freecad-plaque');
  });

  it('trou coté depuis les axes de l’esquisse : ils deviennent les axes H et V du Sketcher', async () => {
    const { doc, ids } = buildPlateDocument();
    const d: CadDocument = {
      ...doc,
      parts: doc.parts.map((p) => ({
        ...p,
        features: p.features.map((f): Feature => {
          if (f.id !== ids.sketch2 || f.type !== 'sketch') return f;
          const circle = f.params.entities.find((e) => e.type === 'circle')!;
          const center = circle.type === 'circle' ? circle.center : '';
          const constraints = f.params.constraints.map((c): SketchConstraint =>
            c.type === 'distanceX' ? { id: c.id, type: 'pointLineDistance', point: center, line: AXIS_Y_ID, value: c.value } : c.type === 'distanceY' ? { id: c.id, type: 'pointLineDistance', point: center, line: AXIS_X_ID, value: c.value } : c,
          );
          return { ...f, params: { ...f.params, constraints } };
        }),
      })),
    };
    const { script } = await exportDoc(d);
    expect(script).toMatch(/"Distance", \d+, 3, -2, /);
    expect(script).toMatch(/"Distance", \d+, 3, -1, /);
    await check(d, 'freecad-axes');
  });

  it('répétition de deux étapes ensemble (trou et plot) : LinearPattern à deux Originals', async () => {
    const { doc, ids } = buildPlateDocument();
    const part = findPart(doc, ids.partId)!;
    const sketch = part.features.find((f) => f.id === ids.sketch2) as SketchFeature;
    const bossSketch = solveSketch({ ...sketch.params, constraints: sketch.params.constraints.map((c) => (c.type === 'diameter' ? { ...c, value: 10 } : c)) }).sketch;
    let d = addFeature(doc, ids.partId, { ...sketch, id: 'sk-boss', name: 'Plot', params: bossSketch });
    const boss = makeExtrudeFeature(d, findPart(d, ids.partId)!, 'sk-boss', 8);
    d = addFeature(d, ids.partId, boss);
    const pat = makePatternFeature(d, findPart(d, ids.partId)!, ids.pocket, 'linear');
    d = addFeature(d, ids.partId, { ...pat, params: { ...pat.params, count: 3, spacing: 15, extraSourceIds: [boss.id] } });
    const { script } = await exportDoc(d);
    expect(script).toMatch(/\.Originals = \[\w+, \w+\]/);
    await check(d, 'freecad-repetition-multiple');
  });

  it('congé sur une arête verticale et chanfrein sur l’arête avant du dessus', async () => {
    const { doc, ids } = buildPlateDocument();
    let d = addFeature(doc, ids.partId, makeFilletFeature(doc, findPart(doc, ids.partId)!, [cornerEdge(doc, ids.sketch1, ids.extrude)], 4));
    d = addFeature(d, ids.partId, makeChamferFeature(d, findPart(d, ids.partId)!, [topFrontEdge(d, ids.sketch1, ids.extrude)], 1));
    await check(d, 'freecad-conge-chanfrein');
  });

  it('perçages lamé M4 et fraisé M3 sur des points et des cercles', async () => {
    const { doc, ids } = buildPlateDocument();
    // Sans la poche ; deux esquisses sur le dessus : un cercle et un point.
    let d: CadDocument = { ...doc, parts: doc.parts.map((p) => ({ ...p, features: p.features.filter((f) => f.id !== ids.pocket) })) };
    const sk = d.parts[0]!.features.find((f) => f.id === ids.sketch2) as SketchFeature;
    d = { ...d, parts: d.parts.map((p) => ({ ...p, features: p.features.map((f): Feature => (f.id === ids.sketch2 ? { ...sk, params: addPoint(sk.params, { x: 45, y: 15 }).sketch } : f)) })) };
    const h1 = makeHoleFeature(d, findPart(d, ids.partId)!, ids.sketch2);
    d = addFeature(d, ids.partId, { ...h1, params: { ...h1.params, kind: 'counterbore', size: 'M4', headDiameter: 8, headDepth: 2 } });
    await check(d, 'freecad-percage');
  });

  it('répétitions en ligne et en cercle, symétrie par un plan de construction', async () => {
    const { doc, ids } = buildPlateDocument();
    const lin = makePatternFeature(doc, findPart(doc, ids.partId)!, ids.pocket, 'linear');
    let d = addFeature(doc, ids.partId, { ...lin, params: { ...lin.params, count: 3, spacing: 12 } });
    const plane = makePlaneFeature(d, findPart(d, ids.partId)!);
    d = addFeature(d, ids.partId, { ...plane, params: { base: { kind: 'plane', plane: 'YZ' }, offset: 70, angle: 0, hinge: { kind: 'axis', axis: 'X' } } });
    d = addFeature(d, ids.partId, makeMirrorFeature(d, findPart(d, ids.partId)!, { kind: 'part' }, { kind: 'datum', featureId: plane.id }));
    await check(d, 'freecad-repetitions');
  });

  it('formes toutes faites, révolution et équations liées à des paramètres', async () => {
    const { doc, ids } = buildPlateDocument();
    const box = makePrimitiveFeature(doc, findPart(doc, ids.partId)!, 'cylinder', 'cut');
    let d = addFeature(doc, ids.partId, { ...box, params: { ...box.params, position: { x: 45, y: 15, z: 0 }, diameter: 8, height: 5 } });
    // Paramètre « ep » lié à l'épaisseur de la plaque.
    d = { ...d, parameters: [{ name: 'ep', expression: '6' }], parts: d.parts.map((p) => ({ ...p, features: p.features.map((f): Feature => (f.id === ids.extrude ? { ...f, expressions: { distance: 'ep' } } : f)) })) };
    d = applyParameters(d);
    // Révolution : un anneau autour de l'axe Y de l'esquisse XZ.
    const sk = makeSketchFeature(d, findPart(d, ids.partId)!, { kind: 'plane', plane: 'XZ', offset: 0 });
    d = addFeature(d, ids.partId, { ...sk, params: addRectangle(sk.params, { x: 70, y: 0 }, { x: 74, y: 4 }).sketch });
    d = addFeature(d, ids.partId, makeRevolveFeature(d, findPart(d, ids.partId)!, sk.id, { kind: 'sketch-y' }, 360));
    const report = await check(d, 'freecad-formes-parametres');
    if (report) expect(report.bodies.length).toBe(1);
  });

  it('une étape sans équivalent (déplacer) devient une forme figée ; la suite repart d’un nouveau corps', async () => {
    const { doc, ids } = buildPlateDocument();
    const mv = makeMoveFeature(doc, findPart(doc, ids.partId)!);
    let d = addFeature(doc, ids.partId, { ...mv, params: { ...mv.params, translation: { x: 0, y: 0, z: 10 } } });
    const sk = makeSketchFeature(d, findPart(d, ids.partId)!, { kind: 'plane', plane: 'XY', offset: 15 });
    d = addFeature(d, ids.partId, { ...sk, params: holeSketch(sk.params, 45, 15, 6) });
    d = addFeature(d, ids.partId, makePocketFeature(d, findPart(d, ids.partId)!, sk.id, { kind: 'throughAll' }, 'symmetric'));
    const report = await check(d, 'freecad-fige', 1);
    if (report) expect(report.bodies.length).toBe(2);
  });

  it('assemblage : des liens placés vers les corps ; .FCStd des formes finales lisible par FreeCAD', async () => {
    const parsed = parseNativeFile(readFileSync('tests/fixtures/reference-schema-1.vibecad', 'utf8'));
    if (!parsed.ok) throw new Error(parsed.error);
    const doc = parsed.doc;
    const engine = new RecomputeEngine(kernel, { get: () => undefined });
    const evs = engine.evaluateDocument(doc);
    const meshes = new Map<string, MeshData>(evs.flatMap((e) => (e.shape ? [[e.partId, engine.meshOf(e, { linearDeflection: 0.1, angularDeflection: 0.5 })!] as const] : [])));
    const placed = solveAssembly(doc.assembly!, (id) => meshes.get(id));
    const leaves = flattenAssembly(doc.assembly!, placed, (id) => meshes.get(id)).map((l) => ({ name: l.name, partId: l.partId, matrix: [...l.matrix], group: null }));
    const service = new GeometryService(kernel);
    const r = await service.exportFreecad(documentForWorker(doc), [], leaves);
    expect(r.script).toContain('App::Link');
    if (!withFreecad) return;
    const report = runInFreecad(r.script, 'freecad-assemblage');
    expect(report.featureErrors).toEqual([]);
    const fcstd = join(outDir, 'freecad-assemblage-formes.FCStd');
    writeFileSync(fcstd, r.fcstd);
    const [cmd, args] = appImage ? [appImage, ['freecadcmd', resolve('scripts/freecad/check_fcstd.py'), fcstd]] : [freecadCmd!, [resolve('scripts/freecad/check_fcstd.py'), fcstd]];
    const out = execFileSync(cmd, args, { env: { ...process.env, QT_QPA_PLATFORM: 'offscreen' }, encoding: 'utf8', timeout: 240_000 });
    const objects = JSON.parse(out.split('\n').find((l) => l.startsWith('RESULT_JSON '))!.slice('RESULT_JSON '.length)) as { type: string; label: string; valid: boolean; volume: number; position: number[] | null; group: string[] }[];
    const shapes = objects.filter((o) => o.type === 'Part::Feature');
    expect(shapes.map((o) => o.label)).toEqual(leaves.map((l) => l.name));
    const volume = evs[0]!.analysis!.volume;
    for (const o of shapes) expect(o.volume).toBeCloseTo(volume, 1);
    // La seconde plaque est à sa place dans l'assemblage.
    expect(shapes[1]!.position![0]).toBeCloseTo(leaves[1]!.matrix[12]!, 6);
    expect(objects.find((o) => o.type === 'App::DocumentObjectGroup')!.group).toEqual(leaves.map((l) => l.name));
  });
});
