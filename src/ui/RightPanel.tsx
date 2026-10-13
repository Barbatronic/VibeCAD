import { useMemo } from 'preact/hooks';
import type { Part, SketchSupport } from '../domain/model';
import { describeSupportPlane } from '../features/sketch/definition';
import { describeFaceRef } from '../features/sketch/support';
import { definitionOf } from '../features/registry';
import { findLine, findPoint } from '../sketch/model';
import { extractProfiles } from '../sketch/profiles';
import { deleteSelection, editDimension, setTool, TOOL_HELP, type SketchSession } from '../sketch/session';
import { ISSUE_MESSAGES } from '../domain/status';
import { useAppState, useController } from './context';
import { AssemblyRightPanel } from './AssemblyUi';
import { FabricationRightPanel } from './FabricationUi';
import { SimulationRightPanel } from './SimulationUi';
import { Button, Callout } from './components/controls';
import { FEATURE_PANELS } from './feature-panels';
import { Icon } from './icons';
import { SketchLists } from './SketchLists';
import { allows } from '../app/levels';

function supportText(support: SketchSupport, part: Part | undefined): string {
  if (support.kind === 'plane') return `sur le ${describeSupportPlane(support.plane)}`;
  if (support.kind === 'datum') return `sur « ${part?.features.find((f) => f.id === support.featureId)?.name ?? 'un plan de construction'} »`;
  return `sur la ${describeFaceRef(support.ref, part)}`;
}

function SketchPanel({ session }: { session: SketchSession }) {
  const c = useController();
  const part = useAppState((s) => s.doc.parts.find((p) => p.id === session.partId));
  const name = useAppState((s) => {
    const f = s.doc.parts.flatMap((p) => p.features).find((x) => x.id === session.featureId);
    return f?.name ?? 'Nouvelle esquisse';
  });
  const profile = useMemo(() => extractProfiles(session.sketch), [session.sketch]);
  const hasGeometry = session.sketch.entities.some((e) => e.type !== 'point');
  const selectedDims = session.selection.map((id) => session.sketch.constraints.find((k) => k.id === id)).filter((k) => k && 'value' in k);
  const selectedLines = session.selection.filter((id) => findLine(session.sketch, id));
  const selectedPoints = session.selection.filter((id) => id === 'origin' || findPoint(session.sketch, id));
  const message = session.message;
  const expert = useAppState((s) => allows(s.level, 'sketch-lists'));
  return (
    <>
      <div class="panel-title">
        <Icon name="sketch" />
        <span>{name}</span>
      </div>
      <p class="panel-intro">{supportText(session.sketch.support, part)}</p>
      <p class="vocab">
        <strong>Esquisse</strong> : le dessin plat, coté, à partir duquel on crée un volume.
      </p>
      <div class="panel-content">
        {message ? (
          <Callout kind={message.kind === 'error' ? 'error' : message.kind === 'success' ? 'success' : 'info'}>
            <p>{message.text}</p>
          </Callout>
        ) : (
          <Callout kind="info">
            <p>{TOOL_HELP[session.tool]}</p>
          </Callout>
        )}

        {hasGeometry ? (
          !session.converged ? (
            <div class="dof bad">
              <Icon name="error" />
              <span>Contraintes incompatibles : supprimez la dernière cote ajoutée.</span>
            </div>
          ) : session.dof === 0 ? (
            <div class="dof done">
              <Icon name="ok" />
              <span>
                Esquisse entièrement contrainte
                <small>Forme et position sont fixées par les cotes : le dessin est complètement défini.</small>
              </span>
            </div>
          ) : (
            <div class="dof todo">
              <Icon name="info" />
              <span>
                Encore {session.dof} degré{session.dof > 1 ? 's' : ''} de liberté
                <small>Ajoutez des cotes (outil Cote) pour fixer les dimensions et la position. Ce n’est pas obligatoire pour créer un volume.</small>
              </span>
            </div>
          )
        ) : null}

        {hasGeometry ? (
          profile.ok ? (
            <Callout kind="success">
              <p>
                Contour fermé ({profile.regions.length > 1 ? `${profile.regions.length} contours` : '1 contour'}
                {profile.regions.some((r) => r.holes.length > 0) ? ', avec trou(s)' : ''}) : prêt pour une extrusion ou une poche.
              </p>
            </Callout>
          ) : profile.code !== 'PROFILE_EMPTY' ? (
            <Callout kind="warning">
              <p>{ISSUE_MESSAGES[profile.code]}</p>
            </Callout>
          ) : null
        ) : null}

        {selectedDims.length === 1 ? (
          <div class="field">
            <span class="field-label">Cote sélectionnée</span>
            <div class="segmented">
              <Button small icon="edit" onClick={() => c.updateSession((s) => editDimension(s, selectedDims[0]!.id))}>
                Changer la valeur
              </Button>
              <Button small icon="trash" variant="danger" onClick={() => c.updateSession(deleteSelection)}>
                Supprimer
              </Button>
            </div>
          </div>
        ) : null}
        {selectedLines.length > 0 ? (
          <div class="field">
            <span class="field-label">
              {selectedLines.length} segment{selectedLines.length > 1 ? 's' : ''} sélectionné{selectedLines.length > 1 ? 's' : ''}
            </span>
            <div class="segmented">
              <Button small icon="horizontal" onClick={() => c.updateSession((s) => setTool(s, 'horizontal'))}>
                Horizontal
              </Button>
              <Button small icon="vertical" onClick={() => c.updateSession((s) => setTool(s, 'vertical'))}>
                Vertical
              </Button>
            </div>
          </div>
        ) : null}
        {selectedPoints.length === 2 ? (
          <div class="field">
            <span class="field-label">2 points sélectionnés</span>
            <Button small icon="coincident" onClick={() => c.updateSession((s) => setTool(s, 'coincident'))}>
              Réunir (coïncidence)
            </Button>
          </div>
        ) : null}

        {expert ? <SketchLists session={session} /> : null}

        <details class="advanced">
          <summary>Légende des couleurs</summary>
          <div class="legend" style={{ paddingBottom: '10px' }}>
            <span class="swatch-line" style={{ borderColor: 'var(--vp-sketch)' }} />
            <span>Élément encore libre (peut bouger)</span>
            <span class="swatch-line" style={{ borderColor: 'var(--vp-sketch-constrained)' }} />
            <span>Élément entièrement contraint</span>
            <span class="swatch-line" style={{ borderColor: 'var(--vp-sketch-selected)', borderTopWidth: '5px' }} />
            <span>Élément sélectionné (trait épais)</span>
            <span class="swatch-line" style={{ borderColor: 'var(--vp-preview)', borderTopStyle: 'dashed' }} />
            <span>Tracé en cours (pointillés)</span>
          </div>
        </details>
      </div>
      <div class="panel-actions">
        <Button variant="primary" icon="check" onClick={() => c.finishSketch()}>
          Terminer l’esquisse
        </Button>
        <Button icon="close" onClick={() => c.cancelSketch()}>
          Annuler
        </Button>
      </div>
    </>
  );
}

function FeaturePanel() {
  const c = useController();
  const draft = useAppState((st) => (st.mode.kind === 'feature' ? st.mode.draft : null));
  const part = useAppState((st) => (draft ? st.doc.parts.find((p) => p.id === draft.partId) : undefined));
  const status = useAppState(() => c.draftStatus());
  const blockReason = useAppState(() => c.draftBlockReason());
  const sketchResults = useAppState((st) => (draft ? st.display[draft.partId]?.result.sketches : undefined));
  if (!draft || !part) return null;
  const f = draft.feature;
  const def = definitionOf(f);
  const Panel = FEATURE_PANELS[f.type];
  const sketches = part.features
    .filter((x) => x.type === 'sketch')
    .map((x) => ({ id: x.id, name: x.name, closed: sketchResults?.find((r) => r.featureId === x.id)?.profile.ok ?? null }));
  return (
    <>
      <div class="panel-title">
        <Icon name={def.icon} />
        <span>{f.name}</span>
      </div>
      <p class="vocab">
        <strong>{def.label}</strong> : {def.explanation.split(' : ').slice(1).join(' : ') || def.explanation}
      </p>
      <div class="panel-content">
        {Panel ? (
          <Panel
            draft={draft as never}
            part={part}
            sketches={sketches}
            status={status}
            update={(change) => c.updateDraft(change as never)}
            setField={(name, text, result) => c.setDraftField(name, text, result as never)}
            confirm={() => c.confirmDraft()}
            cancel={() => c.cancelDraft()}
          />
        ) : (
          <p>Cette étape n’a pas de paramètres modifiables.</p>
        )}
      </div>
      <div class="panel-actions">
        <Button variant="primary" icon="check" disabledReason={blockReason} onClick={() => c.confirmDraft()}>
          Valider
        </Button>
        <Button icon="close" onClick={() => c.cancelDraft()}>
          Annuler
        </Button>
      </div>
    </>
  );
}

function PickSupportPanel() {
  const c = useController();
  const mode = useAppState((s) => (s.mode.kind === 'pick-support' ? s.mode : null));
  const repairName = useAppState((s) =>
    mode?.repairFeatureId ? s.doc.parts.flatMap((p) => p.features).find((f) => f.id === mode.repairFeatureId)?.name : null,
  );
  const hasSolid = useAppState((s) => (mode ? (s.display[mode.partId]?.result.analysis?.solidCount ?? 0) > 0 : false));
  // Plans de construction calculés, placés avant l'esquisse à réparer (tous pour une nouvelle esquisse).
  const datums = useAppState(
    (s) => {
      if (!mode) return [];
      const part = s.doc.parts.find((p) => p.id === mode.partId);
      const computed = new Set((s.display[mode.partId]?.result.planes ?? []).map((p) => p.featureId));
      const limit = mode.repairFeatureId ? (part?.features.findIndex((f) => f.id === mode.repairFeatureId) ?? -1) : -1;
      return (part?.features ?? []).filter((f, i) => f.type === 'plane' && computed.has(f.id) && (limit < 0 || i < limit)).map((f) => ({ id: f.id, name: f.name }));
    },
    (a, b) => JSON.stringify(a) === JSON.stringify(b),
  );
  if (!mode) return null;
  const planes = [
    { plane: 'XY' as const, icon: 'top', title: 'Plan XY — dessus', text: 'Le « sol » : on dessine à plat, vu de dessus.' },
    { plane: 'XZ' as const, icon: 'front', title: 'Plan XZ — face', text: 'Un mur devant soi : on dessine vu de face.' },
    { plane: 'YZ' as const, icon: 'right', title: 'Plan YZ — droite', text: 'Un mur sur le côté : on dessine vu de droite.' },
  ];
  return (
    <>
      <div class="panel-title">
        <Icon name="sketch" />
        <span>{repairName ? `Nouveau support pour « ${repairName} »` : 'Nouvelle esquisse'}</span>
      </div>
      <p class="panel-intro">
        {repairName ? 'Choisissez le plan ou la face où reposer cette esquisse. Son dessin et ses cotes seront conservés.' : 'Choisissez où dessiner :'}
      </p>
      <div class="panel-content">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {planes.map((p) => (
            <button key={p.plane} type="button" class="btn plane-choice" onClick={() => c.pickPlane(p.plane)}>
              <Icon name={p.icon} />
              <span>
                <strong>{p.title}</strong>
                <br />
                <span class="field-help">{p.text}</span>
              </span>
            </button>
          ))}
          {datums.map((d) => (
            <button key={d.id} type="button" class="btn plane-choice" onClick={() => c.pickDatum(d.id)}>
              <Icon name="datum-plane" />
              <span>
                <strong>{d.name}</strong>
                <br />
                <span class="field-help">Plan de construction de la pièce.</span>
              </span>
            </button>
          ))}
        </div>
        <Callout kind="info">
          <p>
            {hasSolid
              ? 'Vous pouvez aussi cliquer directement sur une face plane de la pièce, par exemple le dessus d’une plaque.'
              : 'Vous pouvez aussi cliquer sur un des plans colorés dans la vue 3D.'}
          </p>
        </Callout>
      </div>
      <div class="panel-actions">
        <Button icon="close" onClick={() => c.cancelPickSupport()}>
          Annuler
        </Button>
      </div>
    </>
  );
}

function MeasurePanel() {
  const c = useController();
  const mode = useAppState((s) => (s.mode.kind === 'measure' ? s.mode : null));
  if (!mode) return null;
  return (
    <>
      <div class="panel-title">
        <Icon name="measure" />
        <span>Mesurer</span>
      </div>
      <p class="panel-intro">Cliquez une arête ou une face pour lire ses dimensions, puis un second élément pour mesurer la distance entre les deux.</p>
      <div class="panel-content">
        {mode.busy ? (
          <Callout kind="info">
            <p>Mesure en cours…</p>
          </Callout>
        ) : mode.info ? (
          <div class="field" aria-live="polite">
            <span class="field-label">{mode.info.title}</span>
            {mode.info.lines.map((l) => (
              <span key={l}>{l}</span>
            ))}
          </div>
        ) : (
          <p class="field-help">Aucun élément choisi pour l’instant.</p>
        )}
        <p class="field-help">{mode.picks.length === 1 ? 'Cliquez un second élément pour mesurer une distance.' : ''}</p>
      </div>
      <div class="panel-actions">
        <Button variant="primary" icon="check" onClick={() => c.exitMeasure()}>
          Terminer
        </Button>
      </div>
    </>
  );
}

export function RightPanel() {
  const mode = useAppState((s) => s.mode.kind);
  const workspace = useAppState((s) => s.workspace);
  const session = useAppState((s) => (s.mode.kind === 'sketch' ? s.mode.session : null));
  if (workspace === 'assembly') return <AssemblyRightPanel />;
  if (workspace === 'fabrication') return <FabricationRightPanel />;
  if (workspace === 'simulation') return <SimulationRightPanel />;
  if (mode === 'model') return null;
  return (
    <aside class="panel right-panel" aria-label="Paramètres de l’opération en cours">
      {mode === 'sketch' && session ? <SketchPanel session={session} /> : null}
      {mode === 'feature' ? <FeaturePanel /> : null}
      {mode === 'pick-support' ? <PickSupportPanel /> : null}
      {mode === 'measure' ? <MeasurePanel /> : null}
    </aside>
  );
}
