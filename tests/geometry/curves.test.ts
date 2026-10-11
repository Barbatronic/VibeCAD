import Ajv2020 from 'ajv/dist/2020';
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { addFeature, createDocument, findPart, makeExtrudeFeature, makeSketchFeature, makeSweepFeature } from '../../src/domain/document';
import type { CadDocument, SketchParams } from '../../src/domain/model';
import { RecomputeEngine } from '../../src/features/engine';
import type { GeometryKernel } from '../../src/geometry/kernel';
import { parseNativeFile, serializeDocument } from '../../src/io/native-format';
import { addCircle, addEllipse, addLine, addSpline } from '../../src/sketch/model';
import { extractProfiles, profileArea } from '../../src/sketch/profiles';
import { solveSketch } from '../../src/sketch/solver';
import { getKernel } from '../helpers/kernel';

let kernel: GeometryKernel;
beforeAll(async () => {
  kernel = await getKernel();
});

/** Esquisse sur XY dessinée par `draw`, extrudée de 5 mm. */
function extruded(draw: (s: SketchParams) => SketchParams): { doc: CadDocument; sketch: SketchParams; sketchId: string } {
  let doc = createDocument('Courbes');
  const partId = doc.parts[0]!.id;
  const sk = makeSketchFeature(doc, findPart(doc, partId)!, { kind: 'plane', plane: 'XY', offset: 0 });
  const sketch = solveSketch(draw(sk.params)).sketch;
  doc = addFeature(doc, partId, { ...sk, params: sketch });
  doc = addFeature(doc, partId, makeExtrudeFeature(doc, findPart(doc, partId)!, sk.id, 5));
  return { doc, sketch, sketchId: sk.id };
}

const evaluate = (doc: CadDocument) => new RecomputeEngine(kernel, { get: () => undefined }).evaluateDocument(doc)[0]!;

describe('ellipses et splines dans le volume', () => {
  it('ellipse 20 × 8 extrudée : volume π a b h, faces latérales au nom de l’ellipse', () => {
    let id = '';
    const { doc } = extruded((s) => {
      const r = addEllipse(s, { x: 0, y: 0 }, { x: 10, y: 0 }, 4);
      id = r.ellipseId;
      return r.sketch;
    });
    const res = evaluate(doc);
    expect(res.statuses.at(-1)!.state).toBe('ok');
    expect(res.analysis!.volume).toBeCloseTo(Math.PI * 10 * 4 * 5, 3);
    const mesh = new RecomputeEngine(kernel, { get: () => undefined }).meshOf(res, { linearDeflection: 0.05, angularDeflection: 0.3 })!;
    expect(mesh.faces.some((f) => f.tags.some((t) => t.role === 'side' && t.entityId === id))).toBe(true);
  });

  it('ellipse au petit axe plus long que le grand axe : même volume', () => {
    const { doc } = extruded((s) => addEllipse(s, { x: 0, y: 0 }, { x: 3, y: 4 }, 9).sketch);
    expect(evaluate(doc).analysis!.volume).toBeCloseTo(Math.PI * 5 * 9 * 5, 3);
  });

  it('spline fermée et arche (spline ouverte + segment) : volume = aire exacte × hauteur', () => {
    const closed = extruded((s) => addSpline(s, [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 10 }, { x: 0, y: 10 }], true).sketch);
    const area = profileArea(extractProfiles(closed.sketch));
    const res = evaluate(closed.doc);
    expect(res.statuses.at(-1)!.state).toBe('ok');
    expect(res.analysis!.valid).toBe(true);
    expect(res.analysis!.volume).toBeCloseTo(area * 5, 3);

    const arch = extruded((s) => addLine(addSpline(s, [{ x: 0, y: 0 }, { x: 10, y: 8 }, { x: 20, y: 0 }], false).sketch, { x: 20, y: 0 }, { x: 0, y: 0 }).sketch);
    expect(evaluate(arch.doc).analysis!.volume).toBeCloseTo((280 / 3) * 5, 3);
  });

  it('balayage d’un cercle le long d’une spline ouverte : un seul solide valide', () => {
    let doc = createDocument('Tube souple');
    const partId = doc.parts[0]!.id;
    const pathSk = makeSketchFeature(doc, findPart(doc, partId)!, { kind: 'plane', plane: 'XZ', offset: 0 });
    doc = addFeature(doc, partId, { ...pathSk, params: addSpline(pathSk.params, [{ x: 0, y: 0 }, { x: 5, y: 15 }, { x: 15, y: 25 }, { x: 30, y: 30 }], false).sketch });
    const prof = makeSketchFeature(doc, findPart(doc, partId)!, { kind: 'plane', plane: 'XY', offset: 0 });
    doc = addFeature(doc, partId, { ...prof, params: solveSketch(addCircle(prof.params, { x: 0, y: 0 }, 2).sketch).sketch });
    doc = addFeature(doc, partId, makeSweepFeature(doc, findPart(doc, partId)!, prof.id, pathSk.id));
    const res = evaluate(doc);
    expect(res.statuses.at(-1)!.state).toBe('ok');
    expect(res.analysis!.valid).toBe(true);
    expect(res.analysis!.solidCount).toBe(1);
    expect(res.analysis!.volume).toBeGreaterThan(Math.PI * 4 * 40);
  });

  it('aller-retour du format natif et schéma JSON', () => {
    const { doc } = extruded((s) => addSpline(addEllipse(s, { x: 0, y: 0 }, { x: 10, y: 0 }, 4).sketch, [{ x: 20, y: 0 }, { x: 30, y: 5 }, { x: 40, y: 0 }], true).sketch);
    const text = serializeDocument(doc, '2026-10-11T12:00:00.000Z');
    const parsed = parseNativeFile(text);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.doc).toEqual(doc);
    const validate = new Ajv2020({ allErrors: true, strict: false }).compile(JSON.parse(readFileSync('docs/vibecad.schema.json', 'utf8')));
    validate(JSON.parse(text));
    expect(validate.errors ?? []).toEqual([]);
  });
});
