/**
 * Export vidéo d'un scénario de mouvement : chaque image est calculée à son instant (poses de la
 * timeline), rendue hors écran à la taille voulue, encodée par le navigateur (WebCodecs) et
 * rangée dans un fichier MP4. La vidéo est fluide quelle que soit la vitesse de la machine.
 */
import { ArrayBufferTarget, Muxer } from 'mp4-muxer';
import type { AppController } from '../app/controller';
import { SCENARIO_STUDY } from '../app/mechanism';
import type { StudioBackground } from '../viewport/studio';
import { buildViewportInput } from './ViewportHost';
import { renderSettings } from '../domain/render';

export interface VideoOptions {
  width: number;
  height: number;
  fps: 30 | 60;
  /** Nombre de passages de la timeline. */
  loops: number;
  /** Un tour complet de la caméra autour du mécanisme sur toute la vidéo. */
  orbit: boolean;
  /** Éclairage « Rendu » (sinon : celui de la vue). */
  studio: boolean;
  /** Cadrage sur le mécanisme (tout son mouvement) ; sinon celui de la vue. */
  fit: boolean;
  background: 'view' | 'white' | 'black';
}

/** Codecs essayés, du plus répandu au moins répandu (H.264 se lit partout). */
const CODECS = [
  { codec: 'avc1.640033', muxer: 'avc' },
  { codec: 'avc1.640028', muxer: 'avc' },
  { codec: 'avc1.42003e', muxer: 'avc' },
  { codec: 'vp09.00.51.08', muxer: 'vp9' },
  { codec: 'av01.0.12M.08', muxer: 'av1' },
] as const;

export function videoSupported(): boolean {
  return typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined';
}

/** Réglage de l'encodeur pour un codec. */
function encoderConfig(c: (typeof CODECS)[number], width: number, height: number, fps: number, bitrate: number): VideoEncoderConfig {
  return { codec: c.codec, width, height, framerate: fps, bitrate, ...(c.muxer === 'avc' ? { avc: { format: 'avc' as const } } : {}) };
}

/**
 * Premier codec que le navigateur encode vraiment à cette taille : une image d'essai est encodée
 * (certains navigateurs annoncent un codec qu'ils refusent ensuite).
 */
async function pickCodec(width: number, height: number, fps: number, bitrate: number): Promise<(typeof CODECS)[number] | null> {
  const probe = document.createElement('canvas');
  probe.width = width;
  probe.height = height;
  probe.getContext('2d')!.fillRect(0, 0, width, height);
  for (const c of CODECS) {
    const config = encoderConfig(c, width, height, fps, bitrate);
    try {
      if (!(await VideoEncoder.isConfigSupported(config)).supported) continue;
    } catch {
      continue;
    }
    let ok = false;
    let failed = false;
    const encoder = new VideoEncoder({ output: () => (ok = true), error: () => (failed = true) });
    try {
      encoder.configure(config);
      const frame = new VideoFrame(probe, { timestamp: 0 });
      encoder.encode(frame, { keyFrame: true });
      frame.close();
      await encoder.flush();
    } catch {
      failed = true;
    } finally {
      if (encoder.state !== 'closed') encoder.close();
    }
    if (ok && !failed) return c;
  }
  return null;
}

/** Nombre d'images de la vidéo. */
export function videoFrameCount(duration: number, options: Pick<VideoOptions, 'fps' | 'loops'>): number {
  const perLoop = Math.max(1, Math.round(duration * options.fps));
  // Une seule fois : la dernière image montre la fin de la timeline.
  return options.loops <= 1 ? perLoop + 1 : perLoop * options.loops;
}

/** Instant de la timeline montré par l'image `i`. */
export function videoFrameTime(i: number, duration: number, options: Pick<VideoOptions, 'fps' | 'loops'>): number {
  const perLoop = Math.max(1, Math.round(duration * options.fps));
  if (options.loops <= 1) return Math.min(duration, (i / perLoop) * duration);
  return ((i % perLoop) / perLoop) * duration;
}

/** Fond de la vidéo : blanc, noir, ou celui de la scène de rendu. */
function backgroundOf(bg: VideoOptions['background'], scene: StudioBackground): StudioBackground {
  if (bg === 'white') return '#ffffff';
  if (bg === 'black') return '#101114';
  return scene;
}

/**
 * Calcule la vidéo du scénario ouvert ; `progress` reçoit l'avancement (0 à 1), `cancelled` arrête
 * l'export (null est alors renvoyé).
 */
export async function renderScenarioVideo(c: AppController, options: VideoOptions, progress: (f: number) => void, cancelled: () => boolean): Promise<Blob | null> {
  if (!videoSupported()) throw new Error('Ce navigateur ne sait pas encoder de vidéo (WebCodecs).');
  const viewport = c.currentViewport();
  const scenario = c.currentScenario();
  if (!viewport || !scenario?.timeline) throw new Error('Aucune timeline à exporter.');
  const width = options.width - (options.width % 2);
  const height = options.height - (options.height % 2);
  const bitrate = Math.round(width * height * options.fps * 0.12);
  const codec = await pickCodec(width, height, options.fps, bitrate);
  if (!codec) throw new Error('Aucun codec vidéo disponible à cette taille.');
  // Poses de la timeline : calculées d'avance si besoin.
  await c.bakeTimeline();
  const { duration } = scenario.timeline;
  const count = videoFrameCount(duration, options);
  const muxer = new Muxer({ target: new ArrayBufferTarget(), video: { codec: codec.muxer, width, height, frameRate: options.fps }, fastStart: 'in-memory' });
  let failure: Error | null = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => (failure = e instanceof Error ? e : new Error(String(e))),
  });
  encoder.configure(encoderConfig(codec, width, height, options.fps, bitrate));
  const original = viewport.currentInput;
  const state = c.state;
  const render = renderSettings(state.doc.render);
  // Épaisseur des arêtes : comme à l'écran, rapportée à la hauteur de la vidéo.
  const edgeWidth = (state.edgeWidth ?? 1) * Math.max(1, height / Math.max(1, viewport.size.height));
  const pause = () => new Promise((resolve) => setTimeout(resolve, 0));
  const show = (t: number) => {
    const settled = c.scenarioPoseAt(t);
    const built = buildViewportInput({ ...state, scenarioTime: t, scenarioLive: {}, hoverJoint: null, hoverPart: null }, { partId: SCENARIO_STUDY, source: null, scenario: settled });
    viewport.setInput({ ...built, displayStyle: options.studio ? 'render' : state.displayStyle, render, edgeWidth, zoomSpeed: state.zoomSpeed, markers: [], selection: [] });
  };
  try {
    // Cadrage : la boîte qui contient le mécanisme à quelques instants de la timeline.
    let fit: { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number }; sphere: boolean } | null = null;
    if (options.fit) {
      const boxes = Array.from({ length: 9 }, (_, k) => {
        show((duration * k) / 8);
        return viewport.modelBounds();
      }).filter((b): b is NonNullable<typeof b> => !!b);
      if (boxes.length) {
        const min = { x: Math.min(...boxes.map((b) => b.min.x)), y: Math.min(...boxes.map((b) => b.min.y)), z: Math.min(...boxes.map((b) => b.min.z)) };
        const max = { x: Math.max(...boxes.map((b) => b.max.x)), y: Math.max(...boxes.map((b) => b.max.y)), z: Math.max(...boxes.map((b) => b.max.z)) };
        fit = { min, max, sphere: options.orbit };
      }
    }
    await viewport.beginCapture({ width, height, studio: options.studio, background: backgroundOf(options.background, viewport.sceneBackground()), fit });
    let t0 = performance.now();
    for (let i = 0; i < count; i++) {
      if (cancelled() || failure) break;
      show(videoFrameTime(i, duration, options));
      const canvas = viewport.captureFrame(options.orbit ? (360 * i) / count : 0);
      const frame = new VideoFrame(canvas, { timestamp: Math.round((i * 1e6) / options.fps), duration: Math.round(1e6 / options.fps) });
      encoder.encode(frame, { keyFrame: i % (options.fps * 2) === 0 });
      frame.close();
      // L'encodeur prend du retard : on l'attend (mémoire bornée).
      while (encoder.encodeQueueSize > 6 && !failure) await new Promise((resolve) => setTimeout(resolve, 4));
      if (performance.now() - t0 > 60) {
        progress((i + 1) / count);
        await pause();
        t0 = performance.now();
      }
    }
    if (!cancelled() && !failure) await encoder.flush();
  } finally {
    if (encoder.state !== 'closed') encoder.close();
    viewport.endCapture();
    viewport.setInput(original);
  }
  if (failure) throw failure;
  if (cancelled()) return null;
  muxer.finalize();
  progress(1);
  return new Blob([muxer.target.buffer], { type: 'video/mp4' });
}
