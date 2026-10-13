/** Panneau d'un axe de construction : par un point le long de X, Y ou Z, ou repris d'une arête. */
import type { AxisFeature } from '../../domain/model';
import { readNumber } from '../../domain/units';
import { Callout, LengthField, Segmented } from '../../ui/components/controls';
import { PreviewStatus, withParams } from '../../ui/components/feature-fields';
import type { FeaturePanelProps } from '../panel-types';

export function AxisPanel(props: FeaturePanelProps<AxisFeature>) {
  const { draft, update, setField } = props;
  const f = draft.feature;
  const p = f.params;
  const coordinate = (axis: 'x' | 'y' | 'z') => (
    <LengthField
      key={axis}
      id={`draft-pos-${axis}`}
      label={axis.toUpperCase()}
      value={draft.fields[axis] ?? ''}
      error={draft.errors[axis] ?? null}
      onInput={(text) => {
        const v = readNumber(text);
        if (v === null) return setField(axis, text, { error: 'La position doit être un nombre de millimètres.' });
        setField(axis, text, { feature: withParams(f, { position: { ...p.position, [axis]: v } }) });
      }}
      onEnter={props.confirm}
      onEscape={props.cancel}
    />
  );
  return (
    <>
      <Segmented<'line' | 'edge'>
        label="Axe"
        value={p.kind}
        options={[
          { value: 'line', label: 'Par un point', title: 'Une droite parallèle à X, Y ou Z, passant par le point donné' },
          { value: 'edge', label: 'Arête…', title: 'Une arête droite, ou l’axe du bord d’un trou, cliqué dans la vue 3D' },
        ]}
        onChange={(kind) => update((x) => withParams(x, { kind }))}
      />
      {p.kind === 'line' ? (
        <>
          <Segmented<'X' | 'Y' | 'Z'>
            label="Direction"
            value={p.direction}
            options={[
              { value: 'X', label: 'X', title: 'Parallèle à l’axe X (rouge)' },
              { value: 'Y', label: 'Y', title: 'Parallèle à l’axe Y (vert)' },
              { value: 'Z', label: 'Z', title: 'Parallèle à l’axe Z (bleu)' },
            ]}
            onChange={(direction) => update((x) => withParams(x, { direction }))}
          />
          <div class="field">
            <span class="field-label">Point de passage (mm)</span>
            <div class="limits-row three">{(['x', 'y', 'z'] as const).map(coordinate)}</div>
          </div>
        </>
      ) : p.edge ? (
        <span class="field-help">Arête choisie dans la vue 3D. Cliquez une autre arête pour la remplacer.</span>
      ) : (
        <Callout kind="info">
          <p>Cliquez dans la vue 3D une arête droite, ou le bord rond d’un trou pour prendre son axe.</p>
        </Callout>
      )}
      <p class="field-help">L’axe ne change pas la pièce : il sert ensuite d’axe à une « Répétition » en cercle ou de charnière à un « Plan » incliné.</p>
      <PreviewStatus status={props.status} kind="modify" />
    </>
  );
}
