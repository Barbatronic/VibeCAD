/** Panneau du générateur : roue dentée, crémaillère ou poulie crantée. */
import { GEAR_NAMES, gearName, isDefaultGearName } from '../../domain/document';
import type { BeltProfile, GearFeature, GearKind } from '../../domain/model';
import { formatNumber, readNumber } from '../../domain/units';
import { LengthField } from '../../ui/components/controls';
import { OperationField, PreviewStatus, withParams } from '../../ui/components/feature-fields';
import { useAppState } from '../../ui/context';
import { Icon } from '../../ui/icons';
import type { FeaturePanelProps } from '../panel-types';
import { COMMON_MODULES, GEAR_EXPLANATIONS, gearIssues } from './definition';
import { BELT_PROFILES, pulleyOutsideDiameter, spurGeometry } from './profiles';

type NumericField = 'module' | 'pressureAngle' | 'teeth' | 'thickness' | 'bore' | 'rackHeight';

const FIELD_LABELS: Record<NumericField, string> = {
  module: 'Module',
  pressureAngle: 'Angle de pression',
  teeth: 'Nombre de dents',
  thickness: 'Épaisseur (Z)',
  bore: 'Alésage (Ø du trou central, 0 : aucun)',
  rackHeight: 'Hauteur du corps (sous les dents)',
};

export function GearPanel(props: FeaturePanelProps<GearFeature>) {
  const { draft, update, setField } = props;
  const f = draft.feature;
  const p = f.params;
  const expert = useAppState((s) => s.level === 'expert');
  const n = (v: number, d = 2) => formatNumber(v, d);
  const numberField = (field: NumericField, opts: { unit?: string; step?: number; min?: number; help?: string; autoFocus?: boolean } = {}) => (
    <LengthField
      key={field}
      id={`draft-${field}`}
      label={FIELD_LABELS[field]}
      value={draft.fields[field] ?? ''}
      error={draft.errors[field] ?? null}
      {...(opts.unit ? { unit: opts.unit } : {})}
      {...(opts.step ? { step: opts.step } : {})}
      {...(opts.min !== undefined ? { min: opts.min } : {})}
      {...(opts.help ? { help: opts.help } : {})}
      {...(opts.autoFocus ? { autoFocus: true } : {})}
      onInput={(text) => {
        const v = readNumber(text);
        if (v === null) return setField(field, text, { error: `${FIELD_LABELS[field]} : saisissez un nombre.` });
        const next = withParams(f, { [field]: v } as Partial<GearFeature['params']>);
        const issue = gearIssues(next.params).find((i) => i.field === field);
        setField(field, text, issue ? { error: issue.message } : { feature: next });
      }}
      onEnter={props.confirm}
      onEscape={props.cancel}
    />
  );
  const coordinate = (axis: 'x' | 'y' | 'z') => (
    <LengthField
      key={axis}
      id={`draft-pos-${axis}`}
      label={axis.toUpperCase()}
      value={draft.fields[axis] ?? ''}
      error={draft.errors[axis] ?? null}
      onInput={(text) => {
        const v = readNumber(text);
        if (v === null) return setField(axis, text, { error: 'La position doit être un nombre de millimètres.' });
        setField(axis, text, { feature: withParams(f, { position: { ...p.position, [axis]: v } }) });
      }}
      onEnter={props.confirm}
      onEscape={props.cancel}
    />
  );
  const kinds: GearKind[] = ['spur', 'rack', 'pulley'];
  const spur = p.kind !== 'pulley' ? spurGeometry(p.module, p.teeth, p.pressureAngle) : null;
  return (
    <>
      <div class="field" role="group" aria-label="Pièce à générer">
        <span class="field-label">Pièce à générer</span>
        <div class="choice-grid">
          {kinds.map((k) => (
            <button
              key={k}
              type="button"
              class="choice-card"
              aria-pressed={p.kind === k}
              title={GEAR_EXPLANATIONS[k]}
              // Le nom suit le choix tant qu'il n'a pas été changé à la main (« Roue dentée 1 » → « Poulie 1 »).
              onClick={() => update((x) => ({ ...withParams(x, { kind: k }), ...(isDefaultGearName(x.name) ? { name: gearName(props.part, k, x.id) } : {}) }))}
            >
              <Icon name={`gear-${k}`} />
              <span>{GEAR_NAMES[k]}</span>
            </button>
          ))}
        </div>
        <p class="field-help">{GEAR_EXPLANATIONS[p.kind]}</p>
      </div>
      <OperationField what="La pièce générée" value={p.operation} onChange={(operation) => update((x) => withParams(x, { operation }))} />
      {p.kind === 'pulley' ? (
        <label class="field">
          <span class="field-label">Courroie</span>
          <select id="draft-belt" class="select" value={p.belt} onChange={(e) => update((x) => withParams(x, { belt: (e.target as HTMLSelectElement).value as BeltProfile }))}>
            {(Object.keys(BELT_PROFILES) as BeltProfile[]).map((b) => (
              <option key={b} value={b}>
                {BELT_PROFILES[b].label}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <>
          {numberField('module', { unit: 'mm', step: 0.5, min: 0.2, help: `Taille des dents : pas = π × module. Modules courants : ${COMMON_MODULES.map((m) => n(m)).join(' ; ')}.`, autoFocus: true })}
          {expert ? numberField('pressureAngle', { unit: '°', step: 0.5, help: '20° presque toujours. Deux pièces qui engrènent doivent avoir le même.' }) : null}
        </>
      )}
      {numberField('teeth', { unit: 'dents', step: 1, min: p.kind === 'rack' ? 1 : 6 })}
      {numberField('thickness', { unit: 'mm', step: 1 })}
      {p.kind === 'rack' ? numberField('rackHeight', { unit: 'mm', step: 1 }) : numberField('bore', { unit: 'mm', step: 0.5, help: 'Pour un axe de moteur : 5 mm (NEMA 17), 8 mm pour une tige filetée M8…' })}
      {p.kind === 'pulley' ? (
        <label class="checkbox-row">
          <input id="draft-flanges" type="checkbox" checked={p.flanges} onChange={() => update((x) => withParams(x, { flanges: !p.flanges }))} />
          <span>Joues de chaque côté (la courroie ne glisse pas hors de la poulie)</span>
        </label>
      ) : null}
      <p class="field-help gear-figures" id="draft-gear-figures">
        {p.kind === 'spur' && spur
          ? `Ø primitif ${n(spur.pitch)} mm, Ø extérieur ${n(spur.tip)} mm, Ø de pied ${n(spur.root)} mm. Avec une roue de z dents au même module : entraxe = ${n(p.module)} × (${p.teeth} + z) / 2.`
          : p.kind === 'rack'
            ? `Longueur ${n(p.teeth * Math.PI * p.module)} mm (pas ${n(Math.PI * p.module)} mm). Une roue de z dents au même module a son centre à ${n(p.module)} × z / 2 mm au-dessus de la ligne primitive (y = 0).`
            : `Ø extérieur ${n(pulleyOutsideDiameter(p.belt, p.teeth))} mm (Ø primitif ${n((p.teeth * BELT_PROFILES[p.belt].pitch) / Math.PI)} mm). Profil approché : faites une impression d’essai avec votre courroie.`}
      </p>
      <div class="field">
        <span class="field-label">{p.kind === 'rack' ? 'Début de la ligne primitive (mm)' : 'Position du centre de la face du bas (mm)'}</span>
        <div class="limits-row three">{(['x', 'y', 'z'] as const).map(coordinate)}</div>
      </div>
      <PreviewStatus status={props.status} kind={p.operation === 'cut' ? 'cut' : p.operation === 'common' ? 'modify' : 'add'} />
    </>
  );
}
