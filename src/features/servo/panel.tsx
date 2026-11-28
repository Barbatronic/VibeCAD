/** Panneau de la cannelure de servo : modèle de servo, emplacement (bord rond ou esquisse), cotes. */
import type { ServoFeature, ServoSpline } from '../../domain/model';
import { formatLength, readNumber, MIN_POSITIVE } from '../../domain/units';
import { LengthField, Segmented } from '../../ui/components/controls';
import { PreviewStatus, SketchElementSelect, sketchElementsBefore, withParams } from '../../ui/components/feature-fields';
import type { FeaturePanelProps } from '../panel-types';
import { SERVO_SPLINE_LABELS, SERVO_SPLINES, servoIssues } from './definition';

type NumericField = 'teeth' | 'tipDiameter' | 'rootDiameter' | 'depth' | 'screwDiameter';

const FIELD_LABELS: Record<NumericField, string> = {
  teeth: 'Nombre de dents',
  tipDiameter: 'Ø extérieur des crans',
  rootDiameter: 'Ø intérieur des crans',
  depth: 'Profondeur des crans',
  screwDiameter: 'Ø du trou de vis (0 : aucun)',
};

export function ServoPanel(props: FeaturePanelProps<ServoFeature>) {
  const { draft, update, setField } = props;
  const f = draft.feature;
  const p = f.params;
  const t = (v: number) => formatLength(v, 3, false);
  const numberField = (field: NumericField, opts: { unit: string; step: number; min?: number; help?: string }) => (
    <LengthField
      key={field}
      id={`draft-${field}`}
      label={FIELD_LABELS[field]}
      value={draft.fields[field] ?? ''}
      error={draft.errors[field] ?? null}
      unit={opts.unit}
      step={opts.step}
      min={opts.min ?? MIN_POSITIVE}
      {...(opts.help ? { help: opts.help } : {})}
      onInput={(text) => {
        const v = readNumber(text);
        if (v === null) return setField(field, text, { error: `${FIELD_LABELS[field]} : saisissez un nombre.` });
        // Une cote changée à la main : la cannelure n'est plus celle d'un modèle de servo.
        const next = withParams(f, { [field]: v, standard: 'custom' } as Partial<ServoFeature['params']>);
        const issue = servoIssues(next.params).find((i) => i.field === field);
        setField(field, text, issue ? { error: issue.message } : { feature: next });
      }}
      onEnter={props.confirm}
      onEscape={props.cancel}
    />
  );
  const choose = (standard: ServoSpline) => {
    if (standard === 'custom') return update((x) => withParams(x, { standard }));
    const s = SERVO_SPLINES[standard];
    const figures = { teeth: s.teeth, tipDiameter: s.tipDiameter, rootDiameter: s.rootDiameter, depth: s.depth, screwDiameter: s.screwDiameter };
    // Les champs reprennent les cotes du modèle choisi (sans les équations qui les réglaient).
    const { expressions, ...bare } = withParams(f, { standard, ...figures });
    const kept = Object.entries(expressions ?? {}).filter(([k]) => !(k in figures));
    const next: ServoFeature = kept.length ? { ...bare, expressions: Object.fromEntries(kept) } : bare;
    setField('teeth', String(s.teeth), { feature: next });
    for (const k of ['tipDiameter', 'rootDiameter', 'depth', 'screwDiameter'] as const) setField(k, t(s[k]), { feature: next });
  };
  const target = p.target;
  const sketchOptions = sketchElementsBefore(props.part, f.id, ['point']);
  const where = target?.kind ?? 'edge';
  return (
    <>
      <div class="field" role="group" aria-label="Servomoteur">
        <span class="field-label">Servomoteur</span>
        <div class="choice-grid">
          {(Object.keys(SERVO_SPLINE_LABELS) as ServoSpline[]).map((k) => (
            <button key={k} type="button" class="choice-card" aria-pressed={p.standard === k} title={k === 'custom' ? 'Cotes saisies à la main' : SERVO_SPLINES[k].help} onClick={() => choose(k)}>
              <span>{SERVO_SPLINE_LABELS[k]}</span>
            </button>
          ))}
        </div>
        <p class="field-help">{p.standard === 'custom' ? 'Cotes saisies à la main.' : SERVO_SPLINES[p.standard].help}</p>
      </div>
      <Segmented<'edge' | 'sketch'>
        label="Centre"
        value={where}
        options={[
          { value: 'edge', label: 'Bord rond…', title: 'Le bord circulaire d’un bossage ou d’un trou, cliqué dans la vue 3D' },
          { value: 'sketch', label: 'Esquisse…', title: 'Un point ou le centre d’un cercle d’esquisse ; la cannelure entre perpendiculairement à l’esquisse' },
        ]}
        onChange={(kind) =>
          update((x) => {
            if (kind === x.params.target?.kind) return x;
            if (kind === 'sketch') {
              const first = sketchOptions[0];
              return first ? withParams(x, { target: { kind: 'sketch', sketchId: first.sketchId, entityId: first.entityId } }) : x;
            }
            const { target: _drop, ...rest } = x.params;
            return { ...x, params: rest };
          })
        }
      />
      {where === 'sketch' ? (
        <SketchElementSelect
          id="draft-servo-sketch"
          label="Point ou cercle d’esquisse"
          options={sketchOptions}
          value={target?.kind === 'sketch' ? target : undefined}
          onChange={(ref) => update((x) => withParams(x, { target: { kind: 'sketch', ...ref } }))}
        />
      ) : (
        <p class="field-help" id="draft-servo-edge">
          {target?.kind === 'edge' ? 'Bord rond choisi. Cliquez-en un autre dans la vue 3D pour déplacer la cannelure.' : 'Cliquez dans la vue 3D le bord rond d’un bossage ou d’un trou : la cannelure se centre dessus.'}
        </p>
      )}
      {numberField('teeth', { unit: 'dents', step: 1, min: 6 })}
      {numberField('tipDiameter', { unit: 'mm', step: 0.05, help: 'Fond des creux où entrent les dents de l’axe.' })}
      {numberField('rootDiameter', { unit: 'mm', step: 0.05, help: 'Pointes qui vont au pied des dents de l’axe.' })}
      {numberField('depth', { unit: 'mm', step: 0.5 })}
      {numberField('screwDiameter', { unit: 'mm', step: 0.1, min: 0, help: 'Traverse toute la pièce, dans l’axe de la cannelure.' })}
      <label class="checkbox-row">
        <input id="draft-servo-reversed" type="checkbox" checked={p.reversed} onChange={() => update((x) => withParams(x, { reversed: !x.params.reversed }))} />
        <span>Côté opposé (creuser de l’autre côté)</span>
      </label>
      <p class="field-help gear-figures">Crans à pointes vives : l’impression les arrondit, ce qui donne le serrage. Si le palonnier force trop ou tourne fou, ajustez les deux diamètres de 0,05 à 0,1 mm et faites un essai.</p>
      <PreviewStatus status={props.status} kind="cut" />
    </>
  );
}
