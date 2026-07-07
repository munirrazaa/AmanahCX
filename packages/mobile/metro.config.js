/**
 * Metro config for the mobile app inside the monorepo.
 * The repo root has its own React (web frontend) at a different version;
 * force every import of react/react-native to THIS package's copy so the
 * bundle never ships two Reacts ("Invalid hook call" / useId of null).
 */
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '..', '..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.join(projectRoot, 'node_modules'),
  path.join(workspaceRoot, 'node_modules'),
];

const forcedModules = ['react', 'react-native', 'react-dom'];
const originalResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const forced = forcedModules.find(
    (m) => moduleName === m || moduleName.startsWith(`${m}/`),
  );
  if (forced) {
    const remapped = path.join(
      projectRoot, 'node_modules', forced,
      ...moduleName.split('/').slice(forced.split('/').length),
    );
    return context.resolveRequest(context, remapped, platform);
  }
  return originalResolveRequest
    ? originalResolveRequest(context, moduleName, platform)
    : context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
