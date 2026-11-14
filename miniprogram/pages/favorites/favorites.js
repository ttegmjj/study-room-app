// pages/favorites/favorites.js
const api = require('../../utils/api.js')
const appearance = require('../../utils/appearance.js')

Page({
  data: {
    favorites: [],
    loading: true,
    wallpaper: null
  },

  loadWallpaper() {
    return getApp().loadAppearance().then(data => {
      this.setData({ wallpaper: appearance.resolve(data) })
    })
  },

  onShow() {
    this.loadFavorites()
    this.loadWallpaper()
  },

  onPullDownRefresh() {
    this.loadFavorites().then(() => wx.stopPullDownRefresh())
  },

  async loadFavorites() {
    try {
      this.setData({ loading: true })
      const list = await api.getFavoriteSeats()
      this.setData({ favorites: list || [], loading: false })
    } catch (e) {
      this.setData({ loading: false })
    }
  },

  goToBooking(e) {
    const { roomid, roomname, seatid, seatcode } = e.currentTarget.dataset
    wx.navigateTo({
      url: `/pages/booking/booking?roomId=${roomid}&roomName=${encodeURIComponent(roomname || '')}&seatId=${seatid}&seatCode=${encodeURIComponent(seatcode)}`
    })
  },

  async removeFavorite(e) {
    const { roomid, seatid } = e.currentTarget.dataset
    try {
      await api.removeFavoriteSeat(roomid, seatid)
      wx.showToast({ title: '已取消收藏', icon: 'success' })
      this.loadFavorites()
    } catch (err) {
      wx.showToast({ title: err.message || '操作失败', icon: 'none' })
    }
  },

  async goToFirstRoom() {
    try {
      const rooms = await api.getRooms()
      if (rooms && rooms.length > 0) {
        wx.redirectTo({ url: `/pages/booking/booking?roomId=${rooms[0]._id}&roomName=${encodeURIComponent(rooms[0].name)}` })
      } else {
        wx.showToast({ title: '暂无开放自习室', icon: 'none' })
      }
    } catch (e) {
      wx.showToast({ title: '加载失败', icon: 'none' })
    }
  }
})
