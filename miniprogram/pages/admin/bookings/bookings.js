// pages/admin/bookings/bookings.js
const api = require('../../../utils/api.js')
const util = require('../../../utils/util.js')
const { guardAdmin } = require('../../../utils/admin-guard.js')

Page({
  data: {
    bookings: [],
    statusFilter: '',
    dateFilter: '',
    tabs: [
      { label: '全部', value: '' },
      { label: '待签到', value: 'booked' },
      { label: '已签到', value: 'checkedin' },
      { label: '已完成', value: 'completed' },
      { label: '已取消', value: 'cancelled' }
    ],
    loading: true
  },

  async onShow() {
    if (!(await guardAdmin())) return
    this.loadBookings()
  },

  async loadBookings() {
    try {
      this.setData({ loading: true })
      const params = {}
      if (this.data.statusFilter) params.status = this.data.statusFilter
      if (this.data.dateFilter) params.date = this.data.dateFilter

      const bookings = await api.adminGetBookings(params)
      const formatted = bookings.map(b => ({
        ...b,
        statusInfo: util.statusText[b.status] || { text: b.status, tagClass: '' },
        checkInTimeStr: b.checkInTime ? util.formatDateTime(b.checkInTime) : '',
        checkOutTimeStr: b.checkOutTime ? util.formatDateTime(b.checkOutTime) : ''
      }))
      this.setData({ bookings: formatted, loading: false })
    } catch (err) {
      this.setData({ loading: false })
    }
  },

  switchTab(e) {
    const value = e.currentTarget.dataset.value
    this.setData({ statusFilter: value })
    this.loadBookings()
  },

  onDateChange(e) {
    this.setData({ dateFilter: e.detail.value })
    this.loadBookings()
  },

  clearDate() {
    this.setData({ dateFilter: '' })
    this.loadBookings()
  },

  async updateStatus(e) {
    const { id, status } = e.currentTarget.dataset
    const statusText = { booked: '待签到', checkedin: '已签到', completed: '已完成', cancelled: '已取消' }

    wx.showModal({
      title: '修改状态',
      content: `确定将此预约状态修改为「${statusText[status]}」吗？`,
      success: async (res) => {
        if (res.confirm) {
          try {
            await api.updateBookingStatus(id, status)
            wx.showToast({ title: '更新成功', icon: 'success' })
            this.loadBookings()
          } catch {}
        }
      }
    })
  }
})
