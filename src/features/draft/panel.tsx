/** Panneau d'une dépouille : faces à incliner (cliquées dans la vue 3D), angle et plan neutre. */
import type { DraftFeature, PlaneName } from '../../domain/model';
import { readNumber } from '../../domain/units';
import { Button, Callout, LengthField, Segmented } from '../../ui/components/controls';
import { DatumPlaneSelect, datumPlanesBefore, PreviewStatus, withParams } from '../../ui/components/feature-fields';
import type { FeaturePanelProps } from '../panel-types';
import { validateDraftAngle } from './definition';

type NeutralChoice = PlaneName | 'face' | 'datum';

export function DraftPanel(props: FeaturePanelProps<DraftFeature>) {
  const { draft, update, setField } = props;
  const f = draft.feature;
  const p = f.params;
  const n = p.faces.length;
  const picking = draft.fields.pick === 'neutral';
  const datums = datumPlanesBefore(props.part, f.id);
  const neutral: NeutralChoice = picking || p.neutral.kind === 'face' ? 'face' : p.neutral.kind === 'datum' ? 'datum' : p.neutral.plane;
  return (
    <>
      {picking ? (
        <Callout kind="info">
          <p>Cliquez dans la vue 3D la face plane qui servira de plan neutre (souvent le dessous de la pièce) : là, les côtés ne bougent pas.</p>
        </Callout>
      ) : (
        <Callout kind="info">
          <p>Cliquez dans la vue 3D les côtés à incliner. Cliquez-les à nouveau pour les retirer.</p>
        </Callout>
      )}
      <div class="field">
        <span class="field-label">Faces inclinées</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <strong aria-live="polite">{n === 0 ? 'aucune pour l’instant' : `${n} face${n > 1 ? 's' : ''}`}</strong>
          {n > 0 ? (
            <Button small icon="trash" onClick={() => update((x) => withParams(x, { faces: [] }))}>
              Tout retirer
            </Button>
          ) : null}
        </div>
      </div>
      <LengthField
        id="draft-angle"
        label="Angle"
        unit="°"
        value={draft.fields.angle ?? ''}
        error={draft.errors.angle ?? null}
        help="Quelques degrés suffisent (1 à 5°)."
        selectOnFocus
        onInput={(text) => {
          const v = readNumber(text);
          const err = v === null ? 'L’angle doit être un nombre de degrés.' : validateDraftAngle(v);
          setField('angle', text, err ? { error: err } : { feature: withParams(f, { angle: v! }) });
        }}
        onEnter={props.confirm}
        onEscape={props.cancel}
      />
      <Segmented<NeutralChoice>
        label="Plan neutre (les côtés n’y bougent pas)"
        value={neutral}
        options={[
          { value: 'XY', label: 'XY', title: 'Plan XY (le plateau) : la pièce rétrécit vers le haut' },
          { value: 'XZ', label: 'XZ', title: 'Plan XZ : la pièce rétrécit vers l’arrière (Y+)' },
          { value: 'YZ', label: 'YZ', title: 'Plan YZ : la pièce rétrécit vers la droite (X+)' },
          { value: 'face', label: 'Face…', title: 'Une face plane de la pièce, cliquée dans la vue 3D : la pièce rétrécit en s’en éloignant' },
          ...(datums.length ? [{ value: 'datum', label: 'Plan…', title: 'Un plan de construction (outil « Plan »)' } as const] : []),
        ]}
        onChange={(v) =>
          v === 'face'
            ? setField('pick', 'neutral', { feature: f })
            : setField('pick', '', { feature: withParams(f, { neutral: v === 'datum' ? { kind: 'datum', featureId: datums[datums.length - 1]!.id } : { kind: 'plane', plane: v } }) })
        }
      />
      {p.neutral.kind === 'datum' && !picking ? (
        <DatumPlaneSelect planes={datums} value={p.neutral.featureId} onChange={(featureId) => update((x) => withParams(x, { neutral: { kind: 'datum', featureId } }))} />
      ) : null}
      <label class="checkbox-row">
        <input type="checkbox" checked={p.reversed} onChange={() => update((x) => withParams(x, { reversed: !x.params.reversed }))} />
        <span>Inverser (la pièce s’élargit en s’éloignant du plan neutre)</span>
      </label>
      <PreviewStatus status={props.status} kind="modify" />
    </>
  );
}
