/**
 * Mise en plan modifiable : la feuille en grand, à la place de la vue 3D (Fabrication › Documents).
 * On y déplace les vues, on ajoute des cotes (entre deux points de la pièce, ou sur un cercle), on
 * les fait glisser, on les supprime ; feuille et échelle se choisissent dans la barre. Molette :
 * zoom ; glisser le fond : déplacer la vue.
 */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { dragDimension, DRAWING_SCALES, leaderAngle, linearAt, nearestAnchor, nearestCircle, placeDimension, scaleLabel, VIEW_ORDER, type PlacedDimension, type ViewName } from '../app/drawings';
import type { DrawingDimension, Id } from '../domain/model';
import type { DrawingPage } from '../io/drawing';
import type { Vec2 } from '../math/vec';
import { useAppState, useController } from './context';
import { Button, IconButton } from './components/controls';

type View = { k: number; x: number; y: number };
type Tool = 'linear' | 'round' | null;
type Drag =
  | { kind: 'view'; name: ViewName; from: Vec2; dx: number; dy: number }
  | { kind: 'dim'; id: Id; change: Partial<DrawingDimension>; moved: boolean };

const num = (v: number) => v.toFixed(2);

export function DrawingBoard() {
  const c = useController();
  const partId = useAppState((s) => {
    if (s.workspace !== 'fabrication' || s.fabricationTab !== 'docs' || s.mode.kind === 'pick-fab-face') return null;
    void s.display;
    return c.docsPart();
  });
  const on = useAppState((s) => s.workspace === 'fabrication' && s.fabricationTab === 'docs' && s.mode.kind !== 'pick-fab-face');
  if (!on) return null;
  return (
    <div class="laser-board drawing-board" aria-label="Mise en plan">
      {partId ? <Sheet key={partId} partId={partId} /> : <p class="drawing-empty">Aucune pièce avec un volume.</p>}
    </div>
  );
}

function Sheet({ partId }: { partId: Id }) {
  const c = useController();
  // Réévalué quand le projet, la forme de la pièce ou ses traits exacts changent.
  useAppState((s) => [s.doc.fabrication?.drawings, s.display[partId], s.drawingRevision, s.doc.name, s.doc.parts, s.doc.materials]);
  const drawing = c.drawingOf(partId);
  const settings = c.drawingSettings(partId);
  const [tool, setTool] = useState<Tool>(null);
  const [pending, setPending] = useState<{ view: ViewName; a: Vec2; b?: Vec2 } | null>(null);
  const [hover, setHover] = useState<Vec2 | null>(null);
  const [selected, setSelected] = useState<Id | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [pan, setPan] = useState<{ sx: number; sy: number; v: View } | null>(null);
  const [view, setView] = useState<View | null>(null);
  const [size, setSize] = useState({ w: 1000, h: 600 });
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const latest = useRef({ selected, tool, pending });
  latest.current = { selected, tool, pending };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.tagName === 'INPUT' || target?.tagName === 'SELECT' || target?.tagName === 'TEXTAREA' || target?.closest('.modal')) return;
      const now = latest.current;
      if (e.key === 'Escape' && (now.tool || now.selected || now.pending)) {
        e.stopPropagation();
        if (now.pending) setPending(null);
        else if (now.tool) setTool(null);
        else setSelected(null);
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && now.selected) {
        e.preventDefault();
        e.stopPropagation();
        c.removeDrawingDimension(partId, now.selected);
        setSelected(null);
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [partId]);
  const layout = drawing?.layout ?? null;
  // Traits des vues et du cadre : refaits seulement quand la mise en page change.
  const paths = useMemo(() => {
    if (!layout) return null;
    const y = (v: number) => layout.height - v;
    const path = (lines: DrawingPage['lines'], style: (s: DrawingPage['lines'][number]['style']) => boolean) =>
      lines
        .filter((l) => style(l.style))
        .map((l) => `M${num(l.a.x)} ${num(y(l.a.y))}L${num(l.b.x)} ${num(y(l.b.y))}`)
        .join('');
    const of = (lines: DrawingPage['lines']) => ({ thick: path(lines, (s) => s === 'thick'), thin: path(lines, (s) => s === 'thin' || s === 'cut'), hidden: path(lines, (s) => s === 'hidden') });
    return { frame: of(layout.frame.lines), views: Object.fromEntries(VIEW_ORDER.map((name) => [name, of(layout.views[name].lines)])) as Record<ViewName, ReturnType<typeof of>> };
  }, [layout]);
  if (!drawing || !layout || !paths) return <p class="drawing-empty">Aucune pièce avec un volume.</p>;
  const { width: W, height: H, scale } = layout;
  const fit: View = (() => {
    const k = Math.max(1e-3, Math.min((size.w - 60) / W, (size.h - 60) / H));
    return { k, x: (size.w - W * k) / 2, y: (size.h - H * k) / 2 };
  })();
  const v = view ?? fit;
  const y = (py: number) => H - py;
  /** Pointeur → point de la feuille (mm, origine en bas à gauche). */
  const toPaper = (e: PointerEvent | WheelEvent): Vec2 => {
    const r = box.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left - v.x) / v.k, y: H - (e.clientY - r.top - v.y) / v.k };
  };
  const reach = 9 / v.k;
  const dims = layout.dimensions.map((d): PlacedDimension => (drag?.kind === 'dim' && drag.id === d.dim.id ? placeDimension({ ...d.dim, ...drag.change }, layout.views[d.dim.view], scale) : d));
  const sel = dims.find((d) => d.dim.id === selected) ?? null;
  // Cote en cours de pose : l'accroche sous le pointeur, puis la cote qui suit le pointeur.
  const snap = tool === 'linear' && hover && !pending?.b ? nearestAnchor(layout, hover, reach, pending?.view) : null;
  const ring = tool === 'round' && hover ? nearestCircle(layout, hover, reach) : null;
  const draft: PlacedDimension | null =
    tool === 'linear' && pending?.b && hover
      ? placeDimension({ id: 'draft', view: pending.view, kind: 'linear', a: pending.a, b: pending.b, ...linearAt(layout.views[pending.view], pending.a, pending.b, hover) }, layout.views[pending.view], scale)
      : null;
  const shiftOf = (name: ViewName): Vec2 => {
    if (drag?.kind !== 'view') return { x: 0, y: 0 };
    if (drag.name === 'face') return { x: drag.dx, y: drag.dy };
    return drag.name === name ? (name === 'dessus' ? { x: 0, y: drag.dy } : { x: drag.dx, y: 0 }) : { x: 0, y: 0 };
  };
  const onDown = (e: PointerEvent) => {
    const p = toPaper(e);
    box.current!.setPointerCapture(e.pointerId);
    if (tool === 'linear') {
      if (pending?.b) {
        const id = c.addDrawingDimension(partId, { view: pending.view, kind: 'linear', a: pending.a, b: pending.b, ...linearAt(layout.views[pending.view], pending.a, pending.b, p) });
        setPending(null);
        setSelected(id);
        return;
      }
      const hit = nearestAnchor(layout, p, reach, pending?.view);
      if (!hit) return;
      if (!pending) setPending({ view: hit.view, a: hit.point });
      else if (Math.hypot(hit.point.x - pending.a.x, hit.point.y - pending.a.y) > 1e-6) setPending({ ...pending, b: hit.point });
      return;
    }
    if (tool === 'round') {
      const hit = nearestCircle(layout, p, reach);
      if (!hit) return;
      const center = layout.views[hit.view].toPaper(hit.circle.center);
      setSelected(c.addDrawingDimension(partId, { view: hit.view, kind: hit.circle.full ? 'diameter' : 'radius', a: hit.circle.center, radius: hit.circle.radius, angle: leaderAngle(center, p), offset: 6 }));
      return;
    }
    setSelected(null);
    setPan({ sx: e.clientX, sy: e.clientY, v });
  };
  const onDimDown = (e: PointerEvent, d: PlacedDimension) => {
    if (tool) return;
    e.stopPropagation();
    box.current!.setPointerCapture(e.pointerId);
    setSelected(d.dim.id);
    setDrag({ kind: 'dim', id: d.dim.id, change: {}, moved: false });
  };
  const onViewDown = (e: PointerEvent, name: ViewName) => {
    if (tool) return;
    e.stopPropagation();
    box.current!.setPointerCapture(e.pointerId);
    setSelected(null);
    setDrag({ kind: 'view', name, from: toPaper(e), dx: 0, dy: 0 });
  };
  const onMove = (e: PointerEvent) => {
    const p = toPaper(e);
    if (tool) setHover(p);
    if (drag?.kind === 'dim') {
      const d = layout.dimensions.find((x) => x.dim.id === drag.id);
      if (d) setDrag({ ...drag, change: dragDimension(d.dim, layout.views[d.dim.view], scale, p), moved: true });
    } else if (drag?.kind === 'view') setDrag({ ...drag, dx: p.x - drag.from.x, dy: p.y - drag.from.y });
    else if (pan) setView({ k: pan.v.k, x: pan.v.x + e.clientX - pan.sx, y: pan.v.y + e.clientY - pan.sy });
  };
  const onUp = () => {
    if (drag?.kind === 'dim' && drag.moved && Object.keys(drag.change).length) c.changeDrawingDimension(partId, drag.id, drag.change);
    if (drag?.kind === 'view') {
      const dx = Math.round(drag.dx * 2) / 2;
      const dy = Math.round(drag.dy * 2) / 2;
      const moved = drag.name === 'face' ? dx !== 0 || dy !== 0 : drag.name === 'dessus' ? dy !== 0 : dx !== 0;
      if (moved) {
        c.updateDrawing(
          partId,
          (d) => {
            const before = d.views?.[drag.name] ?? { x: 0, y: 0 };
            const next = drag.name === 'face' ? { x: before.x + dx, y: before.y + dy } : drag.name === 'dessus' ? { x: 0, y: before.y + dy } : { x: before.x + dx, y: 0 };
            return { ...d, views: { ...d.views, [drag.name]: next } };
          },
          'Déplacer une vue du plan',
        );
      }
    }
    setDrag(null);
    setPan(null);
  };
  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const r = box.current!.getBoundingClientRect();
    const m = { x: e.clientX - r.left, y: e.clientY - r.top };
    const k = Math.min(fit.k * 40, Math.max(fit.k * 0.5, v.k * (e.deltaY < 0 ? 1.2 : 1 / 1.2)));
    setView({ k, x: m.x - ((m.x - v.x) * k) / v.k, y: m.y - ((m.y - v.y) * k) / v.k });
  };
  const pick = (next: Tool) => {
    setTool(tool === next ? null : next);
    setPending(null);
    setSelected(null);
  };
  const texts = (list: DrawingPage['texts'], key: string) =>
    list.map((t, i) => (
      <text key={`${key}${i}`} x={t.at.x} y={y(t.at.y)} font-size={t.size} text-anchor={t.anchor ?? 'start'} transform={t.angle ? `rotate(${-t.angle} ${t.at.x} ${y(t.at.y)})` : undefined}>
        {t.text}
      </text>
    ));
  const linesPath = (lines: DrawingPage['lines']) => lines.map((l) => `M${num(l.a.x)} ${num(y(l.a.y))}L${num(l.b.x)} ${num(y(l.b.y))}`).join('');
  const dimension = (d: PlacedDimension, extra = '') => (
    <g
      key={d.dim.id}
      class={`dwg-dim${d.dim.id === selected ? ' is-selected' : ''}${d.detached ? ' is-detached' : ''}${extra}`}
      data-dim={d.dim.id}
      onPointerDown={(e) => onDimDown(e as PointerEvent, d)}
    >
      <line class="dwg-grip" x1={d.grip[0].x} y1={y(d.grip[0].y)} x2={d.grip[1].x} y2={y(d.grip[1].y)} stroke-width={10 / v.k} />
      <path class="dwg-thin" d={linesPath(d.lines)} />
      {texts(d.texts, 't')}
    </g>
  );
  const detached = dims.filter((d) => d.detached).length;
  const retouched = !!settings && (settings.format !== undefined || settings.scale !== undefined || settings.views !== undefined || settings.dimensions !== undefined);
  const hint = tool === 'linear' ? (!pending ? 'Premier point de la cote' : !pending.b ? 'Second point, dans la même vue' : 'Place de la cote') : tool === 'round' ? 'Cercle ou arc à coter' : null;
  return (
    <>
      <div class="laser-board-bar">
        <label class="mini-field inline">
          <span>Feuille</span>
          <select class="select" aria-label="Format de la feuille" value={layout.format} onChange={(e) => c.updateDrawing(partId, (d) => ({ ...d, format: (e.target as HTMLSelectElement).value as 'A4' | 'A3' }), 'Changer la feuille du plan')}>
            <option value="A4">A4 paysage</option>
            <option value="A3">A3 paysage</option>
          </select>
        </label>
        <label class="mini-field inline">
          <span>Échelle</span>
          <select
            class="select"
            aria-label="Échelle du plan"
            value={settings?.scale ? String(settings.scale) : 'auto'}
            onChange={(e) => {
              const value = (e.target as HTMLSelectElement).value;
              c.updateDrawing(
                partId,
                (d) => {
                  const { scale: _old, ...rest } = d;
                  return value === 'auto' ? rest : { ...rest, scale: Number(value) };
                },
                'Changer l’échelle du plan',
              );
            }}
          >
            <option value="auto">Automatique ({scaleLabel(settings?.scale ? c.drawingAutoScale(partId) : scale)})</option>
            {DRAWING_SCALES.map((s) => (
              <option key={s} value={String(s)}>
                {scaleLabel(s)}
              </option>
            ))}
          </select>
        </label>
        <Button small id="dwg-tool-linear" icon="dimension" variant={tool === 'linear' ? 'primary' : 'default'} hint="Cote entre deux points de la pièce" onClick={() => pick('linear')}>
          Cote
        </Button>
        <Button small id="dwg-tool-round" icon="circle" variant={tool === 'round' ? 'primary' : 'default'} hint="Cote de diamètre (cercle) ou de rayon (arc)" onClick={() => pick('round')}>
          Ø / R
        </Button>
        <span class="spacer" />
        <Button small icon="undo" disabledReason={retouched ? null : 'La mise en plan est automatique.'} hint="Vues, échelle et cotes d’origine ; le cartouche est gardé" onClick={() => c.resetDrawing(partId)}>
          Automatique
        </Button>
        <IconButton icon="fit" label="Tout voir" small onClick={() => setView(null)} />
      </div>
      <div class="laser-board-stage">
        {sel && !tool ? (
          <div class="laser-board-bar secondary" onPointerDown={(e) => e.stopPropagation()}>
            <strong>{sel.texts[0]?.text ?? 'Cote'}</strong>
            <Button
              small
              icon="trash"
              onClick={() => {
                c.removeDrawingDimension(partId, sel.dim.id);
                setSelected(null);
              }}
            >
              Supprimer
            </Button>
          </div>
        ) : null}
        <div class={`laser-board-view drawing-view${tool ? ' is-tool' : ''}`} ref={box} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={() => setHover(null)} onWheel={onWheel}>
          <svg width={size.w} height={size.h} role="img" aria-label="Feuille de la mise en plan">
            <g transform={`translate(${v.x} ${v.y}) scale(${v.k})`} class="dwg-page">
              <rect class="dwg-paper" width={W} height={H} />
              <path class="dwg-thick" d={paths.frame.thick} />
              <path class="dwg-thin" d={paths.frame.thin} />
              {texts(layout.frame.texts, 'f')}
              {VIEW_ORDER.map((name) => {
                const pv = layout.views[name];
                const s = shiftOf(name);
                return (
                  <g key={name} transform={`translate(${s.x} ${-s.y})`} class={`dwg-view${drag?.kind === 'view' && (drag.name === name || drag.name === 'face') ? ' is-moving' : ''}`} data-view={name}>
                    <rect class="dwg-view-box" x={pv.box.x - 2} y={y(pv.box.y + pv.box.h) - 2} width={pv.box.w + 4} height={pv.box.h + 4} onPointerDown={(e) => onViewDown(e as PointerEvent, name)} />
                    <path class="dwg-hidden" d={paths.views[name].hidden} />
                    <path class="dwg-thick" d={paths.views[name].thick} />
                    {texts(pv.texts, 'v')}
                    {dims.filter((d) => d.dim.view === name).map((d) => dimension(d))}
                    {tool === 'linear' ? pv.anchors.points.map((p, i) => <circle key={i} class="dwg-anchor" cx={pv.toPaper(p).x} cy={y(pv.toPaper(p).y)} r={2.5 / v.k} />) : null}
                    {tool === 'round' ? pv.anchors.circles.map((k, i) => <circle key={i} class="dwg-ring" cx={pv.toPaper(k.center).x} cy={y(pv.toPaper(k.center).y)} r={k.radius * scale} stroke-width={2 / v.k} />) : null}
                  </g>
                );
              })}
              {pending ? [pending.a, ...(pending.b ? [pending.b] : [])].map((p, i) => <circle key={i} class="dwg-anchor is-picked" cx={layout.views[pending.view].toPaper(p).x} cy={y(layout.views[pending.view].toPaper(p).y)} r={4 / v.k} />) : null}
              {snap ? <circle class="dwg-anchor is-near" cx={layout.views[snap.view].toPaper(snap.point).x} cy={y(layout.views[snap.view].toPaper(snap.point).y)} r={5 / v.k} stroke-width={1.5 / v.k} /> : null}
              {ring ? <circle class="dwg-ring is-near" cx={layout.views[ring.view].toPaper(ring.circle.center).x} cy={y(layout.views[ring.view].toPaper(ring.circle.center).y)} r={ring.circle.radius * scale} stroke-width={3 / v.k} /> : null}
              {draft ? dimension(draft, ' is-draft') : null}
            </g>
          </svg>
        </div>
      </div>
      <div class="laser-board-status" role="status">
        {hint ?? `${layout.format} paysage · échelle ${scaleLabel(scale)} · ${dims.length} cote${dims.length > 1 ? 's' : ''}`}
        {detached ? <span class="laser-warn"> · {detached > 1 ? `${detached} cotes détachées de la pièce (non exportées)` : 'une cote détachée de la pièce (non exportée)'}</span> : null}
      </div>
    </>
  );
}
