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

`.vibecad`, définie en un seul endroit (`NATIVE_EXTENSION` dans `src/io/native-format.ts`). Elle ne
doit pas être confondue avec STEP ni avec FCStd. Provisoire au départ (point ouvert du cahier des
charges), elle est **définitive** depuis que le nom du logiciel est fixé (décision 0007).

## Gel du schéma 1 (12 octobre 2026, accord du commanditaire)

Le schéma 1 est gelé : seuls des ajouts facultatifs sont permis ; tout changement incompatible
passe au schéma 2 avec migration. Un projet de référence enregistré ce jour
(`tests/fixtures/reference-schema-1.vibecad`) doit toujours s'ouvrir et se reconstruire à
l'identique. Règles détaillées : [format-natif.md](../format-natif.md), « Stabilité du format ».
