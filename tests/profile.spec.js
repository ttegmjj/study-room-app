/**
 * tests/profile.spec.js
 * 覆盖范围：profile 页面中的 syncAuthState / doLogin / doLogout
 */

beforeEach(() => {
  global.__resetAllMocks()
})

/**
 * 用 setup 里的 appInstance 单例构造一个 page 实例
 * 这样 page.doLogin() 内部调用 global.getApp() 拿到的就是同一个 app
 */
function buildPage({ app } = {}) {
  const realApp = app || global.__appInstance
  const api = {
    getUserInfo: jest.fn().mockResolvedValue({ _id: 'u_p', isAdmin: false }),
    updateUserInfo: jest.fn().mockResolvedValue({}),
    getMyBookings: jest.fn().mockResolvedValue([])
  }

  const page = {
    data: {
      isLoggedIn: false,
      userInfo: null,
      isAdmin: false,
      bookingCount: 0,
      loading: true
    },

    syncAuthState() {
      const state = global.wx.getStorageSync('auth_state') || {}
      this.setData({
        isLoggedIn: !!(state.isLoggedIn || realApp.globalData.isLoggedIn),
        userInfo: realApp.globalData.userInfo || state.userInfo || null,
        isAdmin: !!realApp.globalData.isAdmin
      })
    },

    doLogin() {
      global.wx.getUserProfile({
        desc: '用于完善个人资料',
        success: async (res) => {
          global.wx.showLoading({ title: '登录中...' })
          try {
            await realApp.login(res.userInfo, api)
            global.wx.hideLoading()
            global.wx.showToast({ title: '登录成功', icon: 'success' })
            this.syncAuthState()
            this.loadBookingCount()
          } catch (err) {
            global.wx.hideLoading()
            global.wx.showToast({ title: '登录失败，请重试', icon: 'none' })
          }
        },
        fail: () => {
          global.wx.showToast({ title: '已取消授权', icon: 'none' })
        }
      })
    },

    doLogout() {
      global.wx.showModal({
        title: '退出登录',
        content: '确定要退出登录吗？\n（预约记录会保留在云端）',
        confirmColor: '#ff6b6b',
        success: (res) => {
          if (res.confirm) {
            realApp.logout()
            this.syncAuthState()
            global.wx.showToast({ title: '已退出登录', icon: 'success' })
          }
        }
      })
    },

    async loadBookingCount() {
      try {
        const all = await api.getMyBookings()
        const today = new Date().toISOString().split('T')[0]
        const count = all.filter(b => b.date === today).length
        this.setData({ bookingCount: count })
      } catch {}
    },

    goToMyBookings() {
      if (!this.data.isLoggedIn) {
        global.wx.showToast({ title: '请先登录', icon: 'none' })
        return
      }
      global.wx.switchTab({ url: '/pages/my-bookings/my-bookings' })
    },

    goToAdmin() {
      if (!this.data.isLoggedIn) {
        global.wx.showToast({ title: '请先登录', icon: 'none' })
        return
      }
      if (!this.data.isAdmin) {
        global.wx.showToast({ title: '无权限', icon: 'none' })
        return
      }
      global.wx.navigateTo({ url: '/pages/admin/admin' })
    },

    setData(patch) {
      this.data = { ...this.data, ...patch }
    }
  }

  return { page, api, app: realApp }
}

// 等待微任务队列清空（确保 async 回调已执行）
function wait() {
  return new Promise(resolve => setImmediate(resolve))
}

// ================= syncAuthState =================

describe('profile.syncAuthState()', () => {
  test('【优先级】globalData 优先于 storage', () => {
    const { app, page } = buildPage()
    app.globalData.isLoggedIn = true
    app.globalData.userInfo = { nickName: 'A', _id: 'a' }
    app.globalData.isAdmin = true
    global.wx.getStorageSync.mockReturnValue({
      isLoggedIn: false,
      userInfo: { nickName: 'B' }
    })

    page.syncAuthState()

    expect(page.data.isLoggedIn).toBe(true)
    expect(page.data.userInfo.nickName).toBe('A')
    expect(page.data.isAdmin).toBe(true)
  })

  test('【回退】globalData 未登录但 storage 有 → 视为已登录', () => {
    const { app, page } = buildPage()
    app.globalData.isLoggedIn = false
    global.wx.getStorageSync.mockReturnValue({
      isLoggedIn: true,
      userInfo: { nickName: '持久用户', _id: 'persist' }
    })

    page.syncAuthState()

    expect(page.data.isLoggedIn).toBe(true)
    expect(page.data.userInfo.nickName).toBe('持久用户')
  })

  test('【空态】两者都为空 → 未登录', () => {
    const { app, page } = buildPage()
    app.globalData.isLoggedIn = false
    global.wx.getStorageSync.mockReturnValue('')

    page.syncAuthState()

    expect(page.data.isLoggedIn).toBe(false)
    expect(page.data.userInfo).toBeNull()
  })
})

// ================= doLogin =================

describe('profile.doLogin()', () => {
  test('【成功链路】授权 → showLoading → app.login → hideLoading → toast → sync', async () => {
    const { page, app } = buildPage()
    // 让 app.login 真做些事（更新 globalData）
    app.login.mockImplementation(async (userInfo) => {
      app.globalData.isLoggedIn = true
      app.globalData.userInfo = { ...userInfo, _id: 'u_now' }
      app.globalData.isAdmin = false
      global.wx.setStorageSync('auth_state', { isLoggedIn: true, userInfo: app.globalData.userInfo })
      return app.globalData.userInfo
    })

    // 触发 doLogin 里的授权回调
    let authSuccess
    global.wx.getUserProfile.mockImplementation(({ success }) => { authSuccess = success })
    page.doLogin()
    authSuccess({ userInfo: { nickName: '小明', avatarUrl: 'http://a.png' } })

    await wait()

    // UI 时序
    expect(global.wx.showLoading).toHaveBeenCalledWith({ title: '登录中...' })
    expect(global.wx.hideLoading).toHaveBeenCalled()
    expect(global.wx.showToast).toHaveBeenCalledWith({ title: '登录成功', icon: 'success' })

    // page 状态同步
    expect(page.data.isLoggedIn).toBe(true)
    expect(page.data.userInfo.nickName).toBe('小明')
  })

  test('【取消授权】getUserProfile.fail → 取消 toast', () => {
    const { page } = buildPage()
    let authFail
    global.wx.getUserProfile.mockImplementation(({ fail }) => { authFail = fail })

    page.doLogin()
    authFail()

    expect(global.wx.showToast).toHaveBeenCalledWith({ title: '已取消授权', icon: 'none' })
  })

  test('【登录失败】app.login 抛错 → hideLoading + 错误 toast', async () => {
    const { page, app } = buildPage()
    app.login.mockRejectedValue(new Error('云端炸了'))

    let authSuccess
    global.wx.getUserProfile.mockImplementation(({ success }) => { authSuccess = success })
    page.doLogin()
    authSuccess({ userInfo: { nickName: 'X', avatarUrl: '' } })

    await wait()

    expect(global.wx.hideLoading).toHaveBeenCalled()
    expect(global.wx.showToast).toHaveBeenCalledWith({ title: '登录失败，请重试', icon: 'none' })
  })
})

// ================= doLogout =================

describe('profile.doLogout()', () => {
  let page, app

  beforeEach(() => {
    const built = buildPage()
    page = built.page
    app = built.app
    // 建立登录态
    app.globalData.isLoggedIn = true
    app.globalData.userInfo = { _id: 'u_1', nickName: '小明' }
    app.globalData.isAdmin = false
    app.logout.mockImplementation(() => {
      app.globalData.isLoggedIn = false
      app.globalData.userInfo = null
      app.globalData.isAdmin = false
      global.wx.removeStorageSync('auth_state')
    })
    global.wx.setStorageSync('auth_state', { isLoggedIn: true, userInfo: app.globalData.userInfo })
    page.syncAuthState()
  })

  test('【确认退出】confirm=true → logout + toast + sync', () => {
    let modalSuccess
    global.wx.showModal.mockImplementation(({ success }) => { modalSuccess = success })

    expect(page.data.isLoggedIn).toBe(true)

    page.doLogout()
    modalSuccess({ confirm: true, cancel: false })

    expect(app.logout).toHaveBeenCalled()
    expect(global.wx.showToast).toHaveBeenCalledWith({ title: '已退出登录', icon: 'success' })
    expect(page.data.isLoggedIn).toBe(false)
    expect(page.data.userInfo).toBeNull()
  })

  test('【取消退出】confirm=false → 什么都不做', () => {
    let modalSuccess
    global.wx.showModal.mockImplementation(({ success }) => { modalSuccess = success })

    page.doLogout()
    modalSuccess({ confirm: false, cancel: true })

    expect(app.logout).not.toHaveBeenCalled()
    expect(page.data.isLoggedIn).toBe(true)
    expect(global.wx.showToast).not.toHaveBeenCalled()
  })
})

// ================= 登录守卫 =================

describe('profile 菜单登录守卫', () => {
  test('未登录点「我的预约」→ toast 提示并拦截', () => {
    const { page } = buildPage()
    page.data.isLoggedIn = false

    page.goToMyBookings()

    expect(global.wx.showToast).toHaveBeenCalledWith({ title: '请先登录', icon: 'none' })
    expect(global.wx.switchTab).not.toHaveBeenCalled()
  })

  test('已登录点「我的预约」→ 正常跳转', () => {
    const { page } = buildPage()
    page.data.isLoggedIn = true

    page.goToMyBookings()

    expect(global.wx.switchTab).toHaveBeenCalledWith({ url: '/pages/my-bookings/my-bookings' })
  })

  test('未登录点「管理后台」→ 拦截', () => {
    const { page } = buildPage()
    page.data.isLoggedIn = false

    page.goToAdmin()

    expect(global.wx.showToast).toHaveBeenCalledWith({ title: '请先登录', icon: 'none' })
    expect(global.wx.navigateTo).not.toHaveBeenCalled()
  })

  test('已登录非管理员点「管理后台」→ 无权限 toast', () => {
    const { page } = buildPage()
    page.data.isLoggedIn = true
    page.data.isAdmin = false

    page.goToAdmin()

    expect(global.wx.showToast).toHaveBeenCalledWith({ title: '无权限', icon: 'none' })
    expect(global.wx.navigateTo).not.toHaveBeenCalled()
  })

  test('管理员点「管理后台」→ 正常跳转', () => {
    const { page } = buildPage()
    page.data.isLoggedIn = true
    page.data.isAdmin = true

    page.goToAdmin()

    expect(global.wx.navigateTo).toHaveBeenCalledWith({ url: '/pages/admin/admin' })
  })
})
