/** Panneau « Bord plié » : bords choisis dans la vue, longueur du rebord, pli. */
import type { FlangeFeature } from '../../domain/model';
import { parseLength } from '../../domain/units';
import { BendFields } from '../../ui/components/bend-fields';
import { LengthField } from '../../ui/components/controls';
import { EdgeSelectionField } from '../../ui/components/edge-fields';
import { PreviewStatus, withParams } from '../../ui/components/feature-fields';
import type { FeaturePanelProps } from '../panel-types';

export function FlangePanel(props: FeaturePanelProps<FlangeFeature>) {
  const { draft, update, setField } = props;
  const f = draft.feature;
  return (
    <>
      <EdgeSelectionField edges={f.params.edges} verb="plier" onClear={() => update((x) => withParams(x, { edges: [] }))} />
      <LengthField
        id="draft-length"
        label="Longueur du rebord"
        value={draft.fields.length ?? ''}
        error={draft.errors.length ?? null}
        help="Partie droite après le pli. La tôle à plat est allongée d’autant, plus la matière de l’arrondi."
        autoFocus
        selectOnFocus
        onInput={(text) => {
          const parsed = parseLength(text, { label: 'La longueur' });
          setField('length', text, parsed.ok ? { feature: withParams(f, { length: parsed.value }) } : { error: parsed.error });
        }}
        onEnter={props.confirm}
        onEscape={props.cancel}
      />
      <BendFields {...props} />
      <PreviewStatus status={props.status} kind="add" />
    </>
  );
}
