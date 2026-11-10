/** Panneau des paramètres d'une répétition. */
import { PATTERN_SOURCE_TYPES, patternSources } from '../../domain/document';
import type { PatternFeature } from '../../domain/model';
import { parseLength, readNumber } from '../../domain/units';
import { LengthField, Segmented } from '../../ui/components/controls';
import { AxisField, datumAxesBefore, PreviewStatus, withParams } from '../../ui/components/feature-fields';
import type { FeaturePanelProps } from '../panel-types';
import { validatePatternAngle, validatePatternCount } from './definition';

export function PatternPanel(props: FeaturePanelProps<PatternFeature>) {
  const { draft, update, setField } = props;
  const f = draft.feature;
  const p = f.params;
  const own = props.part.features.findIndex((x) => x.id === f.id);
  const sources = props.part.features.filter((x, i) => PATTERN_SOURCE_TYPES.includes(x.type) && (own < 0 || i < own));
  const pick = draft.fields.pick ?? '';
  const axes = datumAxesBefore(props.part, f.id);
  const chosen = new Set(patternSources(p));
  /** Coche ou décoche une étape ; les étapes gardent l'ordre de l'historique. */
  const toggleSource = (id: string) =>
    update((x) => {
      const now = new Set(patternSources(x.params));
      if (now.has(id)) now.delete(id);
      else now.add(id);
      const ordered = sources.map((s) => s.id).filter((s) => now.has(s));
      if (ordered.length === 0) return x;
      const [sourceId, ...extra] = ordered;
      const { extraSourceIds: _old, ...rest } = x.params;
      return { ...x, params: { ...rest, sourceId: sourceId!, ...(extra.length ? { extraSourceIds: extra } : {}) } };
    });
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
      <fieldset class="field pattern-sources">
        <legend class="field-label">Étapes à répéter</legend>
        {sources.length === 0 ? <span class="field-help">Aucune étape à répéter</span> : null}
        {sources.map((s) => (
          <label key={s.id} class="checkbox-row">
            <input
              type="checkbox"
              checked={chosen.has(s.id)}
              // La dernière étape cochée reste cochée : une répétition copie au moins une étape.
              disabled={chosen.has(s.id) && chosen.size === 1}
              onChange={() => toggleSource(s.id)}
            />
            <span>{s.name}</span>
          </label>
        ))}
      </fieldset>
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
        datums={axes}
        onAxis={(axis) => {
          setField('pick', '', { feature: withParams(f, { axis }) });
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
                datums={axes}
                onAxis={(axis) => setField('pick', '', { feature: withParams(f, { second: { ...p.second!, axis } }) })}
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
