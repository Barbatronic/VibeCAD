# 0003 — Format natif JSON `.vibecad`

## Décision

Un seul fichier JSON UTF-8, indenté, contenant une enveloppe versionnée (`format`,
`schemaVersion`, `generator`, `savedAt`) et le document complet. Les fichiers importés (STEP)
sont embarqués dans `resources` (texte UTF-8 ou base64, avec SHA-256). Détails :
[format-natif.md](../format-natif.md).

## Options étudiées

- **Archive ZIP** (manifeste JSON + ressources) : plus compacte pour de gros imports, mais
  demande une bibliothèque d'archive et n'est pas lisible directement. Gardée en réserve si des
  imports volumineux deviennent fréquents (une migration de format le permettrait).
- **JSON unique** (retenu) : lisible, comparable ligne à ligne, ouvrable dans n'importe quel
  éditeur, sans dépendance.

## Extension

`.vibecad` est **provisoire** (point ouvert du cahier des charges), défini en un seul endroit
(`NATIVE_EXTENSION` dans `src/io/native-format.ts`). Elle ne doit pas être confondue avec STEP
ni avec FCStd.
