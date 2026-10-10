import { beforeAll, describe, expect, it } from 'vitest';
import { emptyHistory, nextRedoLabel, nextUndoLabel, recordAction, redoAction, undoAction } from '../../src/commands/history';
import { RecomputeEngine } from '../../src/features/engine';
import type { GeometryKernel } from '../../src/geometry/kernel';
import { getKernel } from '../helpers/kernel';
import { buildPlateDocument, setDimension } from '../helpers/plate';

let kernel: GeometryKernel;
beforeAll(async () => {
  kernel = await getKernel();
});

describe('annuler / rétablir', () => {
  it('restaure dimensions, historique et géométrie de façon cohérente', () => {
    const { doc, ids } = buildPlateDocument();
    const engine = new RecomputeEngine(kernel, { get: () => undefined });
    const volumeOf = (d: typeof doc) => engine.evaluateDocument(d)[0]!.analysis!.volume;

    let history = emptyHistory();
    const v60 = volumeOf(doc);
    const wider = setDimension(doc, ids.sketch1, ids.widthConstraint, 80);
    history = recordAction(history, doc, 'Modifier la cote de largeur');
    expect(nextUndoLabel(history)).toBe('Modifier la cote de largeur');
    const v80 = volumeOf(wider);
    expect(v80).toBeCloseTo(v60 + 20 * 30 * 5, 6);

    const undone = undoAction(history, wider)!;
    expect(undone.doc).toBe(doc);
    expect(undone.label).toBe('Modifier la cote de largeur');
    expect(volumeOf(undone.doc)).toBeCloseTo(v60, 9);
    expect(nextRedoLabel(undone.history)).toBe('Modifier la cote de largeur');

    const redone = redoAction(undone.history, undone.doc)!;
    expect(redone.doc).toBe(wider);
    expect(volumeOf(redone.doc)).toBeCloseTo(v80, 9);
    const width = redone.doc.parts[0]!.features[0]!;
    expect(width.type === 'sketch' && width.params.constraints.find((c) => c.id === ids.widthConstraint)).toMatchObject({ value: 80 });
    expect(redone.doc.parts[0]!.features.map((f) => f.id)).toEqual([ids.sketch1, ids.extrude, ids.sketch2, ids.pocket]);

    // Une nouvelle action efface la possibilité de rétablir.
    const after = recordAction(undone.history, undone.doc, 'Autre action');
    expect(after.future).toHaveLength(0);
    expect(undoAction(emptyHistory(), doc)).toBeNull();
  });
});
