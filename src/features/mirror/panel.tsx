/** Panneau des paramètres d'une symétrie. */
import { mirrorSources, PATTERN_SOURCE_TYPES } from '../../domain/document';
import type { MirrorFeature, PlaneName } from '../../domain/model';
import { Segmented } from '../../ui/components/controls';
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
  const chosen = new Set(mirrorSources(p));
  /** Coche ou décoche une étape ; les étapes gardent l'ordre de l'historique. */
  const toggleSource = (id: string) =>
    update((x) => {
      const now = new Set(mirrorSources(x.params));
      if (now.has(id)) now.delete(id);
      else now.add(id);
      const ordered = steps.map((s) => s.id).filter((s) => now.has(s));
      if (ordered.length === 0) return x;
      const [featureId, ...extra] = ordered;
      return withParams(x, { source: { kind: 'feature', featureId: featureId!, ...(extra.length ? { extraFeatureIds: extra } : {}) } });
    });
  const plane: PlaneChoice = picking || p.plane.kind === 'face' ? 'face' : p.plane.kind === 'datum' ? 'datum' : p.plane.plane;
  return (
    <>
      <Segmented<'part' | 'feature'>
        label="Copier"
        value={p.source.kind}
        options={[
          { value: 'part', label: 'Toute la pièce', title: 'Le reflet de toute la pièce est ajouté' },
          { value: 'feature', label: 'Des étapes', title: 'Seuls les volumes ajoutés ou retirés par les étapes cochées (trous, plots…) sont reproduits' },
        ]}
        onChange={(kind) =>
          update((x) => withParams(x, { source: kind === 'part' ? { kind: 'part' } : { kind: 'feature', featureId: steps[steps.length - 1]?.id ?? '' } }))
        }
      />
      {p.source.kind === 'feature' ? (
        <fieldset class="field pattern-sources">
          <legend class="field-label">Étapes à reproduire</legend>
          {steps.length === 0 ? <span class="field-help">Aucune extrusion, poche ou révolution avant</span> : null}
          {steps.map((s) => (
            <label key={s.id} class="checkbox-row">
              <input
                type="checkbox"
                checked={chosen.has(s.id)}
                // La dernière étape cochée reste cochée : la symétrie reproduit au moins une étape.
                disabled={chosen.has(s.id) && chosen.size === 1}
                onChange={() => toggleSource(s.id)}
              />
              <span>{s.name}</span>
            </label>
          ))}
        </fieldset>
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
        <span class="field-help">Sélectionnez une face plane</span>
      ) : p.plane.kind === 'face' ? (
        <span class="field-help">Face choisie</span>
      ) : null}
      <PreviewStatus status={props.status} kind="modify" />
    </>
  );
}
