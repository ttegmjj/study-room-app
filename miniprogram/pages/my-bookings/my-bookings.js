// pages/my-bookings/my-bookings.js
const api = require('../../utils/api.js')
const util = require('../../utils/util.js')
const appearance = require('../../utils/appearance.js')

Page({
  data: {
    bookings: [],
    filterStatus: '',
    tabs: [
      { label: '全部', value: '' },
      { label: '待签到', value: 'booked' },
      { label: '已签到', value: 'checkedin' },
      { label: '已完成', value: 'completed' },
      { label: '已取消', value: 'cancelled' }
    ],
    loading: true,
    deletableCount: 0,
    wallpaper: null
  },

  loadWallpaper() {
    return getApp().loadAppearance().then(data => {
      this.setData({ wallpaper: appearance.resolve(data) })
    })
  },

  onShow() {
    this.loadBookings()
    this.loadWallpaper()
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 2 })
    }
  },

  onPullDownRefresh() {
    this.loadBookings().then(() => wx.stopPullDownRefresh())
  },

  async loadBookings() {
    try {
      this.setData({ loading: true })
      const bookings = await api.getMyBookings(this.data.filterStatus || undefined)
      const today = util.getToday()
      // 格式化日期
      const formatted = bookings.map(b => {
        // 超时取消 → 特殊标签
        const isTimeoutCancelled = b.status === 'cancelled'
          && (b.cancelledBy === 'system_timeout' || (b.cancelReason && b.cancelReason.indexOf('超时') >= 0))
        const statusInfo = isTimeoutCancelled
          ? { text: '⏰ 已超时取消', tagClass: 'tag-timeout' }
          : (util.statusText[b.status] || { text: b.status, tagClass: '' })

        return {
          ...b,
          dateLabel: this.formatDateLabel(b.date),
          statusInfo,
          checkInTimeStr: b.checkInTime ? util.formatDateTime(b.checkInTime) : '',
          checkOutTimeStr: b.checkOutTime ? util.formatDateTime(b.checkOutTime) : '',
          isTimeoutCancelled,
          // 可删除：已取消的随时可删；其余记录需等到第二天（日期已过）
          canDelete: b.status === 'cancelled' || (b.date && b.date < today)
        }
      })
      this.setData({
        bookings: formatted,
        deletableCount: formatted.filter(x => x.canDelete).length,
        loading: false
      })
    } catch (err) {
      this.setData({ loading: false })
    }
  },

  formatDateLabel(dateStr) {
    const today = util.getToday()
    if (dateStr === today) return '今天'
    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    if (dateStr === util.formatDate(tomorrow)) return '明天'
    return dateStr
  },

  switchTab(e) {
    const value = e.currentTarget.dataset.value
    this.setData({ filterStatus: value })
    this.loadBookings()
  },

  async cancelBooking(e) {
    const { id } = e.currentTarget.dataset
    wx.showModal({
      title: '取消预约',
      content: '确定要取消这个预约吗？',
      confirmColor: '#ff6b6b',
      success: async (res) => {
        if (res.confirm) {
          try {
            await api.cancelBooking(id)
            wx.showToast({ title: '已取消', icon: 'success' })
            this.loadBookings()
          } catch {}
        }
      }
    })
  },

  /** 删除单条记录（仅已取消 / 昨天及更早） */
  deleteBooking(e) {
    const { id } = e.currentTarget.dataset
    wx.showModal({
      title: '删除记录',
      content: '删除后该记录将从列表中移除，不可恢复。确定删除吗？',
      confirmColor: '#ff6b6b',
      success: async (res) => {
        if (!res.confirm) return
        wx.showLoading({ title: '删除中...' })
        try {
          const r = await api.deleteMyBookings([id])
          wx.hideLoading()
          if (r && r.removed) {
            wx.showToast({ title: '已删除', icon: 'success' })
          } else {
            wx.showToast({ title: '该记录暂不可删除', icon: 'none' })
          }
          this.loadBookings()
        } catch (err) {
          wx.hideLoading()
          wx.showToast({ title: (err && err.message) || '删除失败', icon: 'none' })
        }
      }
    })
  },

  /** 一键清理所有可删记录 */
  deleteAllDeletable() {
    const ids = (this.data.bookings || []).filter(b => b.canDelete).map(b => b._id)
    if (ids.length === 0) {
      wx.showToast({ title: '暂无可删除记录', icon: 'none' })
      return
    }
    wx.showModal({
      title: '清理历史记录',
      content: `将删除 ${ids.length} 条记录（已取消或昨天及更早），不可恢复。`,
      confirmColor: '#ff6b6b',
      success: async (res) => {
        if (!res.confirm) return
        wx.showLoading({ title: '清理中...' })
        try {
          const r = await api.deleteMyBookings(ids)
          wx.hideLoading()
          wx.showToast({ title: `已删除 ${(r && r.removed) || 0} 条`, icon: 'none' })
          this.loadBookings()
        } catch (err) {
          wx.hideLoading()
          wx.showToast({ title: (err && err.message) || '清理失败', icon: 'none' })
        }
      }
    })
  },

  goToCheckin(e) {
    const { id } = e.currentTarget.dataset
    wx.navigateTo({ url: `/pages/checkin/checkin?bookingId=${id}` })
  },

  goToIndex() {
    wx.switchTab({ url: '/pages/index/index' })
  }
})
