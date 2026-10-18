/** Panneau « Pli » : trait de pli (esquisse), côté qui se plie, pli. */
import type { FoldFeature } from '../../domain/model';
import { BendFields } from '../../ui/components/bend-fields';
import { Segmented } from '../../ui/components/controls';
import { PreviewStatus, SketchSelect, withParams } from '../../ui/components/feature-fields';
import type { FeaturePanelProps } from '../panel-types';

export function FoldPanel(props: FeaturePanelProps<FoldFeature>) {
  const { update } = props;
  const f = props.draft.feature;
  return (
    <>
      <SketchSelect value={f.params.sketchId} options={props.sketches} onChange={(sketchId) => update((x) => withParams(x, { sketchId }))} />
      <span class="field-help">Le premier trait de l’esquisse, dessiné sur la tôle, est la ligne de pli.</span>
      <Segmented<'left' | 'right'>
        label="Côté qui se plie"
        value={f.params.side}
        options={[
          { value: 'left', label: 'À gauche du trait', title: 'En allant du premier au second point du trait' },
          { value: 'right', label: 'À droite du trait', title: 'En allant du premier au second point du trait' },
        ]}
        onChange={(side) => update((x) => withParams(x, { side }))}
      />
      <BendFields {...props} autoFocusAngle />
      <PreviewStatus status={props.status} kind="modify" />
    </>
  );
}
