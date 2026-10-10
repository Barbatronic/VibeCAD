/** Panneau des paramètres d'une répétition. */
import { PATTERN_SOURCE_TYPES } from '../../domain/document';
import type { PatternAxis, PatternFeature } from '../../domain/model';
import { parseLength, readNumber } from '../../domain/units';
import { Callout, LengthField, Segmented } from '../../ui/components/controls';
import { PreviewStatus, withParams } from '../../ui/components/feature-fields';
import type { FeaturePanelProps } from '../panel-types';
import { validatePatternAngle, validatePatternCount } from './definition';

type AxisChoice = 'X' | 'Y' | 'Z' | 'edge';

/** Choix d'un axe : X, Y, Z, ou une arête cliquée dans la vue 3D (`pick` : en attente du clic). */
function AxisField(props: { label: string; axis: PatternAxis; picking: boolean; onAxis: (axis: 'X' | 'Y' | 'Z') => void; onPick: () => void }) {
  const value: AxisChoice = props.picking || props.axis.kind === 'edge' ? 'edge' : props.axis.axis;
  return (
    <>
      <Segmented<AxisChoice>
        label={props.label}
        value={value}
        options={[
          { value: 'X', label: 'X', title: 'Axe X (rouge)' },
          { value: 'Y', label: 'Y', title: 'Axe Y (vert)' },
          { value: 'Z', label: 'Z', title: 'Axe Z (bleu)' },
          { value: 'edge', label: 'Arête…', title: 'Une arête droite ou le bord d’un trou, cliqué dans la vue 3D' },
        ]}
        onChange={(v) => (v === 'edge' ? props.onPick() : props.onAxis(v))}
      />
      {props.picking ? (
        <Callout kind="info">
          <p>Cliquez dans la vue 3D une arête droite (direction) ou le bord d’un trou (son axe).</p>
        </Callout>
      ) : props.axis.kind === 'edge' ? (
        <span class="field-help">Arête choisie dans la vue 3D. Cliquez « Arête… » pour en prendre une autre.</span>
      ) : null}
    </>
  );
}

export function PatternPanel(props: FeaturePanelProps<PatternFeature>) {
  const { draft, update, setField } = props;
  const f = draft.feature;
  const p = f.params;
  const own = props.part.features.findIndex((x) => x.id === f.id);
  const sources = props.part.features.filter((x, i) => PATTERN_SOURCE_TYPES.includes(x.type) && (own < 0 || i < own));
  const pick = draft.fields.pick ?? '';
  const countField = (name: 'count' | 'count2', label: string, apply: (n: number) => PatternFeature) => (
    <LengthField
      id={`draft-${name}`}
      label={label}
      unit="×"
      step={1}
      min={2}
      value={draft.fields[name] ?? ''}
      error={draft.errors[name] ?? null}
      onInput={(text) => {
        const v = readNumber(text);
        const err = v === null ? 'Le nombre d’exemplaires doit être un nombre entier.' : validatePatternCount(v);
        setField(name, text, err ? { error: err } : { feature: apply(v!) });
      }}
      onEnter={props.confirm}
      onEscape={props.cancel}
    />
  );
  const spacingField = (name: 'spacing' | 'spacing2', apply: (n: number) => PatternFeature) => (
    <LengthField
      id={`draft-${name}`}
      label="Espacement"
      value={draft.fields[name] ?? ''}
      error={draft.errors[name] ?? null}
      help="Distance entre deux exemplaires voisins (d’un centre au suivant)."
      onInput={(text) => {
        const parsed = parseLength(text, { label: 'L’espacement' });
        setField(name, text, parsed.ok ? { feature: apply(parsed.value) } : { error: parsed.error });
      }}
      onEnter={props.confirm}
      onEscape={props.cancel}
    />
  );
  return (
    <>
      <div class="field">
        <label class="field-label" for="draft-source">
          Étape à répéter
        </label>
        <select id="draft-source" class="select" value={p.sourceId} onChange={(e) => update((x) => withParams(x, { sourceId: (e.target as HTMLSelectElement).value }))}>
          {sources.length === 0 ? <option value="">Aucune extrusion, poche ou révolution avant</option> : null}
          {sources.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <span class="field-help">Le volume ajouté (extrusion, révolution) ou retiré (poche, trou) par cette étape est refait à chaque exemplaire.</span>
      </div>
      <Segmented<PatternFeature['params']['kind']>
        label="Disposition"
        value={p.kind}
        options={[
          { value: 'linear', label: 'En ligne', title: 'Les exemplaires suivent une direction (ou une grille)' },
          { value: 'circular', label: 'En cercle', title: 'Les exemplaires tournent autour d’un axe' },
        ]}
        onChange={(kind) =>
          update((x) => withParams(x, { kind, axis: x.params.axis.kind === 'axis' ? { kind: 'axis', axis: kind === 'circular' ? 'Z' : 'X' } : x.params.axis }))
        }
      />
      <AxisField
        label={p.kind === 'linear' ? 'Direction' : 'Axe de rotation'}
        axis={p.axis}
        picking={pick === 'axis'}
        onAxis={(axis) => {
          setField('pick', '', { feature: withParams(f, { axis: { kind: 'axis', axis } }) });
        }}
        onPick={() => setField('pick', 'axis', { feature: f })}
      />
      {countField('count', 'Nombre d’exemplaires (original compris)', (count) => withParams(f, { count }))}
      {p.kind === 'linear'
        ? spacingField('spacing', (spacing) => withParams(f, { spacing }))
        : (
          <LengthField
            id="draft-angle"
            label="Angle total"
            unit="°"
            step={15}
            min={0}
            value={draft.fields.angle ?? ''}
            error={draft.errors.angle ?? null}
            help="360° : exemplaires répartis sur un tour complet. Moins : le premier et le dernier sont séparés de cet angle."
            onInput={(text) => {
              const v = readNumber(text);
              const err = v === null ? 'L’angle doit être un nombre de degrés.' : validatePatternAngle(v);
              setField('angle', text, err ? { error: err } : { feature: withParams(f, { angle: v! }) });
            }}
            onEnter={props.confirm}
            onEscape={props.cancel}
          />
        )}
      <label class="checkbox-row">
        <input type="checkbox" checked={p.reversed} onChange={() => update((x) => withParams(x, { reversed: !x.params.reversed }))} />
        <span>{p.kind === 'linear' ? 'Dans l’autre sens' : 'Tourner dans l’autre sens'}</span>
      </label>
      {p.kind === 'linear' ? (
        <>
          <label class="checkbox-row">
            <input
              type="checkbox"
              checked={!!p.second}
              onChange={() => {
                if (p.second) {
                  update((x) => ({ ...x, params: { ...x.params, second: undefined } }) as PatternFeature);
                  return;
                }
                const other = p.axis.kind === 'axis' && p.axis.axis === 'Y' ? 'X' : 'Y';
                const second = { axis: { kind: 'axis' as const, axis: other as 'X' | 'Y' }, count: 2, spacing: p.spacing, reversed: false };
                setField('count2', '2', { feature: withParams(f, { second }) });
                setField('spacing2', String(p.spacing).replace('.', ','), { feature: withParams(f, { second }) });
              }}
            />
            <span>Deuxième direction (grille)</span>
          </label>
          {p.second ? (
            <fieldset class="pattern-second">
              <legend class="field-label">Deuxième direction</legend>
              <AxisField
                label="Direction"
                axis={p.second.axis}
                picking={pick === 'second'}
                onAxis={(axis) => setField('pick', '', { feature: withParams(f, { second: { ...p.second!, axis: { kind: 'axis', axis } } }) })}
                onPick={() => setField('pick', 'second', { feature: f })}
              />
              {countField('count2', 'Nombre d’exemplaires', (count) => withParams(f, { second: { ...p.second!, count } }))}
              {spacingField('spacing2', (spacing) => withParams(f, { second: { ...p.second!, spacing } }))}
              <label class="checkbox-row">
                <input type="checkbox" checked={p.second.reversed} onChange={() => update((x) => withParams(x, { second: { ...x.params.second!, reversed: !x.params.second!.reversed } }))} />
                <span>Dans l’autre sens</span>
              </label>
            </fieldset>
          ) : null}
        </>
      ) : null}
      <PreviewStatus status={props.status} kind="modify" />
    </>
  );
}
