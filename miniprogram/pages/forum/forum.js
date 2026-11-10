// pages/forum/forum.js
const app = getApp()
const api = require('../../utils/api.js')
const util = require('../../utils/util.js')
const appearance = require('../../utils/appearance.js')

const CATEGORIES = [
  { label: '全部', value: 'all' },
  { label: '找搭子', value: '搭子招募' },
  { label: '经验分享', value: '学习经验' },
  { label: '资料共享', value: '资料共享' },
  { label: '其他', value: '其他' }
]

Page({
  data: {
    posts: [],
    categories: CATEGORIES,
    activeCategory: 'all',
    loading: true,
    isLoggedIn: false,
    wallpaper: null
  },

  onShow() {
    this.setData({ isLoggedIn: !!(app.globalData && app.globalData.isLoggedIn) })
    this.loadPosts()
    this.loadWallpaper()
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 1 })
    }
  },

  loadWallpaper() {
    return app.loadAppearance().then(data => {
      this.setData({ wallpaper: appearance.resolve(data) })
    })
  },

  onPullDownRefresh() {
    this.loadPosts().then(() => wx.stopPullDownRefresh())
  },

  async loadPosts() {
    try {
      this.setData({ loading: true })
      const posts = await api.getPosts(this.data.activeCategory)
      this.setData({
        posts: (posts || []).map(p => ({
          ...p,
          timeAgo: util.formatTimeAgo(p.createdAt)
        })),
        loading: false
      })
    } catch (err) {
      this.setData({ loading: false, posts: [] })
      wx.showToast({ title: (err && err.message) || '加载失败', icon: 'none' })
    }
  },

  switchCategory(e) {
    const value = e.currentTarget.dataset.value
    if (value === this.data.activeCategory) return
    this.setData({ activeCategory: value })
    this.loadPosts()
  },

  goToDetail(e) {
    const { id } = e.currentTarget.dataset
    wx.navigateTo({ url: `/pages/forum/post-detail/post-detail?postId=${id}` })
  },

  goToCreate() {
    if (!this.data.isLoggedIn) {
      wx.showModal({
        title: '需要登录',
        content: '发布帖子前请先登录',
        confirmText: '去登录',
        success: (res) => {
          if (res.confirm) wx.switchTab({ url: '/pages/profile/profile' })
        }
      })
      return
    }
    wx.navigateTo({ url: '/pages/forum/post-edit/post-edit' })
  },

  async toggleLike(e) {
    const { id } = e.currentTarget.dataset
    if (!this.data.isLoggedIn) {
      wx.showToast({ title: '请先登录', icon: 'none' })
      return
    }
    try {
      const res = await api.toggleLike(id)
      const posts = this.data.posts.map(p => {
        if (p._id !== id) return p
        return { ...p, isLiked: res.liked, likeCount: res.likeCount }
      })
      this.setData({ posts })
    } catch (err) {
      wx.showToast({ title: (err && err.message) || '操作失败', icon: 'none' })
    }
  }
})
