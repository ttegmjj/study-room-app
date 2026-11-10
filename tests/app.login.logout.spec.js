/**
 * tests/app.login.logout.spec.js
 * 覆盖范围：app.js 中的 login / logout + globalData + storage 交互
 * 这些是登录态的核心原子能力
 */

const { buildAppConfig } = require('./helpers/buildAppConfig')

beforeEach(() => {
  global.__resetAllMocks()
})

// ---------- login ----------

describe('app.login()', () => {
  let appConfig
  let mockApi

  beforeEach(() => {
    appConfig = buildAppConfig()
    mockApi = {
      getUserInfo: jest.fn().mockResolvedValue({ _id: 'u_100', isAdmin: false }),
      updateUserInfo: jest.fn().mockResolvedValue({})
    }
  })

  test('【成功】写入 globalData + storage', async () => {
    const wxUser = { nickName: '小明', avatarUrl: 'https://img/avatar.png' }
    const result = await appConfig.login(wxUser, mockApi)

    expect(appConfig.globalData.isLoggedIn).toBe(true)
    expect(appConfig.globalData.userInfo.nickName).toBe('小明')
    expect(appConfig.globalData.userInfo._id).toBe('u_100')
    expect(appConfig.globalData.userInfo.isAdmin).toBe(false)
    expect(appConfig.globalData.isAdmin).toBe(false)

    expect(wx.setStorageSync).toHaveBeenCalledWith('auth_state', {
      isLoggedIn: true,
      userInfo: expect.objectContaining({ nickName: '小明' })
    })
    expect(result).toEqual(appConfig.globalData.userInfo)
    expect(mockApi.updateUserInfo).toHaveBeenCalledWith({
      name: '小明',
      avatar: 'https://img/avatar.png'
    })
  })

  test('【成功】云端返回 isAdmin=true', async () => {
    mockApi.getUserInfo.mockResolvedValue({ _id: 'u_admin', isAdmin: true })

    await appConfig.login({ nickName: '管理员', avatarUrl: '' }, mockApi)

    expect(appConfig.globalData.isAdmin).toBe(true)
    expect(appConfig.globalData.userInfo.isAdmin).toBe(true)
  })

  test('【成功】userInfo 为空时不调用 updateUserInfo', async () => {
    mockApi.getUserInfo.mockResolvedValue({ _id: 'u_new', isAdmin: false })

    await appConfig.login(null, mockApi)

    expect(appConfig.globalData.isLoggedIn).toBe(true)
    expect(mockApi.updateUserInfo).not.toHaveBeenCalled()
  })

  test('【失败】getUserInfo 抛异常 → 向上抛出，状态不变', async () => {
    mockApi.getUserInfo.mockRejectedValue(new Error('云函数挂了'))

    await expect(
      appConfig.login({ nickName: 'X', avatarUrl: '' }, mockApi)
    ).rejects.toThrow('云函数挂了')

    expect(appConfig.globalData.isLoggedIn).toBe(false)
    expect(appConfig.globalData.userInfo).toBeNull()
    expect(wx.setStorageSync).not.toHaveBeenCalled()
  })

  test('【失败】updateUserInfo 抛异常 → 向上抛出，状态不变', async () => {
    mockApi.updateUserInfo.mockRejectedValue(new Error('update 失败'))

    await expect(
      appConfig.login({ nickName: 'X', avatarUrl: '' }, mockApi)
    ).rejects.toThrow('update 失败')

    expect(appConfig.globalData.isLoggedIn).toBe(false)
  })

  test('【幂等】两次登录以最新用户为准', async () => {
    await appConfig.login({ nickName: 'A', avatarUrl: '' }, mockApi)
    mockApi.getUserInfo.mockResolvedValue({ _id: 'u_2', isAdmin: false })
    await appConfig.login({ nickName: 'B', avatarUrl: '' }, mockApi)

    expect(appConfig.globalData.userInfo.nickName).toBe('B')
    expect(appConfig.globalData.userInfo._id).toBe('u_2')
  })
})

// ---------- logout ----------

describe('app.logout()', () => {
  let appConfig

  beforeEach(() => {
    appConfig = buildAppConfig()
    // 先建立登录态
    appConfig.globalData.isLoggedIn = true
    appConfig.globalData.userInfo = { _id: 'u_1', nickName: '小明' }
    appConfig.globalData.isAdmin = true
    wx.setStorageSync('auth_state', {
      isLoggedIn: true,
      userInfo: appConfig.globalData.userInfo
    })
  })

  test('【正常退出】清空 globalData + 移除 storage', () => {
    appConfig.logout()

    expect(appConfig.globalData.isLoggedIn).toBe(false)
    expect(appConfig.globalData.userInfo).toBeNull()
    expect(appConfig.globalData.isAdmin).toBe(false)
    expect(wx.removeStorageSync).toHaveBeenCalledWith('auth_state')
  })

  test('【幂等】未登录状态下调用不报错', () => {
    appConfig.globalData.isLoggedIn = false
    appConfig.globalData.userInfo = null
    expect(() => appConfig.logout()).not.toThrow()
  })

  test('【不触碰云端】退出不应调用任何云函数', () => {
    const callCount = wx.cloud.callFunction.mock.calls.length
    appConfig.logout()
    expect(wx.cloud.callFunction).toHaveBeenCalledTimes(callCount)
  })
})

// ---------- onLaunch 恢复 ----------

describe('app.onLaunch() 登录态恢复', () => {
  test('storage 里有 auth_state → 恢复', () => {
    const config = buildAppConfig()
    wx.getStorageSync.mockReturnValue({
      isLoggedIn: true,
      userInfo: { _id: 'u_resume', nickName: '恢复用户' }
    })

    config.onLaunch()

    expect(config.globalData.isLoggedIn).toBe(true)
    expect(config.globalData.userInfo._id).toBe('u_resume')
  })

  test('storage 为空 → 保持未登录', () => {
    const config = buildAppConfig()
    wx.getStorageSync.mockReturnValue('')

    config.onLaunch()

    expect(config.globalData.isLoggedIn).toBe(false)
    expect(config.globalData.userInfo).toBeNull()
  })

  test('storage 读取抛错 → 保持未登录不崩溃', () => {
    const config = buildAppConfig()
    wx.getStorageSync.mockImplementation(() => { throw new Error('storage 不可用') })

    expect(() => config.onLaunch()).not.toThrow()
    expect(config.globalData.isLoggedIn).toBe(false)
  })

  test('wx.cloud 不存在 → 只打错误日志不崩溃', () => {
    const originalCloud = wx.cloud
    delete wx.cloud

    const config = buildAppConfig()
    expect(() => config.onLaunch()).not.toThrow()

    wx.cloud = originalCloud
  })
})
