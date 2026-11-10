// pages/admin/admins/admins.js
const api = require('../../../utils/api.js')
const { guardAdmin } = require('../../../utils/admin-guard.js')

Page({
  data: {
    users: [],
    keyword: '',
    loading: true,
    adminCount: 0
  },

  async onLoad() {
    if (!(await guardAdmin())) return
    this.loadUsers()
  },

  async loadUsers() {
    try {
      this.setData({ loading: true })
      const users = await api.getAdminCandidates(this.data.keyword)
      const list = users.map(u => ({
        ...u,
        openidTail: (u.openid || '').slice(-6),
        initial: (u.name || '?').slice(0, 1)
      }))
      this.setData({
        users: list,
        adminCount: list.filter(u => u.isAdmin).length,
        loading: false
      })
    } catch (err) {
      this.setData({ loading: false })
      wx.showToast({ title: (err && err.message) || '加载失败', icon: 'none' })
    }
  },

  onSearchInput(e) {
    this.setData({ keyword: e.detail.value })
  },

  onSearch() {
    this.loadUsers()
  },

  clearSearch() {
    this.setData({ keyword: '' })
    this.loadUsers()
  },

  /** 禁约 / 解封 */
  banUser(e) {
    const { openid, name, banhours } = e.currentTarget.dataset
    const banned = Number(banhours) > 0
    const items = banned
      ? ['解除限制', '禁约 1 天', '禁约 3 天', '禁约 7 天']
      : ['禁约 1 天', '禁约 3 天', '禁约 7 天']
    const daysMap = banned ? [0, 1, 3, 7] : [1, 3, 7]

    wx.showActionSheet({
      itemList: items,
      success: async (res) => {
        const days = daysMap[res.tapIndex]
        wx.showLoading({ title: '处理中...' })
        try {
          await api.adminSetUserBan(openid, days)
          wx.hideLoading()
          wx.showToast({ title: days > 0 ? `已禁约 ${days} 天` : '已解除限制', icon: 'success' })
          this.loadUsers()
        } catch (err) {
          wx.hideLoading()
          wx.showToast({ title: (err && err.message) || '操作失败', icon: 'none' })
        }
      }
    })
  },

  /** 设为 / 取消管理员 */
  toggleAdmin(e) {
    const { openid, name, status } = e.currentTarget.dataset
    const makeAdmin = Number(status) === 0

    wx.showModal({
      title: makeAdmin ? '设为管理员' : '取消管理员',
      content: makeAdmin
        ? `确认将「${name}」设为管理员？对方将能进入管理后台。`
        : `确认取消「${name}」的管理员权限？`,
      confirmColor: makeAdmin ? '#4A90D9' : '#ff6b6b',
      success: async (res) => {
        if (!res.confirm) return
        wx.showLoading({ title: '处理中...' })
        try {
          await api.setAdmin(openid, makeAdmin)
          wx.hideLoading()
          wx.showToast({ title: makeAdmin ? '已设为管理员' : '已取消管理员', icon: 'success' })
          this.loadUsers()
        } catch (err) {
          wx.hideLoading()
          wx.showToast({ title: (err && err.message) || '操作失败', icon: 'none' })
        }
      }
    })
  }
})
