/** Panneau des paramètres d'une extrusion. */
import type { ExtrudeFeature, PocketFeature } from '../../domain/model';
import { formatLength, parseLength, readNumber, MIN_POSITIVE } from '../../domain/units';
import { LengthField, Segmented } from '../../ui/components/controls';
import { DirectionField, PreviewStatus, SketchSelect, withParams } from '../../ui/components/feature-fields';
import { useAppState } from '../../ui/context';
import type { FeaturePanelProps } from '../panel-types';
import { EXTRUDE_DIRECTION_LABELS, validateOffset } from './definition';

export function ExtrudePanel(props: FeaturePanelProps<ExtrudeFeature>) {
  const { draft, update, setField } = props;
  const f = draft.feature;
  // « Jusqu'à une face » : outil du niveau Expert (toujours visible sur une extrusion qui l'utilise).
  const expert = useAppState((s) => s.level === 'expert');
  const picking = draft.fields.pick === 'upTo';
  const upTo = picking || !!f.params.upTo;
  return (
    <>
      <SketchSelect value={f.params.sketchId} options={props.sketches} onChange={(sketchId) => update((x) => withParams(x, { sketchId }))} />
      {expert || f.params.upTo ? (
        <Segmented<'length' | 'face'>
          label="Jusqu’où ?"
          value={upTo ? 'face' : 'length'}
          options={[
            { value: 'length', label: 'Une longueur', title: 'Extrusion d’une longueur donnée' },
            { value: 'face', label: 'Jusqu’à une face…', title: 'L’extrusion s’arrête sur le plan d’une face plane de la pièce, cliquée dans la vue 3D' },
          ]}
          onChange={(v) => {
            if (v === 'face') return setField('pick', 'upTo', { feature: f });
            const { upTo: _drop, ...params } = f.params;
            setField('pick', '', { feature: { ...f, params } });
          }}
        />
      ) : null}
      {upTo ? (
        picking ? (
          <span class="field-help">Sélectionnez la face d’arrivée</span>
        ) : (
          <span class="field-help">Face d’arrivée choisie</span>
        )
      ) : (
        <>
          <LengthField
            min={MIN_POSITIVE}
            id="draft-distance"
            label={f.params.direction === 'twoSides' ? 'Longueur côté normale' : 'Longueur d’extrusion (épaisseur)'}
            value={draft.fields.distance ?? ''}
            error={draft.errors.distance ?? null}
            autoFocus
            selectOnFocus
            onInput={(text) => {
              const parsed = parseLength(text, { label: 'La longueur' });
              setField('distance', text, parsed.ok ? { feature: withParams(f, { distance: parsed.value }) } : { error: parsed.error });
            }}
            onEnter={props.confirm}
            onEscape={props.cancel}
          />
          <DirectionField
            value={f.params.direction}
            labels={EXTRUDE_DIRECTION_LABELS}
            onChange={(direction) => {
              // Deux côtés : le côté opposé part de la même longueur, à modifier ensuite.
              if (direction === 'twoSides' && f.params.distance2 === undefined) {
                setField('distance2', formatLength(f.params.distance, 3, false), { feature: withParams(f, { direction, distance2: f.params.distance }) });
              } else update((x) => withParams(x, { direction }));
            }}
          />
          {f.params.direction === 'twoSides' ? (
            <LengthField
              min={MIN_POSITIVE}
              id="draft-distance2"
              label="Longueur du côté opposé"
              value={draft.fields.distance2 ?? ''}
              error={draft.errors.distance2 ?? null}
              selectOnFocus
              onInput={(text) => {
                const parsed = parseLength(text, { label: 'La longueur' });
                setField('distance2', text, parsed.ok ? { feature: withParams(f, { distance2: parsed.value }) } : { error: parsed.error });
              }}
              onEnter={props.confirm}
              onEscape={props.cancel}
            />
          ) : null}
        </>
      )}
      <PreviewStatus status={props.status} kind="add" />
      <OffsetField {...props} />
    </>
  );
}

/** « Réglages avancés » d'une extrusion ou d'une poche : décalage du départ (signé). */
export function OffsetField<F extends ExtrudeFeature | PocketFeature>(props: FeaturePanelProps<F>) {
  const { draft, setField } = props;
  const f = draft.feature;
  return (
    <details class="advanced" open={!!f.params.offset || !!draft.errors.offset}>
      <summary>Réglages avancés</summary>
      <LengthField
        id="draft-offset"
        label="Décalage du départ"
        value={draft.fields.offset ?? ''}
        error={draft.errors.offset ?? null}
        help="Le long de la normale de l’esquisse · négatif : côté opposé"
        selectOnFocus
        onInput={(text) => {
          const v = readNumber(text);
          const error = v === null ? 'Le décalage : saisissez un nombre.' : validateOffset(v);
          if (v === null || error) return setField('offset', text, { error: error! });
          const { offset: _drop, ...rest } = f.params;
          setField('offset', text, { feature: { ...f, params: v ? { ...rest, offset: v } : rest } as F });
        }}
        onEnter={props.confirm}
        onEscape={props.cancel}
      />
    </details>
  );
}
