/** Panneau des paramètres d'une extrusion. */
import type { ExtrudeFeature } from '../../domain/model';
import { parseLength } from '../../domain/units';
import { LengthField } from '../../ui/components/controls';
import { DirectionField, PreviewStatus, SketchSelect, withParams } from '../../ui/components/feature-fields';
import type { FeaturePanelProps } from '../panel-types';
import { EXTRUDE_DIRECTION_LABELS } from './definition';

export function ExtrudePanel(props: FeaturePanelProps<ExtrudeFeature>) {
  const { draft, update, setField } = props;
  const f = draft.feature;
  return (
    <>
      <SketchSelect value={f.params.sketchId} options={props.sketches} onChange={(sketchId) => update((x) => withParams(x, { sketchId }))} />
      <LengthField
        id="draft-distance"
        label="Longueur d’extrusion (épaisseur)"
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
      <DirectionField value={f.params.direction} labels={EXTRUDE_DIRECTION_LABELS} onChange={(direction) => update((x) => withParams(x, { direction }))} />
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
