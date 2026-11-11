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
      <EdgeSelectionField
        edges={f.params.edges}
        part={props.part}
        verb="arrondir"
        xray
        onClear={() => update((x) => withParams(x, { edges: [] }))}
        onRemove={(i) => update((x) => withParams(x, { edges: x.params.edges.filter((_e, k) => k !== i) }))}
      />
      <LengthField
        id="draft-size"
        label="Rayon du congé"
        value={draft.fields.size ?? ''}
        error={draft.errors.size ?? null}
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
