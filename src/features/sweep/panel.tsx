/** Panneau d'un balayage : esquisse du profil, esquisse du chemin, matière. */
import type { SweepFeature } from '../../domain/model';
import { OperationField, PreviewStatus, withParams } from '../../ui/components/feature-fields';
import type { FeaturePanelProps } from '../panel-types';

export function SweepPanel(props: FeaturePanelProps<SweepFeature>) {
  const { draft, update } = props;
  const p = draft.feature.params;
  const own = props.part.features.findIndex((x) => x.id === draft.feature.id);
  const before = new Set(props.part.features.filter((x, i) => x.type === 'sketch' && (own < 0 || i < own)).map((x) => x.id));
  const options = props.sketches.filter((s) => before.has(s.id));
  const select = (id: string, label: string, value: string, onChange: (v: string) => void, help: string) => (
    <div class="field">
      <label class="field-label" for={id}>
        {label}
      </label>
      <select id={id} class="select" value={value} onChange={(e) => onChange((e.target as HTMLSelectElement).value)}>
        <option value="">— choisir —</option>
        {options.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
      <span class="field-help">{help}</span>
    </div>
  );
  return (
    <>
      {select('draft-profile', 'Profil (contour fermé)', p.profileId, (profileId) => update((x) => withParams(x, { profileId })), 'La forme de la section, dessinée au début du chemin et de préférence perpendiculaire à lui.')}
      {select('draft-path', 'Chemin', p.pathId, (pathId) => update((x) => withParams(x, { pathId })), 'Des segments et des arcs qui se suivent bout à bout (ou un cercle).')}
      <OperationField what="Le balayage" value={p.operation} onChange={(operation) => update((x) => withParams(x, { operation }))} />
      <PreviewStatus status={props.status} kind="modify" />
    </>
  );
}
