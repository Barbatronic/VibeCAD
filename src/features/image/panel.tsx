/** Panneau « Image » : support, taille, position, rotation, miroir, opacité, mise à l'échelle et redressement. */
import { useState } from 'preact/hooks';
import type { ImageFeature, ImageParams, PlaneName } from '../../domain/model';
import { formatLength, formatNumber, parseLength, readNumber } from '../../domain/units';
import { Button, LengthField, Segmented } from '../../ui/components/controls';
import { PreviewStatus, withParams } from '../../ui/components/feature-fields';
import { ImageCalibrationDialog } from '../../ui/components/image-calibration';
import { useAppState } from '../../ui/context';
import type { FeaturePanelProps } from '../panel-types';

const PLANES: { value: PlaneName; label: string }[] = [
  { value: 'XY', label: 'Dessus (XY)' },
  { value: 'XZ', label: 'Face (XZ)' },
  { value: 'YZ', label: 'Droite (YZ)' },
];

export function ImagePanel(props: FeaturePanelProps<ImageFeature>) {
  const { draft, update, setField } = props;
  const f = draft.feature;
  const p = f.params;
  const resource = useAppState((s) => s.doc.resources[p.resourceId] ?? (s.pendingImage?.id === p.resourceId ? s.pendingImage : null));
  const [dialog, setDialog] = useState<'scale' | 'perspective' | null>(null);
  const apply = (change: Partial<ImageParams>) => {
    const next = withParams(f, change);
    setField('width', formatLength(next.params.width, 3, false), { feature: next });
  };
  const length = (name: 'width' | 'cx' | 'cy', label: string, help: string, set: (v: number) => Partial<ImageParams>) => (
    <LengthField
      id={`draft-image-${name}`}
      label={label}
      value={draft.fields[name] ?? ''}
      error={draft.errors[name] ?? null}
      help={help}
      selectOnFocus
      onInput={(text) => {
        const parsed = parseLength(text, { label });
        const err = parsed.ok && name === 'width' && parsed.value <= 0 ? 'La largeur doit être positive.' : parsed.ok ? null : parsed.error;
        setField(name, text, err ? { error: err } : { feature: withParams(f, set((parsed as { value: number }).value)) });
      }}
      onEnter={props.confirm}
      onEscape={props.cancel}
    />
  );
  return (
    <>
      {p.support.kind === 'plane' ? (
        <Segmented<PlaneName>
          label="Plan"
          value={p.support.plane}
          options={PLANES.map((x) => ({ ...x, title: `Poser l’image sur le plan ${x.label}` }))}
          onChange={(plane) => update((x) => withParams(x, { support: { kind: 'plane', plane, offset: 0 } }))}
        />
      ) : (
        <span class="field-help">Posée sur la face choisie. Pour un plan d’origine, sélectionnez rien avant d’ajouter l’image.</span>
      )}
      <div class="image-actions">
        <Button small icon="dimension" disabled={!resource} onClick={() => setDialog('scale')}>
          Mettre à l’échelle (2 points)…
        </Button>
        <Button small icon="image" disabled={!resource} onClick={() => setDialog('perspective')}>
          Redresser (perspective)…
        </Button>
        {p.perspective ? (
          <Button small icon="close" onClick={() => apply({ perspective: undefined, width: p.width / 2 })}>
            Annuler le redressement
          </Button>
        ) : null}
      </div>
      {length('width', 'Largeur', 'La hauteur suit les proportions de l’image. « Mettre à l’échelle » la règle d’après deux points.', (width) => ({ width }))}
      <div class="limits-row">
        {length('cx', 'Centre X', 'Position dans le plan', (x) => ({ center: { ...p.center, x } }))}
        {length('cy', 'Centre Y', '', (y) => ({ center: { ...p.center, y } }))}
      </div>
      <LengthField
        id="draft-image-rotation"
        label="Rotation"
        unit="°"
        step={15}
        value={draft.fields.rotation ?? ''}
        error={draft.errors.rotation ?? null}
        selectOnFocus
        onInput={(text) => {
          const v = readNumber(text);
          setField('rotation', text, v === null ? { error: 'La rotation doit être un nombre de degrés.' } : { feature: withParams(f, { rotation: v }) });
        }}
        onEnter={props.confirm}
        onEscape={props.cancel}
      />
      <label class="checkbox-row">
        <input type="checkbox" checked={p.mirror} onChange={() => update((x) => withParams(x, { mirror: !x.params.mirror }))} />
        <span>Miroir (retourner l’image gauche-droite)</span>
      </label>
      <div class="field">
        <label class="field-label" for="draft-image-opacity">
          Opacité : {formatNumber(p.opacity * 100, 0)} %
        </label>
        <input id="draft-image-opacity" type="range" min={0.1} max={1} step={0.05} value={p.opacity} onInput={(e) => update((x) => withParams(x, { opacity: Number((e.target as HTMLInputElement).value) }))} />
      </div>
      <PreviewStatus status={props.status} kind="modify" />
      {dialog && resource ? <ImageCalibrationDialog mode={dialog} resource={resource} params={p} onApply={apply} onClose={() => setDialog(null)} /> : null}
    </>
  );
}
