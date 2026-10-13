# Publier VibeCAD sur GitHub et GitHub Pages

Tout est prêt localement : le dépôt git (premier commit), la configuration et un workflow de
publication **à lancement manuel** (`.github/workflows/pages.yml`). Rien n'a été envoyé sur
GitHub : c'est vous qui lancez chaque étape.

Remplacez ci-dessous `MON-COMPTE` par votre nom d'utilisateur GitHub et `VibeCAD` par le nom de
dépôt choisi.

## 1. Créer le dépôt sur GitHub

Sur github.com : **New repository** → nom `VibeCAD` → **sans** README, licence ni .gitignore
(ils existent déjà) → Create repository. Public pour un GitHub Pages gratuit.

## 2. Envoyer les sources

```bash
cd /chemin/vers/le/projet
git remote add origin https://github.com/MON-COMPTE/VibeCAD.git
git push -u origin main
```

## 3. Activer GitHub Pages par GitHub Actions

Dépôt → **Settings** → **Pages** → *Build and deployment* → **Source : GitHub Actions**.

## 4. Lancer la publication (manuellement)

Dépôt → onglet **Actions** → **Publier sur GitHub Pages** → **Run workflow**. Le workflow
installe les dépendances (`npm ci`, Node 22), lance les vérifications (`npm run check`),
construit l'application (`npm run build`) et publie le dossier `dist/`.

Adresse attendue : `https://MON-COMPTE.github.io/VibeCAD/`

## 5. Vérifier après publication

- La page s'ouvre, le message « Préparation du moteur de calcul 3D… » disparaît en quelques
  secondes (le fichier WebAssembly fait 23 Mo, 7 Mo compressé).
- Créer une esquisse, une extrusion ; exporter un STEP ; rouvrir un fichier `.vibecad`.
- Mode hors ligne : après une première visite complète, recharger sans réseau.

## Mettre à jour le site avec les nouveautés

Le site ne se met **pas** à jour tout seul : la publication est manuelle, pour que vous gardiez la
main sur ce qui est mis en ligne.

1. Envoyer les derniers commits : `git push` (depuis le dossier du projet).
2. Onglet **Actions** du dépôt → **Publier sur GitHub Pages** → **Run workflow** (branche
   `main`) → bouton vert **Run workflow**. Compter 2 à 4 minutes ; la coche verte indique que
   c'est en ligne.

   **Attention : ne pas utiliser « Re-run jobs » sur une ancienne publication.** Une relance
   republie la version de son lancement d'origine (son commit), pas la dernière : le site
   resterait sur l'ancienne version malgré la coche verte. Toujours lancer un **nouveau** « Run
   workflow ». Pour vérifier : dans la liste des lancements, le commit affiché doit être le
   dernier (`git log -1 --oneline`). En ligne de commande : `gh workflow run pages.yml --ref main`.
3. Ouvrir (ou recharger) le site : la nouvelle version se télécharge en arrière-plan, puis la
   barre d'état (et le chat, s'il est activé) propose **« Mettre à jour »**. Un clic, et la page repart sur la nouvelle
   version (le travail en cours est sauvegardé automatiquement). Un site déjà ouvert vérifie
   aussi les mises à jour toutes les 30 minutes.

Si vous préférez une mise à jour automatique à chaque `git push`, il suffit d'ajouter
`push: { branches: [main] }` sous `on:` dans `.github/workflows/pages.yml`.

## Bon à savoir

- Les projets restent **dans le navigateur de chaque appareil** : le site publié a son propre
  stockage, distinct de `localhost`. Pour passer un projet d'un endroit à l'autre : Fichier →
  Enregistrer sous… (fichier `.vibecad`), puis Fichier → Ouvrir… sur l'autre adresse.
- Aucun serveur de calcul : tout s'exécute dans le navigateur ; rien n'est envoyé à GitHub
  ni ailleurs pendant l'utilisation.
- Chemins relatifs (`base: './'`) : l'application fonctionne sous n'importe quel sous-dossier.
  Vérifié localement sous `/VibeCAD/`, y compris le rechargement hors ligne.
- Les publications suivantes : pousser les modifications (`git push`), puis lancer un nouveau
  « Run workflow » dans l'onglet Actions (pas « Re-run jobs », qui republie l'ancienne version).
