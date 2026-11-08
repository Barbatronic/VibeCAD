/** Panneau des paramètres d'une gravure. */
import type { EngraveFeature } from '../../domain/model';
import { parseLength } from '../../domain/units';
import { LengthField, Segmented } from '../../ui/components/controls';
import { PreviewStatus, SketchSelect, withParams } from '../../ui/components/feature-fields';
import { STARTER_MATERIALS, type MaterialSheet } from '../../domain/material-sheets';
import { useAppState } from '../../ui/context';
import type { FeaturePanelProps } from '../panel-types';
import { MAX_ENGRAVE_DEPTH } from './definition';

export function EngravePanel(props: FeaturePanelProps<EngraveFeature>) {
  const { draft, update, setField } = props;
  const f = draft.feature;
  // Impression 3D : la zone gravée peut prendre une autre matière (couleur), du projet ou d'un catalogue.
  const colors = useAppState(
    (s) => {
      const project = (s.doc.materials ?? []).filter((m) => m.process === 'print');
      const known = new Set(project.map((m) => m.id));
      const others = [...s.materialCatalogue, ...STARTER_MATERIALS].filter((m) => m.process === 'print' && !known.has(m.id));
      const printed = s.doc.materials?.find((m) => m.id === props.part.make)?.process === 'print';
      return { project, others, printed };
    },
    (a, b) => JSON.stringify(a) === JSON.stringify(b),
  );
  const option = (m: MaterialSheet) => (
    <option key={m.id} value={m.id}>
      {m.name}
    </option>
  );
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
        help="0 : marquage en surface, sans enlever de matière. Plus : le dessin est aussi creusé."
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
      <p class="field-help">En découpe laser, ce dessin est gravé au lieu d’être découpé : en surface pleine (remplissage) ou en trait (contour).</p>
      {colors.printed ? (
        <label class="field">
          <span class="field-label">Couleur en impression 3D</span>
          <select
            id="draft-engrave-material"
            class="select"
            value={f.params.material ?? ''}
            onChange={(e) => {
              const material = (e.target as HTMLSelectElement).value;
              update((x) => {
                const { material: _old, ...rest } = x.params;
                return { ...x, params: material ? { ...rest, material } : rest };
              });
            }}
          >
            <option value="">Celle de la pièce</option>
            {colors.project.length ? <optgroup label="Dans ce projet">{colors.project.map(option)}</optgroup> : null}
            <optgroup label="Catalogue">{colors.others.map(option)}</optgroup>
          </select>
          <span class="field-help">
            {f.params.material && f.params.depth <= 0
              ? 'Pour que l’imprimante change de couleur, donnez une profondeur (0,4 mm par exemple) : le fond et les parois du creux prennent la couleur.'
              : 'Le fond et les parois du creux prennent cette matière ; elle a sa place dans l’AMS.'}
          </span>
        </label>
      ) : null}
      <PreviewStatus status={props.status} kind="cut" />
    </>
  );
}
