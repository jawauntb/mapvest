// Learn more: https://docs.expo.dev/guides/customizing-metro/
// apps/ios is INTENTIONALLY not a Bun workspace member — see root package.json.
// This file used to sandbox Metro to apps/ios/node_modules AND disable
// hierarchical lookup, which broke expo-router's require.context transform
// ("ENOENT: no such file or directory, open '.../app?ctx=<hash>'").
// With apps/ios reinstalled cleanly (real dirs, no .bun symlinks), Expo's
// default Metro config already resolves correctly, so we just re-export it.
const { getDefaultConfig } = require("expo/metro-config");
module.exports = getDefaultConfig(__dirname);
