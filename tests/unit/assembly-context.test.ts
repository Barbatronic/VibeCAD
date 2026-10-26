import { describe, expect, it } from 'vitest';
import { referenceAssembly, syncContexts } from '../../src/app/assembly-context';
import { addFeature, addInstance, addPart, findPart, makeSketchFeature } from '../../src/domain/document';
import type { CadDocument, SketchFeature } from '../../src/domain/model';
import { buildPlateDocument } from '../helpers/plate';

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** Plaque (fixe) et bloc inséré en (40, 0, 20) ; esquisse du bloc posée sur la plaque, dans l'assemblage. */
function project(frozen = false): { doc: CadDocument; sketchId: string } {
  let { doc, ids } = buildPlateDocument();
  const added = addPart(doc, 'Bloc');
  doc = added.doc;
  const a = addInstance(doc, ids.partId, { x: 0, y: 0, z: 0 });
  const b = addInstance(a.doc, added.partId, { x: 40, y: 0, z: 20 });
  doc = b.doc;
  const context = { instanceId: b.instanceId, otherInstanceId: a.instanceId, matrix: IDENTITY, ...(frozen ? { frozen: true } : {}) };
  const sk = makeSketchFeature(doc, findPart(doc, added.partId)!, { kind: 'face', ref: { featureId: ids.extrude, role: 'end' }, partId: ids.partId, context });
  return { doc: addFeature(doc, added.partId, sk), sketchId: sk.id };
}

const supportOf = (doc: CadDocument, id: string) => (doc.parts[1]!.features.find((f) => f.id === id) as SketchFeature).params.support as { context: { matrix: number[] } };

describe('conception en contexte d’assemblage', () => {
  it('position de référence : liaisons à zéro', () => {
    const { doc } = project();
    const joint = { id: 'j1', name: 'Pivot', kind: 'revolute', base: {}, moving: {}, angle: 35, offset: 4 } as never;
    const ref = referenceAssembly({ ...doc.assembly!, joints: [joint] });
    expect(ref.joints[0]).toMatchObject({ angle: 0, offset: 0 });
  });

  it('la place de la voisine suit l’assemblage, sauf lien figé ; rien ne change si elle est déjà à jour', () => {
    const { doc, sketchId } = project();
    const synced = syncContexts(doc, () => undefined);
    // Plaque vue depuis le bloc : décalée de (−40, 0, −20).
    expect(supportOf(synced, sketchId).context.matrix.slice(12, 15)).toEqual([-40, 0, -20]);
    expect(syncContexts(synced, () => undefined)).toBe(synced);
    // Bloc déplacé dans l'assemblage : la matrice suit.
    const moved = { ...synced, assembly: { ...synced.assembly!, instances: synced.assembly!.instances.map((i, n) => (n === 1 ? { ...i, position: { x: 10, y: 5, z: 0 } } : i)) } };
    expect(supportOf(syncContexts(moved, () => undefined), sketchId).context.matrix.slice(12, 15)).toEqual([-10, -5, 0]);
    // Lien figé : il garde sa position.
    const frozen = project(true);
    expect(syncContexts(frozen.doc, () => undefined)).toBe(frozen.doc);
    // Insertion de la voisine retirée : dernière position gardée.
    const gone = { ...synced, assembly: { ...synced.assembly!, instances: synced.assembly!.instances.slice(1) } };
    expect(syncContexts(gone, () => undefined)).toBe(gone);
  });
});
