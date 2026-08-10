// Cross-browser entry point (T18.6, §10.31 "Architettura": one source,
// Chrome and Firefox). Firefox implements the WebExtension APIs on
// `browser` with promise support; its `chrome.*` namespace is
// callback-oriented. Chrome exposes promises on `chrome.*`. Alias once,
// use promises everywhere.
declare const browser: typeof chrome | undefined;

export const ext: typeof chrome = typeof browser === 'undefined' ? chrome : browser;
