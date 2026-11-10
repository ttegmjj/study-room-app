// pages/admin/appearance/appearance.js
const app = getApp()
const api = require('../../../utils/api.js')
const appearance = require('../../../utils/appearance.js')
const { guardAdmin } = require('../../../utils/admin-guard.js')

Page({
  data: {
    presets: appearance.PRESETS,
    wallpaperId: 'default',
    customFileID: '',
    overlay: 0.15,
    overlayPercent: 15,
    preview: appearance.resolve({}),
    saving: false
  },

  async onLoad() {
    if (!(await guardAdmin())) return
    this.loadCurrent()
  },

  async loadCurrent() {
    try {
      const data = await api.getAppearance()
      const overlay = Number(data.overlay) || 0
      this.setData({
        wallpaperId: data.wallpaperId || 'default',
        customFileID: data.customFileID || '',
        overlay,
        overlayPercent: Math.round(overlay * 100)
      })
      this.refreshPreview()
    } catch (err) {
      wx.showToast({ title: (err && err.message) || '读取失败', icon: 'none' })
    }
  },

  selectPreset(e) {
    this.setData({ wallpaperId: e.currentTarget.dataset.id })
    this.refreshPreview()
  },

  onOverlayChange(e) {
    const value = Number(e.detail.value)
    this.setData({ overlayPercent: value, overlay: value / 100 })
    this.refreshPreview()
  },

  chooseImage() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sizeType: ['compressed'],
      success: async (res) => {
        const tempFilePath = res.tempFiles[0].tempFilePath
        wx.showLoading({ title: '上传中...' })
        try {
          const upload = await new Promise((resolve, reject) => {
            wx.cloud.uploadFile({
              cloudPath: `wallpaper/${Date.now()}${this.getExt(tempFilePath)}`,
              filePath: tempFilePath,
              success: resolve,
              fail: reject
            })
          })
          wx.hideLoading()
          this.setData({ wallpaperId: 'custom', customFileID: upload.fileID })
          this.refreshPreview()
          wx.showToast({ title: '图片已上传', icon: 'success' })
        } catch (err) {
          wx.hideLoading()
          wx.showToast({ title: '上传失败', icon: 'none' })
        }
      }
    })
  },

  getExt(filePath) {
    const idx = filePath.lastIndexOf('.')
    return idx >= 0 ? filePath.slice(idx) : '.jpg'
  },

  refreshPreview() {
    this.setData({
      preview: appearance.resolve({
        wallpaperId: this.data.wallpaperId,
        customFileID: this.data.customFileID,
        overlay: this.data.overlay
      })
    })
  },

  async save() {
    if (this.data.saving) return
    if (this.data.wallpaperId === 'custom' && !this.data.customFileID) {
      wx.showToast({ title: '请先上传自定义图片', icon: 'none' })
      return
    }

    this.setData({ saving: true })
    wx.showLoading({ title: '保存中...' })
    try {
      await api.setAppearance({
        wallpaperId: this.data.wallpaperId,
        customFileID: this.data.customFileID,
        overlay: this.data.overlay
      })
      await app.loadAppearance()
      wx.hideLoading()
      wx.showToast({ title: '已立即生效', icon: 'success' })
    } catch (err) {
      wx.hideLoading()
      wx.showModal({
        title: '保存失败',
        content: (err && err.message) || '请稍后重试',
        showCancel: false
      })
    } finally {
      this.setData({ saving: false })
    }
  }
})
