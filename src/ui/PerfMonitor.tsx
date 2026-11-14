/**
 * Moniteur de charge (barre d'état) : une pastille qui résume la charge du modèle, et au clic le
 * détail : moteur de calcul, interface, rendu 3D, mémoire. Voir `app/perf.ts` pour ce qui est
 * mesuré (et pourquoi la charge CPU / GPU de la machine ne l'est pas).
 */
import { createPortal } from 'preact/compat';
import { useEffect, useRef, useState } from 'preact/hooks';
import { PERF_LIMITS, perfReport, slowSteps, type Load, type PerfSnapshot } from '../app/perf';
import { APP_NAME, APP_VERSION } from '../meta';
import { useAppState, useController } from './context';
import { Button } from './components/controls';

const mo = (bytes: number) => `${Math.round(bytes / 1048576)} Mo`;
const ms = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(2).replace('.', ',')} s` : `${Math.round(v)} ms`);
const LOAD_TEXT: Record<Load, string> = { ok: 'Normal', warn: 'Chargé', high: 'Trop lourd' };
const DOT: Record<Load, string> = { ok: 'ok', warn: 'warn', high: 'bad' };

function Dot({ load }: { load: Load }) {
  return <span class={`dot ${DOT[load]}`} aria-hidden="true" />;
}

/** Durées des derniers recalculs, en barres (rouge au-delà du seuil haut). */
function Spark({ snap }: { snap: PerfSnapshot }) {
  const list = snap.evaluations.slice(-40);
  if (list.length < 2) return null;
  const max = Math.max(PERF_LIMITS.computeMs[0], ...list.map((e) => e.durationMs));
  const w = 4;
  return (
    <svg class="perf-spark" viewBox={`0 0 ${40 * (w + 1)} 32`} preserveAspectRatio="none" role="img" aria-label="Durée des derniers recalculs">
      {list.map((e, i) => {
        const h = Math.max(1, (e.durationMs / max) * 32);
        const load = e.durationMs >= PERF_LIMITS.computeMs[1] ? 'high' : e.durationMs >= PERF_LIMITS.computeMs[0] ? 'warn' : 'ok';
        // Les plus récents à droite : 40 places, toujours de la même largeur.
        return <rect key={i} class={`bar-${load}`} x={(40 - list.length + i) * (w + 1)} y={32 - h} width={w} height={h} />;
      })}
    </svg>
  );
}

function Panel({ snap, onClose, anchor }: { snap: PerfSnapshot; onClose: () => void; anchor: DOMRect }) {
  const c = useController();
  const root = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);
  const [cache, setCache] = useState<{ count: number; bytes: number } | null>(null);
  useEffect(() => {
    void c.shapeCache().then(setCache);
  }, []);
  const slow = useAppState(
    (s) => slowSteps(s.doc.parts, (id) => s.display[id]?.stepMs),
    (a, b) => JSON.stringify(a) === JSON.stringify(b),
  );
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node) && !(e.target as Element).closest?.('.perf-item')) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }, []);
  const copy = async () => {
    const text = perfReport(snap, { app: `${APP_NAME} ${APP_VERSION}`, userAgent: navigator.userAgent }, slow);
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      console.info(text);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  const r = snap.render;
  // Hors de la barre d'état (qui rogne ce qui la dépasse), au-dessus de la pastille.
  return createPortal(
    <div
      class="perf-panel"
      role="dialog"
      aria-label="Moniteur de charge"
      ref={root}
      style={{ right: `${Math.max(8, window.innerWidth - anchor.right)}px`, bottom: `${window.innerHeight - anchor.top + 8}px` }}
    >
      <div class="perf-head">
        <Dot load={snap.overall} />
        <strong>Charge : {LOAD_TEXT[snap.overall]}</strong>
      </div>
      <h4>Moteur de calcul</h4>
      <dl class="kv perf-kv">
        <dt>
          <Dot load={snap.loads.compute} /> Dernier recalcul
        </dt>
        <dd>{snap.last ? `${ms(snap.last.durationMs)} · ${snap.last.parts} pièce${snap.last.parts > 1 ? 's' : ''}, ${snap.last.steps} étapes` : '—'}</dd>
        <dt>Occupation (10 s)</dt>
        <dd>{Math.round(snap.engineBusy * 100)} %</dd>
        <dt>
          <Dot load={snap.loads.wasm} /> Mémoire du noyau
        </dt>
        <dd>{snap.last ? mo(snap.last.memoryBytes) : '—'}</dd>
      </dl>
      <Spark snap={snap} />
      {slow.length ? (
        <>
          <h4>Étapes les plus lentes</h4>
          <ul class="perf-steps">
            {slow.map((x) => (
              <li key={x.featureId}>
                <button type="button" class="tl-link" title="Afficher l’historique de cette pièce" onClick={() => c.setActivePart(x.partId)}>
                  {x.part} › {x.step}
                </button>
                <span>{ms(x.ms)}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      <h4>Rendu 3D</h4>
      <dl class="kv perf-kv">
        <dt>
          <Dot load={snap.loads.triangles} /> Triangles
        </dt>
        <dd>{r ? r.triangles.toLocaleString('fr-FR') : '—'}</dd>
        <dt>Appels de dessin</dt>
        <dd>{r ? r.drawCalls : '—'}</dd>
        <dt>Maillages (carte graphique)</dt>
        <dd>{r ? mo(r.gpuBytes) : '—'}</dd>
        <dt>
          <Dot load={snap.loads.frame} /> Image (processeur)
        </dt>
        <dd>{r ? `${r.lastFrameMs.toFixed(1).replace('.', ',')} ms · max ${r.maxFrameMs.toFixed(1).replace('.', ',')} ms` : '—'}</dd>
        <dt>Image (carte graphique)</dt>
        <dd>{r?.gpuMs != null ? `${r.gpuMs.toFixed(1).replace('.', ',')} ms` : 'non mesurée par ce navigateur'}</dd>
      </dl>
      <h4>Interface et mémoire</h4>
      <dl class="kv perf-kv">
        <dt>
          <Dot load={snap.loads.ui} /> Blocages &gt; 50 ms (30 s)
        </dt>
        <dd>{snap.longTasks ? `${snap.longTasks.count}${snap.longTasks.count ? ` · ${ms(snap.longTasks.totalMs)}` : ''}` : 'non mesurés par ce navigateur'}</dd>
        <dt>
          <Dot load={snap.loads.heap} /> Mémoire JavaScript
        </dt>
        <dd>{snap.jsHeap ? `${mo(snap.jsHeap.used)} / ${mo(snap.jsHeap.limit)}` : 'non mesurée par ce navigateur'}</dd>
      </dl>
      <h4>Cache des formes</h4>
      <div class="perf-cache">
        <span title="Pièces déjà calculées, gardées dans ce navigateur : rouvertes sans rejouer leur historique">
          {cache ? `${cache.count} pièce${cache.count > 1 ? 's' : ''} · ${mo(cache.bytes)}` : '—'}
        </span>
        <button type="button" class="tl-link" disabled={!cache?.count} onClick={() => void c.shapeCache(true).then(setCache)}>
          Vider
        </button>
      </div>
      <p class="field-help">Mesures de VibeCAD lui-même : le navigateur ne donne pas la charge du processeur ni de la carte graphique de la machine.</p>
      <div class="perf-actions">
        <Button small onClick={() => void copy()}>
          {copied ? 'Relevé copié' : 'Copier le relevé'}
        </Button>
        <Button small onClick={onClose}>
          Fermer
        </Button>
      </div>
    </div>,
    document.body,
  );
}

/** Pastille de la barre d'état : état général, dernier recalcul et mémoire du noyau. */
export function PerfIndicator() {
  const c = useController();
  const last = useAppState((s) => s.lastEvaluation);
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const [snap, setSnap] = useState<PerfSnapshot>(() => c.perfSnapshot());
  useEffect(() => setSnap(c.perfSnapshot()), [last]);
  // Relevé régulier : toutes les secondes panneau ouvert, toutes les 5 s sinon.
  useEffect(() => {
    const id = setInterval(() => setSnap(c.perfSnapshot()), open ? 1000 : 5000);
    c.setPerfMonitoring(open);
    return () => {
      clearInterval(id);
      c.setPerfMonitoring(false);
    };
  }, [open]);
  return (
    <span class="perf-wrap">
      <button
        type="button"
        ref={button}
        class="item perf-item"
        aria-expanded={open}
        title={`Charge du modèle : ${LOAD_TEXT[snap.overall].toLowerCase()} (cliquer pour le détail)`}
        onClick={() => setOpen(!open)}
      >
        <Dot load={snap.overall} />
        {snap.last ? `${ms(snap.last.durationMs)} · ${mo(snap.last.memoryBytes)}` : 'Charge'}
      </button>
      {open && button.current ? <Panel snap={snap} anchor={button.current.getBoundingClientRect()} onClose={() => setOpen(false)} /> : null}
    </span>
  );
}
