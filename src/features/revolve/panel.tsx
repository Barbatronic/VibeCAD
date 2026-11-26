/** Panneau des paramètres d'une révolution. */
import type { RevolveAxis, RevolveFeature, SketchFeature } from '../../domain/model';
import { formatLength, readNumber, MIN_POSITIVE } from '../../domain/units';
import { LengthField } from '../../ui/components/controls';
import { AxisField, datumAxesBefore, OperationField, PreviewStatus, SketchSelect, withParams } from '../../ui/components/feature-fields';
import { pointPosition } from '../../sketch/model';
import type { FeaturePanelProps } from '../panel-types';
import { validateRevolveAngle } from './definition';

const axisKey = (a: RevolveAxis) => (a.kind === 'line' ? `line:${a.lineId}` : a.kind);
const OTHER = 'axis';

export function RevolvePanel(props: FeaturePanelProps<RevolveFeature>) {
  const { draft, update, setField } = props;
  const f = draft.feature;
  const sketch = props.part.features.find((x): x is SketchFeature => x.id === f.params.sketchId && x.type === 'sketch');
  // Les segments de l'esquisse peuvent servir d'axe (en priorité les traits de construction).
  const entities = sketch?.params.entities ?? [];
  const lines = entities.filter((e) => e.type === 'line').sort((a, b) => Number(!!b.construction) - Number(!!a.construction));
  const lengthOf = (l: (typeof lines)[number]) => {
    if (l.type !== 'line' || !sketch) return null;
    const [a, b] = [pointPosition(sketch.params, l.a), pointPosition(sketch.params, l.b)];
    return a && b ? Math.hypot(b.x - a.x, b.y - a.y) : null;
  };
  let nConstruction = 0;
  let nLine = 0;
  const options: { key: string; label: string; axis: RevolveAxis }[] = [
    { key: 'sketch-y', label: 'Axe Y de l’esquisse (vertical)', axis: { kind: 'sketch-y' } },
    { key: 'sketch-x', label: 'Axe X de l’esquisse (horizontal)', axis: { kind: 'sketch-x' } },
    ...lines.map((l) => {
      const construction = l.type === 'line' && !!l.construction;
      const n = construction ? ++nConstruction : ++nLine;
      const len = lengthOf(l);
      return { key: `line:${l.id}`, label: `${construction ? 'Trait de construction' : 'Segment'} ${n}${len !== null ? `, ${formatLength(len)}` : ''}`, axis: { kind: 'line' as const, lineId: l.id } };
    }),
    { key: OTHER, label: 'Autre axe (repère, axe de construction, arête de la pièce)…', axis: { kind: 'axis', axis: { kind: 'axis', axis: 'Z' } } },
  ];
  const custom = f.params.axis.kind === 'axis' ? f.params.axis.axis : null;
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
            // « Autre axe » : on commence par cliquer une arête dans la vue.
            if (opt?.key === OTHER) setField('pick', 'axis', { feature: withParams(f, { axis: opt.axis }) });
            else if (opt) update((x) => withParams(x, { axis: opt.axis }));
          }}
        >
          {options.map((o) => (
            <option key={o.key} value={o.key}>
              {o.label}
            </option>
          ))}
        </select>
        <span class="field-help">Le dessin doit rester d’un seul côté de l’axe</span>
      </div>
      {custom ? (
        <AxisField
          label="Autre axe (parallèle au plan de l’esquisse)"
          axis={custom}
          picking={draft.fields.pick === 'axis'}
          datums={datumAxesBefore(props.part, f.id)}
          onAxis={(axis) => setField('pick', '', { feature: withParams(f, { axis: { kind: 'axis', axis } }) })}
          onPick={() => setField('pick', 'axis', { feature: f })}
        />
      ) : null}
      <LengthField
        id="draft-angle"
        label="Angle de rotation"
        unit="°"
        step={15}
        min={MIN_POSITIVE}
        value={draft.fields.angle ?? ''}
        error={draft.errors.angle ?? null}
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
      <OperationField value={f.params.operation} what="La révolution" onChange={(operation) => update((x) => withParams(x, { operation }))} />
      <PreviewStatus status={props.status} kind={f.params.operation === 'cut' ? 'cut' : f.params.operation === 'common' ? 'modify' : 'add'} />
      <details class="advanced" open={!!f.params.startAngle || !!draft.errors.startAngle}>
        <summary>Réglages avancés</summary>
        <LengthField
          id="draft-start-angle"
          label="Angle de départ"
          unit="°"
          step={15}
          value={draft.fields.startAngle ?? '0'}
          error={draft.errors.startAngle ?? null}
          help="Décalage du début de la révolution autour de l’axe, dans le sens de rotation"
          selectOnFocus
          onInput={(text) => {
            const v = readNumber(text);
            const err = v === null ? 'L’angle de départ doit être un nombre de degrés.' : Math.abs(v) > 360 ? 'L’angle de départ doit être compris entre −360° et 360°.' : null;
            setField('startAngle', text, err ? { error: err } : { feature: withParams(f, { startAngle: v! }) });
          }}
          onEnter={props.confirm}
          onEscape={props.cancel}
        />
      </details>
    </>
  );
}
