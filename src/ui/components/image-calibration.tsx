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

/** Zone de dessin (px) ; la loupe grossit 4 fois ce qui est sous la souris. */
const VIEW_W = 860;
const VIEW_H = 520;
const LOUPE_R = 70;
const LOUPE_ZOOM = 4;

export function ImageCalibrationDialog(props: { mode: 'scale' | 'perspective'; resource: StepResource; params: ImageParams; onApply: (change: Partial<ImageParams>) => void; onClose: () => void }) {
  const { mode, params } = props;
  const canvas = useRef<HTMLCanvasElement>(null);
  const [points, setPoints] = useState<Vec2[]>([]);
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const [, setTick] = useState(0);
  const source = mode === 'scale' ? imageSource(props.resource, params) : decodedImage(props.resource);
  const need = mode === 'scale' ? 2 : 4;
  const sw = source ? ((source as { width: number }).width ?? 1) : 1;
  const sh = source ? ((source as { height: number }).height ?? 1) : 1;
  // Vue : échelle (px d'écran par px d'image) et position du coin haut-gauche de l'image.
  const fit = Math.min(VIEW_W / sw, VIEW_H / sh);
  const [view, setView] = useState<{ k: number; x: number; y: number } | null>(null);
  const v = view ?? { k: fit, x: (VIEW_W - sw * fit) / 2, y: (VIEW_H - sh * fit) / 2 };
  const [mouse, setMouse] = useState<{ x: number; y: number } | null>(null);
  const drag = useRef<{ kind: 'pan' | 'point'; index: number; sx: number; sy: number; vx: number; vy: number; moved: boolean } | null>(null);
  // Image (normalisé, y vers le haut) ↔ écran (px du canevas).
  const toScreen = (p: Vec2) => ({ x: v.x + p.x * sw * v.k, y: v.y + (1 - p.y) * sh * v.k });
  const toImage = (x: number, y: number): Vec2 => ({ x: (x - v.x) / (sw * v.k), y: 1 - (y - v.y) / (sh * v.k) });
  useEffect(() => {
    if (!source) {
      const t = setTimeout(() => setTick((x) => x + 1), 150);
      return () => clearTimeout(t);
    }
    const ctx = canvas.current?.getContext('2d');
    if (!ctx) return;
    const drawScene = () => {
      ctx.drawImage(source, v.x, v.y, sw * v.k, sh * v.k);
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#e06c00';
      ctx.fillStyle = '#e06c00';
      ctx.font = 'bold 13px sans-serif';
      if (points.length > 1) {
        ctx.beginPath();
        points.forEach((p, i) => (i ? ctx.lineTo(toScreen(p).x, toScreen(p).y) : ctx.moveTo(toScreen(p).x, toScreen(p).y)));
        if (mode === 'perspective' && points.length === 4) ctx.closePath();
        ctx.stroke();
      }
      points.forEach((p, i) => {
        const q = toScreen(p);
        ctx.beginPath();
        ctx.arc(q.x, q.y, 5, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(q.x - 9, q.y);
        ctx.lineTo(q.x + 9, q.y);
        ctx.moveTo(q.x, q.y - 9);
        ctx.lineTo(q.x, q.y + 9);
        ctx.stroke();
        ctx.fillText(String(i + 1), q.x + 8, q.y - 8);
      });
    };
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, VIEW_W, VIEW_H);
    drawScene();
    // Loupe : la même scène, grossie autour de la souris, dans un disque, avec une croix.
    if (mouse && !drag.current?.moved) {
      const cx = mouse.x;
      const cy = mouse.y;
      const lx = Math.min(VIEW_W - LOUPE_R - 4, Math.max(LOUPE_R + 4, cx + (cx > VIEW_W - 2.5 * LOUPE_R ? -1.6 : 1.6) * LOUPE_R));
      const ly = Math.min(VIEW_H - LOUPE_R - 4, Math.max(LOUPE_R + 4, cy - 1.6 * LOUPE_R));
      ctx.save();
      ctx.beginPath();
      ctx.arc(lx, ly, LOUPE_R, 0, Math.PI * 2);
      ctx.clip();
      ctx.fillStyle = '#fff';
      ctx.fillRect(lx - LOUPE_R, ly - LOUPE_R, 2 * LOUPE_R, 2 * LOUPE_R);
      ctx.setTransform(LOUPE_ZOOM, 0, 0, LOUPE_ZOOM, lx - LOUPE_ZOOM * cx, ly - LOUPE_ZOOM * cy);
      drawScene();
      ctx.restore();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.strokeStyle = '#1f5fbf';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(lx, ly, LOUPE_R, 0, Math.PI * 2);
      ctx.stroke();
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(lx - LOUPE_R, ly);
      ctx.lineTo(lx + LOUPE_R, ly);
      ctx.moveTo(lx, ly - LOUPE_R);
      ctx.lineTo(lx, ly + LOUPE_R);
      ctx.stroke();
    }
  });
  const local = (e: MouseEvent) => {
    const r = canvas.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) * VIEW_W) / r.width, y: ((e.clientY - r.top) * VIEW_H) / r.height };
  };
  const onDown = (e: PointerEvent) => {
    const m = local(e);
    // Appui sur un point déjà posé : on le déplace ; ailleurs : clic (nouveau point) ou glisser (vue).
    const index = points.findIndex((p) => Math.hypot(toScreen(p).x - m.x, toScreen(p).y - m.y) < 10);
    drag.current = { kind: index >= 0 && e.button === 0 ? 'point' : 'pan', index, sx: m.x, sy: m.y, vx: v.x, vy: v.y, moved: false };
    canvas.current!.setPointerCapture(e.pointerId);
  };
  const onMove = (e: PointerEvent) => {
    const m = local(e);
    setMouse(m);
    const d = drag.current;
    if (!d) return;
    if (Math.hypot(m.x - d.sx, m.y - d.sy) > 3) d.moved = true;
    if (!d.moved) return;
    if (d.kind === 'point') setPoints((pts) => pts.map((p, i) => (i === d.index ? toImage(m.x, m.y) : p)));
    else setView({ k: v.k, x: d.vx + m.x - d.sx, y: d.vy + m.y - d.sy });
  };
  const onUp = (e: PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d || d.moved || d.kind === 'point' || e.button !== 0) return;
    const p = toImage(d.sx, d.sy);
    setPoints((pts) => (pts.length >= need ? [p] : [...pts, p]));
  };
  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const m = local(e);
    const k = Math.min(fit * 40, Math.max(fit * 0.5, v.k * (e.deltaY < 0 ? 1.25 : 0.8)));
    // Zoom centré sur la souris : le point sous le curseur ne bouge pas.
    setView({ k, x: m.x - ((m.x - v.x) * k) / v.k, y: m.y - ((m.y - v.y) * k) / v.k });
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
        {source ? (
          <canvas
            ref={canvas}
            width={VIEW_W}
            height={VIEW_H}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerLeave={() => setMouse(null)}
            onWheel={onWheel}
            onContextMenu={(e) => e.preventDefault()}
            aria-label="Image à régler : cliquez les points ; molette : zoom ; glisser : déplacer la vue ou un point"
          />
        ) : (
          <p class="field-help">Chargement de l’image…</p>
        )}
      </div>
      <p class="field-help">
        Molette : zoomer là où est la souris · glisser : déplacer l’image · glisser un point posé : l’ajuster · la loupe grossit 4 fois.{' '}
        <button type="button" class="tl-link" onClick={() => setView(null)}>
          Tout voir
        </button>
      </p>
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
