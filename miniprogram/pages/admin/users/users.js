// pages/admin/users/users.js
const api = require('../../../utils/api.js')

Page({
  data: {
    users: [],
    loading: true,
    filterMode: 'all', // all | noshow | banned
    filterThreshold: 1, // 连续爽约 >= N
  },

  onLoad() {
    this.loadUsers()
  },

  async loadUsers() {
    this.setData({ loading: true })
    try {
      let threshold = 0
      if (this.data.filterMode === 'noshow') threshold = this.data.filterThreshold
      if (this.data.filterMode === 'banned') threshold = 1 // 只要被禁约过就行
      const users = await api.adminListUsers(threshold)
      this.setData({ users: users || [], loading: false })
    } catch (err) {
      this.setData({ loading: false })
      wx.showToast({ title: (err && err.message) || '加载失败', icon: 'none' })
    }
  },

  setFilter(e) {
    const mode = e.currentTarget.dataset.mode
    this.setData({ filterMode: mode }, () => this.loadUsers())
  },

  refresh() {
    this.loadUsers()
  },

  /** 解封用户（快捷操作，一键解除禁约） */
  async unbanUser(e) {
    const { openid, name } = e.currentTarget.dataset
    wx.showModal({
      title: '立即解封',
      content: `确定解除用户「${name || ''}」的预约限制？`,
      success: async (res) => {
        if (!res.confirm) return
        try {
          const r = await api.adminSetUserBan(openid, 0)
          wx.showToast({ title: r.message || '已解封', icon: 'success' })
          this.loadUsers()
        } catch (err) {
          wx.showToast({ title: err.message || '操作失败', icon: 'none' })
        }
      }
    })
  },

  /** 管理员手动禁约用户 */
  banUser(e) {
    const { openid, name, hours } = e.currentTarget.dataset
    wx.showModal({
      title: '禁约用户',
      editable: true,
      placeholderText: '输入禁约天数（0 表示解封）',
      content: String(hours > 0 ? Math.ceil(hours / 24) : 1),
      success: async (res) => {
        if (!res.confirm) return
        const days = Number(res.content)
        if (isNaN(days) || days < 0) {
          wx.showToast({ title: '请输入有效天数', icon: 'none' })
          return
        }
        try {
          const r = await api.adminSetUserBan(openid, days)
          wx.showToast({ title: r.message || '操作成功', icon: 'success' })
          this.loadUsers()
        } catch (err) {
          wx.showToast({ title: err.message || '操作失败', icon: 'none' })
        }
      }
    })
  },

  /** 管理员删除用户 */
  deleteUser(e) {
    const { openid, name } = e.currentTarget.dataset
    wx.showModal({
      title: '⚠️ 删除用户',
      content: `确定删除用户「${name || ''}」？\n\n该用户所有预约记录将一并删除，此操作不可恢复！`,
      confirmColor: '#ff6b6b',
      success: async (res) => {
        if (!res.confirm) return
        try {
          const r = await api.adminDeleteUser(openid)
          wx.showToast({ title: r.message || '已删除', icon: 'success' })
          this.loadUsers()
        } catch (err) {
          wx.showToast({ title: err.message || '删除失败', icon: 'none' })
        }
      }
    })
  }
})
