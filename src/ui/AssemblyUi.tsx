/**
 * Interface de l'onglet Assemblage : outils (insérer, liaison), liste des pièces insérées et des
 * liaisons, réglages de la liaison choisie (type, curseurs, limites). Voir docs/assemblage.md.
 */
import { allows } from '../app/levels';
import { useEffect, useRef, useState } from 'preact/hooks';
import { clampToLimits, JOINT_ISSUE_MESSAGES, jointFreedoms } from '../app/assembly';
import { JOINT_EXPLANATIONS, JOINT_LABELS } from '../domain/document';
import type { AssemblyJoint, JointKind } from '../domain/model';
import { formatLength, formatNumber, readNumber } from '../domain/units';
import { useAppState, useController } from './context';
import { Button, Callout, IconButton, ToolButton } from './components/controls';
import { NumberInput } from './components/number-input';
import { Icon } from './icons';
import { FastenerList, FastenerMenu, FastenerModePanel, FastenerPanel } from './FastenerUi';
import { CouplingList, CouplingPanel } from './CouplingUi';
import { SubassemblyBar } from './SubassemblyUi';
import { ToolGroup } from './ToolSectors';
import { subassemblyContains, subassemblyContent, subassemblyList } from '../domain/subassemblies';

/**
 * Onglets des ateliers « Pièces / Assemblage / Fabrication / Simulation », dans un bandeau sous la
 * barre d'outils ; grisés pendant une opération (esquisse, étape en cours…).
 */
export function WorkspaceTabs() {
  const c = useController();
  const workspace = useAppState((s) => s.workspace);
  const assembly = useAppState((s) => allows(s.level, 'workspace:assembly'));
  const simulation = useAppState((s) => allows(s.level, 'workspace:simulation'));
  const busy = useAppState((s) => !['model', 'joint', 'fastener', 'pick-fab-face', 'pick-sim-face'].includes(s.mode.kind));
  return (
    <nav class="workspace-bar" aria-label="Ateliers">
      <div class="workspace-tabs" role="tablist" aria-label="Espace de travail">
        {(
          [
            ['parts', 'Pièces', 'part', 'Modéliser les pièces'],
            ['assembly', 'Assemblage', 'pivot', 'Assembler les pièces et les faire bouger'],
            ['fabrication', 'Fabrication', 'print3d', 'Préparer l’impression 3D et la découpe laser'],
            ['simulation', 'Simulation', 'simulate', 'Voir comment une pièce se déforme sous une charge'],
          ] as const
        )
          .filter(([id]) => (id !== 'assembly' || assembly) && (id !== 'simulation' || simulation))
          .map(([id, label, icon, title]) => (
            <button
              key={id}
              type="button"
              role="tab"
              id={`tab-${id}`}
              aria-selected={workspace === id}
              disabled={busy && workspace !== id}
              title={busy && workspace !== id ? `${label} : ${title} — terminez d’abord l’opération en cours` : `${label} : ${title}`}
              onClick={() => c.setWorkspace(id)}
            >
              <Icon name={icon} />
              {/* Icône seule dans la barre : le nom reste lu (lecteurs d'écran) et en infobulle. */}
              <span class="visually-hidden">{label}</span>
            </button>
          ))}
      </div>
    </nav>
  );
}

function InsertMenu() {
  const c = useController();
  const parts = useAppState(
    (s) => s.doc.parts.map((p) => ({ id: p.id, name: p.name, color: p.color, ok: (s.display[p.id]?.result.analysis?.solidCount ?? 0) > 0 })),
    (a, b) => JSON.stringify(a) === JSON.stringify(b),
  );
  const canBlocks = useAppState((s) => allows(s.level, 'assembly:subassemblies'));
  // Sous-assemblages insérables : pas celui qu'on modifie, ni un bloc qui le contient.
  const blocks = useAppState(
    (s) => {
      if (!allows(s.level, 'assembly:subassemblies')) return [];
      const editing = s.doc.editingSubassembly;
      return subassemblyList(s.doc)
        .filter((x) => !editing || !subassemblyContains(s.doc, x.id, editing))
        .map((x) => ({ id: x.id, name: x.name, empty: x.instances.length === 0 }));
    },
    (a, b) => JSON.stringify(a) === JSON.stringify(b),
  );
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    root.current?.querySelector<HTMLButtonElement>('.menu-item')?.focus();
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);
  return (
    <div class="anchor" ref={root}>
      <button type="button" id="as-insert" class="tool-btn" aria-haspopup="menu" aria-expanded={open} title="Insérer une pièce du projet dans l’assemblage" onClick={() => setOpen(!open)}>
        <Icon name="part" />
        <span>
          Insérer <span aria-hidden="true">▾</span>
        </span>
      </button>
      {open ? (
        <div class="menu" role="menu" aria-label="Pièces à insérer" onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}>
          {parts.map((p) => (
            <button
              key={p.id}
              type="button"
              role="menuitem"
              class="menu-item"
              aria-disabled={p.ok ? undefined : 'true'}
              title={p.ok ? undefined : 'Cette pièce n’a pas encore de volume.'}
              onClick={() => {
                setOpen(false);
                c.insertInstance(p.id);
              }}
            >
              <span class="color-swatch" style={{ background: p.color, width: '16px', height: '16px' }} />
              <span>{p.name}</span>
              {!p.ok ? <span class="shortcut">sans volume</span> : null}
            </button>
          ))}
          {canBlocks ? <div class="menu-sep" role="separator" /> : null}
          {blocks.map((b) => (
            <button
              key={b.id}
              type="button"
              role="menuitem"
              class="menu-item"
              aria-disabled={b.empty ? 'true' : undefined}
              title={b.empty ? 'Ce sous-assemblage est vide.' : 'Inséré comme un bloc rigide'}
              onClick={() => {
                setOpen(false);
                c.insertSubassembly(b.id);
              }}
            >
              <Icon name="explode" />
              <span>Sous-assemblage : {b.name}</span>
              {b.empty ? <span class="shortcut">vide</span> : null}
            </button>
          ))}
          {canBlocks ? (
            <button
              type="button"
              role="menuitem"
              class="menu-item"
              title="Les pièces et l’assemblage d’un autre projet deviennent un sous-assemblage de celui-ci"
              onClick={() => {
                setOpen(false);
                void c.importSubassemblyFile();
              }}
            >
              <Icon name="import" />
              <span>Importer un projet comme sous-assemblage…</span>
            </button>
          ) : null}
          <div class="menu-sep" role="separator" />
          <button
            type="button"
            role="menuitem"
            id="as-insert-component"
            class="menu-item"
            title="Roulements, moteurs, poulies… d’une bibliothèque de composants : ajoutés au projet puis insérés"
            onClick={() => {
              setOpen(false);
              c.openComponents();
            }}
          >
            <Icon name="import" />
            <span>Composant d’une bibliothèque…</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** Résultat de la recherche de collisions (quand elle est activée). */
function CollisionReport() {
  const ctl = useController();
  const data = useAppState(
    (s) =>
      s.collisionCheck
        ? {
            ready: !!s.collisions,
            items: (() => {
              // Pièces dépliées : celles d'un sous-assemblage sont nommées « Bloc › Pièce ».
              const names = new Map(ctl.assemblyLeaves().map((l) => [l.key, l.name]));
              return (s.collisions?.items ?? []).map((c) => ({ a: names.get(c.a) ?? '?', b: names.get(c.b) ?? '?', volume: c.volume }));
            })(),
          }
        : null,
    (a, b) => JSON.stringify(a) === JSON.stringify(b),
  );
  if (!data) return null;
  if (!data.ready) return <p class="field-help">Recherche des collisions…</p>;
  if (data.items.length === 0) return <Callout kind="success">Aucune collision : les pièces ne se rentrent pas dedans.</Callout>;
  return (
    <Callout kind="error">
      <p>
        <strong>
          {data.items.length} collision{data.items.length > 1 ? 's' : ''}
        </strong>{' '}
        (en rouge dans la vue) :
      </p>
      <ul class="collision-list">
        {data.items.map((c, i) => (
          <li key={i}>
            « {c.a} » et « {c.b} » : {formatNumber(c.volume, 1)} mm³ en commun
          </li>
        ))}
      </ul>
    </Callout>
  );
}

export function AssemblyTools() {
  const c = useController();
  const s = useAppState(
    (st) => ({
      joint: st.mode.kind === 'joint',
      hand: st.assemblyHand,
      collisions: st.collisionCheck,
      exploded: st.explode > 0,
      count: st.doc.assembly?.instances.length ?? 0,
      sel: st.assemblySelection,
    }),
    (a, b) => JSON.stringify(a) === JSON.stringify(b),
  );
  return (
    <>
      <ToolGroup name="Insérer">
        <InsertMenu />
        <FastenerMenu />
      </ToolGroup>
      <ToolGroup name="Assembler">
        <ToolButton
          id="as-hand"
          icon="hand"
          label="Main"
          hint="Main : attraper une pièce et la faire bouger à la souris, selon sa liaison (tourner, glisser, pencher)"
          pressed={s.hand}
          onClick={() => c.toggleAssemblyHand()}
        />
        <ToolButton
          id="as-joint"
          icon="pivot"
          label="Liaison"
          hint="Relier deux pièces : cliquez un repère sur la pièce qui bouge, puis sur la pièce de référence"
          pressed={s.joint}
          availability={s.count >= 2 ? { ok: true } : { ok: false, reason: 'Insérez d’abord au moins deux pièces.' }}
          onClick={() => {
            c.toggleAssemblyHand(false);
            if (s.joint) c.cancelJoint();
            else c.startJoint();
          }}
        />
      </ToolGroup>
      <ToolGroup name="Vérifier">
        <ToolButton
          id="as-collisions"
          icon="collision"
          label="Collisions"
          hint="Collisions : signaler en rouge les pièces qui se rentrent dedans (un simple contact n’est pas une collision)"
          pressed={s.collisions}
          availability={s.count >= 2 ? { ok: true } : { ok: false, reason: 'Insérez d’abord au moins deux pièces.' }}
          onClick={() => c.toggleCollisions()}
        />
        <ToolButton
          id="as-explode"
          icon="explode"
          label="Éclater"
          hint="Vue éclatée : écarter les pièces pour voir comment elles s’emboîtent (le projet ne change pas)"
          pressed={s.exploded}
          availability={s.count >= 2 ? { ok: true } : { ok: false, reason: 'Insérez d’abord au moins deux pièces.' }}
          onClick={() => c.setExplode(s.exploded ? 0 : 0.6)}
        />
      </ToolGroup>
      <ToolGroup name="Modifier">
        <ToolButton
          icon="trash"
          label="Supprimer"
          shortcut="Suppr"
          availability={s.sel ? { ok: true } : { ok: false, reason: 'Sélectionnez une pièce insérée, une liaison ou de la visserie.' }}
          onClick={() =>
            s.sel?.kind === 'joint'
              ? c.removeJoint(s.sel.id)
              : s.sel?.kind === 'fasteners'
                ? c.removeFasteners(s.sel.ids)
                : s.sel?.kind === 'coupling'
                  ? c.removeCoupling(s.sel.id)
                  : s.sel
                    ? c.removeInstance(s.sel.id)
                    : undefined
          }
        />
      </ToolGroup>
      <ToolGroup name="Exporter">
        <ToolButton
          id="as-export"
          icon="export"
          label="Exporter"
          hint="Exporter l’assemblage : STEP (FreeCAD), 3MF (impression 3D) ou GLB (3D pour le web, visserie comprise)"
          availability={s.count ? { ok: true } : { ok: false, reason: 'L’assemblage est vide.' }}
          onClick={() => c.showExportDialog()}
        />
      </ToolGroup>
    </>
  );
}

/** Écartement de la vue éclatée (visible tant qu'elle est active). */
function ExplodeSlider() {
  const c = useController();
  const explode = useAppState((s) => s.explode);
  if (explode <= 0) return null;
  return (
    <div class="field explode-field">
      <label class="field-label" for="as-explode-amount">
        Vue éclatée : écartement
      </label>
      <input id="as-explode-amount" type="range" min={0.1} max={2} step={0.05} value={explode} onInput={(e) => c.setExplode(Number((e.target as HTMLInputElement).value))} />
      <span class="field-help">Chaque pièce s’écarte le long de l’axe de sa liaison. Rien n’est modifié dans le projet.</span>
      <Button small icon="close" onClick={() => c.setExplode(0)}>
        Rassembler
      </Button>
    </div>
  );
}

/** Panneau de gauche : pièces insérées (la première est fixe) et liaisons. */
export function AssemblySection() {
  const c = useController();
  const data = useAppState(
    (s) => {
      const a = s.doc.assembly ?? { instances: [], joints: [] };
      const placement = c.assemblyPlacement();
      return {
        instances: a.instances.map((i) => ({
          id: i.id,
          name: i.name,
          block: i.subassemblyId ? (subassemblyList(s.doc).find((x) => x.id === i.subassemblyId)?.name ?? '?') : null,
          color: s.doc.parts.find((p) => p.id === i.partId)?.color ?? '#888',
        })),
        joints: a.joints.map((j) => ({
          id: j.id,
          name: j.name,
          kind: j.kind,
          moving: a.instances.find((i) => i.id === j.moving.instanceId)?.name ?? '?',
          base: a.instances.find((i) => i.id === j.base.instanceId)?.name ?? '?',
          issue: placement?.issues.get(j.id) ?? null,
        })),
        sel: s.assemblySelection,
      };
    },
    (a, b) => JSON.stringify(a) === JSON.stringify(b),
  );
  return (
    <section class="panel-section grow" aria-labelledby="assembly-title">
      <div class="panel-header">
        <span id="assembly-title">Assemblage</span>
      </div>
      <div class="panel-body">
        <SubassemblyBar />
        {data.instances.length === 0 ? (
          <p class="empty-hint">
            L’assemblage est vide. Bouton <strong>Insérer</strong> en haut : choisissez une pièce. La première insérée reste <strong>fixe</strong>.
          </p>
        ) : null}
        <ul class="feature-list" aria-label="Pièces de l’assemblage">
          {data.instances.map((i, index) => (
            <li key={i.id}>
              <div class={`feature-row${data.sel?.kind === 'instance' && data.sel.id === i.id ? ' is-selected' : ''}`}>
                <button type="button" class="feature-main" aria-pressed={data.sel?.kind === 'instance' && data.sel.id === i.id} onClick={() => c.selectInAssembly({ kind: 'instance', id: i.id })}>
                  <span class="color-swatch" style={{ background: i.color, width: '16px', height: '16px' }} />
                  <span class="feature-texts">
                    <span class="name">{i.name}</span>
                    <span class="summary">
                      {index === 0 ? '📌 fixe (référence de l’assemblage)' : i.block ? `bloc : sous-assemblage « ${i.block} »` : 'pièce insérée'}
                    </span>
                  </span>
                </button>
                <span class="row-actions">
                  {!i.block ? <IconButton icon="edit" small label={`Modifier « ${i.name} » dans l’assemblage (pièces voisines autour)`} onClick={() => c.editInAssembly(i.id)} /> : null}
                  <IconButton icon="trash" small label={`Retirer « ${i.name} » de l’assemblage`} onClick={() => c.removeInstance(i.id)} />
                </span>
              </div>
            </li>
          ))}
        </ul>
        <ExplodeSlider />
        <CollisionReport />
        {data.joints.length > 0 ? <h3 class="list-title">Liaisons</h3> : null}
        <ul class="feature-list" aria-label="Liaisons de l’assemblage">
          {data.joints.map((j) => (
            <li key={j.id}>
              <div class={`feature-row${data.sel?.kind === 'joint' && data.sel.id === j.id ? ' is-selected' : ''}`}>
                <button
                  type="button"
                  class="feature-main"
                  aria-pressed={data.sel?.kind === 'joint' && data.sel.id === j.id}
                  title={`${JOINT_LABELS[j.kind]} : ${JOINT_EXPLANATIONS[j.kind]}`}
                  onClick={() => c.selectInAssembly({ kind: 'joint', id: j.id })}
                >
                  <Icon name={`joint-${j.kind}`} class="feature-icon" />
                  <span class="feature-texts">
                    <span class="name">
                      {j.name} · {JOINT_LABELS[j.kind]}
                    </span>
                    <span class="status-line">
                      {j.issue ? <span class="status-badge status-error">Souci</span> : null}
                      <span class="summary">
                        {j.moving} → {j.base}
                      </span>
                    </span>
                  </span>
                </button>
                <span class="row-actions">
                  <IconButton icon="trash" small label={`Supprimer « ${j.name} »`} onClick={() => c.removeJoint(j.id)} />
                </span>
              </div>
              {j.issue ? <div class="feature-issue error">{JOINT_ISSUE_MESSAGES[j.issue]}</div> : null}
            </li>
          ))}
        </ul>
        <CouplingList />
        <FastenerList />
      </div>
    </section>
  );
}

/** Curseur + champ exact pour un mouvement libre d'une liaison. */
function MotionField(props: {
  id: string;
  label: string;
  unit: 'mm' | '°';
  value: number;
  limits: [number, number] | undefined;
  range: [number, number];
  onLive: (v: number) => void;
  onCommit: () => void;
  onExact: (v: number) => void;
}) {
  const [lo, hi] = props.limits ?? props.range;
  const [text, setText] = useState(formatNumber(props.value, 2));
  useEffect(() => setText(formatNumber(props.value, 2)), [props.value]);
  const fmt = (v: number) => (props.unit === '°' ? `${formatNumber(v, 1)}°` : formatLength(v));
  return (
    <div class="field motion-field">
      <label class="field-label" for={props.id}>
        {props.label} : <strong>{fmt(props.value)}</strong>
      </label>
      <input
        id={props.id}
        type="range"
        min={Math.min(lo, hi)}
        max={Math.max(lo, hi)}
        step={props.unit === '°' ? 1 : 0.5}
        value={props.value}
        aria-valuetext={fmt(props.value)}
        onInput={(e) => props.onLive(Number((e.target as HTMLInputElement).value))}
        onChange={() => props.onCommit()}
      />
      <NumberInput
        value={text}
        unit={props.unit}
        min={-100000}
        ariaLabel={`${props.label} exact`}
        onInput={(t) => {
          setText(t);
          const v = readNumber(t);
          if (v !== null) props.onExact(clampToLimits(v, props.limits));
        }}
      />
    </div>
  );
}

function LimitsField(props: { label: string; unit: string; limits: [number, number] | undefined; fallback: [number, number]; onChange: (l: [number, number] | undefined) => void }) {
  const on = !!props.limits;
  const [a, b] = props.limits ?? props.fallback;
  return (
    <div class="field">
      <label class="checkbox-row">
        <input type="checkbox" checked={on} onChange={() => props.onChange(on ? undefined : props.fallback)} />
        <span>Limiter {props.label}</span>
      </label>
      {on ? (
        <div class="limits-row">
          <NumberInput value={formatNumber(a, 2)} unit={props.unit} min={-100000} ariaLabel={`${props.label} minimum`} onInput={(t) => { const v = readNumber(t); if (v !== null) props.onChange([v, b]); }} />
          <NumberInput value={formatNumber(b, 2)} unit={props.unit} min={-100000} ariaLabel={`${props.label} maximum`} onInput={(t) => { const v = readNumber(t); if (v !== null) props.onChange([a, v]); }} />
        </div>
      ) : null}
    </div>
  );
}

/** Nom de la liaison, modifiable sur place (Entrée valide, Échap annule). */
function JointName({ joint }: { joint: AssemblyJoint }) {
  const c = useController();
  const [text, setText] = useState(joint.name);
  useEffect(() => setText(joint.name), [joint.id, joint.name]);
  const done = () => {
    const t = text.trim();
    if (t && t !== joint.name) c.renameJoint(joint.id, t);
    else setText(joint.name);
  };
  return (
    <input
      class="title-input"
      aria-label="Nom de la liaison"
      title="Nom de la liaison (cliquez pour le modifier)"
      value={text}
      onInput={(e) => setText((e.target as HTMLInputElement).value)}
      onBlur={done}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') {
          setText(joint.name);
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}

function JointPanel({ joint }: { joint: AssemblyJoint }) {
  const c = useController();
  const issue = useAppState(() => c.assemblyPlacement()?.issues.get(joint.id) ?? null);
  const animating = useAppState((s) => s.jointAnimation === joint.id);
  const free = jointFreedoms(joint.kind);
  const kinds: JointKind[] = ['fixed', 'revolute', 'slider', 'cylindrical', 'spherical'];
  return (
    <>
      <div class="panel-title">
        <Icon name={`joint-${joint.kind}`} />
        <JointName joint={joint} />
      </div>
      <div class="panel-content">
      <p class="vocab">
        <strong>Liaison</strong> : la pièce mobile est posée sur le repère de la pièce de référence (repère orange), puis elle peut bouger selon le type.
        Avec l’outil <strong>Main</strong> (en haut), attrapez la pièce à la souris : elle ne fait que le mouvement permis
        {free.angle && free.offset ? ' (Maj : glisser au lieu de tourner)' : ''}.
      </p>
      {issue ? <Callout kind="error">{JOINT_ISSUE_MESSAGES[issue]}</Callout> : null}
      {(free.angle && joint.kind !== 'spherical') || free.offset ? (
        <div class="joint-animate">
          <Button small icon={animating ? 'close' : 'play'} variant={animating ? 'default' : 'primary'} onClick={() => c.toggleJointAnimation(joint.id)}>
            {animating ? 'Arrêter' : 'Animer le mécanisme'}
          </Button>
          <span class="field-help">{animating ? 'Les pièces reviendront à leur place.' : 'Cette liaison bouge toute seule ; les pièces reliées suivent.'}</span>
        </div>
      ) : null}
      <div class="field" role="group" aria-label="Type de liaison">
        <span class="field-label">Type de liaison</span>
        <div class="joint-kinds">
          {kinds.map((k) => (
            <button
              key={k}
              type="button"
              class="joint-kind"
              aria-pressed={joint.kind === k}
              title={`${JOINT_LABELS[k]} : ${JOINT_EXPLANATIONS[k]}`}
              onClick={() => c.setJoint(joint.id, { kind: k }, `Liaison : ${JOINT_LABELS[k]}`)}
            >
              <Icon name={`joint-${k}`} />
              <span>{JOINT_LABELS[k]}</span>
            </button>
          ))}
        </div>
        <p class="field-help joint-explanation">
          <strong>{JOINT_LABELS[joint.kind]}</strong> : {JOINT_EXPLANATIONS[joint.kind]}
        </p>
      </div>
      <MotionField
        id="joint-angle"
        label={free.angle ? 'Angle (rotation)' : 'Angle (fixe)'}
        unit="°"
        value={joint.angle}
        limits={joint.angleLimits}
        range={[-180, 180]}
        onLive={(angle) => c.setJointLive(joint.id, { angle: clampToLimits(angle, joint.angleLimits) })}
        onCommit={() => c.commitLive('Tourner la pièce')}
        onExact={(angle) => c.setJoint(joint.id, { angle }, 'Tourner la pièce')}
      />
      {free.tilt ? (
        <>
          <MotionField
            id="joint-tilt"
            label="Pencher (inclinaison)"
            unit="°"
            value={joint.tilt ?? 0}
            limits={[0, joint.tiltLimit ?? 180]}
            range={[0, joint.tiltLimit ?? 180]}
            onLive={(tilt) => c.setJointLive(joint.id, { tilt: Math.max(0, Math.min(tilt, joint.tiltLimit ?? 180)) })}
            onCommit={() => c.commitLive('Pencher la pièce')}
            onExact={(tilt) => c.setJoint(joint.id, { tilt }, 'Pencher la pièce')}
          />
          <MotionField
            id="joint-tilt-direction"
            label="Direction de l’inclinaison"
            unit="°"
            value={joint.tiltDirection ?? 0}
            limits={undefined}
            range={[-180, 180]}
            onLive={(tiltDirection) => c.setJointLive(joint.id, { tiltDirection })}
            onCommit={() => c.commitLive('Pencher la pièce')}
            onExact={(tiltDirection) => c.setJoint(joint.id, { tiltDirection }, 'Pencher la pièce')}
          />
        </>
      ) : null}
      <MotionField
        id="joint-offset"
        label={free.offset ? 'Décalage (glissement)' : 'Décalage (fixe)'}
        unit="mm"
        value={joint.offset}
        limits={joint.offsetLimits}
        range={[Math.min(-50, joint.offset - 20), Math.max(50, joint.offset + 20)]}
        onLive={(offset) => c.setJointLive(joint.id, { offset: clampToLimits(offset, joint.offsetLimits) })}
        onCommit={() => c.commitLive('Faire glisser la pièce')}
        onExact={(offset) => c.setJoint(joint.id, { offset }, 'Faire glisser la pièce')}
      />
      <label class="checkbox-row">
        <input type="checkbox" checked={joint.flip} onChange={() => c.setJoint(joint.id, { flip: !joint.flip }, 'Retourner la pièce')} />
        <span>Retourner la pièce mobile (inverser le sens de son axe)</span>
      </label>
      <details class="advanced">
        <summary>Limites du mouvement</summary>
        {free.angle ? (
          <LimitsField label="l’angle" unit="°" limits={joint.angleLimits} fallback={[0, 90]} onChange={(angleLimits) => c.setJoint(joint.id, { ...(angleLimits ? { angleLimits } : { angleLimits: undefined }) }, 'Limites de la liaison')} />
        ) : null}
        {free.offset ? (
          <LimitsField label="le décalage" unit="mm" limits={joint.offsetLimits} fallback={[0, 20]} onChange={(offsetLimits) => c.setJoint(joint.id, { ...(offsetLimits ? { offsetLimits } : { offsetLimits: undefined }) }, 'Limites de la liaison')} />
        ) : null}
        {free.tilt ? (
          <div class="field">
            <label class="checkbox-row">
              <input
                type="checkbox"
                checked={joint.tiltLimit !== undefined}
                onChange={() => c.setJoint(joint.id, { tiltLimit: joint.tiltLimit !== undefined ? undefined : 45 }, 'Limites de la liaison')}
              />
              <span>Limiter l’inclinaison</span>
            </label>
            {joint.tiltLimit !== undefined ? (
              <NumberInput
                value={formatNumber(joint.tiltLimit, 1)}
                unit="°"
                min={0}
                max={180}
                ariaLabel="Inclinaison maximale"
                onInput={(t) => {
                  const v = readNumber(t);
                  if (v !== null && v >= 0 && v <= 180) c.setJoint(joint.id, { tiltLimit: v, tilt: Math.min(joint.tilt ?? 0, v) }, 'Limites de la liaison');
                }}
              />
            ) : null}
          </div>
        ) : null}
        {!free.angle && !free.offset ? <p class="field-help">Une liaison fixe ne bouge pas : choisissez un autre type pour la faire bouger.</p> : null}
      </details>
      </div>
      <div class="panel-actions">
        <Button variant="danger" icon="trash" onClick={() => c.removeJoint(joint.id)}>
          Supprimer la liaison
        </Button>
      </div>
    </>
  );
}

function InstancePanel({ id }: { id: string }) {
  const c = useController();
  const data = useAppState((s) => {
    const a = s.doc.assembly;
    const inst = a?.instances.find((i) => i.id === id);
    if (!inst) return null;
    const held = a!.joints.some((j) => j.moving.instanceId === id);
    // Bloc : ses liaisons internes qui bougent (réglables ici s'il est souple).
    const inner = inst.subassemblyId ? (subassemblyContent(s.doc, inst.subassemblyId)?.joints ?? []).filter((j) => j.kind !== 'fixed' && j.kind !== 'spherical') : [];
    return { inst, fixed: a!.instances[0]!.id === id, held, inner };
  });
  if (!data) return null;
  const { inst, fixed, held, inner } = data;
  const axis = (k: 'x' | 'y' | 'z') => (
    <label class="mini-field" key={k}>
    <span>{k.toUpperCase()}</span>
    <NumberInput
      value={formatNumber(inst.position[k], 2)}
      unit="mm"
      min={-100000}
      ariaLabel={`Position ${k.toUpperCase()}`}
      onInput={(t) => {
        const v = readNumber(t);
        if (v !== null) c.moveInstance(id, { ...inst.position, [k]: v });
      }}
    />
    </label>
  );
  const rot = inst.rotation ?? { x: 0, y: 0, z: 0 };
  const turn = (k: 'x' | 'y' | 'z') => (
    <label class="mini-field" key={`r${k}`}>
      <span>{k.toUpperCase()}</span>
      <NumberInput
        value={formatNumber(rot[k], 2)}
        unit="°"
        step={15}
        min={-100000}
        ariaLabel={`Rotation autour de ${k.toUpperCase()}`}
        onInput={(t) => {
          const v = readNumber(t);
          if (v !== null) c.rotateInstance(id, { ...rot, [k]: v });
        }}
      />
    </label>
  );
  return (
    <>
      <div class="panel-title">
        <Icon name="part" />
        <span>{inst.name}</span>
      </div>
      <div class="panel-content">
      {!inst.subassemblyId ? (
        <Button icon="edit" onClick={() => c.editInAssembly(id)}>
          Modifier dans l’assemblage
        </Button>
      ) : null}
      {fixed ? (
        <Callout kind="info">C’est la pièce fixe : les autres pièces se placent par rapport à elle.</Callout>
      ) : held ? (
        <Callout kind="info">Cette pièce est tenue par une liaison : sélectionnez la liaison pour la faire bouger.</Callout>
      ) : (
        <Callout kind="info">Pièce libre : reliez-la avec l’outil « Liaison », ou placez-la à la main.</Callout>
      )}
      {!held ? (
        <>
          <div class="field">
            <span class="field-label">Position (X, Y, Z)</span>
            <div class="limits-row three">{(['x', 'y', 'z'] as const).map(axis)}</div>
          </div>
          <div class="field">
            <span class="field-label">Orientation (autour de X, Y, Z)</span>
            <div class="limits-row three">{(['x', 'y', 'z'] as const).map(turn)}</div>
            <span class="field-help">Ou dans la vue : flèches du manipulateur pour déplacer, anneaux pour tourner (pas de 1 mm et 15° ; Maj : 0,1 mm et 1°).</span>
          </div>
        </>
      ) : null}
      {inst.subassemblyId && inner.length ? (
        <div class="field">
          <label class="checkbox-row">
            <input id="as-block-flexible" type="checkbox" checked={!!inst.flexible} onChange={() => c.setBlockFlexible(id, !inst.flexible)} />
            <span>Bloc souple : ses liaisons bougent ici (chaque insertion a ses propres réglages)</span>
          </label>
          {inst.flexible
            ? inner.map((j) => {
                const v = inst.jointValues?.[j.id] ?? { angle: j.angle, offset: j.offset };
                const free = jointFreedoms(j.kind);
                return (
                  <div key={j.id} class="block-joint">
                    <span class="field-label">{j.name}</span>
                    {free.angle ? (
                      <MotionField
                        id={`as-block-${j.id}-angle`}
                        label="Angle"
                        unit="°"
                        value={v.angle}
                        limits={j.angleLimits}
                        range={[-180, 180]}
                        onLive={(angle) => c.setBlockJoint(id, j.id, { angle }, true)}
                        onCommit={() => c.commitLive(`Régler « ${j.name} » dans « ${inst.name} »`)}
                        onExact={(angle) => c.setBlockJoint(id, j.id, { angle })}
                      />
                    ) : null}
                    {free.offset ? (
                      <MotionField
                        id={`as-block-${j.id}-offset`}
                        label="Décalage"
                        unit="mm"
                        value={v.offset}
                        limits={j.offsetLimits}
                        range={[-50, 50]}
                        onLive={(offset) => c.setBlockJoint(id, j.id, { offset }, true)}
                        onCommit={() => c.commitLive(`Régler « ${j.name} » dans « ${inst.name} »`)}
                        onExact={(offset) => c.setBlockJoint(id, j.id, { offset })}
                      />
                    ) : null}
                  </div>
                );
              })
            : <p class="field-help">Rigide : le bloc garde les réglages de ses liaisons tels qu’ils sont dans le sous-assemblage.</p>}
        </div>
      ) : null}
      </div>
      <div class="panel-actions">
        <Button variant="danger" icon="trash" onClick={() => c.removeInstance(id)}>
          Retirer de l’assemblage
        </Button>
      </div>
    </>
  );
}

/** Panneau de droite de l'onglet Assemblage. */
export function AssemblyRightPanel() {
  const sel = useAppState((s) => s.assemblySelection);
  const joint = useAppState((s) => (sel?.kind === 'joint' ? s.doc.assembly?.joints.find((j) => j.id === sel.id) ?? null : null));
  const coupling = useAppState((s) => (sel?.kind === 'coupling' ? s.doc.assembly?.couplings?.find((k) => k.id === sel.id) ?? null : null));
  const jointMode = useAppState((s) => (s.mode.kind === 'joint' ? s.mode : null));
  const fastenerKind = useAppState((s) => (s.mode.kind === 'fastener' ? s.mode.fastenerKind : null));
  const c = useController();
  return (
    <aside class="panel right-panel" aria-label="Réglages de l’assemblage">
      {fastenerKind ? (
        <FastenerModePanel kind={fastenerKind} />
      ) : sel?.kind === 'fasteners' ? (
        <FastenerPanel ids={sel.ids} />
      ) : jointMode ? (
        <>
          <div class="panel-title">
            <Icon name="pivot" />
            <span>Nouvelle liaison</span>
          </div>
          <div class="panel-content">
          <ol class="steps">
            <li class={jointMode.moving ? 'done' : 'current'}>Cliquez un repère sur la pièce qui doit bouger : face plane, bord d’un trou ou d’un axe, arête droite.</li>
            <li class={jointMode.moving ? 'current' : ''}>Cliquez le repère correspondant sur la pièce de référence.</li>
          </ol>
          <p class="field-help">Deux bords circulaires donnent un pivot ; sinon la liaison est fixe. Vous pourrez changer le type ensuite.</p>
          </div>
          <div class="panel-actions">
            <Button icon="close" onClick={() => c.cancelJoint()}>
              Annuler
            </Button>
          </div>
        </>
      ) : joint ? (
        <JointPanel joint={joint} />
      ) : coupling ? (
        <CouplingPanel coupling={coupling} />
      ) : sel?.kind === 'instance' ? (
        <InstancePanel id={sel.id} />
      ) : (
        <>
          <div class="panel-title">
            <Icon name="pivot" />
            <span>Assembler</span>
          </div>
          <div class="panel-content">
          <ol class="steps">
            <li>
              <strong>Insérer</strong> les pièces (la première reste fixe).
            </li>
            <li>
              <strong>Liaison</strong> : un clic sur la pièce qui bouge, un clic sur la pièce de référence.
            </li>
            <li>Faites bouger la pièce avec les curseurs, ou attrapez-la à la souris.</li>
          </ol>
          </div>
        </>
      )}
    </aside>
  );
}
