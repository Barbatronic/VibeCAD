/** Panneau « Épaissir » : grossir ou amincir toute la pièce, coins arrondis ou vifs. */
import type { ThickenFeature } from '../../domain/model';
import { parseLength } from '../../domain/units';
import { LengthField, Segmented } from '../../ui/components/controls';
import { PreviewStatus, withParams } from '../../ui/components/feature-fields';
import type { FeaturePanelProps } from '../panel-types';
import { validateThicken } from './definition';

export function ThickenPanel(props: FeaturePanelProps<ThickenFeature>) {
  const { draft, update, setField } = props;
  const f = draft.feature;
  const p = f.params;
  const sign = p.distance < 0 ? -1 : 1;
  return (
    <>
      <Segmented<'grow' | 'shrink'>
        label="Sens"
        value={sign > 0 ? 'grow' : 'shrink'}
        options={[
          { value: 'grow', label: 'Grossir', title: 'Toutes les faces avancent vers l’extérieur : la pièce grossit (les trous rétrécissent)' },
          { value: 'shrink', label: 'Amincir', title: 'Toutes les faces reculent vers l’intérieur : la pièce maigrit (les trous s’agrandissent), pour laisser du jeu' },
        ]}
        onChange={(v) => update((x) => withParams(x, { distance: Math.abs(x.params.distance) * (v === 'grow' ? 1 : -1) }))}
      />
      <LengthField
        id="draft-distance"
        label="Épaisseur"
        value={draft.fields.distance ?? ''}
        error={draft.errors.distance ?? null}
        help="Pour du jeu en impression 3D : 0,2 à 0,3 mm suffisent."
        autoFocus
        selectOnFocus
        onInput={(text) => {
          const parsed = parseLength(text, { label: 'L’épaisseur' });
          const err = parsed.ok ? validateThicken(parsed.value) : parsed.error;
          setField('distance', text, err ? { error: err } : { feature: withParams(f, { distance: (parsed as { value: number }).value * sign }) });
        }}
        onEnter={props.confirm}
        onEscape={props.cancel}
      />
      <Segmented<'round' | 'sharp'>
        label="Coins"
        value={p.corners}
        options={[
          { value: 'round', label: 'Arrondis', title: 'Distance exacte partout : les coins sortants s’arrondissent' },
          { value: 'sharp', label: 'Vifs', title: 'Les faces sont prolongées jusqu’à se rejoindre : coins pointus' },
        ]}
        onChange={(corners) => update((x) => withParams(x, { corners }))}
      />
      <PreviewStatus status={props.status} kind="modify" />
    </>
  );
}
