/** Panneau du perçage normalisé : type de trou, taille de vis, profondeur, logement de tête. */
import { METRIC_SIZES, type MetricSize } from '../../domain/fasteners';
import type { HoleFeature, HoleFit, HoleKind } from '../../domain/model';
import { formatLength, formatNumber, parseLength } from '../../domain/units';
import { LengthField, Segmented } from '../../ui/components/controls';
import { PreviewStatus, SketchSelect, withParams } from '../../ui/components/feature-fields';
import type { FeaturePanelProps } from '../panel-types';
import { HOLE_FIT_LABELS, HOLE_KIND_HELP, HOLE_KIND_LABELS, holeDiameter, holeIssues, standardHead } from './definition';

export function HolePanel(props: FeaturePanelProps<HoleFeature>) {
  const { draft, update, setField } = props;
  const f = draft.feature;
  const p = f.params;
  const mm = (v: number) => formatLength(v, 3, false);
  /** Type ou taille changés : le logement de tête reprend la valeur de la norme. */
  const choose = (patch: Partial<HoleFeature['params']>) => {
    const next = withParams(f, patch);
    const head = standardHead(next.params.kind, next.params.size);
    const withHead = withParams(next, head);
    setField('headDiameter', mm(head.headDiameter), { feature: withHead });
    setField('headDepth', mm(head.headDepth), { feature: withHead });
  };
  const lengthField = (field: 'depth' | 'headDiameter' | 'headDepth', label: string, help?: string) => (
    <LengthField
      id={`draft-${field}`}
      label={label}
      value={draft.fields[field] ?? ''}
      error={draft.errors[field] ?? null}
      {...(help ? { help } : {})}
      selectOnFocus
      onInput={(text) => {
        const parsed = parseLength(text, { label });
        if (!parsed.ok) return setField(field, text, { error: parsed.error });
        const next = withParams(f, { [field]: parsed.value } as Partial<HoleFeature['params']>);
        const issue = holeIssues(next.params).find((i) => i.field === field);
        setField(field, text, issue ? { error: issue.message } : { feature: next });
      }}
      onEnter={props.confirm}
      onEscape={props.cancel}
    />
  );
  const d = holeDiameter(p);
  return (
    <>
      <SketchSelect value={p.sketchId} options={props.sketches} onChange={(sketchId) => update((x) => withParams(x, { sketchId }))} />
      <p class="field-help">Un trou au centre de chaque cercle de l’esquisse : la taille du cercle dessiné ne compte pas.</p>
      <Segmented
        label="Type de trou"
        value={p.kind}
        options={(Object.keys(HOLE_KIND_LABELS) as HoleKind[]).map((k) => ({ value: k, label: HOLE_KIND_LABELS[k], title: HOLE_KIND_HELP[k] }))}
        onChange={(kind) => choose({ kind })}
      />
      <p class="field-help">{HOLE_KIND_HELP[p.kind]}</p>
      <label class="field">
        <span class="field-label">Taille de vis</span>
        <select id="draft-size" class="select" value={p.size} onChange={(e) => choose({ size: (e.target as HTMLSelectElement).value as MetricSize })}>
          {METRIC_SIZES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>
      {p.kind !== 'tapped' ? (
        <Segmented
          label="Jeu autour de la vis (ISO 273)"
          value={p.fit}
          options={(Object.keys(HOLE_FIT_LABELS) as HoleFit[]).map((k) => ({ value: k, label: HOLE_FIT_LABELS[k] }))}
          onChange={(fit) => update((x) => withParams(x, { fit }))}
        />
      ) : null}
      <p class="field-help" id="draft-hole-figures">
        Trou Ø {formatNumber(d, 2)} mm
        {p.kind === 'tapped' ? ` (perçage avant taraudage ${p.size})` : ''}
        {p.kind === 'counterbore' ? `, lamage Ø ${formatNumber(p.headDiameter, 2)} mm sur ${formatNumber(p.headDepth, 2)} mm` : ''}
        {p.kind === 'countersink' ? `, fraisure à 90° Ø ${formatNumber(p.headDiameter, 2)} mm` : ''}.
        {p.kind !== 'tapped' ? ' En impression 3D, « Normal » ou « Large » laisse passer la vis sans forcer.' : ''}
      </p>
      <Segmented
        label="Profondeur"
        value={p.through ? 'through' : 'depth'}
        options={[
          { value: 'through', label: 'Traversant', title: 'Le trou traverse toute la pièce' },
          { value: 'depth', label: 'Coté', title: 'Profondeur donnée en mm' },
        ]}
        onChange={(v) => update((x) => withParams(x, { through: v === 'through' }))}
      />
      {p.through ? null : lengthField('depth', 'Profondeur du trou')}
      {p.kind === 'counterbore' ? (
        <>
          {lengthField('headDiameter', 'Diamètre du lamage', 'Proposé par la norme (DIN 974) pour une vis CHC ; modifiable.')}
          {lengthField('headDepth', 'Profondeur du lamage')}
        </>
      ) : p.kind === 'countersink' ? (
        lengthField('headDiameter', 'Diamètre de la fraisure', 'Proposé par la norme (ISO 15065) pour une vis FHC ; modifiable.')
      ) : null}
      <label class="checkbox-row">
        <input id="draft-reversed" type="checkbox" checked={p.reversed} onChange={() => update((x) => withParams(x, { reversed: !p.reversed }))} />
        <span>Percer de l’autre côté du plan de l’esquisse</span>
      </label>
      <PreviewStatus status={props.status} kind="cut" />
    </>
  );
}
