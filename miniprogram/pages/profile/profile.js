// pages/profile/profile.js
const app = getApp()
const api = require('../../utils/api.js')
const appearance = require('../../utils/appearance.js')

Page({
  data: {
    isLoggedIn: false,
    userInfo: null,
    isAdmin: false,
    myStats: { totalHours: 0, checkinDays: 0, weekCount: 0 },
    loading: true,
    wallpaper: null,

    // t2: 常用座位（收藏）
    favoriteSeats: []
  },

  loadWallpaper() {
    return app.loadAppearance().then(data => {
      this.setData({ wallpaper: appearance.resolve(data) })
    })
  },

  onShow() {
    this.syncAuthState()
    this.loadWallpaper()
    if (app.globalData.isLoggedIn) {
      this.loadMyStats()
      this.loadFavoriteSeats()
      // 本地没有昵称时（换设备/清缓存后），从云端拉取已设置的资料
      if (!this.data.userInfo || !this.data.userInfo.nickName) {
        this.syncProfileFromCloud()
      }
    } else {
      this.setData({ myStats: { totalHours: 0, checkinDays: 0, weekCount: 0 }, favoriteSeats: [] })
    }
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 1 })
    }
  },

  /** 从 globalData + storage 同步登录态 */
  syncAuthState() {
    const state = wx.getStorageSync('auth_state') || {}
    this.setData({
      isLoggedIn: !!(state.isLoggedIn || app.globalData.isLoggedIn),
      userInfo: app.globalData.userInfo || state.userInfo || null,
      isAdmin: !!app.globalData.isAdmin
    })
  },

  /** 从云端拉取已保存的昵称/头像（换设备或清缓存后恢复） */
  async syncProfileFromCloud() {
    try {
      const u = await api.getUserInfo()
      if (!u) return
      const base = app.globalData.userInfo || {}
      app.globalData.userInfo = {
        ...base,
        nickName: base.nickName || u.name || '',
        avatarUrl: base.avatarUrl || u.avatar || '',
        _id: u._id,
        isAdmin: !!u.isAdmin
      }
      app.globalData.isAdmin = !!u.isAdmin
      wx.setStorageSync('auth_state', { isLoggedIn: true, userInfo: app.globalData.userInfo })
      this.setData({ userInfo: app.globalData.userInfo, isAdmin: !!u.isAdmin })
    } catch (e) {}
  },

  /** ========= 登录相关（云开发静默登录，废弃 wx.getUserProfile） ========= */

  doLogin() {
    wx.showLoading({ title: '登录中...', mask: true })
    app.login(null).then(() => {
      wx.hideLoading()
      wx.showToast({ title: '登录成功', icon: 'success' })
      this.syncAuthState()
      this.loadMyStats()
    }).catch(err => {
      wx.hideLoading()
      // 显示真实错误（方便真机调试）
      const msg = (err && (err.message || err.errMsg)) || '登录失败，请重试'
      wx.showModal({
        title: '登录失败',
        content: msg,
        showCancel: false
      })
      console.error('[登录失败]', err)
    })
  },

  doLogout() {
    wx.showModal({
      title: '退出登录',
      content: '确定要退出登录吗？\n（预约记录会保留在云端）',
      confirmColor: '#ff6b6b',
      success: (res) => {
        if (res.confirm) {
          app.logout()
          this.syncAuthState()
          wx.showToast({ title: '已退出登录', icon: 'success' })
        }
      }
    })
  },

  /** ========= 个人资料（列表样式编辑页） ========= */

  goToEditProfile() {
    if (!this.data.isLoggedIn) {
      wx.showToast({ title: '请先登录', icon: 'none' })
      return
    }
    wx.navigateTo({ url: '/pages/profile/edit/edit' })
  },

  /** ========= 业务功能 ========= */

  async loadMyStats() {
    try {
      const stats = await api.getMyStats()
      this.setData({ myStats: stats })
    } catch (e) {}
  },

  goToMyBookings() {
    if (!this.data.isLoggedIn) {
      wx.showToast({ title: '请先登录', icon: 'none' })
      return
    }
    wx.navigateTo({ url: '/pages/my-bookings/my-bookings' })
  },

  goToAdmin() {
    if (!this.data.isLoggedIn) {
      wx.showToast({ title: '请先登录', icon: 'none' })
      return
    }
    // 直接跳转：非管理员会在管理页看到锁屏提示（含自助初始化入口）
    wx.navigateTo({ url: '/pages/admin/admin' })
  },

  goToAIDemo() {
    wx.navigateTo({ url: '/pages/ai-demo/ai-demo' })
  },

  goToSuggestion() {
    wx.navigateTo({ url: '/pages/suggestion/suggestion' })
  },

  showContact() {
    wx.showModal({
      title: '联系管理员',
      content: '如有问题，请联系：admin@example.com',
      showCancel: false
    })
  },

  showAbout() {
    wx.showModal({
      title: '关于',
      content: '自习室预约小程序 v1.0\n\n基于微信云开发构建',
      showCancel: false
    })
  },

  clearCache() {
    wx.showModal({
      title: '清除缓存',
      content: '将清除本地缓存和登录状态，确定吗？',
      success: (res) => {
        if (res.confirm) {
          const auth = wx.getStorageSync('auth_state')
          wx.clearStorage()
          if (auth) wx.setStorageSync('auth_state', auth)
          wx.showToast({ title: '已清除', icon: 'success' })
        }
      }
    })
  },

  // ========== t2: 常用座位（收藏） ==========
  async loadFavoriteSeats() {
    try {
      const list = await api.getFavoriteSeats()
      this.setData({ favoriteSeats: list || [] })
    } catch (e) {}
  },

  goToFavoriteBooking(e) {
    const { roomid, roomname, seatid, seatcode } = e.currentTarget.dataset
    wx.navigateTo({
      url: `/pages/booking/booking?roomId=${roomid}&roomName=${encodeURIComponent(roomname || '')}&autoSeatId=${seatid}&autoSeatCode=${seatcode}`
    })
  },

  async removeFavoriteSeat(e) {
    const { roomid, seatid } = e.currentTarget.dataset
    wx.showModal({
      title: '取消收藏',
      content: '确定从常用座位中移除？',
      success: async (res) => {
        if (res.confirm) {
          try {
            await api.removeFavoriteSeat(roomid, seatid)
            this.loadFavoriteSeats()
          } catch (err) {
            wx.showToast({ title: err.message || '操作失败', icon: 'none' })
          }
        }
      }
    })
  },
})
