/** Champs communs d'un pli (bord plié, pli sur une ligne) : angle, sens, rayon, avec les limites du matériau. */
import type { BendDirection, FlangeFeature, FoldFeature, Part, SheetFeature } from '../../domain/model';
import { minBendRadius, sheetMaterial } from '../../domain/sheet-metal';
import { formatLength, formatNumber, parseLength, readNumber } from '../../domain/units';
import type { FeaturePanelProps } from '../../features/panel-types';
import { Callout, LengthField, Segmented } from './controls';
import { withParams } from './feature-fields';

/** Tôle de la pièce (première étape « Tôle »), pour les valeurs par défaut et les limites. */
export function sheetOf(part: Part): SheetFeature | null {
  return (part.features.find((f) => f.type === 'sheet') as SheetFeature | undefined) ?? null;
}

export function BendFields<F extends FlangeFeature | FoldFeature>(props: FeaturePanelProps<F> & { autoFocusAngle?: boolean }) {
  const { draft, update, setField } = props;
  const f = draft.feature;
  const sheet = sheetOf(props.part);
  const material = sheet ? sheetMaterial(sheet.params.materialId) : null;
  const min = sheet && material ? minBendRadius(material, sheet.params.thickness) : null;
  return (
    <>
      <LengthField
        id="draft-angle"
        label="Angle du pli"
        unit="°"
        step={15}
        min={0}
        value={draft.fields.angle ?? ''}
        error={draft.errors.angle ?? null}
        help={material ? `90° : à l’équerre. ${material.name} : ${formatNumber(material.maxAngle, 0)}° au plus.` : '90° : à l’équerre.'}
        autoFocus={props.autoFocusAngle ?? false}
        selectOnFocus
        onInput={(text) => {
          const v = readNumber(text);
          const err = v === null || v <= 0 || v > 180 ? 'L’angle du pli doit être entre 0 et 180°.' : null;
          setField('angle', text, err ? { error: err } : { feature: withParams(f, { angle: v! } as Partial<F['params']>) });
        }}
        onEnter={props.confirm}
        onEscape={props.cancel}
      />
      <Segmented<BendDirection>
        label="Sens"
        value={f.params.direction}
        options={[
          { value: 'up', label: 'Vers le haut', title: 'Le pli remonte du côté où la tôle a été épaissie' },
          { value: 'down', label: 'Vers le bas', title: 'Le pli descend de l’autre côté' },
        ]}
        onChange={(direction) => update((x) => withParams(x, { direction } as Partial<F['params']>))}
      />
      <LengthField
        id="draft-radius"
        label="Rayon intérieur"
        value={draft.fields.radius ?? ''}
        error={draft.errors.radius ?? null}
        help={sheet ? `Vide : celui de la tôle (${formatLength(sheet.params.radius)}).${min !== null ? ` Au moins ${formatLength(min)} pour ${material!.name.toLowerCase()} de ${formatLength(sheet.params.thickness)}.` : ''}` : 'Vide : celui de la tôle.'}
        selectOnFocus
        onInput={(text) => {
          if (!text.trim()) {
            const { radius: _r, ...rest } = f.params as F['params'] & { radius?: number };
            return setField('radius', text, { feature: { ...f, params: rest } as F });
          }
          const parsed = parseLength(text, { label: 'Le rayon' });
          setField('radius', text, parsed.ok ? { feature: withParams(f, { radius: parsed.value } as Partial<F['params']>) } : { error: parsed.error });
        }}
        onEnter={props.confirm}
        onEscape={props.cancel}
      />
      {material ? (
        <Callout kind="info">
          <p>
            {material.name}, {formatLength(sheet!.params.thickness)} : {material.method === 'hot' ? 'pliage à chaud' : 'pliage à froid'}. {material.note}
          </p>
        </Callout>
      ) : null}
    </>
  );
}
