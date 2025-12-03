module.exports = {
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: [
    '**/src/**/__tests__/**/*.js',
    '**/src/**/*.test.js'
  ],
  collectCoverageFrom: [
    'src/**/*.{js,jsx}',
    '!src/**/*.test.{js,jsx}',
    '!src/**/__tests__/**',
    '!src/frontend/**',  // exclude frontend
    '!src/__mocks__/**' // exclude mocks
  ],
  coverageDirectory: 'coverage',
  transform: {
    '^.+\\.jsx?$': 'babel-jest'
  },
  moduleNameMapper: {
    '^@forge/api$': '<rootDir>/src/__mocks__/@forge/api.js',
    '^@forge/kvs$': '<rootDir>/src/__mocks__/@forge/kvs.js',
    '^@forge/bridge$': '<rootDir>/src/__mocks__/@forge/bridge.js'
  }
};