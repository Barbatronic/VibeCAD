/** Panneau des paramètres d'une extrusion. */
import type { ExtrudeFeature } from '../../domain/model';
import { formatLength, parseLength } from '../../domain/units';
import { Callout, LengthField, Segmented } from '../../ui/components/controls';
import { DirectionField, PreviewStatus, SketchSelect, withParams } from '../../ui/components/feature-fields';
import { useAppState } from '../../ui/context';
import type { FeaturePanelProps } from '../panel-types';
import { EXTRUDE_DIRECTION_LABELS } from './definition';

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
          <Callout kind="info">
            <p>Cliquez dans la vue 3D une face plane de la pièce : l’extrusion s’arrêtera sur son plan, même s’il est incliné.</p>
          </Callout>
        ) : (
          <span class="field-help">Face d’arrivée choisie dans la vue 3D. Cliquez « Jusqu’à une face… » pour en prendre une autre.</span>
        )
      ) : (
        <>
          <LengthField
            id="draft-distance"
            label={f.params.direction === 'twoSides' ? 'Longueur côté normale' : 'Longueur d’extrusion (épaisseur)'}
            value={draft.fields.distance ?? ''}
            error={draft.errors.distance ?? null}
            help="Épaisseur donnée au dessin, par exemple 5."
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
              id="draft-distance2"
              label="Longueur du côté opposé"
              value={draft.fields.distance2 ?? ''}
              error={draft.errors.distance2 ?? null}
              help="Matière ajoutée de l’autre côté du plan de l’esquisse."
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
      <details class="advanced">
        <summary>Réglages avancés</summary>
        <p class="field-help">
          La normale de l’esquisse est la direction perpendiculaire à son plan (vers l’extérieur d’une face). « Côté opposé » inverse le sens ;
          « Symétrique » répartit l’épaisseur de part et d’autre du plan.
        </p>
      </details>
    </>
  );
}
