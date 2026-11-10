// app.js
App({
  onLaunch: function () {
    if (!wx.cloud) {
      console.error('请使用 2.2.3 或以上的基础库以使用云能力')
    } else {
      // 不传 env → 自动使用开发者工具当前选中的云环境
      // 如果有 globalData.cloudEnv 就用指定的，否则用 DYNAMIC_CURRENT_ENV
      wx.cloud.init({
        env: this.globalData.cloudEnv && this.globalData.cloudEnv !== 'your-cloud-env-id'
          ? this.globalData.cloudEnv
          : wx.cloud.DYNAMIC_CURRENT_ENV,
        traceUser: true,
      })
    }

    // 恢复登录态
    try {
      const cached = wx.getStorageSync('auth_state')
      if (cached && cached.isLoggedIn) {
        this.globalData.isLoggedIn = true
        this.globalData.userInfo = cached.userInfo || null
      }
    } catch (e) {}

    // 拉取订阅消息模板 ID（云端未配置时为空，订阅提醒自动跳过）
    try {
      const api = require('./utils/api.js')
      api.getSubscribeTemplate().then(d => {
        this.globalData.subscribeTemplateId = (d && d.templateId) || ''
      }).catch(() => {})
    } catch (e) {}
  },

  /**
   * 登录：保存用户信息到本地 + 云侧注册（如首次登录）
   * @param {Object} userInfo { nickName, avatarUrl } 来自 wx.getUserProfile
   */
  async login(userInfo) {
    try {
      const api = require('./utils/api.js')
      // 云侧：获取或创建用户
      const cloudUser = await api.getUserInfo()
      // 如果用户提供了微信资料，同步到云端
      if (userInfo && cloudUser) {
        await api.updateUserInfo({
          name: userInfo.nickName,
          avatar: userInfo.avatarUrl
        })
        cloudUser.name = userInfo.nickName
        cloudUser.avatar = userInfo.avatarUrl
      }

      this.globalData.isLoggedIn = true
      // 云端存的是 name/avatar，本地用 nickName/avatarUrl，这里统一映射
      this.globalData.userInfo = {
        nickName: (userInfo && userInfo.nickName) || cloudUser.name || '',
        avatarUrl: (userInfo && userInfo.avatarUrl) || cloudUser.avatar || '',
        _id: cloudUser._id,
        isAdmin: !!cloudUser.isAdmin
      }
      this.globalData.isAdmin = !!cloudUser.isAdmin

      wx.setStorageSync('auth_state', {
        isLoggedIn: true,
        userInfo: this.globalData.userInfo
      })
      return this.globalData.userInfo
    } catch (err) {
      console.error('登录失败', err)
      throw err
    }
  },

  /**
   * 退出登录：仅清本地身份态，云端数据保留
   */
  logout() {
    this.globalData.isLoggedIn = false
    this.globalData.userInfo = null
    this.globalData.isAdmin = false
    wx.removeStorageSync('auth_state')
  },

  /**
   * 拉取壁纸配置：每个页面 onShow 调用，管理员改完后用户下次进入即生效
   */
  async loadAppearance() {
    try {
      const api = require('./utils/api.js')
      const data = await api.getAppearance()
      this.globalData.appearance = data
      try {
        wx.setStorageSync('appearance_cache', data)
      } catch (e) {}
      return data
    } catch (err) {
      if (this.globalData.appearance) return this.globalData.appearance
      try {
        return wx.getStorageSync('appearance_cache') || null
      } catch (e) {
        return null
      }
    }
  },

  globalData: {
    isLoggedIn: false,
    userInfo: null,
    // 留空则自动使用开发者工具当前选中的云环境
    // 如果有固定环境 ID，填在这里（如 'cloud1-xxxxx'）
    cloudEnv: 'cloud1-d0gc4kpkl68d2072f',
    isAdmin: false,
    appearance: null,
    subscribeTemplateId: ''
  }
})
