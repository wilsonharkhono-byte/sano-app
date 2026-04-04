const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

// Force tslib to resolve to the root copy (pdf-lib's nested tslib@1 breaks on web)
const TSLIB_PATH = path.resolve(__dirname, 'node_modules/tslib/tslib.js');

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform === 'web' && moduleName === 'tslib') {
    return { type: 'sourceFile', filePath: TSLIB_PATH };
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
