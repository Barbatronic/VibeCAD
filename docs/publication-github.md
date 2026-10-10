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

## Bon à savoir

- Les projets restent **dans le navigateur de chaque appareil** : le site publié a son propre
  stockage, distinct de `localhost`. Pour passer un projet d'un endroit à l'autre : Fichier →
  Enregistrer sous… (fichier `.vibecad`), puis Fichier → Ouvrir… sur l'autre adresse.
- Aucun serveur de calcul : tout s'exécute dans le navigateur ; rien n'est envoyé à GitHub
  ni ailleurs pendant l'utilisation.
- Chemins relatifs (`base: './'`) : l'application fonctionne sous n'importe quel sous-dossier.
  Vérifié localement sous `/VibeCAD/`, y compris le rechargement hors ligne.
- Les publications suivantes : pousser les modifications (`git push`), puis relancer le
  workflow dans l'onglet Actions.
