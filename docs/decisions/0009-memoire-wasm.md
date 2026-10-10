# 0009 — Mémoire WebAssembly : contournements dans l'adaptateur OCCT

## Constat (mesuré, octobre 2026)

Sur 1 000 recalculs de la plaque percée, la mémoire WASM passait de 100 à 413 Mo (environ
+0,37 Mo par recalcul, sans plafond). Trois causes ont été isolées par des boucles de mesure :

1. **Booléens** : le destructeur de `BRepAlgoAPI_Cut` / `Fuse` de cette build ne libère pas
   toutes les données internes. Appeler `Clear()` avant `delete()` supprime la croissance.
2. **Mode destructif** : par défaut, les booléens d'OCCT modifient leurs formes d'entrée (ajout de
   représentations aux arêtes). Une forme réutilisée (cache, aperçus) grossit à chaque opération.
   `SetNonDestructive(true)` l'évite et protège le cache.
3. **`BRepCheck_Analyzer`** : une instance neuve par vérification ne rend pas sa mémoire. Une
   instance unique réinitialisée par `Init()` reste stable.

## Décision

L'adaptateur applique ces trois règles (`src/geometry/occt/occt-kernel.ts`) et un test de
non-régression (`tests/perf/memory.test.ts`, `npm run bench`) vérifie que 1 500 recalculs avec
maillage ne font plus croître la mémoire au-delà de la mise en route.

## Résultat

Mémoire stable à 100–127 Mo après 1 500 recalculs (au lieu de ~650 Mo). Coût : le mode non
destructif rend chaque booléen un peu plus lent (recalcul de la plaque après modification de la
largeur : ~8 → ~15 ms), sans effet perceptible.
