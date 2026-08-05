// Learn more: https://docs.expo.dev/guides/customizing-metro/
const { getDefaultConfig } = require("expo/metro-config");
const path = require("node:path");

const projectRoot = __dirname;
const config = getDefaultConfig(projectRoot);

// apps/ios is INTENTIONALLY not a Bun workspace member — see root package.json.
// Metro must resolve modules ONLY from apps/ios/node_modules; if it walks up
// to the repo root it hits Bun's .bun/ symlink layout and expo-router's
// context-import path breaks (see README.md).
config.resolver.nodeModulesPaths = [path.resolve(projectRoot, "node_modules")];
config.resolver.disableHierarchicalLookup = true;
// Do NOT set watchFolders to workspaceRoot — this app is self-contained.

module.exports = config;
