module.exports = function configureBabel(api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    // Reanimated 4 delegates worklet transformation to react-native-worklets.
    // Keep this plugin last so gesture callbacks are serialized for the UI runtime.
    plugins: ['react-native-worklets/plugin'],
  };
};
