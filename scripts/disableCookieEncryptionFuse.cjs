// Disable the EnableCookieEncryption fuse on the local electron binary.
// This prevents the macOS Keychain password prompt during development.
// Run via: node scripts/disableCookieEncryptionFuse.cjs
// See: https://github.com/electron/electron/issues/43233

const { flipFuses, FuseVersion, FuseV1Options } = require('@electron/fuses');

async function main() {
  const electronPath = require('electron');
  console.log(`Flipping EnableCookieEncryption fuse on: ${electronPath}`);
  await flipFuses(electronPath, {
    version: FuseVersion.V1,
    resetAdHocDarwinSignature: process.platform === 'darwin',
    [FuseV1Options.EnableCookieEncryption]: false,
  });
  console.log('Done. Cookie encryption fuse disabled for development.');
}

main().catch((error) => {
  // Electron binary may not be present in CI — fail gracefully
  console.error('Failed to flip fuses (ignoring):', error.message);
  process.exit(0);
});
