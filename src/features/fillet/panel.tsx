/** Panneau des paramètres d'un congé. */
import type { FilletFeature } from '../../domain/model';
import { parseLength } from '../../domain/units';
import { LengthField } from '../../ui/components/controls';
import { EdgeSelectionField } from '../../ui/components/edge-fields';
import { PreviewStatus, withParams } from '../../ui/components/feature-fields';
import type { FeaturePanelProps } from '../panel-types';

export function FilletPanel(props: FeaturePanelProps<FilletFeature>) {
  const { draft, update, setField } = props;
  const f = draft.feature;
  return (
    <>
      <EdgeSelectionField edges={f.params.edges} verb="arrondir" onClear={() => update((x) => withParams(x, { edges: [] }))} />
      <LengthField
        id="draft-size"
        label="Rayon du congé"
        value={draft.fields.size ?? ''}
        error={draft.errors.size ?? null}
        help="Plus le rayon est grand, plus l’arrondi est large. Il doit rester plus petit que l’épaisseur."
        autoFocus
        selectOnFocus
        onInput={(text) => {
          const parsed = parseLength(text, { label: 'Le rayon' });
          setField('size', text, parsed.ok ? { feature: withParams(f, { radius: parsed.value }) } : { error: parsed.error });
        }}
        onEnter={props.confirm}
        onEscape={props.cancel}
      />
      <PreviewStatus status={props.status} kind="modify" />
    </>
  );
}
