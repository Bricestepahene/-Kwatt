// Configuration de Metro pour le monorepo pnpm.
// Depuis le SDK 52, Expo règle seul watchFolders et nodeModulesPaths pour les monorepos.
// On ajoute une seule chose : les paquets @kwatt/* sont lus depuis leurs sources TypeScript
// (packages/<nom>/src), pour ne pas dépendre d'un `tsc -b` préalable pendant le développement.
const fs = require('node:fs');
const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');
const packagesRoot = path.join(workspaceRoot, 'packages');

const config = getDefaultConfig(projectRoot);

/** `@kwatt/design` → packages/design/src/index.ts, si ce dossier existe. */
function kwattEntry(moduleName) {
  const match = /^@kwatt\/([a-z0-9-]+)$/.exec(moduleName);
  if (!match) return null;
  const entry = path.join(packagesRoot, match[1], 'src', 'index.ts');
  return fs.existsSync(entry) ? entry : null;
}

const defaultResolve = config.resolver.resolveRequest;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  const entry = kwattEntry(moduleName);
  if (entry) return { type: 'sourceFile', filePath: entry };

  // Les sources des paquets sont en modules ES « NodeNext » : leurs imports relatifs
  // finissent par « .js » alors que le fichier réel est en « .ts ».
  if (
    moduleName.startsWith('.') &&
    moduleName.endsWith('.js') &&
    context.originModulePath.startsWith(packagesRoot + path.sep)
  ) {
    const candidate = path.resolve(path.dirname(context.originModulePath), moduleName.replace(/\.js$/, '.ts'));
    if (fs.existsSync(candidate)) return { type: 'sourceFile', filePath: candidate };
  }

  const resolve = defaultResolve ?? context.resolveRequest;
  return resolve(context, moduleName, platform);
};

// Les sons synthétisés sont des .wav (déjà connus de Metro) ; on garde la liste par défaut.
module.exports = config;
