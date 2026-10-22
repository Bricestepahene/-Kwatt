/** Version du serveur : KWATT_VERSION (posée à la construction de l'image Docker) ou « dev ». */
export const SERVER_VERSION = process.env.KWATT_VERSION?.trim() || 'dev';
