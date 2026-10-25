/**
 * Fenêtre « Composants » : les bibliothèques et leurs collections (un dossier du dépôt), une
 * recherche, une grille de vignettes ; un clic insère le composant (pièce paramétrique, et dans
 * l'atelier Assemblage, insertion dans l'assemblage).
 */
import { useMemo, useState } from 'preact/hooks';
import { matchesSearch, type LibraryCatalog, type LibraryComponent } from '../app/library';
import { partMaterial } from '../domain/part-material';
import { formatNumber } from '../domain/units';
import { useAppState, useController } from './context';
import { Button } from './components/controls';
import { Modal } from './components/modal';
import { Icon } from './icons';

type Ready = Extract<LibraryCatalog, { status: 'ready' }>;

export function ComponentsDialog() {
  const c = useController();
  const catalogs = useAppState((s) => s.libraryCatalogs);
  const inserting = useAppState((s) => (s.dialog?.kind === 'components' ? s.dialog.inserting : null));
  const workspace = useAppState((s) => s.workspace);
  const [query, setQuery] = useState('');
  // Collection choisie : « source|id », ou toutes.
  const [current, setCurrent] = useState<string | null>(null);
  const ready = catalogs.filter((k): k is Ready => k.status === 'ready');
  const cards = useMemo(
    () =>
      ready.flatMap((cat) =>
        cat.index.collections
          .filter((col) => !current || current === `${cat.source}|${col.id}`)
          .flatMap((col) => col.components.filter((k) => matchesSearch(k, query)).map((k) => ({ cat, col, k }))),
      ),
    [catalogs, current, query],
  );
  const close = () => c.setDialog(null);
  return (
    <Modal
      title="Composants"
      onClose={close}
      wide
      footer={
        <>
          <span class="field-help components-hint">
            {workspace === 'assembly' ? 'Le composant est ajouté au projet puis inséré dans l’assemblage.' : 'Le composant est ajouté au projet comme une nouvelle pièce, avec son historique.'}
          </span>
          <Button onClick={() => c.setDialog({ kind: 'preferences' })} icon="settings">
            Bibliothèques…
          </Button>
          <Button onClick={close}>Fermer</Button>
        </>
      }
    >
      <div class="components-browser">
        <nav class="components-collections" aria-label="Collections">
          <button type="button" class="collection-item" aria-pressed={current === null} onClick={() => setCurrent(null)}>
            Tous les composants
          </button>
          {catalogs.map((cat) => (
            <div key={cat.source} class="collection-library">
              <div class="collection-library-name" title={cat.source}>
                {cat.status === 'ready' ? cat.index.name : cat.source.replace(/^https:\/\/(github\.com\/)?/, '')}
              </div>
              {cat.status === 'loading' ? <p class="field-help">Chargement…</p> : null}
              {cat.status === 'error' ? (
                <p class="field-help components-error">
                  {cat.error}{' '}
                  <button type="button" class="tl-link" onClick={() => void c.loadLibraries(true)}>
                    Réessayer
                  </button>
                </p>
              ) : null}
              {cat.status === 'ready'
                ? cat.index.collections.map((col) => (
                    <button
                      key={col.id}
                      type="button"
                      class="collection-item"
                      aria-pressed={current === `${cat.source}|${col.id}`}
                      title={col.description}
                      onClick={() => setCurrent(`${cat.source}|${col.id}`)}
                    >
                      <span>{col.name}</span>
                      <span class="count">{col.components.length}</span>
                    </button>
                  ))
                : null}
            </div>
          ))}
          {catalogs.length === 0 ? <p class="field-help">Aucune bibliothèque : ajoutez-en une dans les Préférences.</p> : null}
        </nav>
        <div class="components-main">
          <input
            type="search"
            class="components-search"
            placeholder="Rechercher : roulement 608, NEMA 17, poulie…"
            aria-label="Rechercher un composant"
            value={query}
            data-autofocus
            onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
          />
          {cards.length === 0 ? (
            <p class="field-help components-empty">{ready.length === 0 ? 'Aucune bibliothèque chargée pour l’instant.' : 'Aucun composant ne correspond.'}</p>
          ) : (
            <ul class="components-grid" aria-label="Composants">
              {cards.map(({ cat, k }) => (
                <li key={`${cat.source}|${k.id}`}>
                  <ComponentCard cat={cat} k={k} busy={inserting === `${cat.source}|${k.id}`} disabled={!!inserting} onInsert={() => void c.insertComponent(cat.source, k.id)} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Modal>
  );
}

function ComponentCard(props: { cat: Ready; k: LibraryComponent; busy: boolean; disabled: boolean; onInsert: () => void }) {
  const { cat, k } = props;
  const details = [
    k.size ? `${k.size.map((v) => formatNumber(v, 1)).join('\u00a0×\u00a0')}\u00a0mm` : null,
    k.material ? partMaterial(k.material).name : null,
    k.mass !== undefined ? `≈\u00a0${formatNumber(k.mass, 1)}\u00a0g` : null,
  ].filter(Boolean);
  return (
    <button type="button" class="component-card" disabled={props.disabled} aria-busy={props.busy} title={k.description} onClick={props.onInsert}>
      <span class="component-preview">
        {k.files.preview ? <img src={`${cat.base}${k.files.preview}`} alt="" loading="lazy" width={160} height={160} /> : <Icon name="part" />}
        {props.busy ? <span class="component-busy">Insertion…</span> : null}
      </span>
      <span class="component-name">{k.name}</span>
      {details.length ? <span class="component-details">{details.join(' · ')}</span> : null}
      <span class="component-formats">{[k.files.vibecad ? 'paramétrique' : null, k.files.step ? 'STEP' : null].filter(Boolean).join(' + ')}</span>
    </button>
  );
}
