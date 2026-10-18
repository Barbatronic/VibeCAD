/**
 * Plaques en grand (découpe laser) : la plaque d'un matériau à la taille de la fenêtre. On y
 * déplace les pièces à la souris, on les tourne (R, ou un angle), on change de plaque, on optimise
 * l'imbrication. Les pièces qui se chevauchent ou dépassent sont en rouge. Molette : zoom ;
 * glisser le fond : déplacer la vue.
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import { placeLoops, placementProblems } from '../app/nesting';
import type { PlacedOutline } from '../app/laser';
import { formatLength, formatNumber, readNumber } from '../domain/units';
import { useAppState, useController } from './context';
import { Button, IconButton } from './components/controls';
import { NumberInput } from './components/number-input';
import { Icon } from './icons';

type View = { k: number; x: number; y: number };

export function LaserEditor() {
  const c = useController();
  const materialId = useAppState((s) => s.laserEditor?.materialId ?? null);
  // Réévalué à chaque changement d'état : la disposition suit le projet.
  useAppState((s) => [s.doc.fabrication, s.display]);
  const layout = materialId ? c.laserLayout() : null;
  const group = layout?.materials.find((g) => g.material.id === materialId) ?? null;
  const spacing = c.fabrication().laser.spacing;
  const [sheet, setSheet] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ key: string; dx: number; dy: number; x: number; y: number; moved: boolean } | null>(null);
  const [pan, setPan] = useState<{ sx: number; sy: number; v: View } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 1000, h: 600 });
  const [view, setView] = useState<View | null>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [materialId]);
  // Dernières pièces affichées, pour le clavier (l'écouteur est posé une fois).
  const latest = useRef<{ pieces: PlacedOutline[]; selected: string | null }>({ pieces: [], selected: null });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!materialId || (e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'SELECT') return;
      if (e.key === 'Escape') {
        e.stopPropagation();
        c.openLaserEditor(null);
      }
      const piece = latest.current.pieces.find((p) => `${p.partId}#${p.copy}` === latest.current.selected);
      if (!piece) return;
      const nudge = e.shiftKey ? 10 : 1;
      const move = (dx: number, dy: number, da = 0) => {
        e.preventDefault();
        c.placeLaserPiece(materialId, piece.partId, piece.copy, { sheet: piece.sheet, x: piece.placement.x + dx, y: piece.placement.y + dy, angle: piece.placement.angle + da });
      };
      if (e.key === 'r' || e.key === 'R') move(0, 0, e.shiftKey ? -90 : 90);
      if (e.key === 'ArrowLeft') move(-nudge, 0);
      if (e.key === 'ArrowRight') move(nudge, 0);
      if (e.key === 'ArrowUp') move(0, nudge);
      if (e.key === 'ArrowDown') move(0, -nudge);
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [materialId]);
  if (!materialId || !group) return null;
  const { w, h } = group.material.sheet;
  const sheets = Math.max(1, group.sheets);
  const current = Math.min(sheet, sheets - 1);
  const key = (p: PlacedOutline) => `${p.partId}#${p.copy}`;
  // Pièce tirée : affichée à sa position en cours (enregistrée au relâchement).
  const pieces = group.placed.map((p) => (drag && drag.moved && key(p) === drag.key ? { ...p, placement: { ...p.placement, x: drag.x, y: drag.y }, loops: placeLoops(p.local, { ...p.placement, x: drag.x, y: drag.y }) } : p));
  latest.current = { pieces, selected };
  const problems = placementProblems(pieces, group.material.sheet);
  const onSheet = pieces.map((p, i) => ({ p, i })).filter(({ p }) => p.sheet === current);
  const sel = pieces.find((p) => key(p) === selected) ?? null;
  // Vue : la plaque tient dans la fenêtre (marge 30 px), y vers le haut.
  const fit: View = (() => {
    const k = Math.min((size.w - 60) / w, (size.h - 60) / h);
    return { k, x: (size.w - w * k) / 2, y: (size.h - h * k) / 2 };
  })();
  const v = view ?? fit;
  const sx = (x: number) => v.x + x * v.k;
  const sy = (y: number) => v.y + (h - y) * v.k;
  const toSheet = (px: number, py: number) => ({ x: (px - v.x) / v.k, y: h - (py - v.y) / v.k });
  const local = (e: PointerEvent | WheelEvent) => {
    const r = box.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const path = (loops: { x: number; y: number }[][]) => loops.map((l) => l.map((q, i) => `${i ? 'L' : 'M'}${sx(q.x).toFixed(1)},${sy(q.y).toFixed(1)}`).join('') + 'Z').join('');
  const onPieceDown = (e: PointerEvent, p: PlacedOutline) => {
    e.stopPropagation();
    const m = local(e);
    const at = toSheet(m.x, m.y);
    setSelected(key(p));
    setDrag({ key: key(p), dx: p.placement.x - at.x, dy: p.placement.y - at.y, x: p.placement.x, y: p.placement.y, moved: false });
    box.current!.setPointerCapture(e.pointerId);
  };
  const onDown = (e: PointerEvent) => {
    setSelected(null);
    setPan({ sx: e.clientX, sy: e.clientY, v });
    box.current!.setPointerCapture(e.pointerId);
  };
  const onMove = (e: PointerEvent) => {
    if (drag) {
      const m = local(e);
      const at = toSheet(m.x, m.y);
      setDrag({ ...drag, x: at.x + drag.dx, y: at.y + drag.dy, moved: drag.moved || Math.hypot(at.x + drag.dx - drag.x, at.y + drag.dy - drag.y) * v.k > 2 });
    } else if (pan) setView({ k: pan.v.k, x: pan.v.x + e.clientX - pan.sx, y: pan.v.y + e.clientY - pan.sy });
  };
  const onUp = () => {
    if (drag?.moved) {
      const p = group.placed.find((x) => key(x) === drag.key);
      if (p) c.placeLaserPiece(materialId, p.partId, p.copy, { sheet: p.sheet, x: Math.round(drag.x * 10) / 10, y: Math.round(drag.y * 10) / 10, angle: p.placement.angle });
    }
    setDrag(null);
    setPan(null);
  };
  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const m = local(e);
    const k = Math.min(fit.k * 30, Math.max(fit.k * 0.5, v.k * (e.deltaY < 0 ? 1.2 : 1 / 1.2)));
    setView({ k, x: m.x - ((m.x - v.x) * k) / v.k, y: m.y - ((m.y - v.y) * k) / v.k });
  };
  const nOverlap = [...problems.overlap].filter((i) => pieces[i]!.sheet === current).length;
  const nOutside = [...problems.outside].filter((i) => pieces[i]!.sheet === current).length;
  return (
    <div class="laser-editor" role="dialog" aria-modal="true" aria-label={`Plaques en grand : ${group.material.name}`}>
      <div class="laser-editor-bar">
        <Icon name="laser" />
        <strong>{group.material.name}</strong>
        <span class="field-help">
          plaque {formatLength(w, 0)} × {formatLength(h, 0)}, espacement {formatLength(spacing)}
        </span>
        <div class="segmented" role="tablist" aria-label="Plaques">
          {Array.from({ length: sheets }, (_, i) => (
            <button key={i} type="button" role="tab" aria-selected={i === current} onClick={() => setSheet(i)}>
              Plaque {i + 1}
            </button>
          ))}
        </div>
        <span class="spacer" />
        <Button small icon="target" onClick={() => c.optimizeLaser(materialId)}>
          Optimiser
        </Button>
        <Button small icon="undo" onClick={() => c.resetLaserPlacements(materialId)}>
          Ranger automatiquement
        </Button>
        <Button small icon="fit" onClick={() => setView(null)}>
          Tout voir
        </Button>
        <IconButton icon="close" label="Fermer les plaques en grand (Échap)" onClick={() => c.openLaserEditor(null)} />
      </div>
      {sel ? (
        <div class="laser-editor-bar secondary">
          <span>
            <strong>{sel.name}</strong>
          </span>
          <Button small icon="redo" onClick={() => c.placeLaserPiece(materialId, sel.partId, sel.copy, { sheet: sel.sheet, ...sel.placement, angle: sel.placement.angle + 90 }, 'Tourner une pièce')}>
            Tourner de 90° (R)
          </Button>
          <label class="mini-field inline">
            <span>Angle</span>
            <NumberInput
              value={formatNumber(sel.placement.angle, 1)}
              unit="°"
              step={15}
              ariaLabel="Angle de la pièce"
              onInput={(t) => {
                const a = readNumber(t);
                if (a !== null) c.placeLaserPiece(materialId, sel.partId, sel.copy, { sheet: sel.sheet, ...sel.placement, angle: a }, 'Tourner une pièce');
              }}
            />
          </label>
          <label class="mini-field inline">
            <span>Plaque</span>
            <select
              class="select"
              aria-label="Plaque de la pièce"
              value={String(sel.sheet)}
              onChange={(e) => {
                const target = Number((e.target as HTMLSelectElement).value);
                c.placeLaserPiece(materialId, sel.partId, sel.copy, { sheet: target, ...sel.placement }, 'Changer une pièce de plaque');
                setSheet(target);
              }}
            >
              {Array.from({ length: sheets + 1 }, (_, i) => (
                <option key={i} value={String(i)}>
                  {i < sheets ? `Plaque ${i + 1}` : 'Nouvelle plaque'}
                </option>
              ))}
            </select>
          </label>
          <span class="field-help">Flèches : déplacer de 1 mm (Maj : 10 mm) · R : tourner</span>
        </div>
      ) : null}
      <div class="laser-editor-view" ref={box} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onWheel={onWheel}>
        <svg width={size.w} height={size.h} role="img" aria-label={`Plaque ${current + 1} en grand`}>
          <rect class="laser-sheet" x={sx(0)} y={sy(h)} width={w * v.k} height={h * v.k} />
          <rect class="laser-sheet-margin" x={sx(spacing)} y={sy(h - spacing)} width={(w - 2 * spacing) * v.k} height={(h - 2 * spacing) * v.k} />
          {onSheet.map(({ p, i }) => {
            const bad = problems.overlap.has(i) || problems.outside.has(i);
            return (
              <g key={key(p)} class={`laser-piece${bad ? ' is-bad' : ''}${key(p) === selected ? ' is-selected' : ''}`} onPointerDown={(e) => onPieceDown(e as PointerEvent, p)} data-piece={key(p)}>
                <path d={path(p.loops)} fill-rule="evenodd" />
                {(p.bends ?? []).map((b, j) => (
                  <line key={j} class="laser-bend" x1={sx(b.a.x)} y1={sy(b.a.y)} x2={sx(b.b.x)} y2={sy(b.b.y)} />
                ))}
                <text x={sx(p.placement.x)} y={sy(p.placement.y)} text-anchor="middle" dominant-baseline="middle">
                  {p.name}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      <div class="laser-editor-status" role="status">
        {onSheet.length} pièce{onSheet.length > 1 ? 's' : ''} sur la plaque {current + 1} ({sheets} plaque{sheets > 1 ? 's' : ''} en tout)
        {nOverlap ? <span class="laser-warn"> · {nOverlap} pièce(s) se chevauchent</span> : null}
        {nOutside ? <span class="laser-warn"> · {nOutside} pièce(s) dépassent de la plaque</span> : null}
        <span class="field-help"> · Glisser une pièce : la déplacer · glisser le fond : déplacer la vue · molette : zoom</span>
      </div>
    </div>
  );
}
