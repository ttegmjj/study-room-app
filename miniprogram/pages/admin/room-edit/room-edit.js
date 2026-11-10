// pages/admin/room-edit/room-edit.js
const api = require('../../../utils/api.js')
const { guardAdmin } = require('../../../utils/admin-guard.js')
const drawQrcode = require('../../../utils/weapp.qrcode.js')

Page({
  data: {
    roomId: '',
    isEdit: false,
    presetRoomTags: ['📖考研自习室', '🧘静音区', '🌙24小时开放', '⚡带插座', '🪟靠窗采光', '📝考试专用', '🖥️电脑房'],
    // picker 选项（JS 里维护，避免模板里写 .indexOf 调用）
    minMinutesOpts: [30, 60, 90, 120],
    statusOpts: ['open', 'closed', 'maintenance'],
    form: {
      name: '',
      location: '',
      description: '',
      openTime: '08:00',
      closeTime: '22:00',
      image: '',
      minMinutes: 30,
      status: 'open',
      roomTags: []    // 自习室整体标签，如 ['📖考研自习室', '🌙24小时开放']
    },
    minMinutesIndex: 0,
    statusIndex: 0,
    qrFileID: '',
    qrTempFilePath: '',  // 前端 Canvas 生成的临时文件
    qrScanCode: '',
    qrLoading: false
  },

  async onLoad(options) {
    if (!(await guardAdmin())) return
    if (options.roomId) {
      this.setData({ roomId: options.roomId, isEdit: true })
      this.loadRoom()
      wx.setNavigationBarTitle({ title: '编辑自习室' })
    } else {
      wx.setNavigationBarTitle({ title: '新增自习室' })
    }
  },

  async loadRoom() {
    try {
      const room = await api.getRoomDetail(this.data.roomId)
      const mm = Number(room.minMinutes) || 30
      const st = room.status || 'open'
      const mmIdx = Math.max(0, this.data.minMinutesOpts.indexOf(mm))
      const stIdx = Math.max(0, this.data.statusOpts.indexOf(st))
      this.setData({
        form: {
          name: room.name,
          location: room.location,
          description: room.description,
          openTime: room.openTime,
          closeTime: room.closeTime,
          image: room.image || '',
          minMinutes: mm,
          status: st,
          roomTags: room.roomTags || []
        },
        minMinutesIndex: mmIdx,
        statusIndex: stIdx,
        qrFileID: room.qrFileID || ''
      })
    } catch {}
  },

  /** 生成签到码：前端 Canvas 画普通二维码（不依赖 wxacode.getUnlimited） */
  async generateQr() {
    if (this.data.qrLoading) return
    this.setData({ qrLoading: true })
    wx.showLoading({ title: '生成签到码...' })
    try {
      // 1. 云函数只负责确保 scanCode 存在
      const info = await api.getRoomQrCode(this.data.roomId)
      this.setData({ qrScanCode: info.scanCode })

      // 2. 前端在 Canvas 上画二维码
      drawQrcode({
        width: 220,
        height: 220,
        canvasId: 'qrcodeCanvas',
        text: info.qrText,
        typeNumber: -1,
        errorCorrectLevel: 'M',
        foreground: '#2a8b5e',  // 薄荷绿，跟主题统一
        background: '#ffffff'
      })

      // 3. 等 Canvas 绘制完成 → 转临时文件
      setTimeout(() => {
        wx.canvasToTempFilePath({
          canvasId: 'qrcodeCanvas',
          width: 220,
          height: 220,
          destWidth: 660,
          destHeight: 660,
          success: async (res) => {
            // 4. 上传到云存储（可选，备份）
            try {
              const upload = await wx.cloud.uploadFile({
                cloudPath: `room-qrcode/${this.data.roomId}-${info.scanCode}.png`,
                filePath: res.tempFilePath
              })
              await api.updateRoom(Object.assign({}, this.data.form, {
                _id: this.data.roomId,
                qrFileID: upload.fileID,
                qrUpdatedAt: Date.now()
              }))
            } catch {}  // 上传失败不阻塞显示

            wx.hideLoading()
            this.setData({
              qrTempFilePath: res.tempFilePath,
              qrFileID: ''  // 不再依赖云存储 fileID 显示
            })
            wx.showToast({ title: '签到码已生成', icon: 'success' })
          },
          fail: (err) => {
            wx.hideLoading()
            wx.showModal({ title: '生成失败', content: (err && err.errMsg) || '请稍后重试', showCancel: false })
          },
          complete: () => this.setData({ qrLoading: false })
        }, this)
      }, 100)
    } catch (err) {
      wx.hideLoading()
      wx.showModal({
        title: '生成失败',
        content: (err && err.message) || '请稍后重试',
        showCancel: false
      })
      this.setData({ qrLoading: false })
    }
  },

  /** 保存签到码到相册，方便打印张贴 */
  saveQr() {
    const filePath = this.data.qrTempFilePath || this.data.qrFileID
    if (!filePath) return
    const doSave = (fp) => {
      wx.showLoading({ title: '保存中...' })
      wx.saveImageToPhotosAlbum({
        filePath: fp,
        success: () => {
          wx.hideLoading()
          wx.showToast({ title: '已保存到相册', icon: 'success' })
        },
        fail: (err) => {
          wx.hideLoading()
          if (err && err.errMsg && err.errMsg.indexOf('auth deny') >= 0) {
            wx.showModal({
              title: '需要相册权限',
              content: '请在设置中允许保存图片到相册',
              confirmText: '去设置',
              success: (r) => { if (r.confirm) wx.openSetting() }
            })
          } else {
            wx.showToast({ title: '保存失败', icon: 'none' })
          }
        }
      })
    }
    if (this.data.qrTempFilePath) {
      doSave(this.data.qrTempFilePath)
    } else if (this.data.qrFileID) {
      wx.showLoading({ title: '下载中...' })
      wx.cloud.downloadFile({
        fileID: this.data.qrFileID,
        success: (res) => { wx.hideLoading(); doSave(res.tempFilePath) },
        fail: () => { wx.hideLoading(); wx.showToast({ title: '下载失败', icon: 'none' }) }
      })
    }
  },

  onInput(e) {
    const { field } = e.currentTarget.dataset
    this.setData({ [`form.${field}`]: e.detail.value })
  },

  onTimeChange(e) {
    const { field } = e.currentTarget.dataset
    this.setData({ [`form.${field}`]: e.detail.value })
  },

  // t1: 最短预约时长切换
  onMinMinutesChange(e) {
    const idx = Number(e.detail.value) || 0
    this.setData({ 'form.minMinutes': this.data.minMinutesOpts[idx], minMinutesIndex: idx })
  },

  // t6: 开放状态切换
  onStatusChange(e) {
    const idx = Number(e.detail.value) || 0
    this.setData({ 'form.status': this.data.statusOpts[idx], statusIndex: idx })
  },

  // t6: 快速 switch 切换开放/暂停
  toggleStatusSwitch(e) {
    this.setData({ 'form.status': e.detail.value ? 'open' : 'closed' })
  },

  // ========== 自习室整体标签（roomTags） ==========

  addPresetRoomTag(e) {
    const val = e.currentTarget.dataset.val
    const tags = this.data.form.roomTags.slice()
    if (tags.includes(val)) {
      wx.showToast({ title: '已添加', icon: 'none' })
      return
    }
    if (tags.length >= 6) {
      wx.showToast({ title: '最多 6 个', icon: 'none' })
      return
    }
    tags.push(val)
    this.setData({ 'form.roomTags': tags })
  },
  addRoomTag() {
    const tags = this.data.form.roomTags.slice()
    if (tags.length >= 6) {
      wx.showToast({ title: '最多 6 个', icon: 'none' })
      return
    }
    tags.push('')
    this.setData({ 'form.roomTags': tags })
  },
  onRoomTagInput(e) {
    const idx = Number(e.currentTarget.dataset.index)
    const tags = this.data.form.roomTags.slice()
    tags[idx] = e.detail.value
    this.setData({ 'form.roomTags': tags })
  },
  removeRoomTag(e) {
    const idx = Number(e.currentTarget.dataset.index)
    const tags = this.data.form.roomTags.slice()
    tags.splice(idx, 1)
    this.setData({ 'form.roomTags': tags })
  },

  async submit() {
    const { form, isEdit, roomId } = this.data

    if (!form.name.trim()) {
      wx.showToast({ title: '请输入名称', icon: 'none' })
      return
    }
    if (!form.location.trim()) {
      wx.showToast({ title: '请输入位置', icon: 'none' })
      return
    }

    wx.showLoading({ title: isEdit ? '保存中...' : '创建中...' })
    try {
      if (isEdit) {
        await api.updateRoom({ roomId, ...form })
      } else {
        await api.createRoom(form)
      }
      wx.hideLoading()
      wx.showToast({ title: '保存成功', icon: 'success' })
      setTimeout(() => wx.navigateBack(), 1000)
    } catch {
      wx.hideLoading()
    }
  }
})
