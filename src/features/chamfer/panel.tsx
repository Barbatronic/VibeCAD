/** Panneau des paramètres d'un chanfrein. */
import type { ChamferFeature, ChamferParams } from '../../domain/model';
import { formatLength, parseLength, readNumber } from '../../domain/units';
import { LengthField, Segmented } from '../../ui/components/controls';
import { EdgeSelectionField } from '../../ui/components/edge-fields';
import { PreviewStatus, withParams } from '../../ui/components/feature-fields';
import { validateChamferAngle } from '../blend-common';
import type { FeaturePanelProps } from '../panel-types';

type Shape = 'equal' | NonNullable<ChamferParams['mode']>;

/** Paramètres pour une autre forme de biseau (la seconde longueur ou l'angle reprennent 45°). */
function withShape(p: ChamferParams, shape: Shape): ChamferParams {
  const { mode: _m, distance2: _d, angle: _a, flip: _f, ...rest } = p;
  if (shape === 'twoDistances') return { ...rest, mode: shape, distance2: p.distance2 ?? p.distance, ...(p.flip ? { flip: true } : {}) };
  if (shape === 'distanceAngle') return { ...rest, mode: shape, angle: p.angle ?? 45, ...(p.flip ? { flip: true } : {}) };
  return rest;
}

export function ChamferPanel(props: FeaturePanelProps<ChamferFeature>) {
  const { draft, update, setField } = props;
  const f = draft.feature;
  const shape: Shape = f.params.mode ?? 'equal';
  return (
    <>
      <EdgeSelectionField
        edges={f.params.edges}
        part={props.part}
        verb="chanfreiner"
        xray
        onClear={() => update((x) => withParams(x, { edges: [] }))}
        onRemove={(i) => update((x) => withParams(x, { edges: x.params.edges.filter((_e, k) => k !== i) }))}
      />
      <Segmented<Shape>
        label="Forme du biseau"
        value={shape}
        options={[
          { value: 'equal', label: 'Égal', title: 'La même longueur des deux côtés (45°)' },
          { value: 'twoDistances', label: '2 longueurs', title: 'Une longueur de chaque côté de l’arête' },
          { value: 'distanceAngle', label: 'Longueur + angle', title: 'Une longueur et l’angle du biseau' },
        ]}
        onChange={(next) => {
          const params = withShape(f.params, next);
          update((x) => ({ ...x, params }));
          if (params.distance2 !== undefined) setField('distance2', formatLength(params.distance2, 3, false), { feature: { ...f, params } });
          if (params.angle !== undefined) setField('angle', String(params.angle).replace('.', ','), { feature: { ...f, params } });
        }}
      />
      <LengthField
        id="draft-size"
        label={shape === 'equal' ? 'Longueur du chanfrein' : 'Première longueur'}
        value={draft.fields.size ?? ''}
        error={draft.errors.size ?? null}
        help={shape === 'equal' ? 'De chaque côté de l’arête (45°)' : 'Sur la première face de chaque arête (la face cliquée)'}
        autoFocus
        selectOnFocus
        onInput={(text) => {
          const parsed = parseLength(text, { label: 'La longueur' });
          setField('size', text, parsed.ok ? { feature: withParams(f, { distance: parsed.value }) } : { error: parsed.error });
        }}
        onEnter={props.confirm}
        onEscape={props.cancel}
      />
      {shape === 'twoDistances' ? (
        <LengthField
          id="draft-distance2"
          label="Seconde longueur"
          value={draft.fields.distance2 ?? ''}
          error={draft.errors.distance2 ?? null}
          help="Sur l’autre face de l’arête"
          selectOnFocus
          onInput={(text) => {
            const parsed = parseLength(text, { label: 'La seconde longueur' });
            setField('distance2', text, parsed.ok ? { feature: withParams(f, { distance2: parsed.value }) } : { error: parsed.error });
          }}
          onEnter={props.confirm}
          onEscape={props.cancel}
        />
      ) : null}
      {shape === 'distanceAngle' ? (
        <LengthField
          id="draft-angle"
          label="Angle"
          unit="°"
          value={draft.fields.angle ?? ''}
          error={draft.errors.angle ?? null}
          help="Entre la première face et le biseau (45° : chanfrein égal)"
          selectOnFocus
          onInput={(text) => {
            const v = readNumber(text);
            const err = v === null ? 'L’angle doit être un nombre de degrés.' : validateChamferAngle(v);
            setField('angle', text, err ? { error: err } : { feature: withParams(f, { angle: v! }) });
          }}
          onEnter={props.confirm}
          onEscape={props.cancel}
        />
      ) : null}
      {shape !== 'equal' ? (
        <label class="checkbox-row">
          <input id="draft-flip" type="checkbox" checked={!!f.params.flip} onChange={() =>
              update((x) => {
                const { flip, ...rest } = x.params;
                return { ...x, params: flip ? rest : { ...rest, flip: true } };
              })
            } />
          <span>Inverser les côtés (la première longueur passe sur l’autre face)</span>
        </label>
      ) : null}
      <PreviewStatus status={props.status} kind="modify" />
    </>
  );
}
