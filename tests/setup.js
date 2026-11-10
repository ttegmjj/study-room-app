/**
 * tests/setup.js
 * 全局 Mock：模拟微信小程序运行时环境
 */

const storage = {}

// 用 jest.fn 包装的 storage 方法
const setStorageSync = jest.fn((key, value) => { storage[key] = value })
const getStorageSync = jest.fn((key) => storage[key] !== undefined ? storage[key] : '')
const removeStorageSync = jest.fn((key) => { delete storage[key] })
const clearStorageSync = jest.fn(() => { Object.keys(storage).forEach(k => delete storage[k]) })
const getStorage = jest.fn(({ key, success }) => { success && success({ data: storage[key] }) })
const setStorage = jest.fn(({ key, data, success }) => { storage[key] = data; success && success() })
const removeStorage = jest.fn(({ key, success }) => { delete storage[key]; success && success() })
const clearStorage = jest.fn(({ success }) => { Object.keys(storage).forEach(k => delete storage[k]); success && success() })

function resetStorage() {
  Object.keys(storage).forEach(k => delete storage[k])
  setStorageSync.mockClear()
  getStorageSync.mockClear()
  removeStorageSync.mockClear()
}

// ============ wx 全局对象 ============
const wx = {
  cloud: {
    callFunction: jest.fn(),
    init: jest.fn()
  },
  // storage
  setStorageSync, getStorageSync, removeStorageSync, clearStorageSync,
  getStorage, setStorage, removeStorage, clearStorage,
  // UI
  getUserProfile: jest.fn(),
  showLoading: jest.fn(),
  hideLoading: jest.fn(),
  showToast: jest.fn(),
  showModal: jest.fn(),
  switchTab: jest.fn(),
  navigateTo: jest.fn(),
  // auth
  getSetting: jest.fn(),
  login: jest.fn(),
  // 工具
  getSystemInfoSync: jest.fn(() => ({ screenWidth: 375, screenHeight: 667 }))
}

global.wx = wx

// ============ app 单例（profile 通过 getApp 拿到同一个） ============
const appInstance = {
  globalData: {
    isLoggedIn: false,
    userInfo: null,
    isAdmin: false,
    cloudEnv: 'test-env'
  },
  login: jest.fn(),
  logout: jest.fn()
}

// ============ 全局辅助 ============
global.__resetAllMocks = () => {
  // 所有 jest.fn 重置
  jest.clearAllMocks()
  resetStorage()
  // app 单例状态重置
  appInstance.globalData.isLoggedIn = false
  appInstance.globalData.userInfo = null
  appInstance.globalData.isAdmin = false
  wx.cloud.callFunction.mockReset()
  wx.cloud.init.mockReset()
}

global.__resetStorage = resetStorage
global.__appInstance = appInstance

// ============ App / Page / getApp ============
global.App = jest.fn()
global.Page = jest.fn((config) => config)
// getApp 返回同一个引用，这样 profile 页和测试都能操作同一个 appInstance
global.getApp = jest.fn(() => appInstance)
