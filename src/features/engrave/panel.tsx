/** Panneau des paramètres d'une gravure. */
import type { EngraveFeature } from '../../domain/model';
import { parseLength } from '../../domain/units';
import { LengthField, Segmented } from '../../ui/components/controls';
import { PreviewStatus, SketchSelect, withParams } from '../../ui/components/feature-fields';
import { useAppState } from '../../ui/context';
import type { FeaturePanelProps } from '../panel-types';
import { MAX_ENGRAVE_DEPTH } from './definition';

export function EngravePanel(props: FeaturePanelProps<EngraveFeature>) {
  const { draft, update, setField } = props;
  const f = draft.feature;
  const printed = useAppState((s) => s.doc.materials?.find((m) => m.id === props.part.make)?.process === 'print');
  return (
    <>
      <SketchSelect value={f.params.sketchId} options={props.sketches} onChange={(sketchId) => update((x) => withParams(x, { sketchId }))} />
      <Segmented
        label="Gravure"
        value={f.params.mode ?? 'outline'}
        options={[
          { value: 'fill', label: 'Remplissage', title: 'Le laser balaie toute la surface du dessin (texte plein, motif).' },
          { value: 'outline', label: 'Contour', title: 'Le laser suit seulement le trait du dessin.' },
        ]}
        onChange={(mode) => update((x) => withParams(x, { mode }))}
      />
      <LengthField
        id="draft-depth"
        label="Profondeur"
        value={draft.fields.depth ?? ''}
        error={draft.errors.depth ?? null}
        help="0 : marquage en surface"
        min={0}
        autoFocus
        selectOnFocus
        onInput={(text) => {
          const parsed = parseLength(text, { label: 'La profondeur', min: 0, max: MAX_ENGRAVE_DEPTH });
          setField('depth', text, parsed.ok ? { feature: withParams(f, { depth: parsed.value }) } : { error: parsed.error });
        }}
        onEnter={props.confirm}
        onEscape={props.cancel}
      />
      {printed ? <p class="field-help">Couleurs : pinceau de Fabrication › Matières</p> : null}
      <PreviewStatus status={props.status} kind="cut" />
    </>
  );
}
