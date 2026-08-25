module.exports = (api) => {
  api.cache(true);
  return {
    presets: [["babel-preset-expo", { jsxImportSource: "react" }]],
    // Reanimated 3 plugin (New Arch off for iOS 26 Release stability).
    // MUST be listed last.
    plugins: ["react-native-reanimated/plugin"],
  };
};
