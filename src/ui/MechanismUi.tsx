/**
 * Étude « Mécanisme » (atelier Simulation) : couple ou force à fournir sur une liaison motrice
 * pour faire bouger l'assemblage. Réglages, courbe sur la plage de mouvement (survol : la position
 * est montrée dans la vue), résultat et comparaison avec des moteurs courants.
 */
import { useRef } from 'preact/hooks';
import { COMMON_MOTORS, drivableJoints, type MechanismResult, type MotionResult } from '../app/mechanism';
import type { AppState } from '../app/state';
import type { MechanismStudy } from '../domain/model';
import { formatNumber, readNumber } from '../domain/units';
import { useAppState, useController } from './context';
import { Button, Callout, IconButton } from './components/controls';
import { NumberInput } from './components/number-input';
import { Icon } from './icons';

/** Trois chiffres significatifs (0,00123 ; 0,123 ; 12,3) : les couples vont du mN·m au N·m. */
export function significant(v: number): string {
  if (v === 0 || !Number.isFinite(v)) return '0';
  const decimals = Math.min(6, Math.max(0, 2 - Math.floor(Math.log10(Math.abs(v)))));
  return formatNumber(v, decimals);
}

export function MechanismPanel() {
  const c = useController();
  const data = useAppState(
    (s) => {
      const study = c.mechanismStudy();
      const joints = drivableJoints(s.doc.assembly).map((d) => ({ id: d.joint.id, name: d.joint.name, kind: d.kind }));
      const run = s.mechanismRun;
      const leaves = c.assemblyLeaves().map((l) => ({ key: l.key, name: l.name }));
      return { study, joints, run, stale: !!run?.result && run.key !== c.mechanismKey(), hover: s.mechanismHover, leaves, time: s.mechanismTime, playing: s.mechanismPlaying, collisions: s.mechanismCollisions };
    },
    (a, b) =>
      a.study === b.study && a.run === b.run && a.stale === b.stale && a.hover === b.hover && a.time === b.time && a.playing === b.playing && a.collisions === b.collisions && JSON.stringify([a.joints, a.leaves]) === JSON.stringify([b.joints, b.leaves]),
  );
  const { study, joints, run } = data;
  if (!study) return null;
  const kind = joints.find((j) => j.id === study.jointId)?.kind ?? 'angle';
  const angle = kind === 'angle';
  const unit = angle ? 'N·m' : 'N';
  const field = (label: string, key: keyof MechanismStudy, unitLabel: string, opts: { min?: number; step?: number } = {}) => (
    <label class="mini-field">
      <span>{label}</span>
      <NumberInput
        value={formatNumber(study[key] as number, 3)}
        unit={unitLabel}
        {...(opts.min !== undefined ? { min: opts.min } : {})}
        {...(opts.step !== undefined ? { step: opts.step } : {})}
        ariaLabel={label}
        onInput={(t) => {
          const v = readNumber(t);
          if (v !== null) c.setMechanismStudy({ [key]: v });
        }}
      />
    </label>
  );
  // L'élan se règle par la durée de la course (départ arrêté, arrivée arrêtée : on accélère sur la
  // première moitié, on freine sur la seconde), plus parlante qu'une accélération : a = 4 · course / durée².
  const travel = (from: number, to: number) => Math.abs(to - from) * (angle ? Math.PI / 180 : 1 / 1000);
  const duration = study.acceleration > 0 ? Math.sqrt((4 * travel(study.from, study.to)) / study.acceleration) : 0;
  const accelerationFor = (seconds: number, from: number, to: number) => (seconds > 0 ? (4 * travel(from, to)) / (seconds * seconds) : 0);
  /** Borne de la course : la durée choisie est gardée (l'accélération suit). */
  const bound = (label: string, key: 'from' | 'to') => (
    <label class="mini-field">
      <span>{label}</span>
      <NumberInput
        value={formatNumber(study[key], 3)}
        unit={angle ? '°' : 'mm'}
        step={angle ? 15 : 5}
        ariaLabel={label}
        onInput={(t) => {
          const v = readNumber(t);
          if (v === null) return;
          const next = { from: study.from, to: study.to, [key]: v };
          c.setMechanismStudy({ [key]: v, ...(duration > 0 ? { acceleration: accelerationFor(duration, next.from, next.to) } : {}) });
        }}
      />
    </label>
  );
  return (
    <>
      <div class="panel-title">
        <Icon name="pivot" />
        <span>Mécanisme</span>
      </div>
      <div class="panel-content">
        <label class="field">
          <span class="field-label">Liaison motrice</span>
          <select id="mech-joint" class="select" value={study.jointId} onChange={(e) => c.setMechanismStudy({ jointId: (e.target as HTMLSelectElement).value })}>
            {joints.map((j) => (
              <option key={j.id} value={j.id}>
                {j.name} ({j.kind === 'angle' ? 'pivot : couple' : 'glissière : force'})
              </option>
            ))}
          </select>
        </label>
        <div class="limits-row">
          {bound('Course : de', 'from')}
          {bound('à', 'to')}
        </div>
        <div class="limits-row">
          <label class="mini-field" title="Temps pour parcourir la course, départ et arrivée arrêtés. 0 : mouvement lent, sans élan.">
            <span>Durée de la course</span>
            <NumberInput
              id="mech-duration"
              value={formatNumber(duration, 2)}
              unit="s"
              min={0}
              step={0.1}
              ariaLabel="Durée de la course"
              onInput={(t) => {
                const v = readNumber(t);
                if (v !== null && v >= 0) c.setMechanismStudy({ acceleration: accelerationFor(v, study.from, study.to) });
              }}
            />
          </label>
          {field('Frottement', 'friction', unit, { min: 0, step: angle ? 0.01 : 0.5 })}
        </div>
        <div class="limits-row">{field('Marge de sécurité', 'safety', '×', { min: 1, step: 0.5 })}</div>
        <LoadsEditor study={study} leaves={data.leaves} />
        <Button variant="primary" icon="simulate" onClick={() => void c.runMechanism()} disabled={!!run?.busy}>
          {run?.busy ? 'Calcul…' : 'Calculer le couple'}
        </Button>
        {run?.error ? <Callout kind="error">{run.error}</Callout> : null}
        {data.stale ? <Callout kind="warning">Le projet ou les réglages ont changé : recalculez pour mettre la courbe à jour.</Callout> : null}
        {run?.result ? <MechanismResultView result={run.result} study={study} hover={data.hover} /> : null}
        {run?.result && run.motion ? <MotionView motion={run.motion} study={study} angle={angle} leaves={data.leaves} time={data.time} playing={data.playing} collisions={data.collisions} /> : null}
        <p class="field-help">Poids et inertie des pièces ; visserie non comptée.</p>
      </div>
    </>
  );
}

/** Masses portées : une charge (en grammes) posée au centre de gravité d'une pièce de l'assemblage. */
function LoadsEditor({ study, leaves }: { study: MechanismStudy; leaves: { key: string; name: string }[] }) {
  const c = useController();
  const loads = study.loads ?? [];
  const set = (next: MechanismStudy['loads']) => c.setMechanismStudy({ loads: next ?? [] });
  return (
    <div class="field">
      <span class="field-label">Masses portées</span>
      {loads.length === 0 ? <span class="field-help">Aucune</span> : null}
      <ul class="mech-loads" aria-label="Masses portées">
        {loads.map((l, i) => (
          <li key={i}>
            <select class="select" aria-label={`Pièce qui porte la masse ${i + 1}`} value={l.instanceKey} onChange={(e) => set(loads.map((x, j) => (j === i ? { ...x, instanceKey: (e.target as HTMLSelectElement).value } : x)))}>
              {leaves.map((leaf) => (
                <option key={leaf.key} value={leaf.key}>
                  {leaf.name}
                </option>
              ))}
            </select>
            <NumberInput
              value={formatNumber(l.mass * 1000, 1)}
              unit="g"
              min={0}
              step={10}
              ariaLabel={`Masse portée ${i + 1}`}
              onInput={(t) => {
                const v = readNumber(t);
                if (v !== null && v >= 0) set(loads.map((x, j) => (j === i ? { ...x, mass: v / 1000 } : x)));
              }}
            />
            <IconButton icon="trash" small label={`Retirer la masse portée ${i + 1}`} onClick={() => set(loads.filter((_x, j) => j !== i))} />
          </li>
        ))}
      </ul>
      {leaves.length ? (
        <Button icon="plus" small onClick={() => set([...loads, { instanceKey: leaves[leaves.length - 1]!.key, mass: 0.1 }])}>
          Ajouter une masse portée
        </Button>
      ) : null}
      <span class="field-help">Appliquées au centre de gravité de la pièce.</span>
    </div>
  );
}

function MechanismResultView({ result, study, hover }: { result: MechanismResult; study: MechanismStudy; hover: number | null }) {
  const angle = result.joint.kind === 'angle';
  const pos = (v: number) => `${formatNumber(v, angle ? 0 : 1)} ${angle ? '°' : 'mm'}`;
  const val = (v: number) => `${significant(v)} ${result.unit}`;
  if (!result.peak || result.required === null) {
    return <Callout kind="warning">Le mécanisme ne se place à aucune position de la plage : vérifiez les liaisons.</Callout>;
  }
  const lifting = result.peak.value > 0;
  // Rien à fournir : le poids ne travaille pas sur cette liaison (axe vertical, pièces équilibrées).
  const idle = Math.abs(result.peak.value) < 1e-9 && study.friction === 0;
  return (
    <div class="mech-result" aria-live="polite">
      {idle ? <Callout kind="info">Le poids ne charge pas cette liaison (axe vertical ou pièces équilibrées). Indiquez un frottement ou une durée de course.</Callout> : null}
      <MechanismChart result={result} hover={hover} />
      <dl class="props-list">
        <dt>{angle ? 'Couple à fournir' : 'Force à fournir'}</dt>
        <dd>{val(result.required)}</dd>
        <dt>Pic du calcul</dt>
        <dd>
          {val(Math.abs(result.peak.value))} à {pos(result.peak.at)}
        </dd>
        <dt>Masse en mouvement</dt>
        <dd>≈ {formatNumber(result.movingMass * 1000, 0)}&nbsp;g</dd>
      </dl>
      <p class="field-help">
        {lifting
          ? `Au pic : le moteur soulève.`
          : `Au pic : le poids entraîne, le moteur retient.`}{' '}
        À fournir = (pic + frottement {val(study.friction)}) × {formatNumber(study.safety, 1)}.
        {result.failed ? ` ${result.failed} position(s) de la plage où l’assemblage ne se place pas : ignorées.` : ''}
      </p>
      {angle ? (
        <>
          <h3 class="list-title">Moteurs courants</h3>
          <ul class="mech-motors" aria-label="Moteurs courants">
            {COMMON_MOTORS.map((m) => {
              const ok = m.torque >= result.required!;
              return (
                <li key={m.name} class={ok ? 'is-ok' : 'is-short'}>
                  <Icon name={ok ? 'ok' : 'error'} />
                  <span class="mech-motor-name">{m.name}</span>
                  <span class="mech-motor-torque">
                    {formatNumber(m.torque, 2)}&nbsp;N·m <small>{m.note}</small>
                  </span>
                  <span class="mech-motor-verdict">{ok ? 'suffit' : 'trop faible'}</span>
                </li>
              );
            })}
          </ul>
          <p class="field-help">Valeurs indicatives, sans réducteur.</p>
        </>
      ) : null}
    </div>
  );
}

/** Courbe couple/position : poids (gris), total avec accélération (couleur), à fournir (pointillés). */
function MechanismChart({ result, hover }: { result: MechanismResult; hover: number | null }) {
  const c = useController();
  const svg = useRef<SVGSVGElement>(null);
  const W = 320;
  const H = 180;
  const pad = { l: 46, r: 10, t: 18, b: 26 };
  const valid = result.samples.filter((s) => s.total !== null && s.gravity !== null) as { at: number; gravity: number; total: number }[];
  if (valid.length < 2) return null;
  const x0 = result.samples[0]!.at;
  const x1 = result.samples[result.samples.length - 1]!.at;
  const req = result.required ?? 0;
  const yMax = Math.max(req, ...valid.map((s) => Math.max(Math.abs(s.total), Math.abs(s.gravity)))) * 1.1 || 1;
  const X = (v: number) => pad.l + ((v - x0) / (x1 - x0 || 1)) * (W - pad.l - pad.r);
  const Y = (v: number) => pad.t + ((yMax - v) / (2 * yMax)) * (H - pad.t - pad.b);
  const path = (key: 'gravity' | 'total') => {
    // Une coupure là où l'assemblage ne se place pas.
    let d = '';
    let pen = false;
    for (const s of result.samples) {
      const v = s[key];
      if (v === null) {
        pen = false;
        continue;
      }
      d += `${pen ? 'L' : 'M'}${X(s.at).toFixed(1)},${Y(v).toFixed(1)}`;
      pen = true;
    }
    return d;
  };
  const withAcceleration = valid.some((s) => Math.abs(s.total - s.gravity) > 1e-12);
  const angle = result.joint.kind === 'angle';
  const fmt = (v: number) => significant(v);
  const near = hover !== null ? valid.reduce((a, b) => (Math.abs(b.at - hover) < Math.abs(a.at - hover) ? b : a)) : null;
  const onMove = (e: PointerEvent) => {
    const r = svg.current?.getBoundingClientRect();
    if (!r) return;
    const x = ((e.clientX - r.left) / r.width) * W;
    const v = x0 + ((x - pad.l) / (W - pad.l - pad.r)) * (x1 - x0);
    const s = valid.reduce((a, b) => (Math.abs(b.at - v) < Math.abs(a.at - v) ? b : a));
    c.setMechanismHover(s.at);
  };
  return (
    <figure class="mech-chart">
      {withAcceleration ? (
        <div class="mech-legend" aria-hidden="true">
          <span>
            <i class="mech-key total" /> avec l’accélération
          </span>
          <span>
            <i class="mech-key gravity" /> poids seul
          </span>
          <span>
            <i class="mech-key required" /> à fournir
          </span>
        </div>
      ) : null}
      <svg
        ref={svg}
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`Courbe du ${angle ? 'couple' : 'de la force'} selon la position de « ${result.joint.name} »`}
        onPointerMove={onMove}
        onPointerLeave={() => c.setMechanismHover(null)}
      >
        {[-yMax, -yMax / 2, 0, yMax / 2, yMax].map((v) => (
          <g key={v}>
            <line class={v === 0 ? 'mech-zero' : 'mech-grid'} x1={pad.l} x2={W - pad.r} y1={Y(v)} y2={Y(v)} />
            <text class="mech-tick" x={pad.l - 4} y={Y(v) + 3} text-anchor="end">
              {fmt(v)}
            </text>
          </g>
        ))}
        {[x0, (x0 + x1) / 2, x1].map((v) => (
          <text key={v} class="mech-tick" x={X(v)} y={H - 8} text-anchor="middle">
            {formatNumber(v, 0)}
            {angle ? '°' : ''}
          </text>
        ))}
        {req ? (
          <>
            <line class="mech-required" x1={pad.l} x2={W - pad.r} y1={Y(req)} y2={Y(req)} />
            <line class="mech-required" x1={pad.l} x2={W - pad.r} y1={Y(-req)} y2={Y(-req)} />
          </>
        ) : null}
        {withAcceleration ? <path class="mech-line gravity" d={path('gravity')} /> : null}
        <path class="mech-line total" d={path('total')} />
        {near ? (
          <>
            <line class="mech-cross" x1={X(near.at)} x2={X(near.at)} y1={pad.t} y2={H - pad.b} />
            <circle class="mech-dot" cx={X(near.at)} cy={Y(near.total)} r={4} />
          </>
        ) : null}
        <text class="mech-unit" x={4} y={10}>
          {result.unit}
        </text>
      </svg>
      <figcaption class="field-help">
        {near
          ? `À ${formatNumber(near.at, angle ? 0 : 1)}\u00a0${angle ? '°' : 'mm'} : ${significant(near.total)}\u00a0${result.unit}${withAcceleration ? ` (poids seul : ${significant(near.gravity)})` : ''}`
          : '\u00a0'}
      </figcaption>
    </figure>
  );
}

/**
 * Mouvement : la course lue dans le temps (la vue suit), la trajectoire et la vitesse du centre de
 * gravité d'une pièce suivie, et les collisions cherchées le long de la course.
 */
function MotionView(props: {
  motion: MotionResult;
  study: MechanismStudy;
  angle: boolean;
  leaves: { key: string; name: string }[];
  time: number | null;
  playing: boolean;
  collisions: AppState['mechanismCollisions'];
}) {
  const c = useController();
  const { motion, study, collisions } = props;
  const time = props.time ?? 0;
  const seconds = (v: number) => `${formatNumber(v, 2)} s`;
  const pos = (v: number) => `${formatNumber(v, props.angle ? 0 : 1)} ${props.angle ? '°' : 'mm'}`;
  const tracked = motion.samples.filter((s): s is typeof s & { speed: number } => s.speed !== null);
  return (
    <div class="mech-result" aria-label="Mouvement">
      <h3 class="list-title">Mouvement</h3>
      <div class="mech-timeline">
        <IconButton id="mech-play" icon={props.playing ? 'close' : 'play'} small label={props.playing ? 'Arrêter la lecture' : 'Lire le mouvement'} onClick={() => c.toggleMechanismPlay()} />
        <input
          id="mech-time"
          type="range"
          min={0}
          max={motion.duration}
          step={motion.duration / 200}
          value={time}
          aria-label="Instant de la course"
          aria-valuetext={seconds(time)}
          onInput={(e) => c.setMechanismTime(Number((e.target as HTMLInputElement).value))}
        />
        <span class="time">
          {formatNumber(time, 2)} / {seconds(motion.duration)}
        </span>
      </div>
      <label class="field">
        <span class="field-label">Pièce suivie</span>
        <select id="mech-tracked" class="select" value={study.tracked ?? ''} onChange={(e) => c.setMechanismStudy({ tracked: (e.target as HTMLSelectElement).value })}>
          <option value="">Aucune</option>
          {props.leaves.map((leaf) => (
            <option key={leaf.key} value={leaf.key}>
              {leaf.name}
            </option>
          ))}
        </select>
      </label>
      {tracked.length > 1 ? (
        <>
          <SpeedChart samples={tracked} duration={motion.duration} time={props.time} />
          <dl class="props-list">
            <dt>Vitesse maximale</dt>
            <dd id="mech-max-speed">{significant(motion.maxSpeed)} mm/s</dd>
            <dt>Distance parcourue</dt>
            <dd id="mech-distance">{significant(motion.distance)} mm</dd>
          </dl>
        </>
      ) : null}
      {collisions?.busy ? (
        <div class="sim-progress" role="status">
          <progress max={1} value={collisions.progress} aria-label="Recherche des collisions" />
        </div>
      ) : (
        <Button small icon="collision" onClick={() => void c.checkMechanismCollisions()}>
          Collisions sur la course
        </Button>
      )}
      {collisions && !collisions.busy ? (
        collisions.items.length === 0 ? (
          <Callout kind="success">Aucune collision sur la course.</Callout>
        ) : (
          <ul class="mech-collisions" aria-label="Collisions sur la course">
            {collisions.items.map((k) => (
              <li key={`${k.a}|${k.b}`}>
                <strong>{k.a}</strong> et <strong>{k.b}</strong> : {k.from === k.to ? `à ${pos(k.from)}` : `de ${pos(k.from)} à ${pos(k.to)}`}
              </li>
            ))}
          </ul>
        )
      ) : null}
      {motion.failed ? <p class="field-help">{motion.failed} instant(s) où l’assemblage ne se place pas.</p> : null}
    </div>
  );
}

/** Vitesse du point suivi au fil de la course ; un trait marque l'instant montré. */
function SpeedChart({ samples, duration, time }: { samples: { t: number; speed: number }[]; duration: number; time: number | null }) {
  const W = 320;
  const H = 120;
  const pad = { l: 46, r: 10, t: 14, b: 22 };
  const top = Math.max(...samples.map((s) => s.speed)) * 1.1 || 1;
  const X = (t: number) => pad.l + (t / (duration || 1)) * (W - pad.l - pad.r);
  const Y = (v: number) => H - pad.b - (v / top) * (H - pad.t - pad.b);
  const d = samples.map((s, i) => `${i ? 'L' : 'M'}${X(s.t).toFixed(1)},${Y(s.speed).toFixed(1)}`).join('');
  return (
    <figure class="mech-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Vitesse de la pièce suivie au fil de la course">
        {[0, top / 2, top].map((v) => (
          <g key={v}>
            <line class={v === 0 ? 'mech-zero' : 'mech-grid'} x1={pad.l} x2={W - pad.r} y1={Y(v)} y2={Y(v)} />
            <text class="mech-tick" x={pad.l - 4} y={Y(v) + 3} text-anchor="end">
              {significant(v)}
            </text>
          </g>
        ))}
        {[0, duration / 2, duration].map((t) => (
          <text key={t} class="mech-tick" x={X(t)} y={H - 6} text-anchor="middle">
            {formatNumber(t, 2)} s
          </text>
        ))}
        <path class="mech-line total" d={d} />
        {time !== null ? <line class="mech-cross" x1={X(time)} x2={X(time)} y1={pad.t} y2={H - pad.b} /> : null}
        <text class="mech-unit" x={4} y={10}>
          mm/s
        </text>
      </svg>
    </figure>
  );
}
