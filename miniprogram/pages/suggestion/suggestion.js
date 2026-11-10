// pages/suggestion/suggestion.js
const api = require('../../utils/api.js')
const util = require('../../utils/util.js')

Page({
  data: {
    content: '',
    contact: '',
    submitting: false,
    myList: [],
    loading: true
  },

  onShow() {
    this.loadMy()
  },

  onContentInput(e) {
    this.setData({ content: e.detail.value })
  },

  onContactInput(e) {
    this.setData({ contact: e.detail.value })
  },

  async submit() {
    const { content, contact } = this.data
    if (!content.trim()) {
      wx.showToast({ title: '请填写建议内容', icon: 'none' })
      return
    }
    if (this.data.submitting) return
    this.setData({ submitting: true })
    try {
      await api.createSuggestion({ content, contact })
      wx.showToast({ title: '提交成功，谢谢！', icon: 'success' })
      this.setData({ content: '', contact: '' })
      this.loadMy()
    } catch (err) {
      wx.showToast({ title: (err && err.message) || '提交失败', icon: 'none' })
    } finally {
      this.setData({ submitting: false })
    }
  },

  async loadMy() {
    try {
      const list = await api.getMySuggestions()
      list.forEach(item => {
        item.createdAtStr = item.createdAt ? util.formatDateTime(item.createdAt) : ''
      })
      this.setData({ myList: list, loading: false })
    } catch (err) {
      this.setData({ loading: false })
    }
  }
})
