/** Champs des congés et chanfreins : arêtes choisies dans la vue 3D et dimension. */
import type { EdgeRef } from '../../domain/model';
import { Button } from './controls';

export function EdgeSelectionField(props: { edges: readonly EdgeRef[]; onClear: () => void; verb: string }) {
  const n = props.edges.length;
  return (
    <>
      <div class="field">
        <span class="field-label">Arêtes choisies</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <strong aria-live="polite">{n === 0 ? 'aucune' : `${n} arête${n > 1 ? 's' : ''}`}</strong>
          {n > 0 ? (
            <Button small icon="trash" onClick={props.onClear}>
              Tout retirer
            </Button>
          ) : null}
        </div>
      </div>
    </>
  );
}
