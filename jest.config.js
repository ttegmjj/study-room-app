// jest.config.js
module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.spec.js'],
  moduleFileExtensions: ['js', 'json'],
  // 告诉 Jest 不要试图 transform miniprogram 里的 require
  transform: {},
  // 让 miniprogram/ 路径下的 require 能被正确解析
  moduleNameMapper: {
    '^@miniprogram/(.*)$': '<rootDir>/miniprogram/$1'
  },
  setupFiles: ['<rootDir>/tests/setup.js'],
  collectCoverageFrom: [
    'miniprogram/utils/**/*.js',
    'miniprogram/app.js'
  ]
}
