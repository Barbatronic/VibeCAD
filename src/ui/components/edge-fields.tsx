/** Champs des congés et chanfreins : arêtes choisies dans la vue 3D et dimension. */
import type { EdgeRef, Part } from '../../domain/model';
import { describeFaceRef } from '../../features/sketch/support';
import { useAppState, useController } from '../context';
import { Button, IconButton } from './controls';

export function EdgeSelectionField(props: { edges: readonly EdgeRef[]; onClear: () => void; onRemove?: (index: number) => void; part?: Part; verb: string; xray?: boolean }) {
  const c = useController();
  const xray = useAppState((s) => s.blendXray);
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
        {props.xray ? <span class="field-help">Cliquez une arête pour l’ajouter ou la retirer, ou une face pour toutes ses arêtes.</span> : null}
        {n > 0 && props.onRemove ? (
          <ol class="edge-list" id="draft-edge-list">
            {props.edges.map((e, i) => {
              const text = `${describeFaceRef(e.faces[0], props.part)} / ${describeFaceRef(e.faces[1], props.part)}`;
              return (
                <li key={i}>
                  <span class="edge-index">{i + 1}</span>
                  <span class="edge-text" title={text}>
                    {text}
                  </span>
                  <IconButton icon="close" small label={`Retirer l’arête ${i + 1}`} onClick={() => props.onRemove!(i)} />
                </li>
              );
            })}
          </ol>
        ) : null}
      </div>
      {props.xray ? (
        <label class="checkbox-row">
          <input id="draft-xray" type="checkbox" checked={xray} onChange={() => c.setBlendXray(!xray)} />
          <span>Montrer les arêtes cachées (cliquables à travers la pièce)</span>
        </label>
      ) : null}
    </>
  );
}
