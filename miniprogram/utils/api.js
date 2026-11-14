// utils/api.js - 云函数 API 封装（带内存缓存）
const cache = require('./cache.js')

/**
 * 调用云函数，自动加 30 秒内存缓存
 * 纯读接口自动缓存；写操作（create/update/delete）自动失效相关前缀
 */
const CACHE_TTL = 30000 // 30 秒

const CACHABLE = {
  getRooms: true,
  getRoomsWithStats: true,
  getRoomDetail: true,
  getSeats: true,
  getSeatBookings: true,
  getMyBookings: true,
  getCheckinInfo: true,
  checkIsAdmin: true,
  adminGetBookings: true,
  getStats: true,
  getUserInfo: true,
  getMyStats: true,
  getPosts: true,
  getPostDetail: true,
  getAppearance: true,
  getNotice: true,
  getSubscribeTemplate: true,
  getMySuggestions: true,
  getSuggestions: true,
  getFavoriteSeats: true,
  getStudyRanking: true,
  getRoomQrCode: true,
  findScanBooking: true
}

/** 哪些写操作会让哪些缓存失效 */
const INVALIDATE_MAP = {
  createRoom: ['getRooms', 'getRoomsWithStats'],
  updateRoom: ['getRooms', 'getRoomsWithStats', 'getRoomDetail', 'getSeats'],
  deleteRoom: ['getRooms', 'getRoomsWithStats'],
  addSeats: ['getSeats'],
  removeSeats: ['getSeats'],
  updateSeatLayout: ['getSeats'],
  recognizeSeats: ['getSeats'],
  createBooking: ['getMyBookings', 'getSeats', 'getSeatBookings'],
  createBookingBatch: ['getMyBookings', 'getSeats', 'getSeatBookings'],
  cancelBooking: ['getMyBookings', 'getSeats', 'getSeatBookings'],
  deleteMyBookings: ['getMyBookings', 'getSeats', 'getSeatBookings'],
  checkIn: ['getMyBookings', 'getCheckinInfo', 'getSeats'],
  checkOut: ['getMyBookings', 'getCheckinInfo', 'getSeats'],
  updateBookingStatus: ['getMyBookings', 'getSeats', 'getSeatBookings'],
  markSeatOccupied: ['getSeats', 'getSeatBookings'],
  releaseSeatOccupied: ['getSeats', 'getSeatBookings'],
  batchMarkOccupied: ['getSeats', 'getSeatBookings'],
  acquireLock: ['getSeatBookings'],
  releaseLock: ['getSeatBookings'],
  setNotice: ['getNotice'],
  setAppearance: ['getAppearance'],
  saveFavoriteSeat: ['getFavoriteSeats'],
  removeFavoriteSeat: ['getFavoriteSeats'],
  createPost: ['getPosts'],
  deletePost: ['getPosts', 'getPostDetail'],
  toggleLike: ['getPosts', 'getPostDetail'],
  addComment: ['getPosts', 'getPostDetail'],
  createSuggestion: ['getMySuggestions', 'getSuggestions'],
  markSuggestionDone: ['getSuggestions'],
  updateUserInfo: ['getUserInfo'],
  adminSetUserBan: ['adminListUsers'],
  adminDeleteUser: ['adminListUsers'],
  setAdmin: ['adminListUsers']
}

function call(action, data = {}, opts = {}) {
  const skipCache = opts.skipCache === true
  const force = opts.force === true
  const ttl = opts.ttl || CACHE_TTL

  const cacheable = CACHABLE[action]
  const cacheKey = action + ':' + JSON.stringify(data)

  // 读接口：先查缓存
  if (cacheable && !skipCache && !force) {
    const hit = cache.get(cacheKey)
    if (hit !== null) {
      // console.log('[api cache hit]', action)
      return Promise.resolve(hit)
    }
  }

  // console.log('[api]', action)
  return new Promise((resolve, reject) => {
    wx.cloud.callFunction({
      name: 'api',
      data: { action, ...data },
      success: res => {
        if (res.result && res.result.code === 0) {
          const result = res.result.data !== undefined ? res.result.data : res.result
          // 成功 → 读接口缓存；写接口失效相关
          if (cacheable && !skipCache) {
            cache.set(cacheKey, result, ttl)
          } else if (INVALIDATE_MAP[action]) {
            INVALIDATE_MAP[action].forEach(prefix => cache.invalidate(prefix))
          }
          resolve(result)
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

// 公共：让外部（如 pullDownRefresh）强制清除所有缓存
function clearCache() { cache.clear() }

// 自习室
module.exports = {
  clearCache,
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
  updateSeatLayout: (roomId, seats, layoutImage) => call('updateRoom', layoutImage
    ? { roomId, seats, layoutImage }
    : { roomId, seats }),
  recognizeSeatLayout: (roomId, fileID) => call('recognizeSeats', { roomId, fileID }),
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
  adminListUsers: (threshold) => call('adminListUsers', { threshold: threshold || 0 }),
  adminDeleteUser: (openid) => call('adminDeleteUser', { openid }),
  adminExportBookings: (date) => call('adminExportBookings', { date: date || '' }),
  adminGetBookings: (params) => call('adminGetBookings', params || {}),
  updateBookingStatus: (bookingId, status) => call('updateBookingStatus', { bookingId, status }),
  getStats: (date) => call('getStats', { date }),

  // 用户
  getUserInfo: () => call('getUserInfo'),
  updateUserInfo: (data) => call('updateUserInfo', data),
  getMyStats: () => call('getMyStats'),

  // 论坛
  getPosts: (category) => call('getPosts', { category }),
  getPostDetail: (postId) => call('getPostDetail', { postId }),
  createPost: (data) => call('createPost', data),
  deletePost: (postId) => call('deletePost', { postId }),
  toggleLike: (postId) => call('toggleLike', { postId }),
  addComment: (postId, content) => call('addComment', { postId, content }),

  // 外观
  getAppearance: () => call('getAppearance'),
  setAppearance: (data) => call('setAppearance', data),

  // 公告
  getNotice: () => call('getNotice'),
  setNotice: (data) => call('setNotice', data),
  getSubscribeTemplate: () => call('getSubscribeTemplate'),

  // 建议
  createSuggestion: (data) => call('createSuggestion', data),
  getMySuggestions: () => call('getMySuggestions'),
  getSuggestions: () => call('getSuggestions'),
  markSuggestionDone: (id) => call('markSuggestionDone', { id }),

  // 临时锁
  acquireLock: (data) => call('acquireLock', data),
  releaseLock: (data) => call('releaseLock', data),

  // 现场占用
  markSeatOccupied: (data) => call('markSeatOccupied', data),
  releaseSeatOccupied: (data) => call('releaseSeatOccupied', data),
  batchMarkOccupied: (data) => call('batchMarkOccupied', data),

  // 座位收藏
  saveFavoriteSeat: (data) => call('saveFavoriteSeat', data),
  getFavoriteSeats: () => call('getFavoriteSeats'),
  removeFavoriteSeat: (roomId, seatId) => call('removeFavoriteSeat', { roomId, seatId }),

  // 多日连续预约
  createBookingBatch: (data) => call('createBookingBatch', data),

  // 排行榜
  getStudyRanking: (rankMode) => call('getStudyRanking', { rankMode })
}
