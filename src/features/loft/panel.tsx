/** Panneau d'un lissage : esquisses reliées (dans l'ordre de l'historique), raccords, matière. */
import type { LoftFeature } from '../../domain/model';
import { Segmented } from '../../ui/components/controls';
import { PreviewStatus, withParams } from '../../ui/components/feature-fields';
import type { FeaturePanelProps } from '../panel-types';

export function LoftPanel(props: FeaturePanelProps<LoftFeature>) {
  const { draft, update } = props;
  const f = draft.feature;
  const p = f.params;
  const own = props.part.features.findIndex((x) => x.id === f.id);
  const order = props.part.features.filter((x, i) => x.type === 'sketch' && (own < 0 || i < own)).map((x) => x.id);
  const toggle = (id: string) => {
    const set = new Set(p.sketchIds);
    if (set.has(id)) set.delete(id);
    else set.add(id);
    // Les contours sont reliés dans l'ordre de l'historique.
    update((x) => withParams(x, { sketchIds: order.filter((s) => set.has(s)) }));
  };
  return (
    <>
      <fieldset class="field" style={{ border: 'none', padding: 0, margin: 0 }}>
        <legend class="field-label">Contours à relier (au moins deux)</legend>
        {props.sketches
          .filter((s) => order.includes(s.id))
          .map((s) => (
            <label class="checkbox-row" key={s.id}>
              <input type="checkbox" checked={p.sketchIds.includes(s.id)} onChange={() => toggle(s.id)} />
              <span>
                {s.name}
                {s.closed === false ? <span class="field-help"> — contour ouvert</span> : null}
              </span>
            </label>
          ))}
        <span class="field-help">Chaque esquisse : un seul contour fermé, sur un plan différent. Ils sont reliés dans l’ordre de l’historique.</span>
      </fieldset>
      <label class="checkbox-row">
        <input type="checkbox" checked={p.ruled} onChange={() => update((x) => withParams(x, { ruled: !x.params.ruled }))} />
        <span>Raccords droits (faces planes entre les contours)</span>
      </label>
      <Segmented<'add' | 'cut'>
        label="Matière"
        value={p.operation}
        options={[
          { value: 'add', label: 'Ajouter', title: 'Le lissage ajoute de la matière' },
          { value: 'cut', label: 'Creuser', title: 'Le lissage retire de la matière' },
        ]}
        onChange={(operation) => update((x) => withParams(x, { operation }))}
      />
      <PreviewStatus status={props.status} kind="modify" />
    </>
  );
}
