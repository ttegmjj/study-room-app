// pages/forum/post-edit/post-edit.js
const app = getApp()
const api = require('../../../utils/api.js')

const CATEGORIES = ['搭子招募', '学习经验', '资料共享', '其他']

Page({
  data: {
    categories: CATEGORIES,
    categoryIndex: 0,
    title: '',
    content: '',
    contentLength: 0,
    subject: '',
    studyTime: '',
    location: '',
    contact: '',
    submitting: false
  },

  onLoad() {
    const isLoggedIn = !!(app.globalData && app.globalData.isLoggedIn)
    if (!isLoggedIn) {
      wx.showModal({
        title: '需要登录',
        content: '发布帖子前请先登录',
        showCancel: false,
        success: () => wx.navigateBack()
      })
    }
  },

  onCategoryChange(e) {
    this.setData({ categoryIndex: Number(e.detail.value) })
  },

  onInput(e) {
    const field = e.currentTarget.dataset.field
    const value = e.detail.value
    const patch = { [field]: value }
    if (field === 'content') patch.contentLength = value.length
    this.setData(patch)
  },

  async submit() {
    if (this.data.submitting) return

    const title = (this.data.title || '').trim()
    const content = (this.data.content || '').trim()

    if (!title) {
      wx.showToast({ title: '请填写标题', icon: 'none' })
      return
    }
    if (!content) {
      wx.showToast({ title: '请填写内容', icon: 'none' })
      return
    }

    this.setData({ submitting: true })
    wx.showLoading({ title: '发布中...' })

    try {
      await api.createPost({
        category: this.data.categories[this.data.categoryIndex],
        title,
        content,
        subject: this.data.subject,
        studyTime: this.data.studyTime,
        location: this.data.location,
        contact: this.data.contact
      })
      wx.hideLoading()
      wx.showToast({ title: '发布成功', icon: 'success' })
      setTimeout(() => wx.navigateBack(), 1200)
    } catch (err) {
      wx.hideLoading()
      this.setData({ submitting: false })
      wx.showModal({
        title: '发布失败',
        content: (err && err.message) || '请稍后重试',
        showCancel: false
      })
    }
  }
})
