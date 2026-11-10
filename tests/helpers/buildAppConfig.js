/**
 * tests/helpers/buildAppConfig.js
 * 独立于小程序构建环境的纯净 appConfig
 * login 接受 api 作为依赖注入，便于测试时自由 mock
 */
function buildAppConfig() {
  const config = {
    globalData: {
      isLoggedIn: false,
      userInfo: null,
      cloudEnv: 'your-cloud-env-id',
      isAdmin: false
    },

    onLaunch() {
      if (!global.wx.cloud) {
        console.error('请使用 2.2.3 或以上的基础库以使用云能力')
      } else {
        global.wx.cloud.init({
          env: this.globalData.cloudEnv,
          traceUser: true,
        })
      }

      try {
        const cached = global.wx.getStorageSync('auth_state')
        if (cached && cached.isLoggedIn) {
          this.globalData.isLoggedIn = true
          this.globalData.userInfo = cached.userInfo || null
        }
      } catch (e) {}
    },

    /**
     * @param {Object} userInfo { nickName, avatarUrl }
     * @param {Object} api 依赖注入的 api 模块（测试时 mock 此参数）
     */
    async login(userInfo, api) {
      api = api || {
        getUserInfo: () => Promise.resolve({ _id: 'test_id', isAdmin: false }),
        updateUserInfo: () => Promise.resolve({})
      }

      try {
        const cloudUser = await api.getUserInfo()
        if (userInfo && cloudUser) {
          await api.updateUserInfo({
            name: userInfo.nickName,
            avatar: userInfo.avatarUrl
          })
        }

        this.globalData.isLoggedIn = true
        this.globalData.userInfo = { ...userInfo, _id: cloudUser._id, isAdmin: cloudUser.isAdmin }
        this.globalData.isAdmin = !!cloudUser.isAdmin

        global.wx.setStorageSync('auth_state', {
          isLoggedIn: true,
          userInfo: this.globalData.userInfo
        })
        return this.globalData.userInfo
      } catch (err) {
        console.error('登录失败', err)
        throw err
      }
    },

    logout() {
      this.globalData.isLoggedIn = false
      this.globalData.userInfo = null
      this.globalData.isAdmin = false
      global.wx.removeStorageSync('auth_state')
    }
  }

  return config
}

module.exports = { buildAppConfig }
