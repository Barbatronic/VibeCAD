/**
 * Réglages d'un tampon : avec l'outil Tampon, ceux du prochain posé ; avec un tampon sélectionné,
 * sa forme, sa taille et sa rotation.
 */
import { formatLength, parseLength, readNumber } from '../domain/units';
import type { SketchSession } from '../sketch/session';
import { chooseStamp, editStamp, selectedStamp, setStampOptions } from '../sketch/session';
import type { StampShape } from '../sketch/stamp';
import { projectStamps, stampGallery } from '../stamps';
import { Button, LengthField } from './components/controls';
import { useAppState, useController } from './context';
import { useField } from './SketchTextFields';

const fmt = (v: number) => formatLength(v, 2, false);

/** Image d'un contour normalisé (y vers le haut : retourné pour l'écran). */
export function StampPicture({ outline }: { outline: string }) {
  return (
    <svg viewBox="-0.55 -0.55 1.1 1.1" aria-hidden="true">
      <path d={outline} transform="scale(1 -1)" fill-rule="evenodd" />
    </svg>
  );
}

function StampTile({ shape, active, onPick }: { shape: StampShape; active: boolean; onPick: () => void }) {
  return (
    <button type="button" class="stamp-tile" aria-pressed={active} title={shape.name} aria-label={shape.name} onClick={onPick}>
      <StampPicture outline={shape.outline} />
    </button>
  );
}

export function SketchStampFields({ session }: { session: SketchSession }) {
  const c = useController();
  const doc = useAppState((s) => s.doc);
  const target = selectedStamp(session);
  const placing = session.tool === 'stamp';
  const key = target?.id ?? 'tool';
  const value = target ? { size: target.size, angle: target.angle ?? 0 } : session.stampOptions;
  const [size, setSize, sizeError, setSizeError] = useField(fmt(value.size), key);
  const [angle, setAngle, angleError, setAngleError] = useField(fmt(value.angle), key);
  if (!placing && !target) return null;

  const apply = (patch: { size?: number; angle?: number }) => c.updateSession((s) => (target ? editStamp(s, target.id, patch) : setStampOptions(s, patch)));
  const current = target?.outline ?? session.stampOptions.shape?.outline;
  const tiles = (shapes: StampShape[]) => (
    <div class="stamp-gallery">
      {shapes.map((shape) => (
        <StampTile key={shape.outline} shape={shape} active={shape.outline === current} onPick={() => c.updateSession((s) => chooseStamp(s, shape))} />
      ))}
    </div>
  );
  const imported = projectStamps(doc, [session.stampOptions.shape, target && { name: target.name, outline: target.outline }]);
  return (
    <div class="sketch-text-fields">
      <div class="field">
        <span class="field-label">{target ? `Tampon sélectionné : ${target.name}` : 'Forme à poser'}</span>
        {tiles(stampGallery())}
      </div>
      {imported.length > 0 ? (
        <div class="field">
          <span class="field-label">Dans ce projet</span>
          {tiles(imported)}
        </div>
      ) : null}
      <Button small icon="open" onClick={() => void c.importStamp()}>
        Importer un dessin…
      </Button>
      <p class="field-help">Un fichier SVG, ou la photo d’un dessin en noir et blanc (PNG, JPEG, WebP).</p>
      <LengthField
        id="sketch-stamp-size"
        label="Taille (plus grand côté)"
        value={size}
        error={sizeError}
        min={1}
        onInput={(t) => {
          setSize(t);
          const r = parseLength(t, { label: 'La taille', min: 1 });
          setSizeError(r.ok ? null : r.error);
          if (r.ok) apply({ size: r.value });
        }}
      />
      <LengthField
        id="sketch-stamp-angle"
        label="Rotation"
        unit="°"
        step={15}
        value={angle}
        error={angleError}
        onInput={(t) => {
          setAngle(t);
          const v = readNumber(t);
          const ok = v !== null && Math.abs(v) <= 360;
          setAngleError(ok ? null : 'La rotation doit être un nombre de degrés entre −360 et 360.');
          if (ok) apply({ angle: v });
        }}
      />
      {placing ? <p class="field-help">Cliquez dans l’esquisse pour poser le tampon par son centre. Il s’accroche à l’origine, aux axes et aux points.</p> : null}
    </div>
  );
}
