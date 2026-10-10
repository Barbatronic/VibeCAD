import { describe, expect, it } from 'vitest';
import { currentAdvice } from '../../src/app/advice';
import { initialState, type AppState } from '../../src/app/state';
import { withRollbackAt } from '../../src/app/rollback';
import type { FeatureStatus } from '../../src/domain/status';
import type { PartResult } from '../../src/geometry/protocol';
import { buildPlateDocument } from '../helpers/plate';

const { doc } = buildPlateDocument();

function stateWith(statuses: FeatureStatus[] = [], patch: Partial<AppState> = {}): AppState {
  const part = doc.parts[0]!;
  const result = { partId: part.id, statuses, sketches: [], meshKey: null, mesh: null, analysis: null, failedFeatureId: null } as unknown as PartResult;
  return {
    ...initialState(),
    doc,
    activePartId: part.id,
    kernel: { status: 'ready' },
    display: { [part.id]: { result, mesh: null, meshKey: null, stale: false } },
    ...patch,
  };
}

describe('conseils du chat', () => {
  it('se tait quand tout va bien, et pendant le parcours guidé', () => {
    expect(currentAdvice(stateWith())).toBeNull();
    const err: FeatureStatus = { featureId: 'x', state: 'error', code: 'KERNEL_FAILURE' };
    expect(currentAdvice(stateWith([err], { tutorial: { id: 'plate', step: 0 } }))).toBeNull();
  });

  it('pièce vide : propose de commencer une esquisse', () => {
    const s = initialState();
    const advice = currentAdvice({ ...s, kernel: { status: 'ready' } });
    expect(advice).toMatchObject({ level: 'conseil', action: { kind: 'start-sketch' } });
  });

  it('support perdu : explique et propose de choisir un nouveau support', () => {
    const base = stateWith();
    const sketch2 = base.doc.parts[0]!.features[2]!;
    const advice = currentAdvice(stateWith([{ featureId: sketch2.id, state: 'error', code: 'SUPPORT_LOST' }]));
    expect(advice).toMatchObject({ level: 'erreur', mood: 'warning', action: { kind: 'repair-support', featureId: sketch2.id } });
    expect(advice!.text).toContain('choisis un nouveau support');
  });

  it('contour ouvert : renvoie vers l’esquisse en cause', () => {
    const base = stateWith();
    const [sketch1, extrude] = base.doc.parts[0]!.features;
    const advice = currentAdvice(stateWith([{ featureId: extrude!.id, state: 'error', code: 'PROFILE_OPEN', relatedFeatureId: sketch1!.id }]));
    expect(advice).toMatchObject({ action: { kind: 'edit-feature', featureId: sketch1!.id, label: 'Ouvrir « Esquisse 1 »' } });
    expect(advice!.text).toContain('relie les points');
  });

  it('frise en arrière : rappelle comment revenir à la fin', () => {
    const base = stateWith();
    const part = base.doc.parts[0]!;
    const advice = currentAdvice({ ...base, rollback: withRollbackAt({}, part, 2) });
    expect(advice).toMatchObject({ level: 'conseil', action: { kind: 'rollback-end', partId: part.id } });
  });
});
