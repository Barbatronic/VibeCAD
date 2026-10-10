import { describe, expect, it } from 'vitest';
import { activeCount, insertionPoint, isRolledBack, normalizeRollback, rolledBackDocument, withRollbackAt } from '../../src/app/rollback';
import { insertFeatureAfter, makeSketchFeature, removeFeaturesCascade } from '../../src/domain/document';
import { featureDependencies } from '../../src/features/registry';
import { buildPlateDocument } from '../helpers/plate';

describe('barre de retour en arrière', () => {
  it('limite le calcul aux étapes actives et insère à la position de la barre', () => {
    const { doc, ids } = buildPlateDocument();
    const part = doc.parts[0]!;
    expect(activeCount(part, {})).toBe(4);
    const rb = withRollbackAt({}, part, 2);
    expect(rb).toEqual({ [part.id]: ids.extrude });
    expect(isRolledBack(part, rb)).toBe(true);
    expect(rolledBackDocument(doc, rb).parts[0]!.features.map((f) => f.id)).toEqual([ids.sketch1, ids.extrude]);
    // Barre tout au début, puis à la fin (plus de retour).
    expect(rolledBackDocument(doc, withRollbackAt({}, part, 0)).parts[0]!.features).toEqual([]);
    expect(withRollbackAt(rb, part, 4)).toEqual({});
    // Insertion d'une nouvelle étape à la barre.
    const sk = makeSketchFeature(doc, part, { kind: 'plane', plane: 'XZ', offset: 0 });
    const after = insertionPoint(part, rb);
    expect(after).toBe(ids.extrude);
    const inserted = insertFeatureAfter(doc, part.id, after!, sk);
    expect(inserted.parts[0]!.features.map((f) => f.id)).toEqual([ids.sketch1, ids.extrude, sk.id, ids.sketch2, ids.pocket]);
    expect(insertFeatureAfter(doc, part.id, null, sk).parts[0]!.features[0]!.id).toBe(sk.id);
  });

  it('oublie une position devenue inutile (étape supprimée, barre en fin d’historique)', () => {
    const { doc, ids } = buildPlateDocument();
    const part = doc.parts[0]!;
    const rb = withRollbackAt({}, part, 3);
    expect(normalizeRollback(doc, rb)).toBe(rb);
    // Supprimer l'esquisse du trou emporte la poche : la barre visait l'esquisse.
    const without = removeFeaturesCascade(doc, part.id, [ids.sketch2], featureDependencies).doc;
    expect(normalizeRollback(without, rb)).toEqual({});
  });
});
