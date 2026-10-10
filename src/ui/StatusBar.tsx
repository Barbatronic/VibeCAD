import type { AppState } from '../app/state';
import { isDirty } from '../app/state';
import { formatLength } from '../domain/units';
import { describeFaceRef, pickFaceReference } from '../features/sketch/support';
import { TOOL_HELP } from '../sketch/session';
import type { ModelPick } from '../viewport/viewport';
import { useAppState } from './context';
import { Icon } from './icons';

const NAVIGATION_HINT = 'Glisser : tourner · Clic droit ou Maj + glisser : déplacer · Molette : zoomer · Double-clic sur une face : esquisse dessus';

function describePick(s: AppState, pick: { partId: string; kind: 'face' | 'edge'; index: number }): string {
  const part = s.doc.parts.find((p) => p.id === pick.partId);
  const mesh = s.display[pick.partId]?.mesh;
  if (!part || !mesh) return '';
  if (pick.kind === 'face') {
    const face = mesh.faces[pick.index];
    if (!face) return '';
    const ref = pickFaceReference(face.tags, part);
    const kind = face.surface === 'plane' ? 'Face plane' : face.surface === 'cylinder' ? `Face cylindrique Ø ${formatLength((face.cylinder?.radius ?? 0) * 2)}` : 'Face';
    return `${part.name} — ${kind}${ref ? `, ${describeFaceRef(ref, part)}` : ''}`;
  }
  const edge = mesh.edges[pick.index];
  if (!edge) return '';
  if (edge.curve === 'circle' && edge.circle) return `${part.name} — arête circulaire Ø ${formatLength(edge.circle.radius * 2)}`;
  return `${part.name} — arête de ${formatLength(edge.length)}`;
}

function helpText(s: AppState): string {
  switch (s.mode.kind) {
    case 'sketch':
      return s.mode.session.message?.text ?? TOOL_HELP[s.mode.session.tool];
    case 'feature':
      return 'Réglez les paramètres à droite : l’aperçu se met à jour. Puis « Valider » (Entrée) ou « Annuler » (Échap).';
    case 'pick-support':
      return 'Cliquez un plan coloré (XY, XZ ou YZ) ou une face plane de la pièce. Échap pour annuler.';
    case 'measure':
      return 'Cliquez une arête ou une face pour lire ses dimensions, puis un second élément pour la distance. Échap pour terminer.';
    case 'joint':
      return s.mode.moving
        ? 'Liaison : cliquez maintenant le repère de la pièce de référence (face plane, bord d’un trou, arête). Échap pour annuler.'
        : 'Liaison : cliquez le repère de la pièce qui doit bouger (face plane, bord circulaire d’un trou ou d’un axe, arête droite). Échap pour annuler.';
    case 'model': {
      const hover = s.hover as ModelPick | null;
      if (hover) return describePick(s, hover);
      const sel = s.selection;
      if (sel && (sel.kind === 'face' || sel.kind === 'edge')) return `Sélection : ${describePick(s, sel)}`;
      return NAVIGATION_HINT;
    }
  }
}

function time(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

export function StatusBar() {
  const text = useAppState(helpText);
  const doc = useAppState(
    (s) => ({ dirty: isDirty(s), savedAt: s.project.savedAt, autosave: s.project.autosave, storage: s.project.storageAvailable }),
    (a, b) => JSON.stringify(a) === JSON.stringify(b),
  );
  const offline = useAppState((s) => s.offline);
  return (
    <footer class="statusbar">
      <span class="help-text" aria-live="polite">
        {text}
      </span>
      <span class="item" title="Toutes les longueurs sont en millimètres">
        Unités : mm
      </span>
      <span class="item" title={doc.storage ? 'Les projets sont conservés dans ce navigateur' : 'Stockage du navigateur indisponible : utilisez Enregistrer sous…'}>
        <span class={`dot ${doc.dirty ? 'warn' : 'ok'}`} />
        {doc.dirty ? 'Modifications non enregistrées' : doc.savedAt ? `Enregistré à ${time(doc.savedAt)}` : 'Nouveau projet'}
        {doc.autosave.kind === 'saved' && doc.dirty ? ` · sauvegarde auto ${time(doc.autosave.at)}` : ''}
        {doc.autosave.kind === 'error' ? ' · sauvegarde auto impossible' : ''}
      </span>
      {offline.status === 'ready' ? (
        <span class="item" title="L’application et le moteur de calcul sont enregistrés : elle fonctionne sans réseau.">
          <Icon name="offline" /> Hors ligne : prêt
        </span>
      ) : offline.status === 'preparing' ? (
        <span class="item" title="Téléchargement des fichiers nécessaires au mode hors ligne">
          <span class="dot" /> Préparation hors ligne {offline.total ? Math.round((offline.done / offline.total) * 100) : 0} %
        </span>
      ) : offline.status === 'update-ready' ? (
        <span class="item">
          <span class="dot warn" /> Nouvelle version prête (rechargez la page)
        </span>
      ) : offline.status === 'error' ? (
        <span class="item" title={offline.message}>
          <span class="dot bad" /> Mode hors ligne indisponible
        </span>
      ) : null}
    </footer>
  );
}
