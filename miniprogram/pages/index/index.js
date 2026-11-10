// pages/index/index.js
const api = require('../../utils/api.js')
const util = require('../../utils/util.js')
const appearance = require('../../utils/appearance.js')

// 当前北京时间 HH:MM
function nowHM() {
  const d = new Date(Date.now() + 8 * 3600 * 1000)
  const hh = d.getUTCHours() < 10 ? `0${d.getUTCHours()}` : `${d.getUTCHours()}`
  const mm = d.getUTCMinutes() < 10 ? `0${d.getUTCMinutes()}` : `${d.getUTCMinutes()}`
  return `${hh}:${mm}`
}

Page({
  data: {
    rooms: [],
    allRooms: [],
    loading: true,
    wallpaper: null,
    notice: null,
    noticeText: '',
    showNoticeModal: false,
    keyword: '',
    filterMode: 'all', // all | free | open
    matched: true,

    // 自习时长排行榜
    ranking: null,
    rankingMode: 'week'
  },

  onLoad() {
    this.loadRooms()
  },

  loadWallpaper() {
    return getApp().loadAppearance().then(data => {
      this.setData({ wallpaper: appearance.resolve(data) })
    })
  },

  loadNotice() {
    return api.getNotice().then(data => {
      const notice = data && data.enabled ? data : null
      const noticeText = notice ? `${notice.title ? notice.title + '：' : ''}${notice.content || ''}` : ''
      this.setData({ notice, noticeText })
    }).catch(() => {})
  },

  /** 首页快捷入口：扫自习室二维码 → 自动跳转签到页 */
  scanCheckin() {
    wx.scanCode({
      onlyFromCamera: false,
      scanType: ['qrCode'],
      success: (res) => {
        // result 可能是 "s=ab12cd34" 也可能是旧版 "pages/checkin/checkin?s=xxx"
        const raw = res.result || ''
        // 提取 s=xxx 部分
        const m = raw.match(/(?:^|[?&\/])(s)=([A-Za-z0-9]+)/) || raw.match(/^(s)=([A-Za-z0-9]+)/)
        const scene = m ? `s=${m[2]}` : (raw.startsWith('s=') ? raw : '')
        if (!scene) {
          wx.showModal({ title: '无效二维码', content: '请扫描自习室入口张贴的签到码', showCancel: false })
          return
        }
        wx.navigateTo({ url: `/pages/checkin/checkin?scene=${encodeURIComponent(scene)}` })
      },
      fail: (err) => {
        if (err && err.errMsg && err.errMsg.indexOf('cancel') < 0) {
          wx.showToast({ title: '扫码失败', icon: 'none' })
        }
      }
    })
  },

  goToForum() {
    wx.navigateTo({ url: '/pages/forum/forum' })
  },

  goToMyBookings() {
    wx.navigateTo({ url: '/pages/my-bookings/my-bookings' })
  },

  onShow() {
    this.loadRooms()
    this.loadWallpaper()
    this.loadNotice()
    this.loadRanking()
    this.checkTimeoutBookings()
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 0 })
    }
  },

  /** 检查是否有因超时（开始后 15 分钟未签到）被系统自动取消的预约，并有则弹窗提醒 */
  async checkTimeoutBookings() {
    try {
      // 查询条件是 status=booked，返回结果里出现 cancelled 的即云端刚判定超时取消的
      const list = (await api.getMyBookings('booked')) || []
      const cancelled = list.filter(b => b.status === 'cancelled')

      // 前端兜底：云端未取消、但开始时间已过 15 分钟仍未签到的，主动取消
      const overdue = list.filter(b => {
        if (b.status !== 'booked') return false
        const startTs = new Date(`${b.date}T${b.startTime}:00+08:00`).getTime()
        return Date.now() > startTs + 15 * 60000
      })
      for (const b of overdue) {
        try {
          await api.cancelBooking(b._id)
        } catch (e) {
          console.error('取消超时预约失败:', b._id, e)
        }
      }

      const all = cancelled.concat(overdue)
      if (all.length === 0) return
      const lines = all.slice(0, 3).map(b =>
        `${b.roomName || ''} ${b.seatCode || ''}座 ${b.startTime}-${b.endTime}`
      )
      const more = all.length > 3 ? `\n……等共 ${all.length} 条` : ''
      wx.showModal({
        title: '⚠️ 预约已超时取消',
        content: `${lines.join('\n')}${more}\n\n预约开始后 15 分钟内未签到，系统已自动取消该预约。`,
        showCancel: false,
        confirmText: '知道了'
      })
    } catch (err) {
      console.error('检查超时预约失败:', err)
    }
  },

  onPullDownRefresh() {
    Promise.all([this.loadRooms(), this.loadNotice(), this.loadRanking()]).then(() => wx.stopPullDownRefresh())
  },

  async loadRooms() {
    try {
      this.setData({ loading: true })
      const today = util.getToday()
      // 聚合接口一次返回自习室 + 当日已约座位数，避免逐房间的 N+1 请求
      const roomsWithStats = await api.getRoomsWithStats(today)

      // 预计算：剩余座位、是否当前开放
      const hm = nowHM()
      const list = roomsWithStats.map(r => ({
        ...r,
        available: Math.max(0, r.totalSeats - r.bookedToday),
        openNow: r.openTime <= hm && hm <= r.closeTime
      }))

      this.setData({ allRooms: list, loading: false }, () => this.applyFilters())
    } catch (err) {
      this.setData({ loading: false })
    }
  },

  applyFilters() {
    const kw = (this.data.keyword || '').trim()
    const mode = this.data.filterMode
    const list = (this.data.allRooms || []).filter(r => {
      const matchKw = !kw || (r.name || '').indexOf(kw) >= 0 || (r.location || '').indexOf(kw) >= 0
      let matchMode = true
      if (mode === 'free') matchMode = r.available > 0 && r.status !== 'closed'
      if (mode === 'open') matchMode = r.openNow && r.status !== 'closed'
      return matchKw && matchMode
    })
    this.setData({ rooms: list, matched: list.length > 0 })
  },

  /** 检查自习室是否可预约（排除 closed/maintenance） */
  isBookable(room) {
    return room && room.status !== 'closed' && room.status !== 'maintenance'
  },

  onSearchInput(e) {
    this.setData({ keyword: e.detail.value }, () => this.applyFilters())
  },

  clearSearch() {
    this.setData({ keyword: '' }, () => this.applyFilters())
  },

  setFilter(e) {
    const mode = e.currentTarget.dataset.mode
    this.setData({ filterMode: mode }, () => this.applyFilters())
  },

  showNotice() {
    if (!this.data.notice) return
    this.setData({ showNoticeModal: true })
  },

  closeNotice() {
    this.setData({ showNoticeModal: false })
  },

  noop() {},

  async loadRanking() {
    try {
      const ranking = await api.getStudyRanking(this.data.rankingMode)
      this.setData({ ranking })
    } catch (e) {
      // 即使后端没部署 / 网络失败，也给一个空结构，让排行榜区块露出来
      this.setData({
        ranking: {
          mode: this.data.rankingMode,
          totalUsers: 0,
          myRank: 0,
          myMinutes: 0,
          list: []
        }
      })
    }
  },

  toggleRankingMode() {
    const next = this.data.rankingMode === 'week' ? 'month' : 'week'
    this.setData({ rankingMode: next }, () => this.loadRanking())
  },

  goToBooking(e) {
    const { id, name } = e.currentTarget.dataset
    const allRooms = this.data.allRooms || []
    const room = allRooms.find(r => r._id === id)
    // t6: closed 状态不允许进入预约
    if (room && (room.status === 'closed' || room.status === 'maintenance')) {
      const label = room.status === 'closed' ? '暂停开放' : '维护中'
      wx.showToast({ title: `该自习室${label}`, icon: 'none' })
      return
    }
    wx.navigateTo({
      url: `/pages/booking/booking?roomId=${id}&roomName=${encodeURIComponent(name)}`
    })
  }
})
