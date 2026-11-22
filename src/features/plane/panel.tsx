/**
 * Panneau d'un plan de construction : la façon de le construire (décalé, milieu, trois points,
 * perpendiculaire à une arête, tangent à un cylindre, parallèle par un point, arête et point), les
 * éléments choisis dans la vue 3D, puis le décalage le long de sa normale.
 */
import type { DatumPlaneMode, DatumPoint, MirrorPlane, PlaneFeature, PlaneName } from '../../domain/model';
import { readNumber } from '../../domain/units';
import { Button, Callout, LengthField, Segmented } from '../../ui/components/controls';
import { AxisField, datumAxesBefore, DatumPlaneSelect, datumPlanesBefore, PreviewStatus, SketchElementSelect, sketchElementsBefore, withParams } from '../../ui/components/feature-fields';
import type { FeaturePanelProps } from '../panel-types';
import { planeIssues } from './definition';

type BaseChoice = PlaneName | 'face' | 'datum';

export const PLANE_MODES: { value: DatumPlaneMode; label: string; help: string }[] = [
  { value: 'offset', label: 'Décalé ou incliné', help: 'Un plan ou une face, décalé, puis incliné autour d’une charnière' },
  { value: 'midplane', label: 'Au milieu de deux plans', help: 'Plan médian entre deux faces ou plans parallèles, bissecteur s’ils se coupent' },
  { value: 'threePoints', label: 'Par trois points', help: 'Bouts, milieux ou centres d’arêtes de la pièce, ou l’origine' },
  { value: 'normalToEdge', label: 'Perpendiculaire à une arête', help: 'En un point de l’arête : début, fin ou position en %' },
  { value: 'tangent', label: 'Tangent à un cylindre', help: 'Choisi par son bord rond, à un angle autour de son axe' },
  { value: 'parallelPoint', label: 'Parallèle, par un point', help: 'Parallèle à un plan ou une face, passant par un point' },
  { value: 'edgePoint', label: 'Par une arête et un point', help: 'Contient une arête droite et passe par un point' },
  { value: 'sketchLine', label: 'Par une ligne d’esquisse', help: 'Contient un segment d’esquisse, perpendiculaire à l’esquisse' },
];

/** Premier élément à choisir dans la vue pour une façon de construire (rien : déjà complet). */
function firstPick(mode: DatumPlaneMode, p: PlaneFeature['params']): string {
  if (mode === 'threePoints') return (p.points?.length ?? 0) < 3 ? `p${p.points?.length ?? 0}` : '';
  if (mode === 'parallelPoint') return p.points?.[0] ? '' : 'p0';
  if (mode === 'sketchLine') return '';
  if (mode === 'normalToEdge' || mode === 'tangent' || mode === 'edgePoint') return p.edge || p.sketchElement ? (mode === 'edgePoint' && !p.points?.[0] ? 'p0' : '') : 'edgeRef';
  if (mode === 'midplane') return p.second ? '' : 'face2';
  return '';
}

const POINT_NAMES: Record<Extract<DatumPoint, { kind: 'edge' }>['at'], string> = { start: 'début d’arête', end: 'fin d’arête', mid: 'milieu d’arête', center: 'centre d’un bord rond' };

export function PlanePanel(props: FeaturePanelProps<PlaneFeature>) {
  const { draft, update, setField } = props;
  const f = draft.feature;
  const p = f.params;
  const mode = p.mode ?? 'offset';
  const pick = draft.fields.pick ?? '';
  const datums = datumPlanesBefore(props.part, f.id);
  const numberField = (field: 'offset' | 'angle' | 'along', label: string, unit: string, toParam: (v: number) => number = (v) => v) => (
    <LengthField
      id={`draft-${field}`}
      label={label}
      unit={unit}
      {...(field === 'along' ? { min: 0, max: 100 } : {})}
      value={draft.fields[field] ?? ''}
      error={draft.errors[field] ?? null}
      help=""
      selectOnFocus
      onInput={(text) => {
        const v = readNumber(text);
        if (v === null) return setField(field, text, { error: `${label} : saisissez un nombre.` });
        const next = withParams(f, { [field]: toParam(v) } as Partial<PlaneFeature['params']>);
        const issue = planeIssues(next.params).find((i) => i.field === field);
        setField(field, text, issue ? { error: issue.message } : { feature: next });
      }}
      onEnter={props.confirm}
      onEscape={props.cancel}
    />
  );
  /** Choix d'un plan : plan d'origine, face cliquée (`pickName`) ou autre plan de construction. */
  const planeChoice = (label: string, value: MirrorPlane | undefined, key: 'base' | 'second', pickName: string) => {
    const choice: BaseChoice | '' = pick === pickName ? 'face' : !value ? '' : value.kind === 'face' ? 'face' : value.kind === 'datum' ? 'datum' : value.plane;
    return (
      <>
        <Segmented<BaseChoice | ''>
          label={label}
          value={choice}
          options={[
            { value: 'XY', label: 'XY', title: 'Plan XY (le sol)' },
            { value: 'XZ', label: 'XZ', title: 'Plan XZ (de face)' },
            { value: 'YZ', label: 'YZ', title: 'Plan YZ (de côté)' },
            { value: 'face', label: 'Face…', title: 'Une face plane de la pièce, cliquée dans la vue 3D' },
            ...(datums.length ? [{ value: 'datum' as const, label: 'Plan…', title: 'Un autre plan de construction' }] : []),
          ]}
          onChange={(v) =>
            v === 'face'
              ? setField('pick', pickName, { feature: f })
              : v === ''
                ? undefined
                : setField('pick', '', { feature: withParams(f, { [key]: v === 'datum' ? { kind: 'datum', featureId: datums[datums.length - 1]!.id } : { kind: 'plane', plane: v } } as Partial<PlaneFeature['params']>) })
          }
        />
        {pick === pickName ? (
          <Callout kind="info">
            <p>Sélectionnez une face plane</p>
          </Callout>
        ) : value?.kind === 'face' ? (
          <span class="field-help">Face choisie</span>
        ) : null}
        {value?.kind === 'datum' ? <DatumPlaneSelect planes={datums} value={value.featureId} onChange={(featureId) => update((x) => withParams(x, { [key]: { kind: 'datum', featureId } } as Partial<PlaneFeature['params']>))} /> : null}
      </>
    );
  };
  const sketchPoints = sketchElementsBefore(props.part, f.id, ['point']);
  /** Point n° `i` : choisi dans la vue (bout, milieu ou centre d'arête), l'origine, ou un point d'esquisse. */
  const pointSlot = (i: number, label: string) => {
    const pt = p.points?.[i];
    const picking = pick === `p${i}`;
    const setPoint = (point: DatumPoint) => {
      const points = [...(p.points ?? [])];
      points[i] = point;
      setField('pick', firstPick(mode, { ...p, points }), { feature: withParams(f, { points }) });
    };
    const setOrigin = () => setPoint({ kind: 'origin' });
    const firstSketchPoint = sketchPoints[0];
    return (
      <div class="field" key={`p${i}`}>
        <span class="field-label">{label}</span>
        <span class="field-help">{picking ? 'Cliquez une arête : le bout, le milieu ou le centre le plus proche' : !pt ? 'À choisir' : pt.kind === 'origin' ? 'Origine' : pt.kind === 'sketch' ? 'Point d’esquisse' : POINT_NAMES[pt.at]}</span>
        <div class="segmented">
          <Button small icon="target" onClick={() => setField('pick', picking ? '' : `p${i}`, { feature: f })}>
            {picking ? 'Cliquez dans la vue…' : 'Choisir…'}
          </Button>
          <Button small icon="point" onClick={setOrigin}>
            Origine
          </Button>
          {firstSketchPoint ? (
            <Button small icon="sketch" onClick={() => setPoint({ kind: 'sketch', sketchId: firstSketchPoint.sketchId, entityId: firstSketchPoint.entityId })}>
              Esquisse…
            </Button>
          ) : null}
        </div>
        {pt?.kind === 'sketch' ? (
          <SketchElementSelect id={`draft-sketch-point-${i}`} label="Point d’esquisse" options={sketchPoints} value={pt} onChange={(ref) => setPoint({ kind: 'sketch', ...ref })} />
        ) : null}
      </div>
    );
  };
  /** Arête de la pièce cliquée dans la vue, ou élément d'esquisse (`kind` : segments ou cercles et arcs). */
  const edgeSlot = (label: string, help: string, kind: 'line' | 'circle' | 'any') => {
    const picking = pick === 'edgeRef';
    const options = sketchElementsBefore(props.part, f.id, kind === 'any' ? ['line', 'circle'] : [kind]);
    const first = options[0];
    return (
      <div class="field">
        <span class="field-label">{label}</span>
        <span class="field-help">{picking ? help : p.sketchElement ? 'Élément d’esquisse' : p.edge ? 'Arête choisie' : 'À choisir'}</span>
        <div class="segmented">
          <Button small icon="target" onClick={() => setField('pick', picking ? '' : 'edgeRef', { feature: f })}>
            {picking ? 'Cliquez dans la vue…' : 'Choisir…'}
          </Button>
          {first ? (
            <Button small icon="sketch" onClick={() => setField('pick', mode === 'edgePoint' && !p.points?.[0] ? 'p0' : '', { feature: withParams(f, { sketchElement: p.sketchElement ?? { sketchId: first.sketchId, entityId: first.entityId } }) })}>
              Esquisse…
            </Button>
          ) : null}
        </div>
        {p.sketchElement && !picking ? (
          <SketchElementSelect id="draft-sketch-element" label="Élément d’esquisse" options={options} value={p.sketchElement} onChange={(sketchElement) => update((x) => withParams(x, { sketchElement }))} />
        ) : null}
      </div>
    );
  };
  return (
    <>
      <label class="field">
        <span class="field-label">Construction</span>
        <select
          class="select"
          aria-label="Construction du plan"
          value={mode}
          onChange={(e) => {
            const next = (e.target as HTMLSelectElement).value as DatumPlaneMode;
            // Autre construction : le décalage repart de 0 (celui par défaut d'un plan décalé n'a pas de sens ici).
            const firstLine = next === 'sketchLine' && !p.sketchElement ? sketchElementsBefore(props.part, f.id, ['line'])[0] : undefined;
            const sketchElement = firstLine ? { sketchId: firstLine.sketchId, entityId: firstLine.entityId } : p.sketchElement;
            const params = { ...p, mode: next, offset: next === 'offset' ? p.offset : 0, sketchElement };
            const feature = withParams(f, { mode: next, offset: params.offset, sketchElement });
            setField('offset', String(params.offset).replace('.', ','), { feature });
            setField('pick', firstPick(next, params), { feature });
          }}
        >
          {PLANE_MODES.map((m) => (
            <option key={m.value} value={m.value} title={m.help}>
              {m.label}
            </option>
          ))}
        </select>
        <span class="field-help">{PLANE_MODES.find((m) => m.value === mode)?.help}</span>
      </label>

      {mode === 'offset' ? (
        <>
          {planeChoice('Plan de départ', p.base, 'base', 'face')}
          {numberField('offset', 'Décalage', 'mm')}
          {numberField('angle', 'Inclinaison', '°')}
          {p.angle !== 0 ? (
            <AxisField
              label="Charnière (axe de rotation)"
              axis={p.hinge}
              picking={pick === 'edge'}
              datums={datumAxesBefore(props.part, f.id)}
              onAxis={(hinge) => setField('pick', '', { feature: withParams(f, { hinge }) })}
              onPick={() => setField('pick', 'edge', { feature: f })}
            />
          ) : null}
        </>
      ) : null}
      {mode === 'midplane' ? (
        <>
          {planeChoice('Premier plan', p.base, 'base', 'face')}
          {planeChoice('Second plan', p.second, 'second', 'face2')}
        </>
      ) : null}
      {mode === 'threePoints' ? [pointSlot(0, 'Point 1'), pointSlot(1, 'Point 2'), pointSlot(2, 'Point 3')] : null}
      {mode === 'normalToEdge' ? (
        <>
          {edgeSlot('Arête', 'Cliquez une arête (droite ou courbe)', 'any')}
          {numberField('along', 'Position sur l’arête', '%', (v) => v / 100)}
        </>
      ) : null}
      {mode === 'tangent' ? (
        <>
          {edgeSlot('Bord rond du cylindre', 'Cliquez le bord rond d’un cylindre ou d’un trou', 'circle')}
          {numberField('angle', 'Angle autour de l’axe', '°')}
        </>
      ) : null}
      {mode === 'parallelPoint' ? (
        <>
          {planeChoice('Parallèle à', p.base, 'base', 'face')}
          {pointSlot(0, 'Passant par')}
        </>
      ) : null}
      {mode === 'edgePoint' ? (
        <>
          {edgeSlot('Arête droite', 'Cliquez une arête droite', 'line')}
          {pointSlot(0, 'Passant par')}
        </>
      ) : null}
      {mode === 'sketchLine' ? (
        <SketchElementSelect id="draft-sketch-element" label="Segment d’esquisse" options={sketchElementsBefore(props.part, f.id, ['line'])} value={p.sketchElement} onChange={(sketchElement) => update((x) => withParams(x, { sketchElement }))} />
      ) : null}
      {mode !== 'offset' ? numberField('offset', 'Décalage', 'mm') : null}
      <PreviewStatus status={props.status} kind="modify" />
    </>
  );
}
