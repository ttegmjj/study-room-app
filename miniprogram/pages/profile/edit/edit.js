// pages/profile/edit/edit.js
const app = getApp()
const api = require('../../../utils/api.js')

Page({
  data: {
    avatarUrl: '',
    name: '',
    phone: '',
    phoneDisplay: '',
    isAdmin: false,
    saving: false
  },

  onLoad() {
    const u = app.globalData.userInfo || {}
    this.setData({
      avatarUrl: u.avatarUrl || '',
      name: u.nickName || '',
      phone: u.phone || '',
      isAdmin: !!app.globalData.isAdmin
    })
    this.buildPhoneDisplay()
    this.loadFromCloud()
  },

  /** 以云端为准刷新一次（换设备/清缓存后也能看到真实资料） */
  async loadFromCloud() {
    try {
      const cloud = await api.getUserInfo()
      if (!cloud) return
      this.setData({
        avatarUrl: cloud.avatar || this.data.avatarUrl,
        name: cloud.name || this.data.name,
        phone: cloud.phone || this.data.phone
      })
      this.buildPhoneDisplay()
    } catch (e) {}
  },

  buildPhoneDisplay() {
    const p = this.data.phone || ''
    this.setData({
      phoneDisplay: p ? p.replace(/^(\d{3})\d{4}(\d{4})$/, '$1****$2') : '未填写'
    })
  },

  /** 本地缓存 + globalData 同步，个人中心返回即生效 */
  applyLocal(patch) {
    app.globalData.userInfo = { ...(app.globalData.userInfo || {}), ...patch }
    wx.setStorageSync('auth_state', { isLoggedIn: true, userInfo: app.globalData.userInfo })
  },

  /** 选择头像：先上传云存储，再写回用户资料 */
  async onChooseAvatar(e) {
    const temp = e.detail && e.detail.avatarUrl
    if (!temp || this.data.saving) return

    this.setData({ saving: true })
    wx.showLoading({ title: '上传中...', mask: true })
    try {
      const ext = (temp.match(/\.([a-zA-Z0-9]+)(\?|$)/) || [])[1] || 'jpg'
      const up = await wx.cloud.uploadFile({
        cloudPath: `avatars/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`,
        filePath: temp
      })
      const fileID = up && up.fileID
      if (!fileID) throw new Error('上传失败')

      await api.updateUserInfo({ avatar: fileID })
      this.setData({ avatarUrl: fileID, saving: false })
      this.applyLocal({ avatarUrl: fileID })
      wx.hideLoading()
      wx.showToast({ title: '头像已更新', icon: 'success' })
    } catch (err) {
      this.setData({ saving: false })
      wx.hideLoading()
      console.error('头像保存失败:', err)
      wx.showToast({ title: (err && (err.errMsg || err.message)) || '保存失败', icon: 'none' })
    }
  },

  /** 修改名字 */
  editName() {
    wx.showModal({
      title: '名字',
      editable: true,
      placeholderText: '请输入名字（最多 20 字）',
      content: this.data.name,
      success: async (res) => {
        if (!res.confirm) return
        const name = (res.content || '').trim()
        if (!name) {
          wx.showToast({ title: '名字不能为空', icon: 'none' })
          return
        }
        if (name.length > 20) {
          wx.showToast({ title: '名字最多 20 字', icon: 'none' })
          return
        }
        await this.save({ name }, { nickName: name }, '名字已更新')
      }
    })
  },

  /** 修改手机号 */
  editPhone() {
    wx.showModal({
      title: '手机号',
      editable: true,
      placeholderText: '请输入 11 位手机号',
      content: this.data.phone,
      success: async (res) => {
        if (!res.confirm) return
        const phone = (res.content || '').trim()
        if (phone && !/^1\d{10}$/.test(phone)) {
          wx.showToast({ title: '手机号格式不正确', icon: 'none' })
          return
        }
        const ok = await this.save({ phone }, { phone }, '手机号已更新')
        if (ok) this.setData({ phone })
        this.buildPhoneDisplay()
      }
    })
  },

  /** 统一保存：写云端 + 本地缓存 */
  async save(cloudPatch, localPatch, okText) {
    wx.showLoading({ title: '保存中...', mask: true })
    try {
      await api.updateUserInfo(cloudPatch)
      if (localPatch) this.applyLocal(localPatch)
      wx.hideLoading()
      wx.showToast({ title: okText, icon: 'success' })
      return true
    } catch (err) {
      wx.hideLoading()
      console.error('保存失败:', err)
      wx.showToast({ title: (err && (err.errMsg || err.message)) || '保存失败', icon: 'none' })
      return false
    }
  }
})
