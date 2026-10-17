import { LEVELS } from '../app/levels';
import { useEffect, useRef } from 'preact/hooks';
import { NATIVE_EXTENSION } from '../io/native-format';
import { useAppState, useController } from './context';
import { Button, IconButton } from './components/controls';
import { CatFigure } from './Mascot';

const GLOSSARY: [string, string][] = [
  ['Esquisse', 'Le dessin plat, sur un plan ou une face, à partir duquel on crée un volume.'],
  ['Plan', 'Une surface plate infinie qui sert de support au dessin : XY (dessus), XZ (face), YZ (droite).'],
  ['Origine', 'Le point de départ (0, 0, 0) du repère, à la croisée des axes X (rouge), Y (vert) et Z (bleu).'],
  ['Cote', 'Une dimension exacte imposée au dessin : une longueur, un diamètre, une distance depuis l’origine. Double-clic : changer la valeur ; glisser : déplacer la cote pour la lire plus facilement.'],
  ['Contrainte', 'Une règle géométrique : deux points réunis, un segment horizontal, deux segments parallèles ou de même longueur, un segment qui touche un cercle (tangence)… Les moins courantes sont dans le menu « Contraintes ».'],
  ['Entièrement contraint', 'Le dessin ne peut plus bouger : toutes ses dimensions et sa position sont fixées (il devient vert).'],
  ['Extrusion', 'Donner une épaisseur au dessin pour créer de la matière.'],
  ['Poche', 'Retirer de la matière en suivant le dessin. Un perçage est une poche ronde « traversante ».'],
  ['Congé', 'Arrondir une arête vive : on choisit les arêtes et le rayon de l’arrondi.'],
  ['Chanfrein', 'Couper une arête vive en biseau : on choisit les arêtes et la distance du biseau.'],
  ['Arête', 'La ligne où deux faces de la pièce se rejoignent.'],
  ['Polygone', 'Une forme à côtés égaux (triangle, carré, hexagone…) dont les sommets sont sur un cercle en pointillés : coter ce cercle fixe sa taille.'],
  ['Oblong', 'Une rainure aux deux bouts arrondis, comme un trou de vis qu’on peut régler.'],
  ['Couper', 'Retirer le morceau d’un trait jusqu’aux croisements voisins, pour réunir deux formes en un seul contour.'],
  ['Arc', 'Une portion de cercle : on clique le centre, le départ, puis on tourne dans le sens voulu jusqu’à l’arrivée.'],
  ['Construction', 'Un trait en pointillés qui sert de repère pour coter ; il ne compte pas pour le volume.'],
  ['Projeter', 'Reprendre une arête de la pièce (le bord d’un trou, un côté) dans l’esquisse pour s’en servir comme repère.'],
  ['Frise', 'La bande d’icônes en bas de la vue : faites glisser le repère pour revoir la pièce à une étape plus ancienne.'],
  ['Assemblage', 'L’onglet où l’on réunit les pièces du projet et où on les fait bouger les unes par rapport aux autres.'],
  ['Repère', 'Un point et une direction posés sur une pièce : le centre d’une face plane, le centre d’un trou, le milieu d’une arête.'],
  ['Collision', 'Deux pièces qui se rentrent dedans : impossible en vrai. Le volume en trop est montré en rouge.'],
  ['Liaison', 'Ce qui relie deux pièces : fixe, pivot (rotation, comme une roue), glissière (translation, comme un tiroir) ou pivot glissant.'],
  ['3MF', 'Format pour l’impression 3D qui garde l’unité (mm), le nom et la couleur des pièces.'],
  ['Révolution', 'Faire tourner le dessin autour d’un axe pour obtenir une pièce ronde, comme au tour.'],
  ['Centre de gravité', 'Le point d’équilibre de la pièce : posée sur une pointe juste dessous, elle tiendrait en équilibre.'],
  ['Coupe', 'Voir l’intérieur d’une pièce en la coupant par un plan, comme on coupe un fruit en deux. La pièce n’est pas modifiée.'],
  ['Balayage', 'Un contour fermé qui suit un chemin, comme la pâte d’une poche à douille : un tube coudé, une anse.'],
  ['Lissage', 'Un volume qui passe en douceur d’un contour à un autre, comme le goulot d’une bouteille qui passe du rond au carré.'],
  ['Coque', 'Vider une pièce en gardant une paroi, comme un pot : on clique les faces à laisser ouvertes.'],
  ['Forme', 'Une forme toute faite (boîte, cylindre, boule, anneau) qu’on ajoute à la pièce ou qu’on creuse dedans, sans dessiner d’esquisse.'],
  ['Symétrie', 'Ajouter le reflet de la pièce (ou d’un trou, d’un plot) comme dans un miroir, de l’autre côté d’un plan.'],
  ['Répétition', 'Refaire plusieurs fois la même étape (un trou, un plot) : en ligne, en grille ou en cercle. Changer l’original change toutes les copies.'],
  ['Historique', 'La liste des étapes de construction. On peut modifier une étape ancienne : les suivantes sont recalculées.'],
  ['Solide', 'Un volume fermé, avec un intérieur et un extérieur, comme une vraie pièce.'],
  ['STEP', 'Format d’échange entre logiciels de CAO (FreeCAD…) : il contient les formes exactes, pas l’historique.'],
  ['STL', 'Format de maillage (triangles) pour l’impression 3D, sans unité ni historique.'],
  ['Raideur', 'Ce qui fait qu’une pièce plie peu sous une charge. Une pièce deux fois plus raide plie deux fois moins.'],
  ['Alléger la pièce', 'Dans Simulation : garder seulement la matière qui travaille vraiment (optimisation topologique). Le calcul enlève la matière inutile et montre en orange une forme plus légère, souvent en forme de treillis, comme une grue ou un pont.'],
];

export function HelpDrawer() {
  const c = useController();
  const open = useAppState((s) => s.helpOpen);
  const catHidden = useAppState((s) => s.mascot.hidden);
  const level = useAppState((s) => s.level);
  const tips = useAppState((s) => s.tips);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    ref.current?.querySelector<HTMLElement>('button')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        c.toggleHelp(false);
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [open]);
  if (!open) return null;
  return (
    <aside class="drawer" role="dialog" aria-modal="false" aria-labelledby="help-title" ref={ref}>
      <div class="modal-header">
        <h2 id="help-title">Aide</h2>
        <IconButton icon="close" label="Fermer l’aide" onClick={() => c.toggleHelp(false)} />
      </div>
      <div class="drawer-body">
        <p>
          <Button variant="primary" icon="graduation" onClick={() => c.startTutorial()}>
            Choisir un parcours guidé
          </Button>
        </p>
        <p>
          <Button icon="settings" onClick={() => c.setDialog({ kind: 'preferences' })}>
            Toutes les préférences…
          </Button>
        </p>
        <label class="checkbox-row">
          <input type="checkbox" checked={tips} onChange={() => c.setTips(!tips)} />
          <span>Bulles d’explication au survol des outils (sinon : info-bulles simples)</span>
        </label>
        <fieldset class="help-levels">
          <legend>Niveau de l’interface</legend>
          <p class="field-help">Chaque niveau montre plus d’outils. Le niveau est retenu sur cet ordinateur ; un lien avec « ?niveau=expert » l’impose.</p>
          {LEVELS.map((l) => (
            <label class="checkbox-row" key={l.id}>
              <input type="radio" name="help-level" checked={level === l.id} onChange={() => c.setLevel(l.id)} />
              <span>
                <strong>{l.label}</strong> — {l.description}
              </span>
            </label>
          ))}
        </fieldset>
        <div class="help-cat">
          <CatFigure mood="tip" size={48} decorative />
          <div>
            <p>
              <strong>Java</strong>, le chat de VibeCAD, t’accompagne dans le parcours et te prévient quand une étape a un souci, avec un bouton pour la
              corriger. Il ne modifie jamais ta pièce tout seul.
            </p>
            <label class="checkbox-row">
              <input type="checkbox" checked={!catHidden} onChange={() => c.setMascot({ hidden: !catHidden, dismissed: null })} />
              <span>Afficher le chat</span>
            </label>
          </div>
        </div>

        <h3>Se déplacer dans la vue 3D</h3>
        <table class="shortcut-table">
          <tbody>
            <tr>
              <th>Tourner autour de la pièce</th>
              <td>Clic gauche + glisser (pavé tactile : appuyer + glisser)</td>
            </tr>
            <tr>
              <th>Déplacer la vue</th>
              <td>Clic droit + glisser, ou Maj + clic gauche + glisser (pavé tactile : deux doigts appuyés)</td>
            </tr>
            <tr>
              <th>Zoomer</th>
              <td>Molette, ou pincer sur le pavé tactile (zoom vers le curseur)</td>
            </tr>
            <tr>
              <th>Cadrer toute la pièce</th>
              <td>
                <kbd>F</kbd> ou le bouton « Cadrer »
              </td>
            </tr>
            <tr>
              <th>Vues standard</th>
              <td>
                <kbd>0</kbd> isométrique · <kbd>1</kbd> face · <kbd>2</kbd> dessus · <kbd>3</kbd> droite · <kbd>4</kbd> arrière · <kbd>5</kbd> dessous ·{' '}
                <kbd>6</kbd> gauche
              </td>
            </tr>
            <tr>
              <th>En esquisse</th>
              <td>La vue reste face au dessin : clic droit (ou deux doigts) pour déplacer, molette pour zoomer.</td>
            </tr>
          </tbody>
        </table>

        <h3>Dessiner une esquisse</h3>
        <ol>
          <li>« Esquisse », puis choisir un plan (XY = dessus) ou double-cliquer une face plane.</li>
          <li>Dessiner avec Segment, Rectangle ou Cercle. Les points s’accrochent à l’origine, aux points existants et à la grille : un repère et un mot (« Origine », « Extrémité »…) l’indiquent.</li>
          <li>Pendant le tracé, taper directement les dimensions au clavier (Tab pour passer au champ suivant, Entrée pour valider). La virgule est acceptée : 12,5.</li>
          <li>Ajouter des cotes avec l’outil Cote : un segment (longueur), un cercle (diamètre), deux points (distance horizontale, verticale ou alignée).</li>
          <li>Double-cliquer une cote pour changer sa valeur. Échap annule l’outil en cours.</li>
          <li>
            Outil Sélection : chaque clic ajoute un élément à la sélection (un nouveau clic le retire) ; glisser dans le vide trace un cadre qui choisit
            tout ce qu’il contient. Double-clic dans le vide ou Espace : tout désélectionner.
          </li>
          <li>« Terminer l’esquisse » pour revenir au volume.</li>
        </ol>
        <p>
          Couleurs : bleu = encore libre, vert = entièrement contraint, orange = sélectionné (trait épais). Un contour ouvert est signalé par des cercles
          rouges « À relier ».
        </p>

        <h3>Créer et modifier des volumes</h3>
        <ul>
          <li>
            <strong>Extrusion</strong> : choisir l’esquisse, la longueur et le sens. L’aperçu vert n’est pas encore enregistré : « Valider » l’ajoute.
          </li>
          <li>
            <strong>Poche</strong> : « Traversante » perce toute la pièce ; « Cotée » retire une profondeur précise. L’aperçu rouge montre la matière
            retirée.
          </li>
          <li>
            <strong>Congé</strong> et <strong>Chanfrein</strong> : cliquer sur une ou plusieurs arêtes de la pièce (elles s’épaississent au survol), puis
            choisir le rayon ou la distance. Recliquer une arête la retire de la liste.
          </li>
          <li>Double-cliquer une étape de l’historique pour la modifier : les étapes suivantes sont recalculées.</li>
          <li>Une étape en erreur est marquée en rouge avec une explication et un bouton pour la corriger. Rien n’est perdu.</li>
        </ul>

        <h3>Raccourcis clavier</h3>
        <table class="shortcut-table">
          <tbody>
            <tr>
              <th>Annuler / Rétablir</th>
              <td>
                <kbd>Ctrl</kbd>+<kbd>Z</kbd> / <kbd>Ctrl</kbd>+<kbd>Y</kbd> (ou <kbd>Ctrl</kbd>+<kbd>Maj</kbd>+<kbd>Z</kbd>)
              </td>
            </tr>
            <tr>
              <th>Enregistrer / Ouvrir</th>
              <td>
                <kbd>Ctrl</kbd>+<kbd>S</kbd> / <kbd>Ctrl</kbd>+<kbd>O</kbd>
              </td>
            </tr>
            <tr>
              <th>Outils d’esquisse</th>
              <td>
                <kbd>L</kbd> segment · <kbd>R</kbd> rectangle · <kbd>C</kbd> cercle · <kbd>D</kbd> cote · <kbd>H</kbd> horizontal · <kbd>V</kbd> vertical ·{' '}
                <kbd>O</kbd> coïncidence · <kbd>A</kbd> arc · <kbd>T</kbd> couper · <kbd>P</kbd> projeter
              </td>
            </tr>
            <tr>
              <th>Supprimer</th>
              <td>
                <kbd>Suppr</kbd> : la sélection (élément d’esquisse, étape ou pièce)
              </td>
            </tr>
            <tr>
              <th>Arrêter / annuler</th>
              <td>
                <kbd>Échap</kbd> : arrête le tracé, puis l’outil, puis ferme l’opération
              </td>
            </tr>
            <tr>
              <th>Désactiver l’accrochage</th>
              <td>
                Maintenir <kbd>Alt</kbd> pendant le tracé
              </td>
            </tr>
          </tbody>
        </table>

        <h3>Enregistrer et échanger</h3>
        <ul>
          <li>« Enregistrer » garde le projet dans ce navigateur. Une sauvegarde automatique protège aussi le travail en cours.</li>
          <li>« Enregistrer sous… » crée un fichier {NATIVE_EXTENSION} : la copie sûre, à garder ou à transmettre. Il contient tout l’historique.</li>
          <li>« Exporter en STEP » pour FreeCAD (formes exactes, en mm). « Exporter en STL » pour l’impression 3D (en mm, sans unité dans le fichier).</li>
          <li>« Importer » un STEP ajoute un « Solide importé » : sa forme est copiée dans le projet.</li>
        </ul>

        <h3>Vocabulaire</h3>
        <dl class="glossary">
          {GLOSSARY.map(([term, def]) => (
            <div key={term}>
              <dt>{term}</dt>
              <dd>{def}</dd>
            </div>
          ))}
        </dl>
      </div>
    </aside>
  );
}
