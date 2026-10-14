/** Panneau du perçage normalisé : type de trou, taille de vis, profondeur, logement de tête. */
import { METRIC_SIZES, type MetricSize } from '../../domain/fasteners';
import type { HoleFeature, HoleFit, HoleKind } from '../../domain/model';
import { formatLength, formatNumber, parseLength, readNumber } from '../../domain/units';
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
    const head = standardHead(next.params.kind, next.params.size, next.params.diameter ?? 5);
    const withHead = withParams(next, head);
    setField('headDiameter', mm(head.headDiameter), { feature: withHead });
    setField('headDepth', mm(head.headDepth), { feature: withHead });
    if (patch.diameter !== undefined) setField('diameter', mm(patch.diameter), { feature: withHead });
  };
  const lengthField = (field: 'depth' | 'headDiameter' | 'headDepth' | 'diameter' | 'clearance', label: string, help?: string) => (
    <LengthField
      id={`draft-${field}`}
      label={label}
      value={draft.fields[field] ?? ''}
      error={draft.errors[field] ?? null}
      {...(help ? { help } : {})}
      selectOnFocus
      onInput={(text) => {
        // Le jeu peut être négatif (trou un peu plus petit que la vis) : nombre simple.
        const parsed = field === 'clearance' ? (readNumber(text) === null ? { ok: false as const, error: 'Le jeu doit être un nombre de millimètres.' } : { ok: true as const, value: readNumber(text)! }) : parseLength(text, { label });
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
      <p class="field-help">Un trou à chaque point (outil Point) et au centre de chaque cercle de l’esquisse : la taille du cercle dessiné ne compte pas.</p>
      <Segmented
        label="Type de trou"
        value={p.kind}
        options={(Object.keys(HOLE_KIND_LABELS) as HoleKind[]).map((k) => ({ value: k, label: HOLE_KIND_LABELS[k], title: HOLE_KIND_HELP[k] }))}
        onChange={(kind) => choose({ kind })}
      />
      <p class="field-help">{HOLE_KIND_HELP[p.kind]}</p>
      <label class="field">
        <span class="field-label">Taille de vis</span>
        <select
          id="draft-size"
          class="select"
          value={p.size}
          onChange={(e) => {
            const size = (e.target as HTMLSelectElement).value as MetricSize | 'custom';
            // Diamètre libre : il part du diamètre actuel du trou.
            choose(size === 'custom' ? { size, diameter: p.diameter ?? Math.round(d * 10) / 10 } : { size });
          }}
        >
          {METRIC_SIZES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
          <option value="custom">Diamètre libre</option>
        </select>
      </label>
      {p.size === 'custom' ? (
        lengthField('diameter', 'Diamètre du perçage', 'Le trou a exactement ce diamètre (pour un axe, une tige, un aimant…).')
      ) : p.kind === 'tapped' ? (
        <Segmented<'tap' | 'plastic'>
          label="Filetage"
          value={p.thread ?? 'tap'}
          options={[
            { value: 'tap', label: 'Au taraud', title: 'Perçage avant taraudage de la norme ISO (M3 : 2,5 mm) : on fait le filet avec un taraud' },
            { value: 'plastic', label: 'Dans le plastique', title: 'La vis forme son filet en se vissant dans la pièce imprimée (0,9 × le diamètre de la vis)' },
          ]}
          onChange={(thread) => update((x) => withParams(x, { thread }))}
        />
      ) : (
        <>
          <Segmented
            label="Jeu autour de la vis"
            value={p.fit}
            options={(Object.keys(HOLE_FIT_LABELS) as HoleFit[]).map((k) => ({ value: k, label: HOLE_FIT_LABELS[k], title: k === 'custom' ? 'Jeu choisi, ajouté au diamètre de la vis' : k === 'none' ? 'Le trou a exactement le diamètre de la vis' : `Série ${HOLE_FIT_LABELS[k].toLowerCase()} de la norme ISO 273` }))}
            onChange={(fit) => (fit === 'custom' ? setField('clearance', mm(p.clearance ?? 0.3), { feature: withParams(f, { fit, clearance: p.clearance ?? 0.3 }) }) : update((x) => withParams(x, { fit })))}
          />
          {p.fit === 'custom' ? lengthField('clearance', 'Jeu (ajouté au diamètre de la vis)', 'En impression 3D, 0,2 à 0,4 mm suffisent en général ; faites un essai avec votre imprimante.') : null}
        </>
      )}
      <p class="field-help" id="draft-hole-figures">
        Trou Ø {formatNumber(d, 2)} mm
        {p.size !== 'custom' && p.kind === 'tapped' ? (p.thread === 'plastic' ? ` (la vis ${p.size} forme son filet dans le plastique)` : ` (perçage avant taraudage ${p.size})`) : ''}
        {p.size !== 'custom' && p.kind !== 'tapped' ? (p.fit === 'custom' ? ` (vis ${p.size} + jeu de ${formatNumber(p.clearance ?? 0.3, 2)} mm)` : p.fit === 'none' ? ` (diamètre de la vis ${p.size}, sans jeu)` : ` (série ${HOLE_FIT_LABELS[p.fit].toLowerCase()} ISO 273)`) : ''}
        {p.kind === 'counterbore' ? `, lamage Ø ${formatNumber(p.headDiameter, 2)} mm sur ${formatNumber(p.headDepth, 2)} mm` : ''}
        {p.kind === 'countersink' ? `, fraisure à 90° Ø ${formatNumber(p.headDiameter, 2)} mm` : ''}.
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
