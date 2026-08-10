// Manifest transforms shared by build.mjs and the unit tests (T18.6):
// ONE source tree, per-browser manifests.

/**
 * Firefox variant of the Chrome MV3 manifest: an event page instead of a
 * service worker (Firefox MV3 does not run extension service workers),
 * and the add-on id AMO requires for MV3.
 */
export function firefoxManifest(chromeManifest) {
  const manifest = structuredClone(chromeManifest);
  manifest.background = { scripts: ['background.js'] };
  manifest.browser_specific_settings = {
    gecko: { id: 'save-as-wdf@wdf.dev', strict_min_version: '128.0' },
  };
  return manifest;
}
