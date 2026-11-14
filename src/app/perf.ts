/**
 * Moniteur de charge : ce que VibeCAD mesure de lui-même pour dire si un modèle devient lourd.
 * Un navigateur ne donne ni la charge du processeur ni celle de la carte graphique de la machine :
 * on mesure donc le travail de l'application (recalculs du moteur, blocages de l'interface,
 * rendu 3D) et sa mémoire (noyau WASM, mémoire JavaScript quand le navigateur l'expose).
 *
 * Les échantillons vivent hors de l'état de l'application : les relever ne provoque aucun rendu.
 */

/** Recalcul du moteur géométrique (worker). */
export interface EvaluationSample {
  at: number;
  durationMs: number;
  memoryBytes: number;
  parts: number;
  steps: number;
}

/** Mesures de la vue 3D (fournies par la vue, voir `Viewport.stats`). */
export interface RenderStats {
  /** Durée de préparation de la dernière image côté processeur (ms). */
  lastFrameMs: number;
  /** Plus longue image des dernières secondes (ms). */
  maxFrameMs: number;
  /** Images dessinées pendant la dernière seconde (la vue ne dessine que si quelque chose change). */
  framesLastSecond: number;
  triangles: number;
  drawCalls: number;
  /** Mémoire des maillages envoyés à la carte graphique (octets, estimée). */
  gpuBytes: number;
  /** Temps réel de la carte graphique pour la dernière image mesurée (ms), si le navigateur le donne. */
  gpuMs: number | null;
}

export type Load = 'ok' | 'warn' | 'high';

export interface PerfSnapshot {
  last: EvaluationSample | null;
  /** Recalculs des 2 dernières minutes, du plus ancien au plus récent. */
  evaluations: EvaluationSample[];
  /** Part du temps où le moteur a calculé, sur les 10 dernières secondes (0 à 1). */
  engineBusy: number;
  /** Blocages de l'interface de plus de 50 ms sur les 30 dernières secondes. */
  longTasks: { count: number; totalMs: number; maxMs: number } | null;
  /** Mémoire JavaScript (Chrome, Edge) : utilisée et plafond. */
  jsHeap: { used: number; limit: number } | null;
  render: RenderStats | null;
  /** Niveau de chaque mesure, et le pire. */
  loads: Record<'compute' | 'wasm' | 'triangles' | 'frame' | 'ui' | 'heap', Load>;
  overall: Load;
}

/** Seuils : au-delà, la mesure passe en orange puis en rouge. */
export const PERF_LIMITS = {
  computeMs: [1000, 3000],
  wasmBytes: [1024 ** 3, 1.6 * 1024 ** 3],
  triangles: [1_500_000, 4_000_000],
  frameMs: [16, 33],
  longTaskMs: [500, 2000],
  heapRatio: [0.7, 0.85],
} as const;

const KEEP_MS = 120_000;
const evaluations: EvaluationSample[] = [];
const longTasks: { at: number; ms: number }[] = [];
let observing = false;

function trim(now: number): void {
  while (evaluations.length && now - evaluations[0]!.at > KEEP_MS) evaluations.shift();
  while (longTasks.length && now - longTasks[0]!.at > 30_000) longTasks.shift();
}

/** Blocages de l'interface (Chrome, Edge) : observés dès le premier appel. */
function observeLongTasks(): void {
  if (observing || typeof PerformanceObserver === 'undefined') return;
  observing = true;
  try {
    if (!PerformanceObserver.supportedEntryTypes?.includes('longtask')) return;
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) longTasks.push({ at: performance.now(), ms: e.duration });
      trim(performance.now());
    }).observe({ type: 'longtask', buffered: true });
  } catch {
    // Navigateur sans cette mesure : la ligne « Interface » l'indique.
  }
}

/** Enregistre un recalcul ; un recalcul lent est aussi signalé dans la console du navigateur. */
export function recordEvaluation(sample: Omit<EvaluationSample, 'at'>): void {
  observeLongTasks();
  const now = performance.now();
  evaluations.push({ ...sample, at: now });
  trim(now);
  if (sample.durationMs >= PERF_LIMITS.computeMs[0]) {
    console.warn(
      `[VibeCAD] recalcul lent : ${(sample.durationMs / 1000).toFixed(2)} s (${sample.parts} pièce${sample.parts > 1 ? 's' : ''}, ${sample.steps} étape${sample.steps > 1 ? 's' : ''}, noyau ${Math.round(sample.memoryBytes / 1048576)} Mo)`,
    );
  }
}

const level = (value: number, [warn, high]: readonly [number, number]): Load => (value >= high ? 'high' : value >= warn ? 'warn' : 'ok');
const worst = (loads: Load[]): Load => (loads.includes('high') ? 'high' : loads.includes('warn') ? 'warn' : 'ok');

export function perfSnapshot(render: RenderStats | null): PerfSnapshot {
  observeLongTasks();
  const now = performance.now();
  trim(now);
  const last = evaluations.at(-1) ?? null;
  // Temps de calcul tombé dans les 10 dernières secondes (un recalcul se termine à `at`).
  const busyMs = evaluations.reduce((sum, e) => sum + Math.max(0, Math.min(e.durationMs, e.at - (now - 10_000))), 0);
  const supported = typeof PerformanceObserver !== 'undefined' && !!PerformanceObserver.supportedEntryTypes?.includes('longtask');
  const lt = supported ? { count: longTasks.length, totalMs: longTasks.reduce((s, t) => s + t.ms, 0), maxMs: longTasks.reduce((m, t) => Math.max(m, t.ms), 0) } : null;
  const mem = (performance as unknown as { memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number } }).memory;
  const jsHeap = mem ? { used: mem.usedJSHeapSize, limit: mem.jsHeapSizeLimit } : null;
  const loads = {
    compute: last ? level(last.durationMs, PERF_LIMITS.computeMs) : 'ok',
    wasm: last ? level(last.memoryBytes, PERF_LIMITS.wasmBytes) : 'ok',
    triangles: render ? level(render.triangles, PERF_LIMITS.triangles) : 'ok',
    frame: render ? level(render.maxFrameMs, PERF_LIMITS.frameMs) : 'ok',
    ui: lt ? level(lt.totalMs, PERF_LIMITS.longTaskMs) : 'ok',
    heap: jsHeap ? level(jsHeap.used / jsHeap.limit, PERF_LIMITS.heapRatio) : 'ok',
  } satisfies PerfSnapshot['loads'];
  return { last, evaluations: [...evaluations], engineBusy: Math.min(1, busyMs / 10_000), longTasks: lt, jsHeap, render, loads, overall: worst(Object.values(loads)) };
}

const mo = (bytes: number) => `${Math.round(bytes / 1048576)} Mo`;
const ms = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(2)} s` : `${Math.round(v)} ms`);

/** Étape lente : pièce, étape, durée de sa dernière mesure. */
export interface SlowStep {
  partId: string;
  featureId: string;
  part: string;
  step: string;
  ms: number;
}

/** Étapes les plus lentes du projet (dernière mesure de chacune), de la plus lente à la moins lente. */
export function slowSteps(parts: readonly { id: string; name: string; features: readonly { id: string; name: string }[] }[], stepMs: (partId: string) => Record<string, number> | undefined, limit = 5, minMs = 100): SlowStep[] {
  const out: SlowStep[] = [];
  for (const p of parts) {
    const times = stepMs(p.id);
    if (!times) continue;
    for (const f of p.features) {
      const ms = times[f.id];
      if (ms !== undefined && ms >= minMs) out.push({ partId: p.id, featureId: f.id, part: p.name, step: f.name, ms });
    }
  }
  return out.sort((a, b) => b.ms - a.ms).slice(0, limit);
}

/** Relevé texte (à coller dans un message ou un ticket). */
export function perfReport(s: PerfSnapshot, context: { app: string; userAgent: string }, slow: readonly SlowStep[] = []): string {
  const lines = [
    `Relevé de charge ${context.app} — ${new Date().toLocaleString('fr-FR')}`,
    `Navigateur : ${context.userAgent}`,
    `État général : ${s.overall === 'ok' ? 'normal' : s.overall === 'warn' ? 'chargé' : 'trop lourd'}`,
    '',
    `Moteur de calcul : dernier recalcul ${s.last ? ms(s.last.durationMs) : '—'}${s.last ? ` (${s.last.parts} pièces, ${s.last.steps} étapes)` : ''}, occupé ${Math.round(s.engineBusy * 100)} % des 10 dernières secondes`,
    `Mémoire du noyau (WASM) : ${s.last ? mo(s.last.memoryBytes) : '—'}`,
    `Mémoire JavaScript : ${s.jsHeap ? `${mo(s.jsHeap.used)} sur ${mo(s.jsHeap.limit)}` : 'non mesurée par ce navigateur'}`,
    `Interface : ${s.longTasks ? `${s.longTasks.count} blocage(s) > 50 ms en 30 s (total ${ms(s.longTasks.totalMs)}, plus long ${ms(s.longTasks.maxMs)})` : 'non mesurée par ce navigateur'}`,
    s.render
      ? `Rendu 3D : ${s.render.triangles.toLocaleString('fr-FR')} triangles, ${s.render.drawCalls} appels de dessin, maillages ${mo(s.render.gpuBytes)}, image ${s.render.lastFrameMs.toFixed(1)} ms (max ${s.render.maxFrameMs.toFixed(1)} ms)${s.render.gpuMs !== null ? `, carte graphique ${s.render.gpuMs.toFixed(1)} ms` : ''}`
      : 'Rendu 3D : —',
    '',
    'Étapes les plus lentes (dernière mesure) :',
    ...(slow.length ? slow.map((x) => `  ${ms(x.ms)} : ${x.part} › ${x.step}`) : ['  aucune au-delà de 100 ms']),
    '',
    'Recalculs (2 dernières minutes) :',
    ...s.evaluations.map((e) => `  il y a ${Math.round((performance.now() - e.at) / 1000)} s : ${ms(e.durationMs)}, ${e.parts} pièces, ${e.steps} étapes, noyau ${mo(e.memoryBytes)}`),
  ];
  return lines.join('\n');
}
