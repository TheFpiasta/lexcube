module.exports = {
  automock: false,
  testEnvironment: 'jsdom',
  moduleNameMapper: {
    '\\.(css|less|sass|scss)$': 'identity-obj-proxy',
    '\\.(mp4|png|svg)$': '<rootDir>/src/__tests__/file-mock.ts',
    '\\?raw$': '<rootDir>/src/__tests__/raw-mock.ts',
  },
  setupFiles: ['<rootDir>/src/__tests__/jest-setup.ts'],
  preset: 'ts-jest/presets/js-with-babel',
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  testPathIgnorePatterns: ['/lib/', '/node_modules/'],
  testRegex: '/__tests__/.*.spec.ts[x]?$',
  transformIgnorePatterns: ['/node_modules/(?!(@jupyter(lab|-widgets)/.*)/)'],
  transform: {
    '^.+\\.[tj]sx?$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json', babelConfig: true }],
  },
};
