/**
 * Fenêtres de réglage d'une image de référence : mise à l'échelle par deux points (sur l'image
 * affichée, redressée ou non) et redressement par les quatre coins d'un rectangle connu (sur
 * l'image d'origine). Les points sont en coordonnées normalisées (0 → 1, y vers le haut).
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import { calibratedWidth, perspectiveSettings } from '../../app/images';
import type { ImageParams, StepResource } from '../../domain/model';
import { formatLength, parseLength } from '../../domain/units';
import type { Vec2 } from '../../math/vec';
import { decodedImage, imageSource } from '../image-cache';
import { Button, Callout, LengthField } from './controls';
import { Modal } from './modal';

const CORNER_NAMES = ['bas gauche', 'bas droit', 'haut droit', 'haut gauche'];

export function ImageCalibrationDialog(props: { mode: 'scale' | 'perspective'; resource: StepResource; params: ImageParams; onApply: (change: Partial<ImageParams>) => void; onClose: () => void }) {
  const { mode, params } = props;
  const canvas = useRef<HTMLCanvasElement>(null);
  const [points, setPoints] = useState<Vec2[]>([]);
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const [, setTick] = useState(0);
  const source = mode === 'scale' ? imageSource(props.resource, params) : decodedImage(props.resource);
  const need = mode === 'scale' ? 2 : 4;
  // Taille du dessin : l'image tient dans 640 × 420 px, proportions gardées.
  const sw = source ? ((source as { width: number }).width ?? 1) : 1;
  const sh = source ? ((source as { height: number }).height ?? 1) : 1;
  const k = Math.min(640 / sw, 420 / sh);
  const w = Math.max(1, Math.round(sw * k));
  const h = Math.max(1, Math.round(sh * k));
  useEffect(() => {
    if (!source) {
      const t = setTimeout(() => setTick((x) => x + 1), 150);
      return () => clearTimeout(t);
    }
    const ctx = canvas.current?.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(source, 0, 0, w, h);
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#e06c00';
    ctx.fillStyle = '#e06c00';
    ctx.font = 'bold 13px sans-serif';
    const px = (p: Vec2) => ({ x: p.x * w, y: (1 - p.y) * h });
    if (points.length > 1) {
      ctx.beginPath();
      points.forEach((p, i) => (i ? ctx.lineTo(px(p).x, px(p).y) : ctx.moveTo(px(p).x, px(p).y)));
      if (mode === 'perspective' && points.length === 4) ctx.closePath();
      ctx.stroke();
    }
    points.forEach((p, i) => {
      const q = px(p);
      ctx.beginPath();
      ctx.arc(q.x, q.y, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillText(String(i + 1), q.x + 7, q.y - 7);
    });
  });
  const onClick = (e: MouseEvent) => {
    const r = canvas.current!.getBoundingClientRect();
    const p = { x: (e.clientX - r.left) / r.width, y: 1 - (e.clientY - r.top) / r.height };
    setPoints((pts) => (pts.length >= need ? [p] : [...pts, p]));
  };
  const valA = parseLength(a, { label: mode === 'scale' ? 'La distance' : 'La largeur' });
  const valB = parseLength(b, { label: 'La hauteur' });
  const ready = points.length === need && valA.ok && (mode === 'scale' || valB.ok);
  const apply = () => {
    if (!ready || !valA.ok) return;
    if (mode === 'scale') {
      const width = calibratedWidth(params, points[0]!, points[1]!, valA.value);
      if (width) props.onApply({ width });
    } else if (valB.ok) {
      props.onApply(perspectiveSettings(points as [Vec2, Vec2, Vec2, Vec2], valA.value, valB.value));
    }
    props.onClose();
  };
  const hint =
    mode === 'scale'
      ? points.length < 2
        ? `Cliquez le point ${points.length + 1} sur 2 : deux points dont vous connaissez la distance (les bouts d’une règle, une cote du plan).`
        : 'Indiquez la distance réelle entre les deux points. (Un nouveau clic recommence.)'
      : points.length < 4
        ? `Cliquez le coin ${CORNER_NAMES[points.length]} (${points.length + 1} sur 4) d’un rectangle connu : feuille A4, face d’une boîte…`
        : 'Indiquez la taille réelle de ce rectangle. (Un nouveau clic recommence.)';
  return (
    <Modal
      title={mode === 'scale' ? 'Mettre l’image à l’échelle' : 'Redresser l’image (perspective)'}
      wide
      onClose={props.onClose}
      footer={
        <>
          <Button onClick={props.onClose}>Annuler</Button>
          <Button variant="primary" disabled={!ready} onClick={apply}>
            Appliquer
          </Button>
        </>
      }
    >
      <Callout kind="info">
        <p>{hint}</p>
      </Callout>
      <div class="image-calibration">
        {source ? <canvas ref={canvas} width={w} height={h} onClick={onClick} aria-label="Image à régler : cliquez les points" /> : <p class="field-help">Chargement de l’image…</p>}
      </div>
      <div class="limits-row">
        <LengthField
          id="calib-a"
          label={mode === 'scale' ? 'Distance réelle entre les 2 points' : 'Largeur du rectangle (coins 1 → 2)'}
          value={a}
          error={a && !valA.ok ? valA.error : null}
          onInput={setA}
          onEnter={apply}
        />
        {mode === 'perspective' ? <LengthField id="calib-b" label="Hauteur du rectangle (coins 2 → 3)" value={b} error={b && !valB.ok ? valB.error : null} onInput={setB} onEnter={apply} /> : null}
      </div>
      {mode === 'perspective' ? <p class="field-help">Exemple : une feuille A4 posée à côté de la pièce fait {formatLength(210)} × {formatLength(297)}.</p> : null}
    </Modal>
  );
}
