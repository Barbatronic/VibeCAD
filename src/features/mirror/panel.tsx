/** Panneau des paramètres d'une symétrie. */
import { PATTERN_SOURCE_TYPES } from '../../domain/document';
import type { MirrorFeature, PlaneName } from '../../domain/model';
import { Callout, Segmented } from '../../ui/components/controls';
import { DatumPlaneSelect, datumPlanesBefore, PreviewStatus, withParams } from '../../ui/components/feature-fields';
import type { FeaturePanelProps } from '../panel-types';

type PlaneChoice = PlaneName | 'face' | 'datum';

export function MirrorPanel(props: FeaturePanelProps<MirrorFeature>) {
  const { draft, update, setField } = props;
  const f = draft.feature;
  const p = f.params;
  const own = props.part.features.findIndex((x) => x.id === f.id);
  const steps = props.part.features.filter((x, i) => PATTERN_SOURCE_TYPES.includes(x.type) && (own < 0 || i < own));
  const picking = draft.fields.pick === 'plane';
  const datums = datumPlanesBefore(props.part, f.id);
  const plane: PlaneChoice = picking || p.plane.kind === 'face' ? 'face' : p.plane.kind === 'datum' ? 'datum' : p.plane.plane;
  return (
    <>
      <Segmented<'part' | 'feature'>
        label="Copier"
        value={p.source.kind}
        options={[
          { value: 'part', label: 'Toute la pièce', title: 'Le reflet de toute la pièce est ajouté' },
          { value: 'feature', label: 'Une étape', title: 'Seul le volume ajouté ou retiré par une étape (un trou, un plot…) est reproduit' },
        ]}
        onChange={(kind) =>
          update((x) => withParams(x, { source: kind === 'part' ? { kind: 'part' } : { kind: 'feature', featureId: steps[steps.length - 1]?.id ?? '' } }))
        }
      />
      {p.source.kind === 'feature' ? (
        <div class="field">
          <label class="field-label" for="draft-source">
            Étape à reproduire
          </label>
          <select
            id="draft-source"
            class="select"
            value={p.source.featureId}
            onChange={(e) => update((x) => withParams(x, { source: { kind: 'feature', featureId: (e.target as HTMLSelectElement).value } }))}
          >
            {steps.length === 0 ? <option value="">Aucune extrusion, poche ou révolution avant</option> : null}
            {steps.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      <Segmented<PlaneChoice>
        label="Plan de symétrie (le miroir)"
        value={plane}
        options={[
          { value: 'YZ', label: 'YZ', title: 'Plan YZ : reflet de gauche à droite (selon X)' },
          { value: 'XZ', label: 'XZ', title: 'Plan XZ : reflet d’avant en arrière (selon Y)' },
          { value: 'XY', label: 'XY', title: 'Plan XY : reflet de haut en bas (selon Z)' },
          { value: 'face', label: 'Face…', title: 'Une face plane de la pièce, cliquée dans la vue 3D' },
          ...(datums.length ? [{ value: 'datum', label: 'Plan…', title: 'Un plan de construction (outil « Plan »)' } as const] : []),
        ]}
        onChange={(v) =>
          v === 'face'
            ? setField('pick', 'plane', { feature: f })
            : setField('pick', '', { feature: withParams(f, { plane: v === 'datum' ? { kind: 'datum', featureId: datums[datums.length - 1]!.id } : { kind: 'plane', plane: v } }) })
        }
      />
      {p.plane.kind === 'datum' && !picking ? (
        <DatumPlaneSelect planes={datums} value={p.plane.featureId} onChange={(featureId) => update((x) => withParams(x, { plane: { kind: 'datum', featureId } }))} />
      ) : null}
      {picking ? (
        <Callout kind="info">
          <p>Cliquez dans la vue 3D une face plane de la pièce : le reflet apparaît de l’autre côté de cette face.</p>
        </Callout>
      ) : p.plane.kind === 'face' ? (
        <span class="field-help">Face choisie dans la vue 3D. Cliquez « Face… » pour en prendre une autre.</span>
      ) : null}
      <PreviewStatus status={props.status} kind="modify" />
    </>
  );
}
