import { beforeAll, describe, expect, it } from 'vitest';
import { addFeature, findPart, makeFilletFeature, makeMoveFeature } from '../../src/domain/document';
import type { CadDocument, MoveFeature } from '../../src/domain/model';
import { RecomputeEngine } from '../../src/features/engine';
import type { GeometryKernel } from '../../src/geometry/kernel';
import { getKernel } from '../helpers/kernel';
import { buildPlateDocument, cornerEdge } from '../helpers/plate';

/** Plaque 60 × 30 × 5 percée Ø 6. */
const PLATE_VOLUME_EXACT = 60 * 30 * 5 - Math.PI * 9 * 5;

let kernel: GeometryKernel;
beforeAll(async () => {
  kernel = await getKernel();
});

function withMove(params: Partial<MoveFeature['params']>) {
  const { doc, ids } = buildPlateDocument();
  const part = findPart(doc, ids.partId)!;
  const move = makeMoveFeature(doc, part);
  const next: CadDocument = addFeature(doc, ids.partId, { ...move, params: { ...move.params, ...params } });
  return { doc: next, ids };
}

const evaluate = (doc: CadDocument) => new RecomputeEngine(kernel, { get: () => undefined }).evaluateDocument(doc)[0]!;

describe('déplacer : toute la pièce', () => {
  it('décalage : la boîte se déplace, le volume ne change pas', () => {
    const part = evaluate(withMove({ translation: { x: 10, y: -5, z: 2 }, angle: 0 }).doc);
    expect(part.failedFeatureId).toBeNull();
    const bb = part.analysis!.bbox!;
    expect([bb.min.x, bb.min.y, bb.min.z].map((v) => Math.round(v * 1e6) / 1e6)).toEqual([10, -5, 2]);
    expect(part.analysis!.volume).toBeCloseTo(PLATE_VOLUME_EXACT, 3);
  });

  it('quart de tour autour de Z (centre à l’origine) : la plaque 60 × 30 passe en 30 × 60', () => {
    const part = evaluate(withMove({ translation: { x: 0, y: 0, z: 0 }, axis: 'Z', angle: 90 }).doc);
    const bb = part.analysis!.bbox!;
    expect(bb.max.x - bb.min.x).toBeCloseTo(30, 6);
    expect(bb.max.y - bb.min.y).toBeCloseTo(60, 6);
    expect(bb.min.x).toBeCloseTo(-30, 6);
  });

  it('les faces gardent leurs références : un congé ajouté après le déplacement retrouve son arête', () => {
    const { doc, ids } = withMove({ translation: { x: 0, y: 0, z: 0 }, axis: 'X', angle: 30, center: { x: 30, y: 15, z: 2.5 } });
    const part = findPart(doc, ids.partId)!;
    const fillet = makeFilletFeature(doc, part, [cornerEdge(doc, ids.sketch1, ids.extrude)], 3);
    const result = evaluate(addFeature(doc, ids.partId, fillet));
    expect(result.failedFeatureId).toBeNull();
    expect(result.statuses.at(-1)!.state).toBe('ok');
    expect(result.analysis!.volume).toBeLessThan(PLATE_VOLUME_EXACT);
  });

  it('copie : l’original reste, la copie s’ajoute (pièce en deux morceaux signalée)', () => {
    const part = evaluate(withMove({ translation: { x: 100, y: 0, z: 0 }, copy: true }).doc);
    expect(part.analysis!.volume).toBeCloseTo(2 * PLATE_VOLUME_EXACT, 2);
    expect(part.statuses.at(-1)!.code).toBe('DISJOINT_SOLID');
  });

  it('déplacement nul : avertissement, la pièce ne bouge pas', () => {
    const part = evaluate(withMove({ translation: { x: 0, y: 0, z: 0 }, angle: 360 }).doc);
    expect(part.statuses.at(-1)!.code).toBe('MOVE_NOTHING');
    expect(part.analysis!.bbox!.min.x).toBeCloseTo(0, 6);
  });
});
