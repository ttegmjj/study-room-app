// pages/admin/admin.js
const api = require('../../utils/api.js')

Page({
  data: {
    isAdmin: false,
    stats: null,
    loading: true
  },

  onLoad() {
    // 先用缓存的权限状态渲染，避免每次进入都等云函数返回
    const cached = !!getApp().globalData.isAdmin
    this.setData({ isAdmin: cached, loading: !cached })
  },

  onShow() {
    if (this.data.isAdmin) {
      // 已是管理员：只刷新统计，不再校验权限（避免页面闪烁/空白）
      this.loadStats()
      return
    }
    this.verifyAdmin()
  },

  verifyAdmin() {
    api.checkIsAdmin().then(isAdmin => {
      getApp().globalData.isAdmin = isAdmin
      this.setData({ isAdmin, loading: false })
      if (isAdmin) this.loadStats()
    }).catch(() => {
      // 校验失败时保留当前状态，不要直接判定为无权限
      this.setData({ loading: false })
    })
  },

  async loadStats() {
    try {
      const stats = await api.getStats()
      this.setData({ stats })
    } catch (e) {}
  },

  /** 自助初始化管理员：仅当系统没有任何有效管理员时云端才会放行；配置了初始化口令则需输入口令 */
  bootstrapAdmin() {
    wx.showModal({
      title: '初始化管理员',
      editable: true,
      placeholderText: '请输入初始化口令（未设置可留空）',
      success: async (res) => {
        if (!res.confirm) return
        const code = (res.content || '').trim()
        wx.showLoading({ title: '初始化中...' })
        try {
          await api.bootstrapAdmin(code)
          wx.hideLoading()
          wx.showToast({ title: '已设为管理员', icon: 'success' })
          getApp().globalData.isAdmin = true
          this.setData({ isAdmin: true })
          this.loadStats()
        } catch (err) {
          wx.hideLoading()
          wx.showToast({ title: (err && err.message) || '初始化失败', icon: 'none' })
        }
      }
    })
  },

  goTo(e) {
    const { url } = e.currentTarget.dataset
    wx.navigateTo({ url })
  }
})
