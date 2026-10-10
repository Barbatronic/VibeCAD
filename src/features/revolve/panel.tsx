/** Panneau des paramètres d'une révolution. */
import type { RevolveAxis, RevolveFeature, SketchFeature } from '../../domain/model';
import { readNumber } from '../../domain/units';
import { LengthField } from '../../ui/components/controls';
import { PreviewStatus, SketchSelect, withParams } from '../../ui/components/feature-fields';
import type { FeaturePanelProps } from '../panel-types';
import { validateRevolveAngle } from './definition';

const axisKey = (a: RevolveAxis) => (a.kind === 'line' ? `line:${a.lineId}` : a.kind);

export function RevolvePanel(props: FeaturePanelProps<RevolveFeature>) {
  const { draft, update, setField } = props;
  const f = draft.feature;
  const sketch = props.part.features.find((x): x is SketchFeature => x.id === f.params.sketchId && x.type === 'sketch');
  // Les segments de l'esquisse peuvent servir d'axe (en priorité les traits de construction).
  const lines = (sketch?.params.entities ?? []).filter((e) => e.type === 'line').sort((a, b) => Number(!!b.construction) - Number(!!a.construction));
  const options: { key: string; label: string; axis: RevolveAxis }[] = [
    { key: 'sketch-y', label: 'Axe Y de l’esquisse (vertical)', axis: { kind: 'sketch-y' } },
    { key: 'sketch-x', label: 'Axe X de l’esquisse (horizontal)', axis: { kind: 'sketch-x' } },
    ...lines.map((l, i) => ({
      key: `line:${l.id}`,
      label: `${l.type === 'line' && l.construction ? 'Trait de construction' : 'Segment'} ${i + 1} (${l.id})`,
      axis: { kind: 'line' as const, lineId: l.id },
    })),
  ];
  return (
    <>
      <SketchSelect value={f.params.sketchId} options={props.sketches} onChange={(sketchId) => update((x) => withParams(x, { sketchId }))} />
      <div class="field">
        <label class="field-label" for="draft-axis">
          Axe de rotation
        </label>
        <select
          id="draft-axis"
          value={axisKey(f.params.axis)}
          onChange={(e) => {
            const opt = options.find((o) => o.key === (e.target as HTMLSelectElement).value);
            if (opt) update((x) => withParams(x, { axis: opt.axis }));
          }}
        >
          {options.map((o) => (
            <option key={o.key} value={o.key}>
              {o.label}
            </option>
          ))}
        </select>
        <span class="field-help">Le dessin doit rester d’un seul côté de l’axe. Astuce : tracez l’axe en trait de construction.</span>
      </div>
      <LengthField
        id="draft-angle"
        label="Angle de rotation"
        unit="°"
        step={15}
        min={0}
        value={draft.fields.angle ?? ''}
        error={draft.errors.angle ?? null}
        help="360° : tour complet. Moins : une part (par exemple 180° pour une demi-pièce)."
        autoFocus
        selectOnFocus
        onInput={(text) => {
          const v = readNumber(text);
          const err = v === null ? 'L’angle doit être un nombre de degrés.' : validateRevolveAngle(v);
          setField('angle', text, err ? { error: err } : { feature: withParams(f, { angle: v! }) });
        }}
        onEnter={props.confirm}
        onEscape={props.cancel}
      />
      <label class="checkbox-row">
        <input type="checkbox" checked={f.params.reversed} onChange={() => update((x) => withParams(x, { reversed: !x.params.reversed }))} />
        <span>Tourner dans l’autre sens</span>
      </label>
      <PreviewStatus status={props.status} kind="add" />
    </>
  );
}
