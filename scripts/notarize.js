const { notarize } = require("@electron/notarize");

exports.default = async function notarizing(context) {
  if (context.electronPlatformName !== "darwin") {
    return;
  }
  await notarize({
    appBundleId: "dev.dispatch.app",
    appPath: context.appOutDir + "/" + context.packager.appInfo.productFilename + ".app",
    appleId: process.env.APPLE_ID,
    appleIdPassword: process.env.APPLE_APP_SPECIFIC_PASSWORD,
    teamId: process.env.APPLE_TEAM_ID,
  });
};
