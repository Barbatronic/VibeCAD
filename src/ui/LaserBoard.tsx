/**
 * Atelier découpe laser : les plaques à plat, en grand, à la place de la vue 3D. Un onglet par
 * matériau, une plaque à la fois. On y déplace les pièces à la souris, on les tourne (R, ou un
 * angle), on les change de plaque, on optimise l'imbrication. Les pièces qui se chevauchent ou
 * dépassent sont en rouge. Molette : zoom ; glisser le fond : déplacer la vue. Pour choisir la face
 * découpée d'une pièce, la vue 3D revient le temps du clic (bandeau en haut).
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import { placeLoops, placementProblems } from '../app/nesting';
import type { PlacedOutline } from '../app/laser';
import type { Id } from '../domain/model';
import { formatLength, formatNumber, readNumber } from '../domain/units';
import { useAppState, useController } from './context';
import { Button, IconButton } from './components/controls';
import { NumberInput } from './components/number-input';
import { Icon } from './icons';

type View = { k: number; x: number; y: number };

export function LaserBoard() {
  const c = useController();
  const on = useAppState((s) => s.workspace === 'fabrication' && s.fabricationTab === 'laser');
  const picking = useAppState((s) => (s.mode.kind === 'pick-fab-face' && s.mode.purpose === 'laser' ? (s.doc.parts.find((p) => p.id === (s.mode as { partId: Id }).partId)?.name ?? '') : null));
  const pages = useAppState(
    (s) => {
      if (!on) return [];
      void s.doc.fabrication;
      void s.display;
      return c.laserLayout().materials.map((g) => ({ id: g.material.id, name: g.material.name, count: g.placed.length }));
    },
    (a, b) => JSON.stringify(a) === JSON.stringify(b),
  );
  const chosen = useAppState((s) => s.laserPage);
  if (!on) return null;
  if (picking !== null) {
    return (
      <div class="laser-pick" role="status">
        <Icon name="target" />
        <span>
          Face à découper de <strong>« {picking} »</strong>
        </span>
        <Button small icon="close" onClick={() => c.cancelFabricationPick()}>
          Annuler
        </Button>
      </div>
    );
  }
  const page = pages.find((p) => p.id === chosen) ?? pages.find((p) => p.count > 0) ?? pages[0];
  return (
    <div class="laser-board" aria-label="Plaques de découpe">
      <div class="laser-board-bar">
        <div class="mat-tabs" role="tablist" aria-label="Matériaux">
          {pages.map((p) => (
            <button key={p.id} type="button" role="tab" aria-selected={p.id === page?.id} onClick={() => c.setLaserPage(p.id)}>
              {p.name}
              <span class="mat-count">{p.count}</span>
            </button>
          ))}
          <IconButton icon="plus" label="Ajouter un matériau" small onClick={() => c.setLaserPage(c.addLaserMaterial())} />
        </div>
      </div>
      {page ? <Board key={page.id} materialId={page.id} /> : null}
    </div>
  );
}

/** Plaques d'un matériau : sélection, glisser, clavier, zoom. */
function Board({ materialId }: { materialId: Id }) {
  const c = useController();
  // Réévalué à chaque changement d'état : la disposition suit le projet.
  useAppState((s) => [s.doc.fabrication, s.display]);
  const layout = c.laserLayout();
  const group = layout.materials.find((g) => g.material.id === materialId) ?? null;
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
  }, []);
  // Dernières pièces affichées, pour le clavier (l'écouteur est posé une fois).
  const latest = useRef<{ pieces: PlacedOutline[]; selected: string | null }>({ pieces: [], selected: null });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.tagName === 'INPUT' || target?.tagName === 'SELECT' || target?.closest('.modal')) return;
      const piece = latest.current.pieces.find((p) => `${p.partId}#${p.copy}` === latest.current.selected);
      if (!piece) return;
      if (e.key === 'Escape') {
        e.stopPropagation();
        setSelected(null);
        return;
      }
      const nudge = e.shiftKey ? 10 : 1;
      const move = (dx: number, dy: number, da = 0) => {
        e.preventDefault();
        e.stopPropagation();
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
  if (!group) return null;
  const { w, h } = group.material.sheet;
  const sheets = Math.max(1, group.sheets);
  const current = Math.min(sheet, sheets - 1);
  const key = (p: PlacedOutline) => `${p.partId}#${p.copy}`;
  // Pièce glissée : ses contours et ses gravures suivent (une translation, l'angle ne change pas).
  const shift = (loops: { x: number; y: number }[][], dx: number, dy: number) => loops.map((l) => l.map((q) => ({ x: q.x + dx, y: q.y + dy })));
  const pieces = group.placed.map((p) => {
    if (!(drag && drag.moved && key(p) === drag.key)) return p;
    const dx = drag.x - p.placement.x;
    const dy = drag.y - p.placement.y;
    return {
      ...p,
      placement: { ...p.placement, x: drag.x, y: drag.y },
      loops: placeLoops(p.local, { ...p.placement, x: drag.x, y: drag.y }),
      ...(p.engrave ? { engrave: p.engrave.map((m) => ({ fill: m.fill, loops: shift(m.loops, dx, dy) })) } : {}),
    };
  });
  latest.current = { pieces, selected };
  const problems = placementProblems(pieces, group.material.sheet);
  const onSheet = pieces.map((p, i) => ({ p, i })).filter(({ p }) => p.sheet === current);
  const sel = pieces.find((p) => key(p) === selected) ?? null;
  // Vue : la plaque tient dans la zone (marge 30 px), y vers le haut.
  const fit: View = (() => {
    const k = Math.max(1e-3, Math.min((size.w - 60) / w, (size.h - 60) / h));
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
  const empty = group.placed.length === 0;
  return (
    <>
      <div class="laser-board-bar">
        <div class="segmented" role="tablist" aria-label="Plaques">
          {Array.from({ length: sheets }, (_, i) => (
            <button key={i} type="button" role="tab" aria-selected={i === current} onClick={() => setSheet(i)}>
              Plaque {i + 1}
            </button>
          ))}
        </div>
        <span class="field-help">
          {formatLength(w, 0)} × {formatLength(h, 0)}
        </span>
        <span class="spacer" />
        <Button small icon="target" disabledReason={empty ? 'Aucune pièce' : null} onClick={() => c.optimizeLaser(materialId)}>
          Optimiser
        </Button>
        <Button small icon="undo" disabledReason={empty ? 'Aucune pièce' : null} onClick={() => c.resetLaserPlacements(materialId)}>
          Ranger automatiquement
        </Button>
        <IconButton icon="fit" label="Tout voir" small onClick={() => setView(null)} />
      </div>
      {/* Barre de la pièce choisie : posée sur la plaque, pour que le dessin ne bouge pas à la sélection. */}
      <div class="laser-board-stage">
        {sel ? (
          <div class="laser-board-bar secondary" onPointerDown={(e) => e.stopPropagation()}>
            <strong>{sel.name}</strong>
            <Button small icon="redo" onClick={() => c.placeLaserPiece(materialId, sel.partId, sel.copy, { sheet: sel.sheet, ...sel.placement, angle: sel.placement.angle + 90 }, 'Tourner une pièce')}>
              90° (R)
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
            <span class="field-help" title="Flèches : 1 mm · Maj + flèches : 10 mm · R : 90°">
              Flèches · R
            </span>
          </div>
        ) : null}
        <div class="laser-board-view" ref={box} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onWheel={onWheel}>
          <svg width={size.w} height={size.h} role="img" aria-label={`Plaque ${current + 1}`}>
            <rect class="laser-sheet" x={sx(0)} y={sy(h)} width={w * v.k} height={h * v.k} />
            <rect class="laser-sheet-margin" x={sx(spacing)} y={sy(h - spacing)} width={Math.max(0, (w - 2 * spacing) * v.k)} height={Math.max(0, (h - 2 * spacing) * v.k)} />
            {onSheet.map(({ p, i }) => {
              const bad = problems.overlap.has(i) || problems.outside.has(i);
              return (
                <g key={key(p)} class={`laser-piece${bad ? ' is-bad' : ''}${key(p) === selected ? ' is-selected' : ''}`} onPointerDown={(e) => onPieceDown(e as PointerEvent, p)} data-piece={key(p)}>
                  <path class="laser-cut" d={path(p.loops)} fill-rule="evenodd" />
                  {(p.engrave ?? []).map((m, j) => (
                    <path key={`g${j}`} class={`laser-engrave${m.fill ? ' is-fill' : ''}`} d={path(m.loops)} fill-rule="evenodd" />
                  ))}
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
      </div>
      <div class="laser-board-status" role="status">
        {empty ? 'Aucune pièce dans ce matériau' : `${onSheet.length} pièce${onSheet.length > 1 ? 's' : ''} · plaque ${current + 1} sur ${sheets}`}
        {nOverlap ? <span class="laser-warn"> · {nOverlap} chevauchement{nOverlap > 1 ? 's' : ''}</span> : null}
        {nOutside ? <span class="laser-warn"> · {nOutside} hors plaque</span> : null}
        <span class="laser-legend" aria-label="Légende">
          <i class="cut" /> découpe <i class="line" /> gravure en trait <i class="fill" /> gravure remplie
        </span>
      </div>
    </>
  );
}
