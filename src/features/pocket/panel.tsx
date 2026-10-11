/** Panneau des paramètres d'une poche (enlèvement de matière). */
import type { PocketFeature } from '../../domain/model';
import { formatLength, parseLength } from '../../domain/units';
import { LengthField, Segmented } from '../../ui/components/controls';
import { DirectionField, PreviewStatus, SketchSelect, withParams } from '../../ui/components/feature-fields';
import type { FeaturePanelProps } from '../panel-types';
import { POCKET_DIRECTION_LABELS } from './definition';

export function PocketPanel(props: FeaturePanelProps<PocketFeature>) {
  const { draft, update, setField } = props;
  const f = draft.feature;
  const through = f.params.extent.kind === 'throughAll';
  const setExtent = (kind: 'throughAll' | 'distance') => {
    if (kind === 'throughAll') return update((x) => withParams(x, { extent: { kind } }));
    const parsed = parseLength(draft.fields.distance ?? '', { label: 'La profondeur' });
    update((x) => withParams(x, { extent: { kind, distance: parsed.ok ? parsed.value : 5 } }));
  };
  return (
    <>
      <SketchSelect value={f.params.sketchId} options={props.sketches} onChange={(sketchId) => update((x) => withParams(x, { sketchId }))} />
      <Segmented
        label={f.params.direction === 'twoSides' ? 'Profondeur dans la matière' : 'Profondeur'}
        value={f.params.extent.kind}
        options={[
          { value: 'throughAll', label: 'Traversante', title: 'Perce toute la pièce' },
          { value: 'distance', label: 'Cotée', title: 'Profondeur donnée en mm' },
        ]}
        onChange={setExtent}
      />
      {through ? (
        <p class="field-help">« Traversante » : la poche traverse toute la pièce, quelle que soit son épaisseur. Idéal pour un perçage.</p>
      ) : (
        <LengthField
          id="draft-distance"
          label={f.params.direction === 'twoSides' ? 'Profondeur dans la matière' : 'Profondeur de la poche'}
          value={draft.fields.distance ?? ''}
          error={draft.errors.distance ?? null}
          help="Profondeur de matière retirée."
          autoFocus
          selectOnFocus
          onInput={(text) => {
            const parsed = parseLength(text, { label: 'La profondeur' });
            setField(
              'distance',
              text,
              parsed.ok ? { feature: withParams(f, { extent: { kind: 'distance', distance: parsed.value } }) } : { error: parsed.error },
            );
          }}
          onEnter={props.confirm}
          onEscape={props.cancel}
        />
      )}
      <DirectionField
        value={f.params.direction}
        labels={POCKET_DIRECTION_LABELS}
        onChange={(direction) => {
          // Deux côtés : le second côté part de la même profondeur, à modifier ensuite.
          if (direction === 'twoSides' && !f.params.extent2) {
            const extent2 = f.params.extent;
            setField('distance2', extent2.kind === 'distance' ? formatLength(extent2.distance, 3, false) : '5', { feature: withParams(f, { direction, extent2 }) });
          } else update((x) => withParams(x, { direction }));
        }}
      />
      {f.params.direction === 'twoSides' && f.params.extent2 ? (
        <>
          <Segmented
            label="Profondeur de l’autre côté"
            value={f.params.extent2.kind}
            options={[
              { value: 'throughAll', label: 'Traversante', title: 'Perce toute la pièce de ce côté' },
              { value: 'distance', label: 'Cotée', title: 'Profondeur donnée en mm' },
            ]}
            onChange={(kind) => {
              if (kind === 'throughAll') return update((x) => withParams(x, { extent2: { kind } }));
              const parsed = parseLength(draft.fields.distance2 ?? '', { label: 'La profondeur' });
              update((x) => withParams(x, { extent2: { kind, distance: parsed.ok ? parsed.value : 5 } }));
            }}
          />
          {f.params.extent2.kind === 'distance' ? (
            <LengthField
              id="draft-distance2"
              label="Profondeur de l’autre côté"
              value={draft.fields.distance2 ?? ''}
              error={draft.errors.distance2 ?? null}
              help="Matière retirée de l’autre côté du plan de l’esquisse."
              selectOnFocus
              onInput={(text) => {
                const parsed = parseLength(text, { label: 'La profondeur' });
                setField('distance2', text, parsed.ok ? { feature: withParams(f, { extent2: { kind: 'distance', distance: parsed.value } }) } : { error: parsed.error });
              }}
              onEnter={props.confirm}
              onEscape={props.cancel}
            />
          ) : null}
        </>
      ) : null}
      <PreviewStatus status={props.status} kind="cut" />
      <details class="advanced">
        <summary>Réglages avancés</summary>
        <p class="field-help">
          Par défaut, la poche part de l’esquisse et entre « dans la matière ». « Côté opposé » inverse le sens ; « Symétrique » retire la même
          profondeur des deux côtés du plan de l’esquisse ; « Deux côtés » retire une profondeur différente de chaque côté.
        </p>
      </details>
    </>
  );
}
