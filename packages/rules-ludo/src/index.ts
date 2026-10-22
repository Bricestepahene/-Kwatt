/**
 * Règles du Ludo, sans I/O et sans hasard : le lancer est fourni de l'extérieur
 * (tirage vérifiable du serveur). Même état + mêmes lancers = même partie.
 *
 * Deux couches, comme la planche « Réf · Variantes du Ludo » :
 * - la forme du plateau : croix (4 maisons, 52 cases), étoile à 6 branches
 *   (78 cases), croix du Parchís (68 cases), croix traditionnelle du Pachisi ;
 * - les mécanismes : sortie, capture, cases protégées, barrières, lancer
 *   (dé ou 6 cauris), victoire, équipes.
 * Chaque variante est un préréglage des deux ; les règles maison en changent
 * quatre dans les limites de la planche (`validateSetup`).
 *
 * Parcours : chaque maison a sa progression, de 0 (départ) à `finish(config)`
 * (arrivée au centre, au chiffre exact). Croix : 13 cases de piste par maison,
 * couloir de 5 ; Parchís : 64 cases de piste, couloir de 7 ; Pachisi :
 * descente privée de 7 cases, 68 cases de piste, remontée de 7.
 *
 * Géométrie (coordonnées de chaque case pour le dessin) : `boardGeometry`.
 */
export * from './errors.js';
export * from './variants.js';
export * from './engine.js';
export * from './geometry.js';
