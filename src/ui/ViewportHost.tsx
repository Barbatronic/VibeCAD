import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { AppState } from '../app/state';
import type { SketchFeature } from '../domain/model';
import { pointPosition } from '../sketch/model';
import { extractProfiles } from '../sketch/profiles';
import {
  cancelEditor,
  confirmEditor,
  confirmInput,
  drawInputCurrentValues,
  editDimension,
  editorUnit,
  escape as sketchEscape,
  moveDimensionLabel,
  pointerDown,
  pointerLeave,
  pointerMove,
  pointerUp,
  selectConstraint,
  sessionPreview,
  setEditorChoice,
  setEditorText,
  setInputActive,
  setInputValue,
  setPixelSize,
  toggleSnapToGrid,
  TOOL_LABELS,
  type SketchSession,
} from '../sketch/session';
import type { SketchRenderInput } from '../viewport/sketch-render';
import { Viewport, type ViewMarker, type ViewportInput, type ViewPartInput } from '../viewport/viewport';
import { jointFreedoms, lcsFrame, lcsFromPick, solveAssembly } from '../app/assembly';
import { fabricationSettings, printLayout } from '../app/fabrication';
import { invertRigid4, transformDirection4, transformPoint4 } from '../math/mat4';
import type { Vec2 } from '../math/vec';
import { STANDARD_VIEWS, type StandardView } from '../viewport/camera-rig';
import { useAppState, useController } from './context';
import { IconButton } from './components/controls';
import { NumberInput } from './components/number-input';
import { Timeline } from './Timeline';
import { MascotBubble } from './Mascot';
import { formatNumber } from '../domain/units';
import { Icon } from './icons';

function sessionRender(session: SketchSession, highlight: Vec2[]): SketchRenderInput {
  return {
    frame: session.frame,
    sketch: session.sketch,
    mode: 'edit',
    freeEntities: new Set(session.freeEntities),
    selection: new Set([...session.selection, ...(session.editor?.constraintId ? [session.editor.constraintId] : [])]),
    hover: session.hover?.id ?? null,
    picks: session.picks,
    highlightPoints: highlight,
    preview: sessionPreview(session),
    snap: session.snap,
    projectable: session.tool === 'project' ? session.projectable : [],
    projectHover: session.projectHover,
  };
}

/** Vue de l'onglet Assemblage : pièces insérées à leur place, repères des liaisons. */
function buildAssemblyInput(s: AppState): ViewportInput {
  const assembly = s.doc.assembly ?? { instances: [], joints: [] };
  const placement = solveAssembly(assembly, (partId) => s.display[partId]?.mesh);
  const parts: ViewPartInput[] = assembly.instances.map((inst) => {
    const part = s.doc.parts.find((p) => p.id === inst.partId);
    const d = s.display[inst.partId];
    return {
      partId: inst.id,
      color: part?.color ?? '#888888',
      visible: true,
      meshKey: d?.meshKey ?? null,
      mesh: d?.mesh ?? null,
      appearance: 'normal',
      matrix: placement.matrices.get(inst.id) ?? [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
    };
  });
  const markers: ViewMarker[] = [];
  const sel = s.assemblySelection;
  if (sel?.kind === 'joint') {
    const f = placement.jointFrames.get(sel.id);
    if (f) markers.push({ origin: f.base.origin, axis: f.base.normal, role: 'base' }, { origin: f.moving.origin, axis: f.moving.normal, role: 'moving' });
  }
  const selection: ViewportInput['selection'] = [];
  if (s.mode.kind === 'joint' && s.mode.moving) {
    const m = s.mode.moving;
    const inst = assembly.instances.find((i) => i.id === m.instanceId);
    const mesh = inst && s.display[inst.partId]?.mesh;
    const frame = mesh ? lcsFrame(mesh, m.lcs) : null;
    const matrix = placement.matrices.get(m.instanceId);
    if (frame && matrix) {
      markers.push({ origin: transformPoint4(matrix, frame.origin), axis: transformDirection4(matrix, frame.normal), role: 'moving', label: 'Pièce qui bouge' });
    }
    // L'élément cliqué reste en surbrillance pendant le choix du second repère.
    if (s.mode.movingPick) selection.push({ partId: m.instanceId, kind: s.mode.movingPick.kind, index: s.mode.movingPick.index });
  }
  if (s.mode.kind === 'joint' && s.hover) {
    // Aperçu du repère qui servira d'accroche sous la souris (centre de face, de cercle, milieu d'arête).
    const h = s.hover;
    const inst = assembly.instances.find((i) => i.id === h.partId);
    const part = inst && s.doc.parts.find((p) => p.id === inst.partId);
    const mesh = inst && s.display[inst.partId]?.mesh;
    const matrix = inst && placement.matrices.get(inst.id);
    const local = h.kind === 'vertex' && matrix ? transformPoint4(invertRigid4(matrix), h.point) : h.point;
    const r = mesh && part ? lcsFromPick(mesh, h.kind, h.index, part, local) : null;
    const frame = r && !('reason' in r) && mesh ? lcsFrame(mesh, r.ref) : null;
    if (frame && matrix) {
      const second = !!s.mode.moving;
      markers.push({
        origin: transformPoint4(matrix, frame.origin),
        axis: transformDirection4(matrix, frame.normal),
        role: second ? 'base' : 'moving',
        preview: true,
        label: second ? 'Accroche sur la pièce de référence' : 'Accroche sur la pièce qui bouge',
      });
    }
  }
  if (s.mode.kind === 'model' && sel?.kind === 'instance') {
    const inst = assembly.instances.find((i) => i.id === sel.id);
    const mesh = inst && s.display[inst.partId]?.mesh;
    // La pièce sélectionnée : toutes ses arêtes en surbrillance.
    if (mesh) mesh.edges.forEach((_e, index) => selection.push({ partId: sel.id, kind: 'edge', index }));
  }
  // Outil Main : seules les pièces tenues par une liaison mobile peuvent être attrapées.
  const dragTargets = s.assemblyHand && s.mode.kind === 'model'
    ? assembly.joints.filter((j) => !placement.issues.has(j.id) && (jointFreedoms(j.kind).angle || jointFreedoms(j.kind).offset)).map((j) => j.moving.instanceId)
    : [];
  const lockedFace = s.mode.kind === 'joint' && s.mode.lockedFace ? { partId: s.mode.lockedFace.instanceId, index: s.mode.lockedFace.index } : null;
  if (lockedFace) selection.push({ partId: lockedFace.partId, kind: 'face', index: lockedFace.index });
  return { mode: 'model', parts, tool: null, sketches: [], session: null, selection, measure: null, featurePicking: true, fitRequest: s.fitRequest, markers, dragTargets, lockedFace };
}

/** Vue de l'onglet Fabrication (impression) : pièces disposées sur le plateau affiché. */
function buildFabricationInput(s: AppState): ViewportInput {
  const hasSolid = (id: string) => (s.display[id]?.result.analysis?.solidCount ?? 0) > 0;
  const settings = fabricationSettings(s.doc, hasSolid);
  if (s.fabricationTab !== 'print') {
    // Découpe laser et documents : les pièces telles que modélisées (pour choisir une face).
    const parts: ViewPartInput[] = s.doc.parts
      .filter((p) => hasSolid(p.id))
      .map((p) => ({ partId: `fab:${p.id}:0`, color: p.color, visible: true, meshKey: s.display[p.id]?.meshKey ?? null, mesh: s.display[p.id]?.mesh ?? null, appearance: 'normal' }));
    return { mode: 'model', parts, tool: null, sketches: [], session: null, selection: [], measure: null, featurePicking: s.mode.kind === 'pick-fab-face', fitRequest: s.fitRequest, markers: [], dragTargets: [], bed: null };
  }
  const layout = printLayout(settings.print, s.doc.parts, (id) => s.display[id]?.mesh, (id) => s.display[id]?.result.analysis);
  const plate = Math.max(0, Math.min(s.printPlate, layout.plates - 1));
  const parts: ViewPartInput[] = layout.placements.filter((p) => p.plate === plate).map((p) => {
    const part = s.doc.parts.find((x) => x.id === p.partId);
    const d = s.display[p.partId];
    return { partId: `fab:${p.partId}:${p.copy}`, color: part?.color ?? '#888888', visible: true, meshKey: d?.meshKey ?? null, mesh: d?.mesh ?? null, appearance: 'normal', matrix: p.matrix };
  });
  return {
    mode: 'model',
    parts,
    tool: null,
    sketches: [],
    session: null,
    selection: [],
    measure: null,
    featurePicking: s.mode.kind === 'pick-fab-face',
    fitRequest: s.fitRequest,
    markers: [],
    dragTargets: [],
    bed: { x: settings.print.bed.x, y: settings.print.bed.y },
  };
}

/** Construit la représentation d'affichage à partir de l'état de l'application. */
export function buildViewportInput(s: AppState): ViewportInput {
  if (s.workspace === 'assembly') return buildAssemblyInput(s);
  if (s.workspace === 'fabrication') return buildFabricationInput(s);
  const mode = s.mode.kind;
  const parts: ViewPartInput[] = s.doc.parts.map((p) => {
    const d = s.display[p.id];
    const previewPart = mode === 'feature' && s.mode.kind === 'feature' && s.mode.draft.partId === p.id ? s.preview?.parts[p.id] : undefined;
    if (previewPart?.mesh && previewPart.meshKey) {
      return { partId: p.id, color: p.color, visible: p.visible, meshKey: `preview|${previewPart.meshKey}`, mesh: previewPart.mesh, appearance: 'preview' };
    }
    return {
      partId: p.id,
      color: p.color,
      visible: p.visible,
      meshKey: d?.meshKey ?? null,
      mesh: d?.mesh ?? null,
      appearance: mode === 'sketch' ? 'dimmed' : d?.stale ? 'stale' : 'normal',
    };
  });

  const sketches: ViewportInput['sketches'] = [];
  if (mode !== 'sketch') {
    for (const part of s.doc.parts) {
      if (!part.visible) continue;
      const result = s.display[part.id]?.result;
      if (!result) continue;
      for (const f of part.features) {
        if (f.type !== 'sketch') continue;
        const selected = s.selection?.kind === 'feature' && s.selection.featureId === f.id;
        const issue = result.statuses.find((st) => st.relatedFeatureId === f.id && st.highlightPoints?.length);
        if (!(f as SketchFeature).visible && !selected && !issue) continue;
        const sk = result.sketches.find((x) => x.featureId === f.id);
        if (!sk?.frame) continue;
        const highlightPoints = (issue?.highlightPoints ?? []).map((id) => pointPosition(sk.solved, id)).filter((v): v is Vec2 => !!v);
        sketches.push({ key: f.id, frame: sk.frame, sketch: sk.solved, mode: 'display', emphasis: selected, highlightPoints });
      }
    }
  }

  let session: SketchRenderInput | null = null;
  if (s.mode.kind === 'sketch') {
    const sess = s.mode.session;
    const profile = extractProfiles(sess.sketch);
    const highlight = !profile.ok && (profile.code === 'PROFILE_OPEN' || profile.code === 'PROFILE_BRANCHED') && !sess.start ? profile.positions : [];
    session = sessionRender(sess, highlight);
  }

  const selection: ViewportInput['selection'] = [];
  if (s.selection && (s.selection.kind === 'face' || s.selection.kind === 'edge')) selection.push({ partId: s.selection.partId, kind: s.selection.kind, index: s.selection.index });
  if (s.mode.kind === 'measure') for (const p of s.mode.picks) if (p.kind !== 'vertex') selection.push({ partId: p.partId, kind: p.kind, index: p.index });

  const tool = mode === 'feature' && s.preview?.tool ? { key: s.preview.tool.key, mesh: s.preview.tool.mesh, kind: s.preview.tool.kind } : null;
  const measure = s.mode.kind === 'measure' && s.mode.info?.segment ? s.mode.info.segment : null;
  const featurePicking = s.mode.kind === 'feature' && (s.mode.draft.feature.type === 'fillet' || s.mode.draft.feature.type === 'chamfer' || s.mode.draft.feature.type === 'pattern' || s.mode.draft.feature.type === 'mirror');
  return { mode: mode === 'joint' || mode === 'pick-fab-face' ? 'model' : mode, parts, tool, sketches, session, selection, measure, featurePicking, fitRequest: s.fitRequest };
}

function DimensionEditorPopup({ session, viewport }: { session: SketchSession; viewport: Viewport }) {
  const c = useController();
  const ed = session.editor!;
  const pos = viewport.projectSketchPoint(session.frame, ed.anchor);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    if (ed.fresh) el.select();
    else el.setSelectionRange(el.value.length, el.value.length);
  }, [ed.mode, ed.constraintId, ed.choice]);
  const title = ed.mode === 'edit' ? 'Modifier la cote' : 'Nouvelle cote';
  const unit = editorUnit(session);
  return (
    <div
      class="floating-editor"
      role="dialog"
      aria-label={title}
      style={{ left: `${Math.min(Math.max(pos.x, 140), viewport.size.width - 140)}px`, top: `${Math.max(pos.y, 150)}px` }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div class="title">{title}</div>
      {ed.mode === 'create' && ed.candidates.length > 1 ? (
        <div class="segmented" role="group" aria-label="Type de cote">
          {ed.candidates.map((cand, i) => (
            <button key={cand.label} type="button" aria-pressed={i === ed.choice} onClick={() => c.updateSession((s) => setEditorChoice(s, i))}>
              {cand.label}
            </button>
          ))}
        </div>
      ) : null}
      <div class="row">
        <NumberInput
          inputRef={inputRef}
          ariaLabel={unit === '°' ? 'Valeur de l’angle en degrés' : 'Valeur de la cote en millimètres'}
          unit={unit}
          value={ed.text}
          invalid={!!ed.error}
          min={0}
          onInput={(text) => c.updateSession((s) => setEditorText(s, text))}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              e.stopPropagation();
              c.updateSession(confirmEditor);
            } else if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              c.updateSession(cancelEditor);
            }
          }}
        />
        <button type="button" class="btn btn-primary btn-small" onClick={() => c.updateSession(confirmEditor)}>
          OK
        </button>
      </div>
      {ed.error ? (
        <div class="field-error" role="alert" style={{ marginTop: '6px' }}>
          <Icon name="error" />
          {ed.error}
        </div>
      ) : (
        <div class="field-help" style={{ marginTop: '6px' }}>
          Entrée pour valider, Échap pour annuler.
        </div>
      )}
    </div>
  );
}

function DrawInputBox({ session }: { session: SketchSession }) {
  const c = useController();
  const input = session.input!;
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const typed = input.values.some((v) => v);
  // Dimensions du tracé sous le curseur : point de départ des flèches et de la molette.
  const current = drawInputCurrentValues(session);
  useEffect(() => {
    // Dès qu'une valeur a été tapée, le champ actif prend le focus (curseur en fin de texte).
    if (!typed) return;
    const el = refs.current[input.active];
    if (el && document.activeElement !== el) {
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }
  }, [typed, input.active]);
  return (
    <div class="draw-input" role="group" aria-label="Dimensions au clavier" onPointerDown={(e) => e.stopPropagation()}>
      {input.labels.map((label, i) => (
        <label key={label}>
          {label}
          <NumberInput
            inputRef={(el) => {
              refs.current[i] = el;
            }}
            value={input.values[i] ?? ''}
            unit={label === 'Angle' ? '°' : 'mm'}
            ariaLabel={label === 'Angle' ? 'Angle en degrés' : `${label} en millimètres`}
            {...(current[i] !== undefined ? { fallback: current[i], placeholder: formatNumber(current[i]!) } : {})}
            onInput={(text) => c.updateSession((s) => setInputValue(s, i, text))}
            onFocus={() => c.updateSession((s) => setInputActive(s, i))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                e.stopPropagation();
                c.updateSession(confirmInput);
              } else if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                (e.target as HTMLInputElement).blur();
                c.updateSession(sketchEscape);
              }
            }}
          />
        </label>
      ))}
      <span class="hint">{input.error ? <span class="field-error">{input.error}</span> : 'Tapez les valeurs (Tab pour passer au champ suivant), puis Entrée.'}</span>
    </div>
  );
}

function ViewControls() {
  const c = useController();
  const projection = useAppState((s) => s.projection);
  const sketching = useAppState((s) => s.mode.kind === 'sketch');
  const grid = useAppState((s) => (s.mode.kind === 'sketch' ? s.mode.session.snapToGrid : false));
  const views: StandardView[] = ['iso', 'front', 'top', 'right'];
  const icons: Record<string, string> = { iso: 'iso', front: 'front', top: 'top', right: 'right' };
  if (sketching) {
    return (
      <div class="view-controls">
        <div class="cluster">
          <IconButton icon="target" label="Vue normale à l’esquisse" onClick={() => c.lookAtSketch()} />
          <IconButton icon="fit" label="Cadrer tout (F)" onClick={() => c.fitAll()} />
        </div>
        <div class="cluster">
          <IconButton
            icon="grid"
            label={grid ? 'Aimantation à la grille : activée (cliquer pour la couper ; Alt maintenu : aucun accrochage)' : 'Aimantation à la grille : coupée (cliquer pour l’activer)'}
            pressed={grid}
            onClick={() => c.updateSession(toggleSnapToGrid)}
          />
        </div>
      </div>
    );
  }
  return (
    <div class="view-controls" role="toolbar" aria-label="Vues">
      <div class="cluster">
        {views.map((v) => (
          <IconButton key={v} icon={icons[v]!} label={`Vue ${STANDARD_VIEWS[v].label} (${STANDARD_VIEWS[v].key})`} onClick={() => c.setView(v)} />
        ))}
      </div>
      <div class="cluster">
        <IconButton icon="fit" label="Cadrer tout (F)" onClick={() => c.fitAll()} />
        <IconButton
          icon={projection === 'perspective' ? 'perspective' : 'orthographic'}
          label={projection === 'perspective' ? 'Projection : perspective (cliquer pour orthographique)' : 'Projection : orthographique (cliquer pour perspective)'}
          onClick={() => c.setProjection(projection === 'perspective' ? 'orthographic' : 'perspective')}
        />
      </div>
    </div>
  );
}

function Banner() {
  const info = useAppState(
    (s) => {
      if (s.mode.kind === 'sketch') return { kind: 'sketch', text: `Mode esquisse — outil ${TOOL_LABELS[s.mode.session.tool]}` };
      if (s.mode.kind === 'feature') return { kind: s.mode.draft.feature.type === 'pocket' ? 'preview cut' : 'preview', text: 'Aperçu — non validé' };
      if (s.mode.kind === 'pick-support') return { kind: 'sketch', text: 'Choisissez un plan ou une face plane' };
      if (s.mode.kind === 'measure') return { kind: 'sketch', text: 'Mesure : cliquez des arêtes ou des faces' };
      const stale = s.doc.parts.find((p) => s.display[p.id]?.stale);
      if (stale) {
        const result = s.display[stale.id]!.result;
        const failedStatus = result.statuses.find((st) => st.featureId === result.failedFeatureId);
        const rootId = failedStatus?.blockedBy ?? result.failedFeatureId;
        const root = stale.features.find((f) => f.id === rootId);
        return { kind: 'stale', text: `« ${stale.name} » n’est plus à jour : corrigez l’étape « ${root?.name ?? '?'} » (en rouge dans l’historique).` };
      }
      return null;
    },
    (a, b) => JSON.stringify(a) === JSON.stringify(b),
  );
  if (!info) return null;
  return (
    <div class={`overlay-banner ${info.kind}`} role="status">
      <Icon name={info.kind === 'stale' ? 'warning' : info.kind.startsWith('preview') ? 'info' : 'sketch'} />
      <span>{info.text}</span>
    </div>
  );
}

export function ViewportHost() {
  const c = useController();
  const container = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState<Viewport | null>(null);
  const [, setTick] = useState(0);
  const tickPending = useRef(false);
  const state = useAppState((s) => s);
  const input = useMemo(
    () => buildViewportInput(state),
    [state.doc, state.display, state.mode, state.selection, state.preview, state.fitRequest, state.workspace, state.assemblySelection, state.assemblyHand, state.fabricationTab, state.printPlate, state.mode.kind === 'joint' ? state.hover : null],
  );
  const kernel = state.kernel;
  const session = state.mode.kind === 'sketch' ? state.mode.session : null;

  useEffect(() => {
    if (!container.current) return;
    let v: Viewport;
    try {
      v = new Viewport(container.current, {
        onPick: (pick, info) => c.handlePick(pick, info),
        onHover: (pick) => c.setHover(pick),
        onAssemblyDrag: (event) => c.assemblyDrag(event),
        onPlanePick: (plane) => c.pickPlane(plane),
        onSketchPointer: (type, p, mods) => {
          if (type === 'move') c.updateSession((s) => pointerMove(s, p, mods));
          else if (type === 'down') c.updateSession((s) => pointerDown(s, p, mods));
          else if (type === 'up') c.updateSession((s) => pointerUp(s));
          else c.updateSession((s) => pointerLeave(s));
        },
        onSketchLabelDrag: (id, phase, p) => c.updateSession((s) => moveDimensionLabel(s, id, p, phase)),
        onSketchLabel: (id, action, additive) => {
          if (action === 'edit') c.updateSession((s) => editDimension(s, id));
          else c.updateSession((s) => selectConstraint(s, id, additive));
        },
        onSketchScale: (px) => c.updateSession((s) => setPixelSize(s, px)),
        onViewChange: () => {
          if (tickPending.current) return;
          tickPending.current = true;
          requestAnimationFrame(() => {
            tickPending.current = false;
            const st = c.state;
            if (st.mode.kind === 'sketch' && st.mode.session.editor) setTick((n) => n + 1);
          });
        },
        onContextLost: () => c.toast('error', 'L’affichage 3D a été interrompu par le navigateur. Rechargez la page (votre travail est sauvegardé automatiquement).'),
      });
    } catch (err) {
      const probe = document.createElement('canvas');
      const hasWebGL = !!(probe.getContext('webgl2') ?? probe.getContext('webgl'));
      c.toast(
        'error',
        hasWebGL
          ? 'La vue 3D n’a pas pu démarrer. Rechargez la page ; si le problème continue, signalez-le avec le détail ci-dessous.'
          : 'La vue 3D ne peut pas démarrer : WebGL est indisponible ou désactivé dans ce navigateur.',
        { detail: (err as Error).stack ?? (err as Error).message },
      );
      return;
    }
    setViewport(v);
    c.attachViewport(v);
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    const onScheme = () => v.setPalette();
    media?.addEventListener?.('change', onScheme);
    return () => {
      media?.removeEventListener?.('change', onScheme);
      c.attachViewport(null);
      v.dispose();
    };
  }, []);

  useEffect(() => {
    viewport?.setInput(input);
  }, [viewport, input]);

  return (
    <div class={`viewport-host mode-${state.mode.kind}`} ref={container}>
      <Banner />
      <ViewControls />
      <Timeline />
      <MascotBubble />
      {viewport && session?.editor ? <DimensionEditorPopup session={session} viewport={viewport} /> : null}
      {session?.input && session.start ? <DrawInputBox session={session} /> : null}
      {state.evaluating && kernel.status === 'ready' ? (
        <div class="busy-indicator" role="status">
          <span class="spinner" />
          Calcul…
        </div>
      ) : null}
      {kernel.status !== 'ready' ? (
        <div class="loading-overlay">
          <div class="loading-card" role="status">
            {kernel.status === 'loading' ? (
              <>
                <span class="spinner" />
                <strong>Préparation du moteur de calcul 3D…</strong>
                <span class="field-help">Le noyau géométrique (Open CASCADE) se charge dans le navigateur. Rien n’est envoyé sur Internet.</span>
              </>
            ) : (
              <>
                <Icon name="error" />
                <strong>Le moteur de calcul n’a pas pu démarrer.</strong>
                <span class="field-help">{kernel.message}</span>
                <span class="field-help">Essayez de recharger la page, ou utilisez un navigateur récent (Firefox, Chrome, Edge, Safari).</span>
              </>
            )}
          </div>
        </div>
      ) : null}
      <span class="visually-hidden" aria-live="polite">
        {session?.message?.text ?? ''}
      </span>
    </div>
  );
}
