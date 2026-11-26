/**
 * Atelier Rendu : la scène (lumière principale, ambiance, sol, fond) réglée pour les images et les
 * vidéos, et son sujet : l'assemblage tel quel, ou un scénario de mouvement rejoué par sa timeline.
 */
import { useRef, useState } from 'preact/hooks';
import { drivableJoints } from '../app/mechanism';
import { RENDER_LIMITS, type RenderBackground, type RenderGround, type RenderSettings } from '../domain/render';
import { formatNumber, readNumber } from '../domain/units';
import { useAppState, useController } from './context';
import { ToolButton } from './components/controls';
import { ToolGroup } from './ToolSectors';
import { NumberInput } from './components/number-input';
import { Icon } from './icons';
import { ScenarioTimeline } from './ScenarioTimeline';
import { CAPTURE_SIZES } from './capture-sizes';

const LABEL = 'Régler la scène de rendu';

/** Curseur d'un réglage : la vue suit pendant le glisser, une seule annulation au lâcher. */
function RenderSlider(props: { id: string; label: string; field: keyof typeof RENDER_LIMITS; step: number; digits: number; unit?: string; scale?: number }) {
  const c = useController();
  const value = useAppState(() => c.renderSettings()[props.field]);
  const [min, max] = RENDER_LIMITS[props.field];
  const k = props.scale ?? 1;
  const text = `${formatNumber(value * k, props.digits)}${props.unit ?? ''}`;
  return (
    <div class="field render-field">
      <label class="field-label" for={props.id}>
        {props.label} <strong>{text}</strong>
      </label>
      <input
        id={props.id}
        type="range"
        min={min}
        max={max}
        step={props.step}
        value={value}
        aria-valuetext={text}
        onInput={(e) => c.setRender({ [props.field]: Number((e.target as HTMLInputElement).value) }, true)}
        onChange={(e) => {
          c.setRender({ [props.field]: Number((e.target as HTMLInputElement).value) }, true);
          c.commitLive(LABEL);
        }}
      />
    </div>
  );
}

/** Choix exclusif sous le titre de sa section (pas de libellé répété). */
function Choice<T extends string>(props: { label: string; value: T; options: { value: T; label: string; title?: string }[]; onChange: (value: T) => void }) {
  return (
    <div class="segmented render-choice" role="group" aria-label={props.label}>
      {props.options.map((o) => (
        <button type="button" key={o.value} aria-pressed={o.value === props.value} title={o.title ?? o.label} onClick={() => props.onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function ColorField(props: { label: string; field: 'groundColor' | 'backgroundColor' | 'backgroundBottom' }) {
  const c = useController();
  const value = useAppState(() => c.renderSettings()[props.field]);
  return (
    <label class="render-color">
      <input type="color" aria-label={props.label} value={value} onChange={(e) => c.setRender({ [props.field]: (e.target as HTMLInputElement).value })} />
      <span>{props.label}</span>
    </label>
  );
}

/**
 * Direction de la lumière vue du dessus : le centre est le zénith, le bord l'horizon. On glisse le
 * point (ou on clique) ; flèches : ±5° (Maj : ±1°).
 */
function LightPad() {
  const c = useController();
  const settings = useAppState(() => c.renderSettings(), (a, b) => a.lightAzimuth === b.lightAzimuth && a.lightElevation === b.lightElevation);
  const ref = useRef<SVGSVGElement>(null);
  const R = 46;
  const [lo, hi] = RENDER_LIMITS.lightElevation;
  const r = ((90 - settings.lightElevation) / (90 - lo)) * R;
  const a = (settings.lightAzimuth * Math.PI) / 180;
  const at = { x: 50 + r * Math.cos(a), y: 50 - r * Math.sin(a) };
  const from = (e: PointerEvent, live: boolean) => {
    const box = ref.current!.getBoundingClientRect();
    const x = ((e.clientX - box.left) / box.width) * 100 - 50;
    const y = 50 - ((e.clientY - box.top) / box.height) * 100;
    const d = Math.min(R, Math.hypot(x, y));
    const azimuth = Math.round((((Math.atan2(y, x) * 180) / Math.PI + 360) % 360) * 10) / 10;
    const elevation = Math.round(Math.max(lo, Math.min(hi, 90 - (d / R) * (90 - lo))) * 10) / 10;
    c.setRender({ lightAzimuth: azimuth, lightElevation: elevation }, live);
  };
  const nudge = (e: KeyboardEvent) => {
    const step = e.shiftKey ? 1 : 5;
    const az = settings.lightAzimuth;
    const el = settings.lightElevation;
    const next =
      e.key === 'ArrowLeft' ? { lightAzimuth: (az + step) % 360 } : e.key === 'ArrowRight' ? { lightAzimuth: (az - step + 360) % 360 } : e.key === 'ArrowUp' ? { lightElevation: Math.min(hi, el + step) } : e.key === 'ArrowDown' ? { lightElevation: Math.max(lo, el - step) } : null;
    if (!next) return;
    e.preventDefault();
    c.setRender(next);
  };
  return (
    <svg
      ref={ref}
      class="light-pad"
      width="150"
      height="150"
      viewBox="0 0 100 100"
      role="slider"
      tabIndex={0}
      aria-label="Direction de la lumière"
      aria-valuetext={`azimut ${formatNumber(settings.lightAzimuth, 0)}°, hauteur ${formatNumber(settings.lightElevation, 0)}°`}
      onPointerDown={(e) => {
        (e.currentTarget as Element).setPointerCapture(e.pointerId);
        from(e, true);
      }}
      onPointerMove={(e) => {
        if ((e.currentTarget as Element).hasPointerCapture(e.pointerId)) from(e, true);
      }}
      onPointerUp={(e) => {
        from(e, true);
        c.commitLive('Orienter la lumière');
      }}
      onKeyDown={nudge}
    >
      <circle cx="50" cy="50" r={R} class="lp-disc" />
      <circle cx="50" cy="50" r={R / 2} class="lp-ring" />
      <line x1="4" y1="50" x2="96" y2="50" class="lp-axis" />
      <line x1="50" y1="4" x2="50" y2="96" class="lp-axis" />
      <text x="97" y="47" class="lp-label" text-anchor="end">
        X
      </text>
      <text x="53" y="10" class="lp-label">
        Y
      </text>
      <line x1="50" y1="50" x2={at.x} y2={at.y} class="lp-ray" />
      <circle cx={at.x} cy={at.y} r="6" class="lp-sun" />
    </svg>
  );
}

function AngleField(props: { label: string; field: 'lightAzimuth' | 'lightElevation' }) {
  const c = useController();
  const value = useAppState(() => c.renderSettings()[props.field]);
  const [min, max] = RENDER_LIMITS[props.field];
  return (
    <label class="render-angle">
      <span class="field-label">{props.label}</span>
      <NumberInput
        value={formatNumber(value, 1)}
        unit="°"
        min={min}
        max={max}
        ariaLabel={`Lumière : ${props.label.toLowerCase()}`}
        onInput={(t) => {
          const v = readNumber(t);
          if (v !== null) c.setRender({ [props.field]: props.field === 'lightAzimuth' ? ((v % 360) + 360) % 360 : Math.max(min, Math.min(max, v)) });
        }}
      />
    </label>
  );
}

export function RenderSection() {
  const c = useController();
  const data = useAppState(
    (s) => ({
      scenarios: drivableJoints(s.doc.assembly).length ? (s.doc.simulation?.scenarios ?? []).map((x) => ({ id: x.id, name: x.name })) : [],
      current: c.renderShowsScenario() ? (c.currentScenario()?.id ?? null) : null,
    }),
    (a, b) => JSON.stringify(a) === JSON.stringify(b),
  );
  const settings = useAppState(() => c.renderSettings());
  const set = (patch: Partial<RenderSettings>) => c.setRender(patch);
  const changed = useAppState((s) => !!s.doc.render);
  return (
    <div class="render-panel">
      <section class="panel-section" aria-labelledby="render-subject-title">
        <div class="panel-header">
          <span id="render-subject-title">Sujet</span>
        </div>
        <div class="panel-body">
          <ul class="feature-list sim-parts" role="radiogroup" aria-label="Sujet du rendu">
            <li>
              <button type="button" role="radio" id="render-subject-scene" aria-checked={!data.current} class={`sim-part${!data.current ? ' is-current' : ''}`} onClick={() => c.setRenderSubject(null)}>
                <Icon name="pivot" />
                <span>Assemblage</span>
              </button>
            </li>
            {data.scenarios.map((x) => (
              <li key={x.id}>
                <button type="button" role="radio" aria-checked={data.current === x.id} class={`sim-part${data.current === x.id ? ' is-current' : ''}`} title="Scénario de mouvement, rejoué par sa timeline" onClick={() => c.setRenderSubject(x.id)}>
                  <Icon name="play" />
                  <span>{x.name}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </section>
      <section class="panel-section" aria-labelledby="render-light-title">
        <div class="panel-header">
          <span id="render-light-title">Lumière</span>
        </div>
        <div class="panel-body render-light">
          <LightPad />
          <div class="render-light-fields">
            <AngleField label="Azimut" field="lightAzimuth" />
            <AngleField label="Hauteur" field="lightElevation" />
          </div>
          <RenderSlider id="render-intensity" label="Intensité" field="lightIntensity" step={0.05} digits={2} />
          <RenderSlider id="render-softness" label="Douceur des ombres" field="shadowSoftness" step={0.5} digits={1} />
        </div>
      </section>
      <section class="panel-section" aria-labelledby="render-ambiance-title">
        <div class="panel-header">
          <span id="render-ambiance-title">Ambiance</span>
        </div>
        <div class="panel-body">
          <RenderSlider id="render-environment" label="Reflets" field="environment" step={0.05} digits={2} />
          <RenderSlider id="render-exposure" label="Exposition" field="exposure" step={0.05} digits={2} />
          <label class="check">
            <input type="checkbox" checked={settings.occlusion} onChange={(e) => set({ occlusion: (e.target as HTMLInputElement).checked })} />
            Ombrage des creux
          </label>
        </div>
      </section>
      <section class="panel-section" aria-labelledby="render-ground-title">
        <div class="panel-header">
          <span id="render-ground-title">Sol</span>
        </div>
        <div class="panel-body">
          <Choice<RenderGround>
            label="Sol"
            value={settings.ground}
            options={[
              { value: 'none', label: 'Aucun', title: 'Pas de sol ni d’ombre portée' },
              { value: 'shadow', label: 'Ombre', title: 'Sol invisible : seule l’ombre portée se voit' },
              { value: 'color', label: 'Couleur', title: 'Sol coloré qui reçoit l’ombre' },
            ]}
            onChange={(ground) => set({ ground })}
          />
          {settings.ground !== 'none' ? <RenderSlider id="render-shadow" label="Ombre portée" field="shadowOpacity" step={0.01} digits={0} unit=" %" scale={100} /> : null}
          {settings.ground === 'color' ? <ColorField label="Couleur du sol" field="groundColor" /> : null}
        </div>
      </section>
      <section class="panel-section" aria-labelledby="render-background-title">
        <div class="panel-header">
          <span id="render-background-title">Fond</span>
        </div>
        <div class="panel-body">
          <Choice<RenderBackground>
            label="Fond"
            value={settings.background}
            options={[
              { value: 'view', label: 'Vue', title: 'Le fond de la vue' },
              { value: 'color', label: 'Uni' },
              { value: 'gradient', label: 'Dégradé' },
            ]}
            onChange={(background) => set({ background })}
          />
          {settings.background !== 'view' ? <ColorField label={settings.background === 'gradient' ? 'Haut' : 'Couleur du fond'} field="backgroundColor" /> : null}
          {settings.background === 'gradient' ? <ColorField label="Bas" field="backgroundBottom" /> : null}
          <button type="button" class="btn btn-small render-reset" disabled={!changed} onClick={() => c.resetRender()}>
            Réglages par défaut
          </button>
        </div>
      </section>
    </div>
  );
}

/** Export d'une image : taille, cadrage. */
function ImageExport() {
  const c = useController();
  const [open, setOpen] = useState(false);
  const [size, setSize] = useState(1);
  const [fit, setFit] = useState(true);
  const [state, setState] = useState<{ busy: boolean; error?: string }>({ busy: false });
  const start = async () => {
    setState({ busy: true });
    try {
      const { renderStill } = await import('./render-image');
      const { width, height } = CAPTURE_SIZES[size]!;
      const blob = await renderStill(c, { width, height, fit });
      setState({ busy: false });
      setOpen(false);
      await c.saveRenderImage(blob);
    } catch (err) {
      setState({ busy: false, error: (err as Error).message });
    }
  };
  return (
    <div class="render-image">
      <ToolButton id="render-image" icon="export" label="Image" hint="Enregistrer une image de la scène (PNG)" pressed={open} onClick={() => setOpen(!open)} />
      {open ? (
        <div class="tl-video-panel render-image-panel" role="dialog" aria-label="Export d’une image">
          <label class="field">
            <span class="field-label">Taille</span>
            <select id="image-size" class="select" value={size} onChange={(e) => setSize(Number((e.target as HTMLSelectElement).value))}>
              {CAPTURE_SIZES.map((x, k) => (
                <option key={k} value={k}>
                  {x.label}
                </option>
              ))}
            </select>
          </label>
          <div class="tl-video-row">
            <span class="field-label">Cadrage</span>
            <span class="segmented small" role="group" aria-label="Cadrage">
              <button type="button" aria-pressed={fit} title="Les pièces remplissent l’image" onClick={() => setFit(true)}>
                Pièces
              </button>
              <button type="button" aria-pressed={!fit} title="Comme la vue" onClick={() => setFit(false)}>
                Vue
              </button>
            </span>
          </div>
          {state.error ? (
            <p class="field-error" role="alert">
              {state.error}
            </p>
          ) : null}
          <button type="button" id="image-export" class="btn btn-primary btn-small" disabled={state.busy} onClick={() => void start()}>
            {state.busy ? 'Calcul…' : 'Exporter'}
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function RenderTools() {
  return (
    <ToolGroup name="Exporter">
      <ImageExport />
    </ToolGroup>
  );
}

/** Timeline du scénario choisi comme sujet (lecture, vidéo). */
export function RenderTimeline() {
  const c = useController();
  const on = useAppState(() => c.renderShowsScenario());
  return on ? <ScenarioTimeline /> : null;
}

