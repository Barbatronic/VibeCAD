/**
 * Étude « Mécanisme » (atelier Simulation) : couple ou force à fournir sur une liaison motrice
 * pour faire bouger l'assemblage. Réglages, courbe sur la plage de mouvement (survol : la position
 * est montrée dans la vue), résultat et comparaison avec des moteurs courants.
 */
import { useRef } from 'preact/hooks';
import { COMMON_MOTORS, drivableJoints, type MechanismResult } from '../app/mechanism';
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
      return { study, joints, run, stale: !!run?.result && run.key !== c.mechanismKey(), hover: s.mechanismHover, leaves };
    },
    (a, b) => a.study === b.study && a.run === b.run && a.stale === b.stale && a.hover === b.hover && JSON.stringify([a.joints, a.leaves]) === JSON.stringify([b.joints, b.leaves]),
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
  return (
    <>
      <div class="panel-title">
        <Icon name="pivot" />
        <span>Couple sur une liaison</span>
      </div>
      <p class="panel-intro">
        Quel couple (pivot) ou quelle force (glissière) faut-il sur la liaison motrice pour faire bouger le mécanisme, et quel moteur choisir ? Le calcul tient compte du poids des pièces (d’après leur matière) et, si on le demande, de l’accélération.
      </p>
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
          {field('De', 'from', angle ? '°' : 'mm', { step: angle ? 15 : 5 })}
          {field('à', 'to', angle ? '°' : 'mm', { step: angle ? 15 : 5 })}
        </div>
        <div class="limits-row">
          {field('Frottement', 'friction', unit, { min: 0, step: angle ? 0.01 : 0.5 })}
          {field('Accélération', 'acceleration', angle ? 'rad/s²' : 'm/s²', { min: 0, step: 1 })}
        </div>
        <div class="limits-row">{field('Sécurité', 'safety', '×', { min: 1, step: 0.5 })}</div>
        <LoadsEditor study={study} leaves={data.leaves} />
        <Button variant="primary" icon="simulate" onClick={() => void c.runMechanism()} disabled={!!run?.busy}>
          {run?.busy ? 'Calcul…' : 'Calculer le couple'}
        </Button>
        {run?.error ? <Callout kind="error">{run.error}</Callout> : null}
        {data.stale ? <Callout kind="warning">Le projet ou les réglages ont changé : recalculez pour mettre la courbe à jour.</Callout> : null}
        {run?.result ? <MechanismResultView result={run.result} study={study} hover={data.hover} /> : null}
        <p class="field-help">
          Calcul quasi statique : poids des pièces pleines et des masses portées, centre de gravité placé dans l’assemblage, accélération avec l’inertie de chaque pièce (translation et rotation propre). La visserie et les effets de vitesse ne sont pas comptés : prenez une marge (coefficient de sécurité).
        </p>
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
      {loads.length === 0 ? <span class="field-help">Aucune : seul le poids des pièces compte.</span> : null}
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
      <span class="field-help">Posée au centre de gravité de la pièce (objet tenu par une pince, plateau chargé…).</span>
    </div>
  );
}

function MechanismResultView({ result, study, hover }: { result: MechanismResult; study: MechanismStudy; hover: number | null }) {
  const angle = result.joint.kind === 'angle';
  const pos = (v: number) => `${formatNumber(v, angle ? 0 : 1)} ${angle ? '°' : 'mm'}`;
  const val = (v: number) => `${significant(v)} ${result.unit}`;
  if (!result.peak || result.required === null) {
    return <Callout kind="warning">Le mécanisme ne se place à aucune position de la plage : vérifiez les liaisons (boucle impossible, liaison en erreur).</Callout>;
  }
  const lifting = result.peak.value > 0;
  return (
    <div class="mech-result" aria-live="polite">
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
          ? `Au pic, le moteur doit pousser dans le sens des ${angle ? 'angles' : 'décalages'} croissants (il soulève).`
          : `Au pic, le poids entraîne le mécanisme : le moteur doit le retenir (frein ou couple de maintien).`}{' '}
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
          <p class="field-help">Valeurs indicatives (fiches courantes). Un réducteur (engrenages, poulies) divise le couple demandé au moteur par son rapport.</p>
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
          ? `À ${formatNumber(near.at, angle ? 0 : 1)}\u00a0${angle ? '°' : 'mm'} : ${significant(near.total)}\u00a0${result.unit}${withAcceleration ? ` (poids seul : ${significant(near.gravity)})` : ''} — position montrée dans la vue.`
          : 'Survolez la courbe : la position correspondante est montrée dans la vue.'}
      </figcaption>
    </figure>
  );
}
