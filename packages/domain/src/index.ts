/**
 * @kwatt/domain : calculs purs du domaine Kwatt (SPEC §7 et planches de la
 * maquette). Pas d'I/O, pas d'horloge (l'heure est un paramètre), pas de
 * hasard non reproductible. Partagé par le serveur (qui fait foi) et l'appli
 * (affichage, hors connexion).
 */
export * from './rating.js';
export * from './ranks.js';
export * from './machine.js';
export * from './stakes.js';
export * from './time.js';
export * from './quarters.js';
export * from './predictions.js';
export * from './quests.js';
export * from './league/money.js';
export * from './league/schedule.js';
export * from './league/standings.js';
export * from './league/exclusion.js';
export * from './league/ludo.js';
export * from './league/teams.js';
export * from './league/cup.js';
export * from './league/boards.js';
