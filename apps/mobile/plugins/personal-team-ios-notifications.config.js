const { readFileSync, writeFileSync } = require('node:fs');
const { IOSConfig, withFinalizedMod } = require('expo/config-plugins');

const withPersonalTeamIosNotifications = (config) =>
  withFinalizedMod(config, [
    'ios',
    (finalizedConfig) => {
      if (process.env.IOS_REMOTE_PUSH_ENABLED === 'true') {
        return finalizedConfig;
      }

      const entitlementsPath = IOSConfig.Entitlements.getEntitlementsPath(
        finalizedConfig.modRequest.projectRoot,
      );

      if (entitlementsPath) {
        const entitlements = readFileSync(entitlementsPath, 'utf8');
        const personalTeamEntitlements = entitlements.replace(
          /\s*<key>aps-environment<\/key>\s*<string>[^<]*<\/string>/,
          '',
        );
        writeFileSync(entitlementsPath, personalTeamEntitlements);
      }

      return finalizedConfig;
    },
  ]);

module.exports = withPersonalTeamIosNotifications;
