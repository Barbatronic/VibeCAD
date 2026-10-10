/** Champs des congés et chanfreins : arêtes choisies dans la vue 3D et dimension. */
import type { EdgeRef } from '../../domain/model';
import { Button, Callout } from './controls';

export function EdgeSelectionField(props: { edges: readonly EdgeRef[]; onClear: () => void; verb: string }) {
  const n = props.edges.length;
  return (
    <>
      <Callout kind="info">
        <p>
          Cliquez les arêtes à {props.verb} dans la vue 3D. Cliquez à nouveau une arête (ou la face {props.verb === 'arrondir' ? 'arrondie' : 'en biseau'})
          pour la retirer.
        </p>
      </Callout>
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
