// utils/api.js - 云函数 API 封装

const call = (action, data = {}) => {
  return new Promise((resolve, reject) => {
    wx.cloud.callFunction({
      name: 'api',
      data: { action, ...data },
      success: res => {
        if (res.result && res.result.code === 0) {
          resolve(res.result.data !== undefined ? res.result.data : res.result)
        } else {
          const r = res.result || {}
          const msg = r.message || '请求失败'
          const err = new Error(msg)
          err.code = r.code || 500
          err.action = r.action
          reject(err)
        }
      },
      fail: err => {
        console.error('[API Error]', action, err)
        const e = new Error('网络错误')
        e.code = -1
        reject(e)
      }
    })
  })
}

// 自习室
module.exports = {
  getRooms: () => call('getRooms'),
  getRoomsWithStats: (date) => call('getRoomsWithStats', { date }),
  getRoomDetail: (roomId) => call('getRoomDetail', { roomId }),
  createRoom: (data) => call('createRoom', data),
  updateRoom: (data) => call('updateRoom', data),
  deleteRoom: (roomId) => call('deleteRoom', { roomId }),

  // 座位
  getSeats: (roomId, date, startTime, endTime) => call('getSeats', { roomId, date, startTime, endTime }),
  getSeatBookings: (roomId, seatId, date) => call('getSeatBookings', { roomId, seatId, date }),
  addSeats: (roomId, seats) => call('addSeats', { roomId, seats }),
  removeSeats: (roomId, seatIds) => call('removeSeats', { roomId, seatIds }),
  // 座位布局（座位间隔/连座）：复用 updateRoom 整体写回 seats 数组（云端有管理员校验）
  updateSeatLayout: (roomId, seats, layoutImage) => call('updateRoom', layoutImage
    ? { roomId, seats, layoutImage }
    : { roomId, seats }),
  // 拍照识别座位布局（云开发 AI 多模态）
  recognizeSeatLayout: (roomId, fileID) => call('recognizeSeats', { roomId, fileID }),
  // 自习室签到小程序码 / 扫码后定位自己的预约
  getRoomQrCode: (roomId) => call('getRoomQrCode', { roomId }),
  getScanBooking: (scene, roomId) => call('findScanBooking', { scene: scene || '', roomId: roomId || '' }),

  // 预约
  createBooking: (data) => call('createBooking', data),
  getMyBookings: (status) => call('getMyBookings', { status }),
  cancelBooking: (bookingId) => call('cancelBooking', { bookingId }),
  deleteMyBookings: (bookingIds) => call('deleteMyBookings', { bookingIds }),

  // 签到
  checkIn: (bookingId) => call('checkIn', { bookingId }),
  checkOut: (bookingId) => call('checkOut', { bookingId }),
  getCheckinInfo: (bookingId) => call('getCheckinInfo', { bookingId }),

  // 管理员
  checkIsAdmin: () => call('checkIsAdmin'),
  bootstrapAdmin: (code) => call('bootstrapAdmin', { code: code || '' }),
  setAdmin: (openid, isAdmin) => call('setAdmin', { openid, isAdminFlag: isAdmin }),
  getAdminCandidates: (keyword) => call('getAdminCandidates', { keyword: keyword || '' }),
  adminSetUserBan: (openid, days) => call('adminSetUserBan', { openid, days }),
  adminExportBookings: (date) => call('adminExportBookings', { date: date || '' }),
  adminGetBookings: (params) => call('adminGetBookings', params || {}),
  updateBookingStatus: (bookingId, status) => call('updateBookingStatus', { bookingId, status }),
  getStats: (date) => call('getStats', { date }),

  // 用户
  getUserInfo: () => call('getUserInfo'),
  updateUserInfo: (data) => call('updateUserInfo', data),
  getMyStats: () => call('getMyStats'),

  // 学习搭子论坛
  getPosts: (category) => call('getPosts', { category }),
  getPostDetail: (postId) => call('getPostDetail', { postId }),
  createPost: (data) => call('createPost', data),
  deletePost: (postId) => call('deletePost', { postId }),
  toggleLike: (postId) => call('toggleLike', { postId }),
  addComment: (postId, content) => call('addComment', { postId, content }),

  // 外观（壁纸）
  getAppearance: () => call('getAppearance'),
  setAppearance: (data) => call('setAppearance', data),

  // 公告
  getNotice: () => call('getNotice'),
  setNotice: (data) => call('setNotice', data),
  getSubscribeTemplate: () => call('getSubscribeTemplate'),

  // 征集建议
  createSuggestion: (data) => call('createSuggestion', data),
  getMySuggestions: () => call('getMySuggestions'),
  getSuggestions: () => call('getSuggestions'),
  markSuggestionDone: (id) => call('markSuggestionDone', { id }),

  // t4: 临时锁（选座位时加锁，确认后释放）
  acquireLock: (data) => call('acquireLock', data),
  releaseLock: (data) => call('releaseLock', data),

  // 现场占用（管理员手动标记座位被现场人员占用）
  markSeatOccupied: (data) => call('markSeatOccupied', data),
  releaseSeatOccupied: (data) => call('releaseSeatOccupied', data),
  batchMarkOccupied: (data) => call('batchMarkOccupied', data),

  // t2: 座位收藏
  saveFavoriteSeat: (data) => call('saveFavoriteSeat', data),
  getFavoriteSeats: () => call('getFavoriteSeats'),
  removeFavoriteSeat: (roomId, seatId) => call('removeFavoriteSeat', { roomId, seatId }),

  // t5: 多日连续预约
  createBookingBatch: (data) => call('createBookingBatch', data),

  // t8: 排行榜
  getStudyRanking: (rankMode) => call('getStudyRanking', { rankMode })
}
