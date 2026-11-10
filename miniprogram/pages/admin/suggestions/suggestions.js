// pages/admin/suggestions/suggestions.js
const api = require('../../../utils/api.js')
const util = require('../../../utils/util.js')
const { guardAdmin } = require('../../../utils/admin-guard.js')

Page({
  data: {
    list: [],
    loading: true,
    isAdmin: false
  },

  async onLoad() {
    if (!(await guardAdmin())) return
    this.setData({ isAdmin: true })
    this.loadList()
  },

  async loadList() {
    this.setData({ loading: true })
    try {
      const list = await api.getSuggestions()
      list.forEach(item => {
        item.createdAtStr = item.createdAt ? util.formatDateTime(item.createdAt) : ''
      })
      this.setData({ list, loading: false })
    } catch (err) {
      this.setData({ loading: false })
      wx.showToast({ title: (err && err.message) || '加载失败', icon: 'none' })
    }
  },

  async markDone(e) {
    const id = e.currentTarget.dataset.id
    try {
      await api.markSuggestionDone(id)
      wx.showToast({ title: '已标记', icon: 'success' })
      this.loadList()
    } catch (err) {
      wx.showToast({ title: (err && err.message) || '操作失败', icon: 'none' })
    }
  },

  onPullDownRefresh() {
    this.loadList().then(() => wx.stopPullDownRefresh())
  }
})
