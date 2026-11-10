// pages/checkin/checkin.js
const api = require('../../utils/api.js')
const util = require('../../utils/util.js')

Page({
  data: {
    bookingId: '',
    booking: null,
    statusText: '',
    loading: true,
    currentTime: '',
    timer: null,
    scanError: '',    // 扫码进入但没找到自己的预约时的提示
    // 签到按钮状态
    canCheckIn: false,
    canCheckOut: false,
    timeWarning: ''   // 超时/未到时间提示
  },

  onLoad(options) {
    // 扫自习室小程序码进入时携带 scene（形如 s=xxxxxxx），普通进入携带 bookingId
    const scene = options.scene || ''
    const roomId = options.roomId || ''

    if (options.bookingId) {
      this.setData({ bookingId: options.bookingId })
      this.loadBooking()
    } else if (scene || roomId) {
      this.resolveScanBooking(scene, roomId)
    } else {
      this.setData({ loading: false, scanError: '缺少预约信息，请重新扫码' })
    }

    // 每秒更新当前时间 + 按钮状态
    this.data.timer = setInterval(() => {
      this.setData({ currentTime: util.formatTime(new Date()) })
      this.updateCheckButtons()
    }, 1000)
  },

  /** 扫码后：按签到短码找到该自习室，再定位自己当天的预约 */
  async resolveScanBooking(scene, roomId) {
    try {
      const data = await api.getScanBooking(scene, roomId)
      this.setData({ bookingId: data.bookingId })
      this.loadBooking()
    } catch (err) {
      this.setData({ loading: false, scanError: (err && err.message) || '未找到可签到的预约' })
    }
  },

  onUnload() {
    if (this.data.timer) {
      clearInterval(this.data.timer)
    }
  },

  async loadBooking() {
    try {
      this.setData({ loading: true })
      const booking = await api.getCheckinInfo(this.data.bookingId)
      booking.checkInTimeStr = booking.checkInTime ? util.formatDateTime(booking.checkInTime) : ''
      booking.checkOutTimeStr = booking.checkOutTime ? util.formatDateTime(booking.checkOutTime) : ''

      // 检测是否刚被系统超时取消 → 弹提示
      if (booking.status === 'cancelled' && booking.cancelReason && booking.cancelReason.indexOf('超时') >= 0) {
        wx.showModal({
          title: '预约已超时',
          content: booking.cancelReason,
          showCancel: false,
          confirmText: '知道了'
        })
      }

      this.setData({
        booking,
        loading: false,
        statusText: (util.statusText[booking.status] && util.statusText[booking.status].text) || booking.status
      })
      this.updateCheckButtons()
    } catch (err) {
      console.error('[加载预约失败]', err)
      this.setData({ loading: false })
      wx.showToast({ title: '加载失败', icon: 'none' })
    }
  },

  /** 根据状态+时间计算按钮可用 */
  updateCheckButtons() {
    const b = this.data.booking
    if (!b) return

    let canCheckIn = false
    let timeWarning = ''

    if (b.status === 'booked') {
      const now = new Date()
      const start = new Date(`${b.date}T${b.startTime}:00`)
      const timeoutAt = new Date(start.getTime() + 15 * 60000)
      const diffStartMin = (now - start) / 60000
      const diffTimeoutMin = (now - timeoutAt) / 60000

      if (diffStartMin < 0) {
        // 还没到
        canCheckIn = false
        timeWarning = `签到时间未到（还有 ${Math.abs(Math.round(diffStartMin))} 分钟）`
      } else if (diffTimeoutMin > 0) {
        // 已过签到时限（开始15分钟未签到）
        canCheckIn = false
        timeWarning = '已过签到时限（开始后15分钟未签到），预约将被自动取消'
      } else {
        // 正常时间（开始 ~ 开始后15分钟内）
        canCheckIn = true
      }
    }

    const canCheckOut = b.status === 'checkedin'
    this.setData({ canCheckIn, canCheckOut, timeWarning })
  },

  async doCheckIn() {
    if (!this.data.canCheckIn) {
      // 显示原因提示
      wx.showToast({ title: this.data.timeWarning || '当前不能签到', icon: 'none' })
      return
    }

    wx.showLoading({ title: '签到中...' })
    try {
      await api.checkIn(this.data.bookingId)
      wx.hideLoading()
      wx.showToast({ title: '签到成功', icon: 'success' })
      this.loadBooking()
    } catch (err) {
      wx.hideLoading()

      // 超时 → 建议取消预约（双按钮 dialog）
      if (err && err.code === 410 && err.action === 'suggestCancel') {
        wx.showModal({
          title: '无法签到',
          content: err.message,
          confirmText: '取消预约',
          confirmColor: '#ff6b6b',
          cancelText: '知道了',
          success: (res) => {
            if (res.confirm) {
              this.cancelBooking()
            }
          }
        })
      } else {
        // 其他错误
        const msg = (err && (err.message || err.errMsg)) || '签到失败'
        wx.showModal({ title: '签到失败', content: msg, showCancel: false })
      }
    }
  },

  async doCheckOut() {
    if (!this.data.canCheckOut) {
      wx.showToast({ title: '当前状态不能签退', icon: 'none' })
      return
    }

    wx.showLoading({ title: '签退中...' })
    try {
      await api.checkOut(this.data.bookingId)
      wx.hideLoading()
      wx.showToast({ title: '签退成功', icon: 'success' })
      this.loadBooking()
    } catch (err) {
      wx.hideLoading()
      const msg = (err && (err.message || err.errMsg)) || '签退失败'
      wx.showModal({ title: '签退失败', content: msg, showCancel: false })
    }
  },

  async cancelBooking() {
    wx.showModal({
      title: '取消预约',
      content: '确定要取消这个预约吗？\n（取消后座位将释放给他人）',
      confirmColor: '#ff6b6b',
      success: async (res) => {
        if (res.confirm) {
          try {
            await api.cancelBooking(this.data.bookingId)
            wx.showToast({ title: '已取消', icon: 'success' })
            setTimeout(() => wx.navigateBack(), 1500)
          } catch (err) {
            wx.showToast({ title: (err && err.message) || '取消失败', icon: 'none' })
          }
        }
      }
    })
  },

  getCheckinCode() {
    wx.showModal({
      title: '签到码',
      content: `签到码：${this.data.bookingId}\n出示给管理员或扫描设备`,
      showCancel: false
    })
  }
})
