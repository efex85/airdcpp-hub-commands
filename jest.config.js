// Sync object
const config = {
  // airdcpp-apisocket is published as ES modules, so it has to be transformed as well
  transform: {
    '^.+\\.ts$': 'ts-jest',
    '^.+\\.js$': ['ts-jest', { tsconfig: { allowJs: true, module: 'commonjs', esModuleInterop: true } }],
  },
  transformIgnorePatterns: [
    '/node_modules/(?!airdcpp-apisocket)',
  ],
  testEnvironment: 'node',
  moduleFileExtensions: [
    'js',
    'ts',
    'json'
  ],
  moduleNameMapper: {
    '(src/.*)$': '<rootDir>/$1'
  },
  watchPathIgnorePatterns: [
    '/node_modules/',
    '/dist/'
  ],
  coverageDirectory: './coverage/',
  coveragePathIgnorePatterns: [
    '/dist/',
    '/node_modules/',
    '/src/tests/'
  ],
  collectCoverage: true,
};

module.exports = config;
