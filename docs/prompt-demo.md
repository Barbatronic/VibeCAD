Avec le MCP vibecad, conçois une tour Eiffel « dentelle » à découper au laser dans du
contreplaqué de 3 mm, sur 2 planches de 300 × 300 mm. Chaque profil est posé sur la
DIAGONALE de sa planche (environ 424 mm), pour obtenir la tour la plus haute possible :
vise environ 32 cm en gardant les proportions de la vraie tour.

Principe de montage (aucune colle) :
- 2 profils plats de même silhouette, qui s'emboîtent en croix à 90° par des fentes
  à mi-bois : le profil A a une fente ouverte vers le haut, le profil B une fente ouverte
  vers le bas, depuis l'arche. Les fentes font 3,1 mm de large et se rejoignent à mi-hauteur.
- Les profils sont dans les diagonales du plan carré, pour que les 4 pieds tombent aux coins.
- 3 plateaux carrés (1er étage, 2e étage, sommet), percés de 2 fentes en X le long de leurs
  diagonales. Ils s'enfilent par le haut et reposent sur un petit épaulement (2,5 mm de
  saillie) taillé dans le bord des profils, juste sous chaque étage. Ils débordent de 4 mm
  au-delà des faces de la tour.
- Le profil B porte la flèche ; le profil A s'arrête là où il devient trop étroit pour être fendu.

Forme : silhouette évasée façon vraie tour Eiffel (largeur qui décroît de façon exponentielle
avec la hauteur, pieds bien écartés, largeur au sol d'environ 0,57 × la hauteur), grande
arche entre les pieds, étages aux proportions réelles (1er vers 19 % de la hauteur, 2e vers
38 %, 3e vers 86 %), flèche avec une petite boule.
Calcule la taille maximale : sur la diagonale, la largeur disponible croît depuis chaque coin.
Place la pointe de la flèche près d'un coin et le pied vers l'autre bout. Chaque profil doit
tenir dans la planche avec 3 mm de marge partout. Donne-moi la hauteur obtenue.

Dentelle : ajoure les profils avec un treillis façon poutres métalliques. Croisillons en X
dans les pieds et le corps, sur deux colonnes quand c'est assez large ; petits losanges plus
haut, là où c'est étroit. Garde un montant plein de 3 mm le long des bords, une bande pleine
autour de la fente centrale, et des bandes pleines aux étages. Les ponts de bois font au moins
2,2 mm et aucun trou ne fait moins de 2 mm. Ajoure aussi les plateaux (triangles avec une
croisée entre les fentes). Chaque pièce doit rester d'un seul morceau.

Démarche attendue (montre ce que sait faire le MCP) :
1. Ouvre un nouveau projet « Tour Eiffel dentelle 2 planches » (new_project, sans forcer).
2. Mets les dimensions clés en paramètres du projet : hauteur, demi-largeur au sol,
   épaisseur, largeur de fente, hauteurs des étages.
3. Construis chaque pièce par un seul batch (une action annulable chacune), montée en 3D :
   profils croisés à ±45°, plateaux à leur hauteur. Vérifie à chaque fois que le profil de
   l'esquisse est valide et que le volume est cohérent.
4. Fais des captures en vue de face et en iso pour vérifier l'assemblage.
5. Découpe laser : matériau contreplaqué 3 mm, plaque 300 × 300, 2 plaques. Un profil par
   plaque, posé sur la diagonale (angle de 45°), et les plateaux dans les coins libres.
   N'utilise pas l'optimisation automatique : elle peut figer l'onglet plusieurs minutes sur
   des pièces aussi ajourées. Vérifie avec get_laser_layout qu'aucune pièce ne dépasse ni ne
   chevauche (cet outil ne le signale pas encore : contrôle les bbox toi-même).
6. Exporte le SVG de découpe et donne-moi son chemin, avec un résumé : hauteur de la tour,
   nombre de trous par pièce, plaques utilisées, ordre de montage.

Pose-moi une question seulement si un choix m'appartient vraiment.
