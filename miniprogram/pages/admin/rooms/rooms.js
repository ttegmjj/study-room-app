// pages/admin/rooms/rooms.js
const api = require('../../../utils/api.js')
const { guardAdmin } = require('../../../utils/admin-guard.js')

Page({
  data: {
    rooms: [],
    loading: true
  },

  async onShow() {
    if (!(await guardAdmin())) return
    this.loadRooms()
  },

  async loadRooms() {
    try {
      this.setData({ loading: true })
      const rooms = await api.getRooms()
      const withSeatCount = rooms.map(r => ({
        ...r,
        seatCount: (r.seats || []).length
      }))
      this.setData({ rooms: withSeatCount, loading: false })
    } catch (err) {
      this.setData({ loading: false })
    }
  },

  addRoom() {
    wx.navigateTo({ url: '/pages/admin/room-edit/room-edit' })
  },

  editRoom(e) {
    const { id } = e.currentTarget.dataset
    wx.navigateTo({ url: `/pages/admin/room-edit/room-edit?roomId=${id}` })
  },

  manageSeats(e) {
    const { id, name } = e.currentTarget.dataset
    wx.navigateTo({ url: `/pages/admin/seats/seats?roomId=${id}&roomName=${encodeURIComponent(name)}` })
  },

  async deleteRoom(e) {
    const { id, name } = e.currentTarget.dataset
    wx.showModal({
      title: '删除自习室',
      content: `确定要删除「${name}」吗？相关预约也会被取消。`,
      confirmColor: '#ff6b6b',
      success: async (res) => {
        if (res.confirm) {
          try {
            await api.deleteRoom(id)
            wx.showToast({ title: '已删除', icon: 'success' })
            this.loadRooms()
          } catch {}
        }
      }
    })
  }
})
