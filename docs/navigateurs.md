# Navigateurs testés et limites

## Tests automatisés

Les parcours de `tests/e2e/` (plaque percée de bout en bout, modification de la largeur,
annuler / rétablir, erreur récupérable, enregistrement et rechargement, export puis import STEP
persistant, deux pièces, mode hors ligne) passent sur :

| Navigateur | Version | Commande |
| --- | --- | --- |
| Chromium (Playwright) | build 1243 (Playwright 1.63) | `npm run test:e2e` |
| Firefox (Playwright) | 155.0 | `npm run test:e2e:firefox` |

Firefox 156 est le navigateur installé sur la machine de développement ; Edge (Chromium) et
Safari récents disposent des mêmes technologies mais ne sont pas testés automatiquement pour le
moment. Les fonctions absentes de Safari (réenregistrer dans le même fichier, compression du 3MF)
ont une solution de repli ; un essai sur un vrai Mac ou iPad reste conseillé avant un usage en
classe.

## Technologies requises

- **WebGL 2** (affichage 3D). Sans accélération matérielle, le rendu logiciel fonctionne mais
  plus lentement.
- **WebAssembly avec exceptions** (noyau OCCT) : Firefox ≥ 100, Chrome/Edge ≥ 95,
  Safari ≥ 15.2.
- **Workers ES** (modules dans un worker) : Firefox ≥ 114, Chrome/Edge ≥ 80, Safari ≥ 15.
- **IndexedDB** (projets, sauvegarde automatique) : en navigation privée, certains navigateurs
  l'effacent à la fermeture : utiliser « Enregistrer sous… ».
- **Service worker** (hors ligne) : uniquement en HTTPS ou sur `localhost`.

## Limites connues

- **`file://` non pris en charge** : ouvrir `index.html` par un double-clic ne fonctionne pas
  (workers et WASM interdits par les navigateurs). Utiliser `npm run dev`, `npm run preview` ou un
  hébergement HTTPS.
- **File System Access API** (réenregistrer dans le même fichier) : Chrome et Edge seulement ;
  ailleurs, « Enregistrer sous… » télécharge le fichier.
- **Pavé tactile** : deux doigts = zoom (comme la molette), pincer = zoom, Maj + glisser ou clic
  droit = déplacer la vue. Sur certains Mac, le défilement à deux doigts est rapide : le
  ralentir dans les réglages du système si besoin.
- **Écrans étroits** (< 980 px) : le panneau des pièces se replie (bouton en haut à gauche) ; en
  dessous de 720 px, le panneau des paramètres s'affiche en bas. L'usage visé reste un
  ordinateur avec souris.
