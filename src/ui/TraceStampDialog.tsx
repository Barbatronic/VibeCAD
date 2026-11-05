/**
 * Importer un dessin : réglages en direct à partir d'une photo, d'un scan ou d'un SVG dessiné en
 * image, aperçu du contour, gomme pour effacer une ombre ou un trait de trop. Un SVG peut aussi
 * garder son tracé exact. Le résultat devient une forme de tampon.
 */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { importSvgShape, type SvgImportResult } from '../io/svg-import';
import { otsuThreshold, traceBitmap, traceMask, type GrayImage, type TraceMode, type TraceOptions } from '../io/trace-bitmap';
import { Button, Callout, Segmented } from './components/controls';
import { Modal } from './components/modal';
import { useAppState, useController } from './context';
import { StampPicture } from './SketchStampFields';

type Settings = Omit<TraceOptions, 'erased'>;

/** Délai avant de recalculer : suit le curseur sans bloquer son mouvement. */
const TRACE_DELAY_MS = 90;

function initialSettings(image: GrayImage): Settings {
  const threshold = otsuThreshold(image);
  // Un bord plutôt sombre : le fond est noir, le dessin clair.
  const { width: w, height: h, data } = image;
  let dark = 0;
  for (let x = 0; x < w; x++) dark += (data[x]! < threshold ? 1 : 0) + (data[(h - 1) * w + x]! < threshold ? 1 : 0);
  return { threshold, invert: dark > w, mode: 'fill', thicken: 0, despeckle: Math.round((w * h) / 8000), smoothing: 0.4 };
}

function Slider(props: { id: string; label: string; help: string; min: number; max: number; step?: number; value: number; onInput: (v: number) => void }) {
  return (
    <div class="field">
      <label class="field-label" for={props.id}>
        {props.label}
      </label>
      <input id={props.id} type="range" min={props.min} max={props.max} step={props.step ?? 1} value={props.value} onInput={(e) => props.onInput(Number((e.target as HTMLInputElement).value))} />
      <span class="field-help">{props.help}</span>
    </div>
  );
}

function paint(canvas: HTMLCanvasElement, image: GrayImage, mask: Uint8Array): void {
  const out = canvas.getContext('2d')!.createImageData(image.width, image.height);
  for (let i = 0; i < mask.length; i++) {
    // L'encre retenue en bleu, sur le dessin d'origine pâli.
    const pale = 255 - (255 - image.data[i]!) * 0.3;
    out.data.set(mask[i] ? [31, 95, 192, 255] : [pale, pale, pale, 255], i * 4);
  }
  canvas.getContext('2d')!.putImageData(out, 0, 0);
}

type Source = 'exact' | 'trace';

function TraceForm(props: { image: GrayImage | null; name: string; exact: SvgImportResult | null }) {
  const c = useController();
  const { exact } = props;
  // Sans image, il reste le tracé exact : la fenêtre se réduit à son aperçu.
  const image = props.image ?? { width: 1, height: 1, data: new Uint8Array(1) };
  const canvas = useRef<HTMLCanvasElement>(null);
  const erased = useMemo(() => new Uint8Array(image.width * image.height), [image]);
  const [source, setSource] = useState<Source>(exact?.ok ? 'exact' : 'trace');
  const [settings, setSettings] = useState(() => initialSettings(image));
  const [strokes, setStrokes] = useState(0);
  const [name, setName] = useState(props.name);
  const [result, setResult] = useState<SvgImportResult | null>(null);
  const update = (patch: Partial<Settings>) => setSettings((s) => ({ ...s, ...patch }));
  const tracing = source === 'trace';

  useEffect(() => {
    if (!tracing) return;
    const timer = setTimeout(() => {
      const options = { ...settings, erased };
      if (canvas.current) paint(canvas.current, image, traceMask(image, options));
      setResult(importSvgShape(traceBitmap(image, options), name, { preview: true }));
    }, TRACE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [settings, strokes, tracing]);

  // Gomme : un disque à chaque position, reliées entre elles pour un trait continu.
  const brush = Math.max(4, Math.round(Math.max(image.width, image.height) / 40));
  const last = useRef<{ x: number; y: number } | null>(null);
  const eraseTo = (e: PointerEvent) => {
    const box = (e.currentTarget as HTMLCanvasElement).getBoundingClientRect();
    const at = { x: ((e.clientX - box.left) / box.width) * image.width, y: ((e.clientY - box.top) / box.height) * image.height };
    const from = last.current ?? at;
    const steps = Math.max(1, Math.ceil(Math.hypot(at.x - from.x, at.y - from.y) / (brush / 2)));
    for (let k = 0; k <= steps; k++) {
      const cx = from.x + ((at.x - from.x) * k) / steps;
      const cy = from.y + ((at.y - from.y) * k) / steps;
      for (let y = Math.max(0, Math.floor(cy - brush)); y <= Math.min(image.height - 1, cy + brush); y++) {
        for (let x = Math.max(0, Math.floor(cx - brush)); x <= Math.min(image.width - 1, cx + brush); x++) {
          if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= brush) erased[y * image.width + x] = 1;
        }
      }
    }
    last.current = at;
    setStrokes((n) => n + 1);
  };

  const close = () => c.finishTrace(null);
  const shown = tracing ? result : exact;
  const shape = shown?.ok ? shown.shape : null;
  const accept = () => {
    if (!shape) return;
    const label = name.trim() || props.name;
    if (!tracing) return c.finishTrace({ name: label, outline: shape.outline });
    // Le contrôle complet, trop long pour suivre les curseurs, se fait ici.
    const checked = importSvgShape(traceBitmap(image, { ...settings, erased }), label);
    if (checked.ok) c.finishTrace(checked.shape);
    else setResult(checked);
  };

  return (
    <Modal
      wide
      title="Importer un dessin"
      onClose={close}
      footer={
        <>
          <Button onClick={close}>Annuler</Button>
          <Button variant="primary" icon="ok" disabled={!shape} onClick={accept}>
            Utiliser ce dessin
          </Button>
        </>
      }
    >
      {exact?.ok && props.image ? (
        <Segmented<Source>
          label="Contour à utiliser"
          value={source}
          options={[
            { value: 'exact', label: 'Tracé du fichier', title: 'Les courbes exactes du SVG.' },
            { value: 'trace', label: 'Retravailler', title: 'Le contour est recalculé depuis l’image : réglages et gomme.' },
          ]}
          onChange={setSource}
        />
      ) : null}
      {exact && !exact.ok && tracing ? (
        <Callout kind="info">
          {/* Seul le constat : le conseil qui suit le « : » vise un logiciel de dessin, l'appli s'en charge ici. */}
          <p>{exact.error.split(' : ')[0]}. Pas de souci : le contour est recalculé depuis l’image, ajustez-le avec les réglages.</p>
        </Callout>
      ) : null}
      {exact?.ok && !tracing && exact.warnings.length > 0 ? (
        <Callout kind="info">
          <p>{exact.warnings.join(' ')}</p>
        </Callout>
      ) : null}
      <div class="trace-layout">
        <div class="trace-views">
          <figure class={tracing ? undefined : 'trace-hidden'}>
            <canvas
              ref={canvas}
              width={image.width}
              height={image.height}
              aria-label="Le dessin : ce qui est gardé est en bleu. Glissez pour gommer."
              onPointerDown={(e) => {
                (e.currentTarget as HTMLCanvasElement).setPointerCapture(e.pointerId);
                last.current = null;
                eraseTo(e);
              }}
              onPointerMove={(e) => {
                if (e.buttons) eraseTo(e);
              }}
            />
            <figcaption>En bleu, ce qui est gardé. Glissez dessus pour gommer.</figcaption>
          </figure>
          <figure>
            <div class="trace-result">{shape ? <StampPicture outline={shape.outline} /> : null}</div>
            <figcaption>Le contour obtenu</figcaption>
          </figure>
        </div>
        <div class="trace-controls">
          {tracing ? (
            <>
              <Segmented<TraceMode>
                label="Ce qui devient du volume"
                value={settings.mode}
                options={[
                  { value: 'fill', label: 'Forme pleine', title: 'L’intérieur des traits fermés est rempli : un objet solide.' },
                  { value: 'lines', label: 'Traits seuls', title: 'Seuls les traits sortent en relief : plus fidèle, plus fragile.' },
                ]}
                onChange={(mode) => update({ mode })}
              />
              <Slider id="trace-threshold" label="Noir et blanc" help="Plus à droite, plus de gris compte comme de l’encre." min={1} max={254} value={settings.threshold} onInput={(threshold) => update({ threshold })} />
              <Slider id="trace-thicken" label="Épaissir les traits" help="Renforce un trait fin et referme les petits trous." min={0} max={12} value={settings.thicken} onInput={(thicken) => update({ thicken })} />
              <Slider id="trace-despeckle" label="Enlever les taches" help="Retire les petits points isolés." min={0} max={400} step={5} value={settings.despeckle} onInput={(despeckle) => update({ despeckle })} />
              <Slider id="trace-smoothing" label="Lisser" help="Adoucit les bords tremblés." min={0} max={1} step={0.05} value={settings.smoothing} onInput={(smoothing) => update({ smoothing })} />
              <div class="segmented">
                <button type="button" aria-pressed={settings.invert} onClick={() => update({ invert: !settings.invert })}>
                  Inverser
                </button>
                <button
                  type="button"
                  onClick={() => {
                    erased.fill(0);
                    setStrokes((n) => n + 1);
                  }}
                >
                  Annuler la gomme
                </button>
              </div>
            </>
          ) : null}
          <div class="field">
            <label class="field-label" for="trace-name">
              Nom du tampon
            </label>
            <div class="input-with-unit">
              <input id="trace-name" type="text" value={name} maxLength={40} onInput={(e) => setName((e.target as HTMLInputElement).value)} />
            </div>
          </div>
        </div>
      </div>
      {tracing && result && !result.ok ? (
        <Callout kind="warning">
          <p>{result.error} Essayez de lisser moins, ou d’épaissir les traits.</p>
        </Callout>
      ) : null}
    </Modal>
  );
}

export function TraceStampDialog() {
  const d = useAppState((s) => (s.dialog?.kind === 'trace-stamp' ? s.dialog : null));
  return d ? <TraceForm image={d.image} name={d.name} exact={d.exact} /> : null;
}
