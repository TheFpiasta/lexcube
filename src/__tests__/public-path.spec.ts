import { buildClassicNotebookPublicPath } from '../nbextension-public-path';

describe('buildClassicNotebookPublicPath', () => {
  it('appends nbextension path to a trailing-slash base URL', () => {
    expect(buildClassicNotebookPublicPath('/user/test/')).toBe('/user/test/nbextensions/lexcube/');
  });

  it('normalizes a missing trailing slash in base URL', () => {
    expect(buildClassicNotebookPublicPath('/user/test')).toBe('/user/test/nbextensions/lexcube/');
  });

  it('falls back to root when base URL is missing', () => {
    expect(buildClassicNotebookPublicPath(undefined)).toBe('/nbextensions/lexcube/');
    expect(buildClassicNotebookPublicPath(null)).toBe('/nbextensions/lexcube/');
    expect(buildClassicNotebookPublicPath('')).toBe('/nbextensions/lexcube/');
  });
});
