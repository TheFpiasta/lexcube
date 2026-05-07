/*
 * Sets webpack runtime public path for the classic notebook bundle.
 *
 * - Asset modules (svg/png/mp4/glb) emit URLs as __webpack_require__.p + filename.
 * - In classic notebook, the base URL is in body[data-base-url].
 * - This module is the first nbextension entry and must run before widget imports,
 *   so emitted asset URLs resolve to: <base>/nbextensions/lexcube/<file>.
 */
declare let __webpack_public_path__: string;

export function buildClassicNotebookPublicPath(baseUrl: string | null | undefined): string {
  const normalizedBaseUrl = baseUrl && baseUrl.length > 0
    ? (baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`)
    : '/';

  return `${normalizedBaseUrl}nbextensions/lexcube/`;
}

if (typeof document !== 'undefined' && typeof __webpack_public_path__ !== 'undefined') {
  const notebookBaseUrl = document.querySelector('body')?.getAttribute('data-base-url');
  __webpack_public_path__ = buildClassicNotebookPublicPath(notebookBaseUrl);
}
