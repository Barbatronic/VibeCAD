import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { partShown, type AppState } from '../app/state';
import type { Assembly, AssemblyFastener, SketchFeature } from '../domain/model';
import type { MeshData } from '../geometry/kernel';
import { pointPosition, standalonePoints } from '../sketch/model';
import { frameToWorld } from '../math/frame';
import { DISPLAY_STYLES, type DisplayStyle } from '../viewport/part-meshes';
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
import { Viewport, type ViewMarker, type ViewportInput, type ViewPartInput, type ViewSelection } from '../viewport/viewport';
import { blockContent, explodeOffsets, flattenAssembly, jointFreedoms, lcsFrame, lcsFromPick, solveAssembly, type AssemblyPlacement, type SolveOptions } from '../app/assembly';
import { subassemblyContent } from '../domain/subassemblies';
import { FASTENER_COLOR, fastenerMesh, placeFasteners } from '../app/fasteners';
import { fabricationSettings, printLayout } from '../app/fabrication';
import { invertRigid4, multiply4, transformDirection4, transformPoint4, translation4, type Mat4 } from '../math/mat4';
import type { Vec2 } from '../math/vec';
import { STANDARD_VIEWS, type StandardView } from '../viewport/camera-rig';
import { useAppState, useController } from './context';
import { IconButton } from './components/controls';
import { NumberInput } from './components/number-input';
import { Timeline } from './Timeline';
import { MascotBubble } from './Mascot';
import { formatNumber } from '../domain/units';
import { Icon } from './icons';
import { allows } from '../app/levels';
import type { Vec3 } from '../math/vec';
import { formatLength } from '../domain/units';
import { resultGeometry, studyFaces, studyInput, studyKey, studyOf, type StudySource } from '../app/simulation';
import { exaggerationFor } from '../sim/study';

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

/** Visserie des sous-assemblages insérés (récursivement), placée dans le monde. */
function blockFasteners(
  assembly: Assembly,
  placement: AssemblyPlacement,
  meshOf: (partId: string) => MeshData | null | undefined,
  options: SolveOptions,
  depth = 0,
): { key: string; instanceId: string; fastener: AssemblyFastener; matrix: Mat4 }[] {
  const out: { key: string; instanceId: string; fastener: AssemblyFastener; matrix: Mat4 }[] = [];
  if (depth > 8) return out;
  for (const inst of assembly.instances) {
    const m = placement.matrices.get(inst.id);
    const content = blockContent(inst, options);
    if (!m || !content) continue;
    const sub = solveAssembly(content, meshOf, options);
    const placed = content.fasteners?.length ? placeFasteners(content, meshOf, (id) => sub.matrices.get(id)) : null;
    for (const f of content.fasteners ?? []) {
      const fm = placed?.matrices.get(f.id);
      if (fm) out.push({ key: `${inst.id}/${f.id}`, instanceId: inst.id, fastener: f, matrix: multiply4(m, fm) });
    }
    for (const inner of blockFasteners(content, sub, meshOf, options, depth + 1)) out.push({ ...inner, key: `${inst.id}/${inner.key}`, instanceId: inst.id, matrix: multiply4(m, inner.matrix) });
  }
  return out;
}

/** Vue de l'onglet Assemblage : pièces insérées à leur place, repères des liaisons. */
function buildAssemblyInput(s: AppState): ViewportInput {
  const assembly = s.doc.assembly ?? { instances: [], joints: [] };
  const sketchesOf = (partId: string) => s.display[partId]?.result.sketches;
  const meshOf = (partId: string) => s.display[partId]?.mesh;
  const options = { sketchesOf, subassemblyOf: (id: string) => subassemblyContent(s.doc, id) };
  const placement = solveAssembly(assembly, meshOf, options);
  // Pièces placées : les sous-assemblages insérés sont dépliés en leurs pièces.
  const leaves = flattenAssembly(assembly, placement, meshOf, options);
  const leafByKey = new Map(leaves.map((l) => [l.key, l]));
  // Vue éclatée : chaque pièce (et sa visserie) décalée, sans toucher au projet ; un bloc s'écarte d'un seul tenant.
  const exploded = s.explode > 0;
  const offsets = exploded ? explodeOffsets(assembly, placement, meshOf, s.explode, leaves) : null;
  const shifted = (id: string, m: Mat4 | undefined): Mat4 | undefined => {
    const o = offsets?.get(id);
    return m && o ? multiply4(translation4(o), m) : m;
  };
  const parts: ViewPartInput[] = leaves.map((leaf) => {
    const part = s.doc.parts.find((p) => p.id === leaf.partId);
    const d = s.display[leaf.partId];
    return {
      partId: leaf.key,
      color: part?.color ?? '#888888',
      visible: true,
      meshKey: d?.meshKey ?? null,
      mesh: d?.mesh ?? null,
      appearance: 'normal',
      matrix: shifted(leaf.instanceId, leaf.matrix) ?? leaf.matrix,
    };
  });
  // Visserie posée à l'intérieur des sous-assemblages : placée dans le bloc, puis avec lui.
  for (const block of blockFasteners(assembly, placement, meshOf, options)) {
    const matrix = shifted(block.instanceId, block.matrix);
    if (!matrix) continue;
    const { key, mesh } = fastenerMesh(block.fastener.kind, block.fastener.size, block.fastener.length);
    parts.push({ partId: `fs:${block.key}`, color: FASTENER_COLOR, visible: true, meshKey: key, mesh, appearance: 'normal', matrix });
  }
  // Visserie : un objet par élément, placé sur son bord de trou (maillages partagés).
  const fasteners = assembly.fasteners?.length
    ? placeFasteners(assembly, (partId) => s.display[partId]?.mesh, (id) => placement.matrices.get(id))
    : null;
  for (const f of assembly.fasteners ?? []) {
    const matrix = shifted(f.at.instanceId, fasteners?.matrices.get(f.id));
    if (!matrix) continue;
    const { key, mesh } = fastenerMesh(f.kind, f.size, f.length);
    parts.push({ partId: `fs:${f.id}`, color: FASTENER_COLOR, visible: true, meshKey: key, mesh, appearance: 'normal', matrix });
  }
  const markers: ViewMarker[] = [];
  const sel = s.assemblySelection;
  if (sel?.kind === 'joint' && !exploded) {
    const f = placement.jointFrames.get(sel.id);
    if (f) markers.push({ origin: f.base.origin, axis: f.base.normal, role: 'base' }, { origin: f.moving.origin, axis: f.moving.normal, role: 'moving' });
  }
  const selection: ViewportInput['selection'] = [];
  if (s.mode.kind === 'joint' && s.mode.moving) {
    const m = s.mode.moving;
    // La pièce (dépliée) du repère choisi : pièce insérée, ou pièce d'un bloc.
    const leaf = leafByKey.get([m.instanceId, ...(m.member ?? [])].join('/'));
    const mesh = leaf && s.display[leaf.partId]?.mesh;
    const frame = mesh && leaf ? lcsFrame(mesh, m.lcs, sketchesOf(leaf.partId)) : null;
    if (frame && leaf) {
      markers.push({ origin: transformPoint4(leaf.matrix, frame.origin), axis: transformDirection4(leaf.matrix, frame.normal), role: 'moving', label: 'Pièce qui bouge' });
    }
    // L'élément cliqué reste en surbrillance pendant le choix du second repère.
    if (s.mode.movingPick && leaf) selection.push({ partId: leaf.key, kind: s.mode.movingPick.kind, index: s.mode.movingPick.index });
  }
  if (s.mode.kind === 'joint' && s.hover) {
    // Aperçu du repère qui servira d'accroche sous la souris (centre de face, de cercle, milieu d'arête).
    const h = s.hover;
    const leaf = leafByKey.get(h.partId);
    const part = leaf && s.doc.parts.find((p) => p.id === leaf.partId);
    const mesh = leaf && s.display[leaf.partId]?.mesh;
    const matrix = leaf?.matrix;
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
  if (s.mode.kind === 'model' && sel?.kind === 'fasteners') {
    for (const id of sel.ids) {
      const f = assembly.fasteners?.find((x) => x.id === id);
      if (f) fastenerMesh(f.kind, f.size, f.length).mesh.edges.forEach((_e, index) => selection.push({ partId: `fs:${id}`, kind: 'edge', index }));
    }
  }
  if (s.mode.kind === 'model' && sel?.kind === 'instance') {
    // La pièce (ou le bloc) sélectionnée : toutes ses arêtes en surbrillance.
    for (const leaf of leaves.filter((l) => l.instanceId === sel.id)) {
      const mesh = s.display[leaf.partId]?.mesh;
      if (mesh) mesh.edges.forEach((_e, index) => selection.push({ partId: leaf.key, kind: 'edge', index }));
    }
  }
  // Outil Main : seules les pièces tenues par une liaison mobile peuvent être attrapées.
  const dragTargets = s.assemblyHand && s.mode.kind === 'model' && !exploded
    ? (() => {
        const movable = new Set(assembly.joints.filter((j) => !placement.issues.has(j.id) && (jointFreedoms(j.kind).angle || jointFreedoms(j.kind).offset)).map((j) => j.moving.instanceId));
        // Un bloc s'attrape par n'importe laquelle de ses pièces.
        return leaves.filter((l) => movable.has(l.instanceId)).map((l) => l.key);
      })()
    : [];
  // Collisions : la matière commune à deux pièces, en rouge.
  const highlightMeshes = s.collisionCheck && s.collisions && !exploded ? s.collisions.items.map((c, i) => ({ key: `${s.collisions!.key}:${i}`, mesh: c.mesh })) : [];
  // Création d'une liaison : les points seuls des esquisses deviennent des accroches cliquables.
  const anchors: NonNullable<ViewportInput['anchors']> = [];
  if (s.mode.kind === 'joint' && !exploded) {
    for (const leaf of leaves) {
      const part = s.doc.parts.find((p) => p.id === leaf.partId);
      if (!part) continue;
      for (const sk of s.display[leaf.partId]?.result.sketches ?? []) {
        if (!sk.frame) continue;
        const name = part.features.find((f) => f.id === sk.featureId)?.name ?? 'esquisse';
        for (const p of standalonePoints(sk.solved)) {
          anchors.push({ key: `${leaf.key}|${sk.featureId}|${p.id}`, at: transformPoint4(leaf.matrix, frameToWorld(sk.frame, p)), title: `Point de « ${name} » (${leaf.name})` });
        }
      }
    }
  }
  const lockedFace = s.mode.kind === 'joint' && s.mode.lockedFace ? { partId: s.mode.lockedFace.instanceId, index: s.mode.lockedFace.index } : null;
  if (lockedFace) selection.push({ partId: lockedFace.partId, kind: 'face', index: lockedFace.index });
  return { mode: 'model', parts, tool: null, sketches: [], session: null, selection, measure: null, featurePicking: true, fitRequest: s.fitRequest, markers, dragTargets, lockedFace, highlightMeshes, anchors };
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

/** Le système demande moins d'animations (réglage d'accessibilité). */
function reducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Dernier résultat mis en forme (pièce déformée, couleurs) : recalculé seulement s'il change. */
let resultCache: { key: string; value: NonNullable<ViewportInput['resultMesh']> } | null = null;

/** Vue de l'onglet Simulation : la pièce étudiée, ses faces fixées et chargées, le résultat. */
function buildSimulationInput(s: AppState, partId: string | null, source: StudySource | null): ViewportInput {
  const base: ViewportInput = { mode: 'model', parts: [], tool: null, sketches: [], session: null, selection: [], measure: null, featurePicking: s.mode.kind === 'pick-sim-face', fitRequest: s.fitRequest, markers: [], dragTargets: [], bed: null };
  if (!partId || !source) return base;
  const study = studyOf(s.doc, partId);
  const run = s.simulationRun;
  const done = run?.status === 'done' && run.result && run.partId === partId && run.key === studyKey(study, source.key) && s.mode.kind !== 'pick-sim-face' ? run : null;
  let resultMesh: ViewportInput['resultMesh'] = null;
  if (done?.result) {
    const scale = s.simulationDeformed ? exaggerationFor(done.result.maxDisplacement, done.size) : 0;
    const animate = scale > 0 && s.simulationAnimate && !reducedMotion();
    const key = `${done.key}|${s.simulationDisplay}|${scale}|${animate}`;
    if (resultCache?.key !== key) {
      resultCache = {
        key,
        value: {
          key,
          ...resultGeometry(done.result, s.simulationDisplay, scale),
          indices: done.result.indices,
          ...(animate ? { animation: { base: done.result.positions, displacement: done.result.displacement, scale } } : {}),
        },
      };
    }
    resultMesh = resultCache.value;
  }
  const appearance = resultMesh ? 'ghost' : 'normal';
  // Pièce seule, ou pièces de l'assemblage à leur place (repérées par leur insertion).
  const parts: ViewPartInput[] =
    source.kind === 'part'
      ? [{ partId, color: s.doc.parts.find((p) => p.id === partId)?.color ?? '#888888', visible: true, meshKey: source.key, mesh: source.mesh, appearance }]
      : source.items.map((it) => {
          const inst = s.doc.assembly?.instances.find((i) => i.id === it.instanceId);
          const color = s.doc.parts.find((p) => p.id === inst?.partId)?.color ?? '#888888';
          return { partId: it.instanceId, color, visible: true, meshKey: s.display[inst?.partId ?? '']?.meshKey ?? null, mesh: it.mesh, appearance, matrix: it.matrix };
        });
  const markedFaces: NonNullable<ViewportInput['markedFaces']> = resultMesh
    ? []
    : studyFaces(study, source).flatMap((f) => [
        ...f.fixed.map((index) => ({ partId: f.instanceId ?? partId, index, role: 'fixed' as const })),
        ...f.load.map((index) => ({ partId: f.instanceId ?? partId, index, role: 'load' as const })),
      ]);
  // Flèche de la charge : elle arrive sur le centre des faces chargées.
  const markers: ViewMarker[] = [];
  const problem = studyInput(study, source);
  if (problem.ok) {
    const t = problem.input.loaded;
    let cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < t.length; i += 3) {
      cx += t[i]!;
      cy += t[i + 1]!;
      cz += t[i + 2]!;
    }
    const n = t.length / 3;
    const f = problem.input.force;
    const len = Math.hypot(f.x, f.y, f.z) || 1;
    const axis = { x: f.x / len, y: f.y / len, z: f.z / len };
    const label = study.load.kind === 'mass' ? `${formatNumber(study.load.value)} kg` : `${formatNumber(study.load.value)} N`;
    markers.push({ origin: { x: cx / n - 18 * axis.x, y: cy / n - 18 * axis.y, z: cz / n - 18 * axis.z }, axis, role: 'base', label });
  }
  return { ...base, parts, markedFaces, resultMesh, markers };
}

/** Construit la représentation d'affichage à partir de l'état de l'application. */
export function buildViewportInput(s: AppState, simulation: { partId: string | null; source: StudySource | null } = { partId: null, source: null }): ViewportInput {
  if (s.workspace === 'assembly') return buildAssemblyInput(s);
  if (s.workspace === 'fabrication') return buildFabricationInput(s);
  if (s.workspace === 'simulation') return buildSimulationInput(s, simulation.partId, simulation.source);
  const mode = s.mode.kind;
  // Vue en coupe : les pièces coupées remplacent les pièces (hors esquisse et opération en cours).
  const cut = s.section && s.sectionParts && (mode === 'model' || mode === 'measure') ? s.sectionParts : null;
  const sectionFaces: ViewSelection[] = [];
  // Pendant une opération ou une esquisse, les autres pièces deviennent transparentes : on voit
  // ce que l'on fait sur la pièce en cours.
  const workingPartId = s.mode.kind === 'feature' ? s.mode.draft.partId : s.mode.kind === 'sketch' ? s.mode.session.partId : null;
  const parts: ViewPartInput[] = s.doc.parts.map((p) => {
    const d = s.display[p.id];
    const sec = cut?.parts[p.id];
    if (cut && sec !== undefined) {
      for (const index of sec.cutFaces) sectionFaces.push({ partId: p.id, kind: 'face', index });
      return { partId: p.id, color: p.color, visible: partShown(s, p) && !!sec.mesh, meshKey: sec.mesh ? `cut|${cut.key}|${p.id}` : null, mesh: sec.mesh, appearance: 'normal' };
    }
    const previewPart = mode === 'feature' && s.mode.kind === 'feature' && s.mode.draft.partId === p.id ? s.preview?.parts[p.id] : undefined;
    if (previewPart?.mesh && previewPart.meshKey) {
      return { partId: p.id, color: p.color, visible: partShown(s, p), meshKey: `preview|${previewPart.meshKey}`, mesh: previewPart.mesh, appearance: 'preview' };
    }
    return {
      partId: p.id,
      color: p.color,
      visible: partShown(s, p),
      meshKey: d?.meshKey ?? null,
      mesh: d?.mesh ?? null,
      appearance: workingPartId && p.id !== workingPartId ? 'ghost' : mode === 'sketch' ? 'dimmed' : d?.stale ? 'stale' : 'normal',
    };
  });

  const sketches: ViewportInput['sketches'] = [];
  if (mode !== 'sketch') {
    for (const part of s.doc.parts) {
      if (!partShown(s, part)) continue;
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
  const featurePicking = s.mode.kind === 'feature' && (s.mode.draft.feature.type === 'fillet' || s.mode.draft.feature.type === 'chamfer' || s.mode.draft.feature.type === 'pattern' || s.mode.draft.feature.type === 'mirror' || s.mode.draft.feature.type === 'split' || s.mode.draft.feature.type === 'draft' || s.mode.draft.feature.type === 'plane' || s.mode.draft.feature.type === 'axis' || (s.mode.draft.feature.type === 'extrude' && s.mode.draft.fields.pick === 'upTo') || s.mode.draft.feature.type === 'shell');
  // Centre de gravité de la pièce active (pièce entière : pas pendant une coupe ni une esquisse).
  const points: { at: Vec3; label: string }[] = [];
  const active = s.display[s.activePartId]?.result.analysis;
  if (s.showCentroid && allows(s.level, 'view-centroid') && !cut && mode !== 'sketch' && active?.centroid) points.push({ at: active.centroid, label: 'G' });
  // Plans de construction des pièces affichées (hors esquisse) ; pendant la modification d'une
  // étape, ceux de son aperçu. Celui modifié ou sélectionné est mis en avant.
  const datumPlanes: NonNullable<ViewportInput['datumPlanes']> = [];
  const datumAxes: NonNullable<ViewportInput['datumAxes']> = [];
  if (mode !== 'sketch' && !cut) {
    const editing = s.mode.kind === 'feature' ? s.mode.draft.feature.id : null;
    const selectedId = s.selection?.kind === 'feature' ? s.selection.featureId : null;
    for (const part of s.doc.parts) {
      if (!partShown(s, part)) continue;
      const result = (s.mode.kind === 'feature' && s.mode.draft.partId === part.id ? s.preview?.parts[part.id] : undefined) ?? s.display[part.id]?.result;
      for (const pl of result?.planes ?? []) {
        const f = part.features.find((x) => x.id === pl.featureId);
        const label = f?.name ?? (s.mode.kind === 'feature' && s.mode.draft.feature.id === pl.featureId ? s.mode.draft.feature.name : 'Plan');
        datumPlanes.push({ key: pl.featureId, frame: pl.frame, label, active: pl.featureId === editing || pl.featureId === selectedId });
      }
      for (const ax of result?.axes ?? []) {
        const f = part.features.find((x) => x.id === ax.featureId);
        const label = f?.name ?? (s.mode.kind === 'feature' && s.mode.draft.feature.id === ax.featureId ? s.mode.draft.feature.name : 'Axe');
        datumAxes.push({ key: ax.featureId, point: ax.point, dir: ax.dir, label, active: ax.featureId === editing || ax.featureId === selectedId });
      }
    }
  }
  return { mode: mode === 'joint' || mode === 'fastener' || mode === 'pick-fab-face' || mode === 'pick-sim-face' ? 'model' : mode, parts, tool, sketches, session, selection: cut ? [] : selection, measure, featurePicking, fitRequest: s.fitRequest, sectionFaces, points, datumPlanes, datumAxes };
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

/** Réglages de la vue en coupe : plan, position (curseur), moitié montrée. */
function SectionPanel() {
  const c = useController();
  const section = useAppState((s) => (s.workspace === 'parts' ? s.section : null));
  const range = useAppState((s) => (s.section ? c.sectionRange(s.section.plane) : null), (a, b) => JSON.stringify(a) === JSON.stringify(b));
  if (!section) return null;
  const [lo, hi] = range ?? [-50, 50];
  const pad = Math.max(1, (hi - lo) * 0.02);
  return (
    <div class="section-panel" role="group" aria-label="Vue en coupe">
      <div class="section-head">
        <Icon name="section" />
        <strong>Vue en coupe</strong>
        <IconButton icon="close" label="Quitter la vue en coupe" small onClick={() => c.setSection(null)} />
      </div>
      <div class="segmented" role="group" aria-label="Plan de coupe">
        {(['XY', 'XZ', 'YZ'] as const).map((plane) => (
          <button key={plane} type="button" aria-pressed={section.plane === plane} title={`Couper parallèlement au plan ${plane}`} onClick={() => c.setSection({ plane })}>
            {plane}
          </button>
        ))}
      </div>
      <label class="section-slider">
        <span>
          Position : <strong>{formatLength(section.offset, 1)}</strong>
        </span>
        <input
          type="range"
          aria-label="Position du plan de coupe"
          min={Math.floor((lo - pad) * 10) / 10}
          max={Math.ceil((hi + pad) * 10) / 10}
          step={0.1}
          value={section.offset}
          onInput={(e) => c.setSection({ offset: Number((e.target as HTMLInputElement).value) })}
        />
      </label>
      <label class="checkbox-row">
        <input type="checkbox" checked={section.flip} onChange={() => c.setSection({ flip: !section.flip })} />
        <span>Voir l’autre moitié</span>
      </label>
    </div>
  );
}

const DISPLAY_LABELS: Record<DisplayStyle, { label: string; help: string }> = {
  'shaded-edges': { label: 'Ombré avec arêtes', help: 'L’affichage habituel' },
  shaded: { label: 'Ombré sans arêtes', help: 'Rendu lisse, pour présenter' },
  'hidden-lines': { label: 'Arêtes cachées en pointillés', help: 'Comme un dessin technique : on voit les trous et ce qui est derrière' },
  transparent: { label: 'Transparent', help: 'Voir à travers la matière : l’intérieur, les poches, les perçages' },
  wireframe: { label: 'Fil de fer', help: 'Les arêtes seules, toutes visibles' },
  monochrome: { label: 'Noir et blanc', help: 'Faces blanches, arêtes noires : lisible imprimé ou en capture' },
};

/** Bouton « Affichage » : choix du mode d'affichage des pièces. */
function DisplayMenu() {
  const c = useController();
  const style = useAppState((s) => s.displayStyle);
  const edgeWidth = useAppState((s) => s.edgeWidth);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);
  return (
    <div class="display-menu" ref={root}>
      <IconButton id="view-display" icon="display" label={`Affichage : ${DISPLAY_LABELS[style].label}`} pressed={open} onClick={() => setOpen(!open)} />
      {open ? (
        <div class="menu display-menu-list" role="menu" aria-label="Affichage des pièces">
          {DISPLAY_STYLES.map((d) => (
            <button
              key={d}
              type="button"
              role="menuitemradio"
              aria-checked={style === d}
              class="menu-item"
              title={DISPLAY_LABELS[d].help}
              onClick={() => {
                c.setDisplayStyle(d);
                setOpen(false);
              }}
            >
              <Icon name={style === d ? 'check' : 'blank'} />
              <span>{DISPLAY_LABELS[d].label}</span>
            </button>
          ))}
          <div class="menu-sep" role="separator" />
          <label class="field edge-width-field">
            <span class="field-label">
              Épaisseur des arêtes : <strong>{formatNumber(edgeWidth, 1)} px</strong>
            </span>
            <input id="view-edge-width" type="range" min={0.5} max={4} step={0.5} value={edgeWidth} onInput={(e) => c.setEdgeWidth(Number((e.target as HTMLInputElement).value))} />
          </label>
        </div>
      ) : null}
    </div>
  );
}

function ViewControls() {
  const c = useController();
  const projection = useAppState((s) => s.projection);
  const section = useAppState((s) => s.section);
  const canSection = useAppState((s) => s.workspace === 'parts' && allows(s.level, 'view-section'));
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
        <DisplayMenu />
        {canSection ? (
          <IconButton
            icon="section"
            label={section ? 'Coupe : activée (cliquer pour revoir la pièce entière)' : 'Coupe : voir l’intérieur de la pièce, coupée par un plan'}
            pressed={!!section}
            onClick={() => c.setSection(section ? null : {})}
          />
        ) : null}
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
      if (s.mode.kind === 'feature') return { kind: s.mode.draft.feature.type === 'pocket' || s.mode.draft.feature.type === 'hole' ? 'preview cut' : 'preview', text: 'Aperçu — non validé' };
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
    () => {
      const partId = state.workspace === 'simulation' ? c.simulationPartId() : null;
      const built = state.workspace !== 'simulation' ? buildViewportInput(state) : buildViewportInput(state, { partId, source: partId ? c.simulationSource(partId) : null });
      return { ...built, displayStyle: state.displayStyle, edgeWidth: state.edgeWidth };
    },
    [state.simulationPart, state.simulationRun, state.simulationDisplay, state.simulationDeformed, state.simulationAnimate, state.activePartId, state.doc, state.display, state.mode, state.selection, state.preview, state.fitRequest, state.workspace, state.assemblySelection, state.assemblyHand, state.fabricationTab, state.printPlate, state.mode.kind === 'joint' ? state.hover : null, state.section, state.sectionParts, state.showCentroid, state.level, state.collisionCheck, state.collisions, state.isolatedPartId, state.explode, state.displayStyle, state.edgeWidth],
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
        onSketchLabel: (id, action) => {
          if (action === 'edit') c.updateSession((s) => editDimension(s, id));
          else c.updateSession((s) => selectConstraint(s, id, true));
        },
        onSketchScale: (px) => c.updateSession((s) => setPixelSize(s, px)),
        onAnchorPick: (key) => {
          const [leafKey, sketchId, pointId] = key.split('|');
          c.pickJointPoint(leafKey!, sketchId!, pointId!);
        },
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

  // Thème choisi dans les préférences : appliqué à la page, puis aux couleurs de la vue 3D.
  const theme = state.theme;
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'auto') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', theme);
    viewport?.setPalette();
  }, [viewport, theme]);

  return (
    <div class={`viewport-host mode-${state.mode.kind}`} ref={container}>
      <Banner />
      <ViewControls />
      <SectionPanel />
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
