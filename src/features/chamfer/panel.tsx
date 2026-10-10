/** Panneau des paramètres d'un chanfrein. */
import type { ChamferFeature } from '../../domain/model';
import { parseLength } from '../../domain/units';
import { LengthField } from '../../ui/components/controls';
import { EdgeSelectionField } from '../../ui/components/edge-fields';
import { PreviewStatus, withParams } from '../../ui/components/feature-fields';
import type { FeaturePanelProps } from '../panel-types';

export function ChamferPanel(props: FeaturePanelProps<ChamferFeature>) {
  const { draft, update, setField } = props;
  const f = draft.feature;
  return (
    <>
      <EdgeSelectionField edges={f.params.edges} verb="chanfreiner" onClear={() => update((x) => withParams(x, { edges: [] }))} />
      <LengthField
        id="draft-size"
        label="Longueur du chanfrein"
        value={draft.fields.size ?? ''}
        error={draft.errors.size ?? null}
        help="Longueur retirée de chaque côté de l’arête (biseau à 45°)."
        autoFocus
        selectOnFocus
        onInput={(text) => {
          const parsed = parseLength(text, { label: 'La longueur' });
          setField('size', text, parsed.ok ? { feature: withParams(f, { distance: parsed.value }) } : { error: parsed.error });
        }}
        onEnter={props.confirm}
        onEscape={props.cancel}
      />
      <PreviewStatus status={props.status} kind="modify" />
    </>
  );
}
