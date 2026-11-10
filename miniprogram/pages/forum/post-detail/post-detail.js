// pages/forum/post-detail/post-detail.js
const app = getApp()
const api = require('../../../utils/api.js')
const util = require('../../../utils/util.js')

Page({
  data: {
    postId: '',
    post: null,
    comments: [],
    commentText: '',
    loading: true,
    isLoggedIn: false,
    submitting: false
  },

  onLoad(options) {
    this.setData({ postId: options.postId || '' })
    this.setData({ isLoggedIn: !!(app.globalData && app.globalData.isLoggedIn) })
    this.loadDetail()
  },

  onPullDownRefresh() {
    this.loadDetail().then(() => wx.stopPullDownRefresh())
  },

  async loadDetail() {
    try {
      this.setData({ loading: true })
      const data = await api.getPostDetail(this.data.postId)
      this.setData({
        post: {
          ...data.post,
          timeAgo: util.formatTimeAgo(data.post.createdAt),
          createdAtStr: util.formatDateTime(data.post.createdAt)
        },
        comments: (data.comments || []).map(c => ({
          ...c,
          timeAgo: util.formatTimeAgo(c.createdAt)
        })),
        loading: false
      })
    } catch (err) {
      this.setData({ loading: false })
      wx.showModal({
        title: '加载失败',
        content: (err && err.message) || '帖子可能已被删除',
        showCancel: false,
        success: () => wx.navigateBack()
      })
    }
  },

  async toggleLike() {
    if (!this.data.isLoggedIn) {
      wx.showToast({ title: '请先登录', icon: 'none' })
      return
    }
    try {
      const res = await api.toggleLike(this.data.postId)
      this.setData({
        'post.isLiked': res.liked,
        'post.likeCount': res.likeCount
      })
    } catch (err) {
      wx.showToast({ title: (err && err.message) || '操作失败', icon: 'none' })
    }
  },

  onCommentInput(e) {
    this.setData({ commentText: e.detail.value })
  },

  async submitComment() {
    if (this.data.submitting) return
    if (!this.data.isLoggedIn) {
      wx.showToast({ title: '请先登录', icon: 'none' })
      return
    }
    const content = (this.data.commentText || '').trim()
    if (!content) {
      wx.showToast({ title: '请输入评论内容', icon: 'none' })
      return
    }

    this.setData({ submitting: true })
    try {
      await api.addComment(this.data.postId, content)
      this.setData({ commentText: '' })
      wx.showToast({ title: '评论成功', icon: 'success' })
      this.loadDetail()
    } catch (err) {
      wx.showToast({ title: (err && err.message) || '评论失败', icon: 'none' })
    } finally {
      this.setData({ submitting: false })
    }
  },

  copyContact() {
    if (!this.data.post || !this.data.post.contact) return
    wx.setClipboardData({
      data: this.data.post.contact,
      success: () => wx.showToast({ title: '联系方式已复制', icon: 'success' })
    })
  },

  deletePost() {
    wx.showModal({
      title: '删除帖子',
      content: '删除后不可恢复，确定要删除吗？',
      confirmColor: '#ff6b6b',
      success: async (res) => {
        if (!res.confirm) return
        try {
          await api.deletePost(this.data.postId)
          wx.showToast({ title: '已删除', icon: 'success' })
          setTimeout(() => wx.navigateBack(), 1200)
        } catch (err) {
          wx.showToast({ title: (err && err.message) || '删除失败', icon: 'none' })
        }
      }
    })
  }
})
