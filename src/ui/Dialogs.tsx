import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { formatLength, formatVolume } from '../domain/units';
import { NATIVE_EXTENSION } from '../io/native-format';
import { STL_UNIT_NOTE } from '../io/stl';
import { THREEMF_NOTE } from '../io/threemf';
import { APP_NAME, APP_TAGLINE, APP_VERSION } from '../meta';
import { useAppState, useController } from './context';
import { Button, Callout, IconButton, Segmented } from './components/controls';
import { LEVELS } from '../app/levels';
import type { ExportFormat, ThemeChoice } from '../app/state';
import { Icon } from './icons';

function Modal(props: { title: string; onClose: () => void; children: ComponentChildren; footer?: ComponentChildren; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>('[data-autofocus], .modal-body button, .modal-body input, .modal-footer button');
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        props.onClose();
      }
      if (e.key === 'Tab' && ref.current) {
        const focusables = Array.from(ref.current.querySelectorAll<HTMLElement>('button, input, select, a[href], [tabindex="0"]')).filter((el) => !el.hasAttribute('disabled'));
        if (focusables.length === 0) return;
        const firstEl = focusables[0]!;
        const lastEl = focusables[focusables.length - 1]!;
        if (e.shiftKey && document.activeElement === firstEl) {
          e.preventDefault();
          lastEl.focus();
        } else if (!e.shiftKey && document.activeElement === lastEl) {
          e.preventDefault();
          firstEl.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      previous?.focus?.();
    };
  }, []);
  return (
    <div class="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && props.onClose()}>
      <div class={`modal${props.wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby="modal-title" ref={ref}>
        <div class="modal-header">
          <h2 id="modal-title">{props.title}</h2>
          <IconButton icon="close" label="Fermer" onClick={props.onClose} />
        </div>
        <div class="modal-body">{props.children}</div>
        {props.footer ? <div class="modal-footer">{props.footer}</div> : null}
      </div>
    </div>
  );
}

function when(iso: string): string {
  return new Date(iso).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });
}

function OpenDialog() {
  const c = useController();
  const d = useAppState((s) => (s.dialog?.kind === 'open' ? s.dialog : null));
  const currentId = useAppState((s) => s.doc.id);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  if (!d) return null;
  const close = () => c.setDialog(null);
  return (
    <Modal
      title="Ouvrir un projet"
      onClose={close}
      wide
      footer={
        <>
          <Button icon="open" onClick={() => void c.openFile()}>
            Ouvrir un fichier ({NATIVE_EXTENSION} ou STEP)…
          </Button>
          <Button onClick={close}>Fermer</Button>
        </>
      }
    >
      {d.loading ? <p>Chargement…</p> : null}
      {d.drafts.length > 0 ? (
        <>
          <h3>Brouillons récupérables</h3>
          <p class="field-help">Modifications sauvegardées automatiquement mais pas encore enregistrées.</p>
          <ul class="project-list">
            {d.drafts.map((p) => (
              <li class="project-item" key={`draft-${p.projectId}`}>
                <div class="info">
                  <div class="name">{p.name}</div>
                  <div class="meta">Sauvegarde automatique du {when(p.savedAt)}</div>
                </div>
                <Button small icon="open" onClick={() => void c.openAutosaveDraft(p.projectId)}>
                  Récupérer
                </Button>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      <h3>Mes projets (dans ce navigateur)</h3>
      {!d.loading && d.projects.length === 0 ? (
        <p class="empty-hint">Aucun projet enregistré pour l’instant. Utilisez « Enregistrer » (Ctrl+S) pour en garder un ici.</p>
      ) : null}
      <ul class="project-list">
        {d.projects.map((p) => (
          <li class="project-item" key={p.id}>
            <div class="info">
              <div class="name">
                {p.name}
                {p.id === currentId ? ' (ouvert)' : ''}
              </div>
              <div class="meta">
                Enregistré le {when(p.savedAt)} · {Math.max(1, Math.round(p.size / 1024))} Ko
              </div>
            </div>
            <Button small icon="open" onClick={() => void c.openProject(p.id)}>
              Ouvrir
            </Button>
            {confirmDelete === p.id ? (
              <Button small variant="danger" icon="trash" onClick={() => void c.deleteProject(p.id)}>
                Confirmer la suppression
              </Button>
            ) : (
              <IconButton icon="trash" label={`Supprimer « ${p.name} » du navigateur`} onClick={() => setConfirmDelete(p.id)} />
            )}
          </li>
        ))}
      </ul>
      <Callout kind="info">
        <p>
          Les projets sont gardés dans ce navigateur, sur cet ordinateur. Le navigateur peut les effacer (nettoyage, manque de place) : pour
          garder une copie sûre ou changer d’ordinateur, utilisez « Enregistrer sous… » qui crée un fichier {NATIVE_EXTENSION}.
        </p>
      </Callout>
    </Modal>
  );
}

const EXPORT_FORMATS: { format: ExportFormat; label: string; title: string }[] = [
  { format: 'step', label: 'STEP', title: 'Pour FreeCAD et les autres logiciels de CAO (formes exactes)' },
  { format: '3mf', label: '3MF', title: 'Pour l’impression 3D (pièces, couleurs, unité en mm)' },
  { format: 'stl', label: 'STL', title: 'Pour l’impression 3D (le format le plus répandu)' },
  { format: 'glb', label: 'GLB', title: 'Pour montrer le modèle : page web, présentation, visionneuse 3D' },
  { format: 'freecad', label: 'FreeCAD', title: 'Script qui reconstruit le projet dans FreeCAD avec son historique (esquisses, cotes, étapes)' },
  { format: 'fcstd', label: 'FCStd', title: 'Document FreeCAD des formes finales (sans historique), à ouvrir d’un double-clic' },
];

function ExportDialog() {
  const c = useController();
  const d = useAppState((s) => (s.dialog?.kind === 'export' ? s.dialog : null));
  const parts = useAppState((s) => s.doc.parts.map((p) => ({ part: p, display: s.display[p.id] })));
  const assemblyCount = useAppState((s) => s.doc.assembly?.instances.length ?? 0);
  const plates = useAppState((s) => (s.dialog?.kind === 'export' && s.dialog.plate !== undefined ? c.printLayout().plates : 0));
  if (!d) return null;
  const close = () => c.setDialog(null);
  const isStep = d.format === 'step';
  return (
    <Modal
      title={d.plate !== undefined ? 'Exporter le plateau en 3MF' : `Exporter${d.assembly ? ' l’assemblage' : ''}`}
      onClose={close}
      footer={
        <>
          <Button onClick={close}>Annuler</Button>
          <Button variant="primary" icon="export" disabled={d.busy} disabledReason={d.partIds.length === 0 ? 'Cochez au moins une pièce.' : null} onClick={() => void c.confirmExport()}>
            {d.busy ? 'Export en cours…' : 'Exporter'}
          </Button>
        </>
      }
    >
      {d.plate === undefined ? (
        <div class="field" role="group" aria-label="Format">
          <span class="field-label">Format</span>
          <div class="segmented">
            {EXPORT_FORMATS.filter((f) => !d.assembly || f.format !== 'stl').map((f) => (
              <button key={f.format} type="button" aria-pressed={d.format === f.format} title={f.title} onClick={() => c.setExportFormat(f.format)}>
                {f.label}
              </button>
            ))}
          </div>
          <span class="field-help">{EXPORT_FORMATS.find((f) => f.format === d.format)?.title}</span>
        </div>
      ) : null}
      {d.plate !== undefined ? (
        <>
          <p>
            Le <strong>plateau préparé</strong> est exporté tel quel : chaque exemplaire avec son orientation, son échelle et sa place.
          </p>
          {plates > 1 ? (
            <fieldset style={{ border: 'none', padding: 0, margin: '0 0 8px' }}>
              <legend class="field-label">Plateaux à exporter</legend>
              {Array.from({ length: plates }, (_v, i) => (
                <label class="checkbox-row" key={i}>
                  <input type="radio" name="export-plate" checked={d.plate === i} onChange={() => c.setExportPlate(i)} />
                  <span>Plateau {i + 1}</span>
                </label>
              ))}
              <label class="checkbox-row">
                <input type="radio" name="export-plate" checked={d.plate === 'all'} onChange={() => c.setExportPlate('all')} />
                <span>Tous les plateaux (un fichier 3MF par plateau)</span>
              </label>
            </fieldset>
          ) : null}
        </>
      ) : d.assembly ? (
        <p>
          Toutes les pièces de l’assemblage sont exportées <strong>à leur place</strong>, chacune avec son nom et sa couleur
          ({assemblyCount} pièce{assemblyCount > 1 ? 's' : ''}).
        </p>
      ) : (
      <fieldset style={{ border: 'none', padding: 0, margin: '0 0 8px' }}>
          <legend class="field-label">Pièces à exporter</legend>
          {parts.map(({ part, display }) => {
            const analysis = display?.result.analysis;
            const has = (analysis?.solidCount ?? 0) > 0;
            return (
              <label class="checkbox-row" key={part.id}>
                <input type="checkbox" checked={d.partIds.includes(part.id)} disabled={!has} onChange={() => c.toggleExportPart(part.id)} />
                <span class="color-swatch" style={{ background: part.color, width: '18px', height: '18px' }} />
                <span>
                  <strong>{part.name}</strong>
                  <span class="field-help">
                    {' '}
                    — {has ? `${formatVolume(analysis!.volume)}` : 'pas encore de volume'}
                    {display?.result.failedFeatureId ? ' · contient une erreur' : ''}
                  </span>
                </span>
              </label>
            );
          })}
        </fieldset>
      )}
      {d.format === 'freecad' ? (
        <Callout kind="info">
          <p>
            Un <strong>script FreeCAD</strong> (.py) qui reconstruit le projet <strong>avec son historique</strong> : esquisses avec leurs contraintes et
            cotes, protrusions, cavités, révolutions, congés, chanfreins, perçages, répétitions, symétries, paramètres (feuille « Parametres »). Les étapes
            sans équivalent sont reprises comme formes figées{d.assembly ? ', et l’assemblage par des liens placés (sans les liaisons)' : ''}.
          </p>
          <p>
            Dans FreeCAD : <strong>Macro → Macros…</strong>, choisissez le dossier du fichier, sélectionnez-le puis <strong>Exécuter</strong>. Le
            projet s’ouvre et est enregistré en .FCStd à côté du script.
          </p>
        </Callout>
      ) : d.format === 'fcstd' ? (
        <Callout kind="info">
          <p>
            Un <strong>document FreeCAD</strong> (.FCStd) qui s’ouvre d’un double-clic, avec les formes finales, leurs noms
            {d.assembly ? ' et l’arborescence de l’assemblage' : ''}. Pas d’historique : pour pouvoir modifier les cotes dans FreeCAD, choisissez
            « FreeCAD ».
          </p>
        </Callout>
      ) : isStep ? (
        <Callout kind="info">
          <p>
            Le fichier STEP contient les <strong>solides</strong> (formes finales, en millimètres) avec le nom et la couleur de chaque pièce. Dans FreeCAD :
            Fichier → Importer. Vous pourrez y ajouter de nouvelles opérations. L’historique de construction (esquisses, cotes) reste dans le projet{' '}
            {NATIVE_EXTENSION} : ce n’est pas un arbre Part Design de FreeCAD.
          </p>
        </Callout>
      ) : d.format === 'glb' ? (
        <Callout kind="info">
          <p>
            Le GLB (glTF) sert à <strong>montrer</strong> le modèle : page web, présentation, visionneuse 3D, réalité augmentée. Il contient les pièces
            en triangles avec leurs couleurs{d.assembly ? ', à leur place dans l’assemblage, visserie comprise' : ''}. Il ne garde ni l’historique ni les
            formes exactes : pour la CAO, préférez le STEP ; pour l’impression, le 3MF.
          </p>
        </Callout>
      ) : d.format === '3mf' ? (
        <Callout kind="info">
          <p>
            {THREEMF_NOTE} Chaque pièce cochée devient un objet séparé. Comme le STL, c’est un maillage de triangles : il ne garde ni l’historique ni les
            formes exactes.
          </p>
        </Callout>
      ) : (
        <Callout kind="warning">
          <p>
            {STL_UNIT_NOTE} Le STL est un maillage de triangles pour l’impression : il ne garde ni l’historique ni les formes exactes. Préférez le 3MF si
            votre logiciel d’impression le lit.
          </p>
        </Callout>
      )}
    </Modal>
  );
}

function ImportDialog() {
  const c = useController();
  const d = useAppState((s) => (s.dialog?.kind === 'import-step' ? s.dialog : null));
  const activeName = useAppState((s) => s.doc.parts.find((p) => p.id === s.activePartId)?.name ?? '');
  if (!d) return null;
  const close = () => c.setDialog(null);
  return (
    <Modal
      title={`Importer « ${d.fileName} »`}
      onClose={close}
      footer={
        <>
          <Button onClick={close}>Annuler</Button>
          <Button variant="primary" icon="import" disabled={!d.inspection || d.busy} onClick={() => void c.confirmImport()}>
            Importer
          </Button>
        </>
      }
    >
      {d.busy ? (
        <p>
          <span class="spinner" style={{ display: 'inline-block', width: '18px', height: '18px', verticalAlign: 'middle', marginRight: '8px' }} />
          Lecture du fichier {d.format === 'stl' ? 'STL' : 'STEP'}…
        </p>
      ) : null}
      {d.error ? (
        <Callout kind="error">
          <p>{d.error}</p>
        </Callout>
      ) : null}
      {d.inspection ? (
        <>
          <p>
            {d.inspection.solids.length} solide{d.inspection.solids.length > 1 ? 's' : ''} trouvé{d.inspection.solids.length > 1 ? 's' : ''}
            {d.inspection.productNames.length ? ` (${d.inspection.productNames.slice(0, 4).join(', ')})` : ''}
            {d.inspection.triangles !== undefined ? ` à partir de ${d.inspection.triangles.toLocaleString('fr-FR')} triangles` : ''} :
          </p>
          <ul>
            {d.inspection.solids.map((s, i) => (
              <li key={i}>
                Solide {i + 1} : {formatVolume(s.volume)}
                {s.bbox
                  ? `, ${formatLength(s.bbox.max.x - s.bbox.min.x, 1, false)} × ${formatLength(s.bbox.max.y - s.bbox.min.y, 1, false)} × ${formatLength(s.bbox.max.z - s.bbox.min.z, 1)}`
                  : ''}
                {s.valid ? '' : ' — attention : solide avec défauts'}
              </li>
            ))}
          </ul>
          <fieldset style={{ border: 'none', padding: 0 }}>
            <legend class="field-label">Où l’ajouter ?</legend>
            <label class="checkbox-row">
              <input type="radio" name="import-target" checked={d.target === 'new-part'} onChange={() => c.setImportTarget('new-part')} />
              Dans une nouvelle pièce
            </label>
            <label class="checkbox-row">
              <input type="radio" name="import-target" checked={d.target === 'active-part'} onChange={() => c.setImportTarget('active-part')} />
              Dans la pièce active (« {activeName} »)
            </label>
          </fieldset>
          <Callout kind="info">
            <p>
              Le contenu du fichier est copié dans le projet : il restera disponible sans le fichier d’origine.{' '}
              {d.format === 'stl'
                ? 'Un STL ne contient que des triangles : les faces planes sont reconstituées, mais les surfaces courbes restent en facettes (on ne peut pas y faire un congé propre).'
                : 'Un STEP contient la forme finale, pas les esquisses ni les étapes qui ont servi à le construire.'}
            </p>
          </Callout>
        </>
      ) : null}
    </Modal>
  );
}

function RecoveryDialog() {
  const c = useController();
  const d = useAppState((s) => (s.dialog?.kind === 'recovery' ? s.dialog : null));
  if (!d) return null;
  return (
    <Modal
      title="Récupérer votre travail ?"
      onClose={() => void c.discardRecovery()}
      footer={
        <>
          <Button onClick={() => void c.discardRecovery()}>Ignorer</Button>
          {d.savedAt ? <Button onClick={() => void c.openSavedInsteadOfRecovery()}>Ouvrir la version enregistrée</Button> : null}
          <Button variant="primary" icon="undo" onClick={() => void c.recover()}>
            Récupérer
          </Button>
        </>
      }
    >
      <p>
        Le projet <strong>« {d.autosave.name} »</strong> a des modifications sauvegardées automatiquement le {when(d.autosave.savedAt)}
        {d.savedAt ? `, plus récentes que le dernier enregistrement (${when(d.savedAt)})` : ', jamais enregistrées'}.
      </p>
      <p class="field-help">« Ignorer » supprime cette sauvegarde automatique.</p>
    </Modal>
  );
}

function UnsavedDialog() {
  const c = useController();
  const d = useAppState((s) => (s.dialog?.kind === 'unsaved' ? s.dialog : null));
  const name = useAppState((s) => s.doc.name);
  if (!d) return null;
  return (
    <Modal
      title="Enregistrer les modifications ?"
      onClose={() => c.setDialog(null)}
      footer={
        <>
          <Button onClick={() => c.setDialog(null)}>Annuler</Button>
          <Button onClick={() => void c.resolveUnsaved('discard')}>Ne pas enregistrer</Button>
          <Button variant="primary" icon="save" onClick={() => void c.resolveUnsaved('save')}>
            Enregistrer
          </Button>
        </>
      }
    >
      <p>
        Le projet <strong>« {name} »</strong> contient des modifications non enregistrées.
      </p>
    </Modal>
  );
}

function ConfirmLeaveSketch() {
  const c = useController();
  const open = useAppState((s) => s.dialog?.kind === 'confirm-leave-sketch');
  if (!open) return null;
  return (
    <Modal
      title="Abandonner les modifications de l’esquisse ?"
      onClose={() => c.setDialog(null)}
      footer={
        <>
          <Button onClick={() => c.setDialog(null)}>Continuer l’esquisse</Button>
          <Button variant="danger" icon="trash" onClick={() => c.cancelSketch(true)}>
            Abandonner
          </Button>
        </>
      }
    >
      <p>Les éléments dessinés et les cotes ajoutées depuis l’ouverture de l’esquisse seront perdus.</p>
    </Modal>
  );
}

function ProblemDialog() {
  const c = useController();
  const d = useAppState((s) => (s.dialog?.kind === 'problem' ? s.dialog : null));
  if (!d) return null;
  return (
    <Modal title={d.title} onClose={() => c.setDialog(null)} footer={<Button onClick={() => c.setDialog(null)}>Fermer</Button>}>
      <Callout kind="error">
        <p>{d.message}</p>
      </Callout>
      {d.details.length ? (
        <details>
          <summary>Détails pour l’enseignant</summary>
          <ul>
            {d.details.map((x) => (
              <li key={x}>
                <code>{x}</code>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </Modal>
  );
}

function AboutDialog() {
  const c = useController();
  const open = useAppState((s) => s.dialog?.kind === 'about');
  const perf = useAppState((s) => ({ kernel: s.kernel, last: s.lastEvaluation }), (a, b) => a.kernel === b.kernel && a.last === b.last);
  if (!open) return null;
  return (
    <Modal title={`À propos de ${APP_NAME}`} onClose={() => c.setDialog(null)} wide footer={<Button onClick={() => c.setDialog(null)}>Fermer</Button>}>
      <p>
        <strong>
          {APP_NAME} {APP_VERSION}
        </strong>{' '}
        — {APP_TAGLINE}. Tous les calculs se font dans ce navigateur : aucun compte, aucun envoi de vos modèles, aucune mesure d’audience.
      </p>
      <h3>Licences</h3>
      <ul>
        <li>
          Application : licence MIT (voir le fichier <code>LICENSE</code>).
        </li>
        <li>
          Noyau géométrique : Open CASCADE Technology (OCCT), LGPL 2.1 avec exception Open CASCADE, compilé en WebAssembly par le projet
          opencascade.js / replicad (paquet <code>replicad-opencascadejs</code> 1.1.0, LGPL 2.1). Le fichier WASM est séparé et remplaçable ; sources :
          dev.opencascade.org, github.com/donalffons/opencascade.js, github.com/sgenoud/replicad.
        </li>
        <li>Affichage 3D : three.js (MIT). Interface : Preact (MIT).</li>
      </ul>
      <p class="field-help">
        Détail des licences et provenance du fichier WASM :{' '}
        <a href="./THIRD_PARTY_NOTICES.md" target="_blank" rel="noopener">
          THIRD_PARTY_NOTICES.md
        </a>{' '}
        ·{' '}
        <a href="./licenses/LGPL-2.1.txt" target="_blank" rel="noopener">
          texte de la LGPL 2.1
        </a>{' '}
        ·{' '}
        <a href="./LICENSE.txt" target="_blank" rel="noopener">
          licence de l’application
        </a>
        .
      </p>
      <h3>Mesures</h3>
      <dl class="kv">
        <dt>Démarrage du noyau</dt>
        <dd>{perf.kernel.initMs ? `${Math.round(perf.kernel.initMs)} ms` : '—'}</dd>
        <dt>Dernier recalcul</dt>
        <dd>{perf.last ? `${Math.round(perf.last.durationMs)} ms` : '—'}</dd>
        <dt>Mémoire du noyau (WASM)</dt>
        <dd>{perf.last ? `${Math.round(perf.last.memoryBytes / 1048576)} Mo` : '—'}</dd>
      </dl>
    </Modal>
  );
}

/**
 * Préférences de cet appareil : niveau, aide, apparence, esquisse. Elles ne sont pas enregistrées
 * dans le projet (un même fichier s'ouvre de la même façon partout).
 */
function PreferencesDialog() {
  const c = useController();
  const prefs = useAppState(
    (s) => ({ level: s.level, tips: s.tips, cat: !s.mascot.hidden, theme: s.theme, grid: s.sketchGrid }),
    (a, b) => JSON.stringify(a) === JSON.stringify(b),
  );
  return (
    <Modal
      title="Préférences"
      onClose={() => c.setDialog(null)}
      wide
      footer={
        <>
          <Button icon="undo" onClick={() => c.resetPreferences()}>
            Rétablir les réglages par défaut
          </Button>
          <Button variant="primary" onClick={() => c.setDialog(null)}>
            Fermer
          </Button>
        </>
      }
    >
      <p class="field-help">Ces réglages sont retenus sur cet ordinateur, pas dans le projet.</p>
      <fieldset class="prefs-group">
        <legend>Niveau de l’interface</legend>
        {LEVELS.map((l) => (
          <label class="checkbox-row" key={l.id}>
            <input type="radio" name="pref-level" checked={prefs.level === l.id} onChange={() => c.setLevel(l.id)} />
            <span>
              <strong>{l.label}</strong> — {l.description}
            </span>
          </label>
        ))}
        <p class="field-help">Un lien avec « ?niveau=expert » (ou débutant, intermédiaire) impose le niveau, par exemple pour une classe.</p>
      </fieldset>
      <fieldset class="prefs-group">
        <legend>Aide</legend>
        <label class="checkbox-row">
          <input type="checkbox" checked={prefs.tips} onChange={() => c.setTips(!prefs.tips)} />
          <span>Bulles d’explication au survol des outils (sinon : info-bulles simples)</span>
        </label>
      </fieldset>
      <fieldset class="prefs-group">
        <legend>Environnement des jeunes</legend>
        <label class="checkbox-row">
          <input type="checkbox" checked={prefs.cat} onChange={() => c.setMascot({ hidden: prefs.cat, dismissed: null })} />
          <span>Afficher Java, le chat qui guide, donne des conseils et prévient des problèmes</span>
        </label>
        <p class="field-help">Désactivé par défaut. Utile avec les plus jeunes ; les conseils restent dans la barre d’état et l’historique.</p>
      </fieldset>
      <fieldset class="prefs-group">
        <legend>Apparence</legend>
        <Segmented<ThemeChoice>
          label="Thème"
          value={prefs.theme}
          options={[
            { value: 'auto', label: 'Automatique', title: 'Comme le système (clair le jour, sombre si l’ordinateur est réglé ainsi)' },
            { value: 'light', label: 'Clair' },
            { value: 'dark', label: 'Sombre' },
          ]}
          onChange={(t) => c.setTheme(t)}
        />
      </fieldset>
      <fieldset class="prefs-group">
        <legend>Esquisse</legend>
        <label class="checkbox-row">
          <input type="checkbox" checked={prefs.grid} onChange={() => c.setSketchGrid(!prefs.grid)} />
          <span>Aimanter les points à la grille (on peut aussi l’activer ou le couper dans chaque esquisse)</span>
        </label>
      </fieldset>
    </Modal>
  );
}

export function Dialogs() {
  const kind = useAppState((s) => s.dialog?.kind ?? null);
  switch (kind) {
    case 'open':
      return <OpenDialog />;
    case 'export':
      return <ExportDialog />;
    case 'import-step':
      return <ImportDialog />;
    case 'recovery':
      return <RecoveryDialog />;
    case 'unsaved':
      return <UnsavedDialog />;
    case 'confirm-leave-sketch':
      return <ConfirmLeaveSketch />;
    case 'problem':
      return <ProblemDialog />;
    case 'about':
      return <AboutDialog />;
    case 'preferences':
      return <PreferencesDialog />;
    default:
      return null;
  }
}

export function Toasts() {
  const c = useController();
  const toasts = useAppState((s) => s.toasts);
  return (
    <div class="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} class={`toast ${t.kind}`} role={t.kind === 'error' ? 'alert' : 'status'}>
          <Icon name={t.kind === 'error' ? 'error' : t.kind === 'success' ? 'ok' : 'info'} />
          <div class="text">
            {t.text}
            {t.detail ? (
              <details>
                <summary>Détails</summary>
                <pre style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{t.detail}</pre>
              </details>
            ) : null}
          </div>
          {t.action ? (
            <button
              type="button"
              class="btn btn-small"
              onClick={() => {
                t.action!();
                c.dismissToast(t.id);
              }}
            >
              {t.actionLabel}
            </button>
          ) : null}
          <IconButton icon="close" label="Fermer le message" small onClick={() => c.dismissToast(t.id)} />
        </div>
      ))}
    </div>
  );
}
