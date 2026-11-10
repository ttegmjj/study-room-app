// pages/admin/notice/notice.js
const api = require('../../../utils/api.js')
const { guardAdmin } = require('../../../utils/admin-guard.js')

Page({
  data: {
    loading: true,
    enabled: false,
    title: '',
    content: '',
    saving: false
  },

  async onLoad() {
    if (!(await guardAdmin())) return
    api.getNotice().then(d => {
      this.setData({
        loading: false,
        enabled: !!d.enabled,
        title: d.title || '',
        content: d.content || ''
      })
    }).catch(err => {
      this.setData({ loading: false })
      wx.showToast({ title: err.message || '加载失败', icon: 'none' })
    })
  },

  onTitleInput(e) {
    this.setData({ title: e.detail.value })
  },

  onContentInput(e) {
    this.setData({ content: e.detail.value })
  },

  onToggle(e) {
    this.setData({ enabled: e.detail.value })
  },

  save() {
    if (this.data.saving) return
    const content = (this.data.content || '').trim()
    if (this.data.enabled && !content) {
      wx.showToast({ title: '启用公告时内容不能为空', icon: 'none' })
      return
    }

    this.setData({ saving: true })
    wx.showLoading({ title: '保存中...', mask: true })
    api.setNotice({
      enabled: this.data.enabled,
      title: (this.data.title || '').trim(),
      content
    }).then(() => {
      wx.hideLoading()
      this.setData({ saving: false })
      wx.showToast({ title: '已保存', icon: 'success' })
    }).catch(err => {
      wx.hideLoading()
      this.setData({ saving: false })
      wx.showModal({
        title: '保存失败',
        content: (err && err.message) || '请稍后重试',
        showCancel: false
      })
    })
  }
})
