/**
 * Timeline d'un scénario de mouvement (posée sous la vue) : une piste par pilotante, avec ses
 * images clés et sa courbe ; les relevés des pilotées en courbes, calculés d'avance ; lecture,
 * boucle, déplacement du curseur de lecture et des clés à la souris ou au clavier.
 */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { jointDofs } from '../app/mechanism';
import { trackKey, trackKeys, valueAt } from '../app/scenario-timeline';
import type { TimelineBake } from '../app/state';
import type { AssemblyJoint, MotionDof, MotionScenario, ScenarioTimeline as Timeline, TimelineKey } from '../domain/model';
import { formatNumber, readNumber } from '../domain/units';
import { useAppState, useController } from './context';
import { IconButton } from './components/controls';
import { NumberInput } from './components/number-input';
import { Icon } from './icons';
import type { VideoOptions } from './video-export';
import { CAPTURE_SIZES } from './capture-sizes';

const unitOf = (dof: MotionDof) => (dof === 'angle' ? '°' : 'mm');
const show = (v: number, dof: MotionDof) => `${formatNumber(v, dof === 'angle' ? 1 : 2)} ${unitOf(dof)}`;
const seconds = (t: number) => `${formatNumber(t, 2)} s`;
/** Points de la courbe d'une piste. */
const CURVE_POINTS = 160;
/** Distance (px) en dessous de laquelle une clé glissée se cale sur le curseur de lecture. */
const SNAP_PX = 6;

type Track = { jointId: string; dof: MotionDof };
type KeyRef = Pick<TimelineKey, 'jointId' | 'dof' | 't'>;

export function ScenarioTimeline() {
  const c = useController();
  const scenario = useAppState(() => c.currentScenario());
  const joints = useAppState((s) => s.doc.assembly?.joints ?? []);
  const time = useAppState((s) => s.scenarioTime);
  const playing = useAppState((s) => s.scenarioPlaying);
  const bake = useAppState((s) => s.timelineBake);
  const stale = useAppState(() => c.timelineBakeStale());
  // Poses à refaire (clé, durée, rôles, assemblage) : calcul relancé d'office.
  useEffect(() => {
    if (stale) void c.bakeTimeline();
  }, [stale, scenario, joints]);
  useEffect(() => () => c.stopScenarioPlay(), []);
  if (!scenario || scenario.drivers.length === 0) return null;
  return <TimelineView scenario={scenario} joints={joints} time={time} playing={playing} bake={bake && bake.scenarioId === scenario.id && !stale ? bake : null} running={stale || bake?.status === 'running'} />;
}

function TimelineView(props: { scenario: MotionScenario; joints: AssemblyJoint[]; time: number; playing: boolean; bake: TimelineBake | null; running: boolean }) {
  const c = useController();
  const { scenario, joints, time, bake } = props;
  const timeline: Timeline = scenario.timeline ?? { duration: 4, keys: [] };
  const { duration } = timeline;
  const [selected, setSelected] = useState<KeyRef | null>(null);
  const [drag, setDrag] = useState<{ key: KeyRef; t: number } | null>(null);
  const lanes = useRef<HTMLDivElement>(null);
  const nameOf = (x: Track) => {
    const j = joints.find((y) => y.id === x.jointId);
    return `${j?.name ?? '?'}${j && jointDofs(j).length > 1 ? (x.dof === 'angle' ? ' · rotation' : ' · translation') : ''}`;
  };
  // La clé choisie a disparu (annulation, suppression) : plus de choix.
  const selectedKey = selected ? timeline.keys.find((k) => k.jointId === selected.jointId && k.dof === selected.dof && Math.abs(k.t - selected.t) < 1e-3) : undefined;
  useEffect(() => {
    if (selected && !selectedKey) setSelected(null);
  }, [selected, selectedKey]);
  const pct = (t: number) => `${(Math.min(duration, Math.max(0, t)) / duration) * 100}%`;
  /** Instant sous la souris (s), dans les pistes. */
  const timeAt = (clientX: number) => {
    const r = lanes.current?.getBoundingClientRect();
    if (!r || r.width <= 0) return 0;
    return Math.min(duration, Math.max(0, ((clientX - r.left) / r.width) * duration));
  };
  const pxPerSecond = () => (lanes.current?.getBoundingClientRect().width ?? 1) / duration;
  // Glisser sur la règle ou une piste vide : le curseur de lecture suit.
  const scrub = (e: PointerEvent) => {
    if (e.button !== 0) return;
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture?.(e.pointerId);
    if (props.playing) c.stopScenarioPlay();
    c.setScenarioTime(timeAt(e.clientX));
    const move = (ev: PointerEvent) => c.setScenarioTime(timeAt(ev.clientX));
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };
  // Clé : un clic la choisit et y amène le curseur ; un glisser la déplace dans le temps.
  const grabKey = (e: PointerEvent, key: TimelineKey) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture?.(e.pointerId);
    const ref = { jointId: key.jointId, dof: key.dof, t: key.t };
    setSelected(ref);
    const x0 = e.clientX;
    let moved = false;
    let t = key.t;
    const move = (ev: PointerEvent) => {
      if (!moved && Math.abs(ev.clientX - x0) < 3) return;
      moved = true;
      t = Math.round(timeAt(ev.clientX) * 100) / 100;
      if (Math.abs(t - time) * pxPerSecond() < SNAP_PX) t = time;
      setDrag({ key: ref, t });
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      setDrag(null);
      if (moved && Math.abs(t - key.t) > 1e-4) {
        c.editTimelineKey(ref, { t });
        setSelected({ ...ref, t });
      } else c.setScenarioTime(key.t);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };
  const keyKeyDown = (e: KeyboardEvent, key: TimelineKey) => {
    const ref = { jointId: key.jointId, dof: key.dof, t: key.t };
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      e.stopPropagation();
      c.removeTimelineKey(ref);
      setSelected(null);
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      e.stopPropagation();
      const t = Math.min(duration, Math.max(0, key.t + (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 0.01 : 0.1)));
      c.editTimelineKey(ref, { t });
      setSelected({ ...ref, t });
    }
  };
  // Espace : lecture ou pause (hors saisie).
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== ' ' || (e.target as HTMLElement).closest('input, select, textarea')) return;
    e.preventDefault();
    e.stopPropagation();
    c.toggleScenarioPlay();
  };
  // Pistes affichées : clés (avec celle en cours de glissement à sa nouvelle place).
  const keysOf = (track: Track) =>
    trackKeys(timeline, track)
      .map((k) => (drag && drag.key.jointId === k.jointId && drag.key.dof === k.dof && Math.abs(drag.key.t - k.t) < 1e-3 ? { ...k, t: drag.t } : k))
      .sort((a, b) => a.t - b.t);
  const blocked = useMemo(() => blockedSpans(bake), [bake]);
  const progress = bake && bake.status === 'running' ? Math.round((100 * bake.frames.length) / Math.max(1, bake.total)) : null;
  const animated = timeline.keys.length > 0;
  const ticks = rulerTicks(duration);
  const sel = selectedKey;
  return (
    <section class="scenario-timeline" aria-label="Timeline" onKeyDown={onKeyDown}>
      <div class="tl-bar">
        <IconButton id="tl-start" icon="skip-start" small label="Début" onClick={() => c.setScenarioTime(0)} />
        <IconButton id="tl-play" icon={props.playing ? 'pause' : 'play'} small label={props.playing ? 'Pause (Espace)' : 'Lire (Espace)'} onClick={() => c.toggleScenarioPlay()} disabled={!animated} />
        <IconButton id="tl-loop" icon="loop" small label="Lecture en boucle" pressed={!!timeline.loop} onClick={() => c.setTimelineLoop(!timeline.loop)} />
        <span class="tl-time" id="tl-time">
          {formatNumber(time, 2)} / {seconds(duration)}
        </span>
        <button type="button" id="tl-key-all" class="btn btn-small" title="Clé sur toutes les pilotantes, à l’instant montré" onClick={() => c.keyScenarioDrivers()}>
          <Icon name="key" />
          Clé
        </button>
        {sel ? (
          <div class="tl-key-edit" role="group" aria-label="Clé choisie">
            <span class="tl-key-name">{nameOf(sel)}</span>
            <NumberInput value={formatNumber(sel.t, 2)} unit="s" step={0.1} min={0} max={duration} ariaLabel="Instant de la clé" onInput={(t) => { const v = readNumber(t); if (v !== null && v >= 0 && v <= duration) { c.editTimelineKey(sel, { t: v }); setSelected({ ...sel, t: Math.round(v * 1000) / 1000 }); } }} />
            <NumberInput value={formatNumber(sel.value, 2)} unit={unitOf(sel.dof)} min={-100000} ariaLabel="Valeur de la clé" onInput={(t) => { const v = readNumber(t); if (v !== null) c.editTimelineKey(sel, { value: v }); }} />
            <span class="segmented small" role="group" aria-label="Passage vers la clé suivante">
              <button type="button" aria-pressed={sel.ease !== 'linear'} title="Départ et arrivée sans à-coup" onClick={() => c.editTimelineKey(sel, { ease: 'smooth' })}>
                Adouci
              </button>
              <button type="button" aria-pressed={sel.ease === 'linear'} title="Vitesse constante" onClick={() => c.editTimelineKey(sel, { ease: 'linear' })}>
                Linéaire
              </button>
            </span>
            <IconButton icon="trash" small label="Supprimer la clé (Suppr)" onClick={() => { c.removeTimelineKey(sel); setSelected(null); }} />
          </div>
        ) : null}
        <span class="spacer" />
        <VideoExport duration={duration} loop={!!timeline.loop} disabled={!animated} />
        {progress !== null ? (
          <span class="tl-progress" role="status">
            <progress max={100} value={progress} aria-label="Calcul des poses" /> {progress} %
          </span>
        ) : null}
        <label class="tl-duration">
          <span>Durée</span>
          <NumberInput value={formatNumber(duration, 2)} unit="s" step={0.5} min={0.1} ariaLabel="Durée de la timeline" onInput={(t) => { const v = readNumber(t); if (v !== null && v >= 0.1 && v <= 600) c.setTimelineDuration(v); }} />
        </label>
      </div>
      <div class="tl-grid">
        <div class="tl-label tl-head" />
        <div class="tl-ruler" onPointerDown={scrub} aria-hidden="true">
          {blocked.map(([a, b], k) => (
            <span key={`b${k}`} class="tl-blocked" style={{ left: pct(a), width: `${((b - a) / duration) * 100}%` }} title="Mécanisme bloqué" />
          ))}
          {ticks.map((t) => (
            <span key={t} class="tl-tick" style={{ left: pct(t) }}>
              {formatNumber(t, 1)}
            </span>
          ))}
        </div>
        <div class="tl-rows">
          {scenario.drivers.map((d) => (
            <DriverRow key={trackKey(d)} track={d} name={nameOf(d)} keys={keysOf(d)} duration={duration} base={d.value} selected={sel ?? null} onGrab={grabKey} onKeyDown={keyKeyDown} onKey={() => c.keyScenarioDrivers(d)} onScrub={scrub} />
          ))}
          {scenario.sensors.map((s) => (
            <SensorRow key={trackKey(s)} track={s} name={nameOf(s)} bake={bake} duration={duration} onScrub={scrub} />
          ))}
          <div class="tl-lanes-overlay" ref={lanes} aria-hidden="true">
            <span class="tl-playhead" style={{ left: pct(time) }} />
          </div>
        </div>
      </div>
      {!animated ? <p class="tl-empty">Aucune clé.</p> : null}
    </section>
  );
}

function DriverRow(props: {
  track: Track;
  name: string;
  keys: TimelineKey[];
  duration: number;
  base: number;
  selected: KeyRef | null;
  onGrab: (e: PointerEvent, k: TimelineKey) => void;
  onKeyDown: (e: KeyboardEvent, k: TimelineKey) => void;
  onKey: () => void;
  onScrub: (e: PointerEvent) => void;
}) {
  const { keys, duration } = props;
  const c = useController();
  const curve = useMemo(() => {
    if (keys.length < 2) return null;
    const vals = Array.from({ length: CURVE_POINTS + 1 }, (_, i) => valueAt(keys, (duration * i) / CURVE_POINTS)!);
    return polyline(vals);
  }, [keys, duration]);
  const hover = { onMouseEnter: () => c.setHoverJoint(props.track.jointId, false), onMouseLeave: () => c.setHoverJoint(null) };
  return (
    <div class="tl-row tl-driver" {...hover}>
      <div class="tl-label">
        <span class="name" title={props.name}>
          {props.name}
        </span>
        <IconButton icon="key" small label={`Clé sur « ${props.name} »`} onClick={props.onKey} />
      </div>
      <div class="tl-lane" onPointerDown={props.onScrub}>
        {curve ? (
          <svg class="tl-curve" viewBox="0 0 1000 100" preserveAspectRatio="none" aria-hidden="true">
            <polyline points={curve} />
          </svg>
        ) : null}
        {keys.map((k) => {
          const on = !!props.selected && props.selected.jointId === k.jointId && props.selected.dof === k.dof && Math.abs(props.selected.t - k.t) < 1e-3;
          return (
            <button
              key={`${k.t}`}
              type="button"
              class={`tl-key${on ? ' is-selected' : ''}${k.ease === 'linear' ? ' is-linear' : ''}`}
              style={{ left: `${(k.t / duration) * 100}%` }}
              title={`${seconds(k.t)} · ${show(k.value, k.dof)}`}
              aria-label={`Clé de ${props.name} à ${seconds(k.t)} : ${show(k.value, k.dof)}`}
              aria-pressed={on}
              onPointerDown={(e) => props.onGrab(e, k)}
              onKeyDown={(e) => props.onKeyDown(e, k)}
            />
          );
        })}
      </div>
    </div>
  );
}

function SensorRow(props: { track: Track; name: string; bake: TimelineBake | null; duration: number; onScrub: (e: PointerEvent) => void }) {
  const { bake, track } = props;
  const c = useController();
  const reading = useAppState(() => c.scenarioState()?.readings.find((r) => r.jointId === track.jointId && r.dof === track.dof)?.value ?? null);
  const curve = useMemo(() => {
    if (!bake || bake.frames.length < 2) return null;
    const k = bake.frames[0]!.readings.findIndex((r) => r.jointId === track.jointId && r.dof === track.dof);
    if (k < 0) return null;
    const vals = bake.frames.map((f) => (f.blocked ? null : (f.readings[k]?.value ?? null)));
    // Images pas encore calculées : la courbe s'arrête là où en est le calcul.
    return polyline(vals, bake.total);
  }, [bake, track.jointId, track.dof]);
  return (
    <div class="tl-row tl-sensor" onMouseEnter={() => c.setHoverJoint(track.jointId, false)} onMouseLeave={() => c.setHoverJoint(null)}>
      <div class="tl-label">
        <span class="name" title={props.name}>
          {props.name}
        </span>
        <span class="tl-reading">{reading === null ? '—' : show(reading, track.dof)}</span>
      </div>
      <div class="tl-lane" onPointerDown={props.onScrub}>
        {curve ? (
          <svg class="tl-curve" viewBox="0 0 1000 100" preserveAspectRatio="none" aria-hidden="true">
            <polyline points={curve} />
          </svg>
        ) : null}
      </div>
    </div>
  );
}

/** Courbe ajustée à la hauteur de la piste (marge en haut et en bas) ; trous aux valeurs absentes. */
function polyline(vals: (number | null)[], count = vals.length): string {
  const ok = vals.filter((v): v is number => v !== null && Number.isFinite(v));
  if (ok.length < 2) return '';
  const lo = Math.min(...ok);
  const hi = Math.max(...ok);
  const span = hi - lo || 1;
  const n = Math.max(2, count) - 1;
  return vals
    .map((v, i) => (v === null || !Number.isFinite(v) ? null : `${((i / n) * 1000).toFixed(1)},${(90 - ((v - lo) / span) * 80).toFixed(1)}`))
    .filter(Boolean)
    .join(' ');
}

/** Intervalles de temps où le mécanisme ne se referme pas (poses calculées). */
function blockedSpans(bake: TimelineBake | null): [number, number][] {
  if (!bake) return [];
  const out: [number, number][] = [];
  const dt = bake.duration / Math.max(1, bake.total - 1);
  for (const f of bake.frames) {
    if (!f.blocked) continue;
    const last = out[out.length - 1];
    const a = Math.max(0, f.t - dt / 2);
    const b = Math.min(bake.duration, f.t + dt / 2);
    if (last && a <= last[1] + 1e-9) last[1] = b;
    else out.push([a, b]);
  }
  return out;
}

/** Graduations de la règle : un pas rond qui en donne une dizaine au plus. */
function rulerTicks(duration: number): number[] {
  const step = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60].find((s) => duration / s <= 10) ?? 60;
  const out: number[] = [];
  for (let t = 0; t <= duration + 1e-9; t += step) out.push(Math.round(t * 1000) / 1000);
  return out;
}


/** Export vidéo (MP4) de la timeline : taille, images par seconde, passages, caméra, éclairage, fond. */
function VideoExport(props: { duration: number; loop: boolean; disabled: boolean }) {
  const c = useController();
  const [open, setOpen] = useState(false);
  const [size, setSize] = useState(1);
  const [opts, setOpts] = useState<Omit<VideoOptions, 'width' | 'height' | 'loops'> & { loops: number | null }>({ fps: 30, loops: null, orbit: false, studio: true, fit: true, background: 'view' });
  const [run, setRun] = useState<{ progress: number; error?: string } | null>(null);
  const cancel = useRef(false);
  const loops = opts.loops ?? (props.loop ? 2 : 1);
  const seconds = (props.duration * loops).toFixed(1).replace('.', ',');
  const start = async () => {
    cancel.current = false;
    setRun({ progress: 0 });
    c.stopScenarioPlay();
    try {
      const { renderScenarioVideo } = await import('./video-export');
      const { width, height } = CAPTURE_SIZES[size]!;
      const blob = await renderScenarioVideo(c, { ...opts, loops, width, height }, (p) => setRun({ progress: p }), () => cancel.current);
      setRun(null);
      if (blob) {
        setOpen(false);
        await c.saveScenarioVideo(blob);
      }
    } catch (err) {
      setRun({ progress: 0, error: (err as Error).message });
    }
  };
  const set = (patch: Partial<typeof opts>) => setOpts({ ...opts, ...patch });
  return (
    <div class="tl-video">
      <button type="button" id="tl-video" class="btn btn-small" aria-expanded={open} disabled={props.disabled} title="Exporter la timeline en vidéo (MP4)" onClick={() => setOpen(!open)}>
        <Icon name="export" />
        Vidéo
      </button>
      {open ? (
        <div class="tl-video-panel" role="dialog" aria-label="Export vidéo">
          <label class="field">
            <span class="field-label">Taille</span>
            <select id="video-size" class="select" value={size} disabled={!!run && !run.error} onChange={(e) => setSize(Number((e.target as HTMLSelectElement).value))}>
              {CAPTURE_SIZES.map((x, k) => (
                <option key={k} value={k}>
                  {x.label}
                </option>
              ))}
            </select>
          </label>
          <div class="tl-video-row">
            <span class="field-label">Images/s</span>
            <span class="segmented small" role="group" aria-label="Images par seconde">
              {([30, 60] as const).map((f) => (
                <button key={f} type="button" aria-pressed={opts.fps === f} onClick={() => set({ fps: f })}>
                  {f}
                </button>
              ))}
            </span>
          </div>
          <label class="tl-video-row">
            <span class="field-label">Passages</span>
            <NumberInput value={String(loops)} unit="×" step={1} min={1} max={50} ariaLabel="Nombre de passages de la timeline" onInput={(t) => { const v = readNumber(t); if (v !== null && v >= 1 && v <= 50) set({ loops: Math.round(v) }); }} />
          </label>
          <div class="tl-video-row">
            <span class="field-label">Caméra</span>
            <span class="segmented small" role="group" aria-label="Caméra">
              <button type="button" aria-pressed={!opts.orbit} onClick={() => set({ orbit: false })}>
                Fixe
              </button>
              <button type="button" aria-pressed={opts.orbit} title="Un tour complet autour du mécanisme" onClick={() => set({ orbit: true })}>
                Un tour
              </button>
            </span>
          </div>
          <div class="tl-video-row">
            <span class="field-label">Cadrage</span>
            <span class="segmented small" role="group" aria-label="Cadrage">
              <button type="button" aria-pressed={opts.fit} title="Le mécanisme remplit l’image, sur tout son mouvement" onClick={() => set({ fit: true })}>
                Mécanisme
              </button>
              <button type="button" aria-pressed={!opts.fit} title="Comme la vue" onClick={() => set({ fit: false })}>
                Vue
              </button>
            </span>
          </div>
          <div class="tl-video-row">
            <span class="field-label">Éclairage</span>
            <span class="segmented small" role="group" aria-label="Éclairage">
              <button type="button" aria-pressed={opts.studio} title="Reflets, ombres au sol, ombrage des creux" onClick={() => set({ studio: true })}>
                Rendu
              </button>
              <button type="button" aria-pressed={!opts.studio} title="Comme la vue" onClick={() => set({ studio: false })}>
                Vue
              </button>
            </span>
          </div>
          <div class="tl-video-row">
            <span class="field-label">Fond</span>
            <span class="segmented small" role="group" aria-label="Fond">
              {(
                [
                  ['view', 'Scène'],
                  ['white', 'Blanc'],
                  ['black', 'Noir'],
                ] as const
              ).map(([k, label]) => (
                <button key={k} type="button" aria-pressed={opts.background === k} onClick={() => set({ background: k })}>
                  {label}
                </button>
              ))}
            </span>
          </div>
          <p class="field-help">
            {CAPTURE_SIZES[size]!.label.split(' (')[0]} · {seconds} s
          </p>
          {run?.error ? (
            <p class="field-error" role="alert">
              {run.error}
            </p>
          ) : null}
          {run && !run.error ? (
            <div class="tl-video-progress" role="status">
              <progress max={100} value={Math.round(run.progress * 100)} aria-label="Export de la vidéo" /> {Math.round(run.progress * 100)} %
              <button type="button" class="btn btn-small" onClick={() => (cancel.current = true)}>
                Annuler
              </button>
            </div>
          ) : (
            <button type="button" id="video-export" class="btn btn-primary btn-small" onClick={() => void start()}>
              Exporter
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}
