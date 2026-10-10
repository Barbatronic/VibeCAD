# 0008 — Stockage local, fichiers et mode hors ligne

## Décision

- **IndexedDB** pour les projets enregistrés, la sauvegarde automatique et les réglages.
- **Téléchargement explicite** toujours disponible (« Enregistrer sous… », exports), car le
  stockage du navigateur peut être effacé ou saturé ; l'application le rappelle au premier
  enregistrement.
- **File System Access API** en amélioration progressive (Chromium) : réenregistrer dans le même
  fichier ; repli universel par téléchargement et sélecteur de fichier.
- **Service worker** écrit à la main (pas de dépendance), généré au build avec la liste exacte
  des fichiers ; progression et état « Hors ligne : prêt » visibles dans la barre d'état.
- **CSP** stricte en production : aucun script, style ou police externe ; aucune télémétrie.

## Conséquences

Fonctionne après la première visite sans réseau (testé : rechargement hors ligne, création,
enregistrement, export STEP). Ne fonctionne pas en `file://` (limite des navigateurs).
