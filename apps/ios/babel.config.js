module.exports = function (api) {
  api.cache(true);
  return {
    presets: [["babel-preset-expo", { jsxImportSource: "react" }]],
    // Reanimated 4 moved its Babel plugin to react-native-worklets/plugin.
    // MUST be listed last.
    plugins: ["react-native-worklets/plugin"],
  };
};
