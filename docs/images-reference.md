# Images de référence (calques)

Outil « Image » du secteur Esquisse : poser une photo ou un plan scanné sur un plan (ou une face
plane), à la bonne taille, pour **redessiner une pièce par-dessus** dans une esquisse :
rétro-conception d'une pièce cassée, d'un objet du quotidien, d'un dessin fait à la main.

## Utilisation

1. Sélectionner une face plane de la pièce (facultatif), puis **Image** et choisir le fichier
   (PNG, JPEG ou WebP). L'image se pose sur la face, sinon sur le plan XY, à 100 mm de large.
2. **Plan** : dessus (XY), face (XZ) ou droite (YZ).
3. **Redresser (perspective)…** — pour une photo prise de biais : cliquer les 4 coins d'un
   rectangle connu, dans l'ordre bas-gauche, bas-droit, haut-droit, haut-gauche (une feuille A4
   posée à côté de l'objet, la face d'une boîte…) et taper sa largeur et sa hauteur. L'image est
   redressée « vue de face » : ce rectangle est au centre, à sa taille réelle, avec une marge d'une
   demi-largeur et d'une demi-hauteur tout autour.
4. **Mettre à l'échelle (2 points)…** — cliquer deux points dont on connaît la distance (les
   graduations d'une règle, une cote du plan) et taper cette distance : la largeur de l'image est
   recalculée.
5. **Largeur**, **centre X / Y**, **rotation**, **miroir** et **opacité** : pour caler l'image sur
   l'origine et rendre le tracé lisible par-dessus.
6. Créer une **esquisse** sur le même plan : l'image reste visible dessous ; on y dessine les
   contours (segments, arcs, splines), on cote, puis on extrude.

L'œil de l'historique masque ou affiche l'image. L'image ne change pas la pièce : elle n'est
utilisée ni par les calculs, ni par les exports. Son fichier est enregistré dans le projet (champ
`resources`, `kind: "image"`).

## Calcul

- Redressement (`src/app/images.ts`, `src/math/homography.ts`) : homographie (transformation
  projective) qui envoie le rectangle de l'image redressée sur les 4 coins cliqués ; chaque pixel
  de l'image redressée (1 600 px de large au plus) va chercher sa couleur dans l'image d'origine
  (`src/ui/image-cache.ts`, calculé une fois par réglage et mis en cache).
- Mise à l'échelle : distance des deux points sur l'image affichée (en mm, avec la largeur
  actuelle) → nouvelle largeur = largeur × distance réelle / distance mesurée.
- Le support (plan, face) est retrouvé comme celui d'une esquisse (`resolveSupportFrame`).

## Validation

`tests/unit/homography.test.ts` (coins envoyés sur le rectangle, droites conservées, cas
dégénéré ; taille, échelle par deux points, rotation, miroir, redressement d'un rectangle A4),
`tests/unit/image-format.test.ts` (format relu à l'identique, conforme au schéma),
`tests/e2e/reference-image.spec.ts` (import d'un PNG, mise à l'échelle et redressement à la
souris, image visible pendant une esquisse sur son plan).
