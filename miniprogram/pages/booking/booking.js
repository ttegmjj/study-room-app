// pages/booking/booking.js
const api = require('../../utils/api.js')
const util = require('../../utils/util.js')

const SLOT_MINUTES = 30   // 每个滑动槽固定 30 分钟（可配置最小预约时长）

Page({
  data: {
    roomId: '',
    roomName: '',
    roomStatus: 'open',     // t6: open / closed / maintenance
    minMinutes: 30,         // t1: 最短预约时长
    openTime: '08:00',
    closeTime: '22:00',
    layoutImage: '',        // 教室实景底图（拍照识别座位时保存）
    showLayoutImage: false,

    // 日期（日历网格：今天起 7 天内可选，其余灰色）
    selectedDate: '',       // yyyy-MM-dd
    weekHeader: ['一', '二', '三', '四', '五', '六', '日'],
    calendarDays: [],       // [{dateStr, day, selectable, selected, isToday}]

    // 所选时段（由座位时间弹窗设置）
    selectedStartTime: '',  // HH:00
    selectedEndTime: '',    // HH:00

    // AI 推荐
    aiRecommend: '',
    aiLoading: false,

    // 座位
    seats: [],
    bookedSeats: [],
    selectedSeat: null,

    // 时间长条弹窗（双滑块滑动选择）
    showTimeModal: false,
    modalLoading: false,
    hourSlots: [],          // [{label, endLabel, booked, past, selectable}]
    selStartIdx: -1,
    selEndIdx: -1,
    selRangeText: '',
    selStartPct: 0,         // 选中区间左边界百分比
    selEndPct: 0,           // 选中区间右边界百分比
    thumbStartPct: 0,       // 起点滑块中心百分比
    thumbEndPct: 0,         // 终点滑块中心百分比
    thumbStartLabel: '',    // 起点气泡显示的时间（如 '08:30'）
    thumbEndLabel: '',      // 终点气泡显示的时间（如 '09:00'）
    stripTicks: [],         // 长条底部的小时刻度
    stripTotalSlots: 0,
    stripSegWidthPct: '0',
    stripHasAvailable: true,
    // 吸附反馈：'start' / 'end' / '' —— 触发滑块气泡抖动+变红
    bubbleFeedback: '',
    // 滑动过程中的临时状态
    _activeThumb: '',       // 'start' | 'end' | ''
    _stripRectLeft: 0,
    _stripRectWidth: 0,

    loading: false,

    // t2: 收藏座位、t5: 批量预约开关
    favoriteSeats: [],
    showBatchSwitch: false,
    batchDays: 7,
    _currentLockId: ''       // 本次会话加的锁，确认或关闭时释放
  },

  onLoad(options) {
    const roomId = options.roomId
    const roomName = decodeURIComponent(options.roomName || '')

    this.setData({
      roomId,
      roomName,
      selectedDate: util.formatDate(new Date())
    })
    this.buildCalendar()

    this.loadRoomDetail()
    this.loadSeats()
    this.loadFavoriteSeats()
  },

  onShow() {
    // 节流：10 秒内不重复拉收藏（api.js 已有缓存兜底，这里防止切后台回来立即刷）
    const now = Date.now()
    if (!this._lastFavLoad || now - this._lastFavLoad > 10000) {
      this._lastFavLoad = now
      this.loadFavoriteSeats()
    }
  },

  /** 离开页面时释放选座临时锁（防止残留挡住别人） */
  onHide() {
    this.releaseCurrentLock()
  },

  onUnload() {
    this.releaseCurrentLock()
  },

  async loadRoomDetail() {
    try {
      const room = await api.getRoomDetail(this.data.roomId)
      if (room && room.status === 'closed') {
        wx.showModal({
          title: '暂停开放',
          content: '该自习室当前暂停开放，请选择其他自习室',
          showCancel: false,
          success: () => wx.navigateBack()
        })
        return
      }
      this.setData({
        openTime: room.openTime,
        closeTime: room.closeTime,
        layoutImage: room.layoutImage || '',
        minMinutes: Number(room.minMinutes) || 30,
        roomStatus: room.status || 'open'
      })
      wx.setNavigationBarTitle({ title: room.name })
    } catch (err) {
      console.error(err)
      if (err && err.code === 403) {
        wx.showModal({
          title: '暂停开放',
          content: err.message || '该自习室暂停开放',
          showCancel: false,
          success: () => wx.navigateBack()
        })
      }
    }
  },

  // t2: 加载收藏的常用座位（拉取 + 同步座位图上的收藏标记）
  async loadFavoriteSeats() {
    try {
      const list = await api.getFavoriteSeats()
      // 构造一个 roomId_seatId set，快速判断
      const favSet = {}
      ;(list || []).forEach(f => { favSet[f.roomId + '_' + f.seatId] = true })

      // 一次 setData：favoriteSeats + 座位图上的 _favorite 标记
      const seats = (this.data.seats || []).map(group => ({
        ...group,
        seats: (group.seats || []).map(s => ({
          ...s,
          _favorite: !!favSet[this.data.roomId + '_' + s.id]
        }))
      }))
      this.setData({ favoriteSeats: list || [], seats })
    } catch (e) {}
  },

  async askAIRecommend() {
    const { roomName, selectedDate, selectedStartTime, selectedEndTime, seats, bookedSeats, favoriteSeats } = this.data
    if (!selectedStartTime || !selectedEndTime) {
      wx.showToast({ title: '先选好时段再让 AI 推荐', icon: 'none' })
      return
    }

    this.setData({ aiLoading: true, aiRecommend: '' })

    try {
      const flatSeats = []
      ;(seats || []).forEach(g => flatSeats.push(...(g.seats || [])))
      const total = flatSeats.length
      const available = flatSeats.filter(s => !s.booked && !s.occupy)
      const bookedCount = flatSeats.filter(s => s.booked).length
      const occupyCount = flatSeats.filter(s => s.occupy).length
      const nearbyAisles = available.filter(s => s.gapAfter || s.rowGapBefore).length
      const favoriteCodes = (favoriteSeats || []).map(f => f.seatCode).join(', ') || '无'

      // 快速动态推荐（不依赖 AI，秒出）
      const tight = available.length < total * 0.3
      const level = tight ? '紧张' : (available.length > total * 0.7 ? '宽松' : '一般')
      let tip = tight ? '空位紧张，建议动作快！' : '空位充足，放心选～'
      let seatTip = nearbyAisles > 0 ? `过道旁还剩 ${nearbyAisles} 个，进出方便` : '靠里位置更安静'
      const dynamicFallback = `${level}｜${tip} ${seatTip} ✨`

      // AI 尝试（走云函数，稳定）
      try {
        const aiRes = await api.aiRecommendSeat({
          roomName, date: selectedDate,
          startTime: selectedStartTime, endTime: selectedEndTime,
          total, available: available.length, booked: bookedCount,
          occupy: occupyCount, favoriteCodes
        })
        if (aiRes && aiRes.code === 0 && aiRes.data) {
          this.setData({ aiRecommend: aiRes.data })
          return
        }
      } catch (e) {
        console.error('[AI recommend]', e && e.message)
      }
      // AI 不可用降级到动态推荐
      this.setData({ aiRecommend: dynamicFallback })
    } catch (err) {
      console.error('[AI recommend]', err)
      // AI 调不通（403/超时/网络错）→ 给动态推荐
      this.setData({ aiRecommend: dynamicFallback })
    } finally {
      this.setData({ aiLoading: false })
    }
  },

  toggleLayoutImage() {
    this.setData({ showLayoutImage: !this.data.showLayoutImage })
  },

  async loadSeats() {
    try {
      this.setData({ loading: true })
      // 座位图按当天显示：后端已返回 enriched seats，带 booked（预约/现场）和 occupy（现场占用）标记
      const { seats, bookedSeats } = await api.getSeats(this.data.roomId, this.data.selectedDate)
      seats.forEach(s => {
        // 后端已算好 booked/occupy，旧版后端可能没返回 → 前端兜底
        if (s.booked === undefined) s.booked = bookedSeats.indexOf(s.id) >= 0
        if (s.occupy === undefined) s.occupy = false
        // t2: 标记已收藏的座位
        s._favorite = this.data.favoriteSeats.some(f => f.roomId === this.data.roomId && f.seatId === s.id)
      })
      const seatGroups = this.groupSeatsByRow(seats)
      this.setData({
        seats: seatGroups,
        bookedSeats,
        loading: false,
        selectedSeat: null
      })
    } catch (err) {
      this.setData({ loading: false })
    }
  },

  groupSeatsByRow(seats) {
    const groups = {}
    seats.forEach(seat => {
      if (!groups[seat.row]) groups[seat.row] = []
      groups[seat.row].push(seat)
    })
    return Object.keys(groups).sort().map(row => {
      const sorted = groups[row].sort((a, b) => (a.col || 0) - (b.col || 0))
      const gapBefore = sorted.length > 0 && !!sorted[0].rowGapBefore
      return { row, seats: sorted, gapBefore }
    })
  },

  // ========== 日期选择（日历网格） ==========

  /** 构建日历：从今天所在周的周一，到「今天+7」所在周的周日；仅今天~今天+7 可选，其余灰色 */
  buildCalendar() {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const todayStr = util.formatDate(today)
    const max = new Date(today)
    max.setDate(max.getDate() + 7)
    const maxStr = util.formatDate(max)

    // 起点：今天所在周的周一
    const start = new Date(today)
    const dow = today.getDay() === 0 ? 7 : today.getDay()
    start.setDate(start.getDate() - (dow - 1))
    // 终点：maxDate 所在周的周日
    const end = new Date(max)
    const endDow = max.getDay() === 0 ? 7 : max.getDay()
    end.setDate(end.getDate() + (7 - endDow))

    const days = []
    const cur = new Date(start)
    while (cur <= end) {
      const dateStr = util.formatDate(cur)
      days.push({
        dateStr,
        day: cur.getDate(),
        selectable: dateStr >= todayStr && dateStr <= maxStr,
        selected: dateStr === this.data.selectedDate,
        isToday: dateStr === todayStr
      })
      cur.setDate(cur.getDate() + 1)
    }
    this.setData({ calendarDays: days })
  },

  /** 点击日历格子：灰色不可点 */
  onCalendarTap(e) {
    const { date, selectable } = e.currentTarget.dataset
    if (!selectable) return
    this.setData({
      selectedDate: date,
      selectedStartTime: '',
      selectedEndTime: ''
    })
    this.buildCalendar()
    this.loadSeats()
  },

  // ========== 座位选择 → 弹出滑动时间长条 ==========

  async selectSeat(e) {
    const { seatid, seatcode } = e.currentTarget.dataset

    // 该座位被标记为「现场占用」→ 直接提示，不弹时间选择
    // 兼容写法：不用 flatMap（某些小程序基础库版本没有）
    let seatMeta = null
    const groups = this.data.seats || []
    for (let i = 0; i < groups.length; i++) {
      const found = (groups[i].seats || []).find(s => s.id === seatid)
      if (found) { seatMeta = found; break }
    }
    if (seatMeta && seatMeta.occupy) {
      wx.showToast({ title: '该座位现场有人，请选择其他', icon: 'none', duration: 2500 })
      return
    }

    this.setData({
      selectedSeat: { id: seatid, code: seatcode },
      selectedStartTime: '',
      selectedEndTime: '',
      selStartIdx: -1,
      selEndIdx: -1,
      selRangeText: '',
      selStartPct: 0,
      selEndPct: 0,
      thumbStartPct: 0,
      thumbEndPct: 0,
      thumbStartLabel: '',
      thumbEndLabel: '',
      hourSlots: [],
      stripTicks: [],
      stripTotalSlots: 0,
      showTimeModal: true,
      modalLoading: true
    })
    try {
      // t4: 选中座位时尝试加临时锁
      api.acquireLock({
        roomId: this.data.roomId,
        seatId: seatid,
        seatCode: seatcode,
        date: this.data.selectedDate,
        minutes: 2,
        kind: 'selecting'
      }).catch(() => {})
    } catch (e) {}
    try {
      const { slots, occupied } = await api.getSeatBookings(this.data.roomId, seatid, this.data.selectedDate)
      // 双重校验：后端返回全天占用（kind='occupy'）→ 直接关闭弹窗提示
      if (occupied) {
        this.setData({ showTimeModal: false })
        this.releaseCurrentLock()
        wx.showToast({ title: '该座位被现场占用，请选择其他', icon: 'none', duration: 2500 })
        return
      }
      this.buildHourSlots(slots || [])
    } catch (err) {
      this.buildHourSlots([])
    }
    this.setData({ modalLoading: false })
  },

  // t2: 收藏 / 取消收藏
  async toggleFavorite(e) {
    const { seatid, seatcode } = e.currentTarget.dataset
    const rooms_id = this.data.roomId
    const exists = this.data.favoriteSeats.some(s => s.roomId === rooms_id && s.seatId === seatid)

    /** 本地同步：直接改 data 里的 favoriteSeats 数组 + seats 图上的 _favorite 标记，一次 setData */
    const localSync = (fav) => {
      let favList = this.data.favoriteSeats.slice()
      if (fav) {
        if (!favList.some(s => s.roomId === rooms_id && s.seatId === seatid)) {
          favList.push({ roomId: rooms_id, seatId: seatid, seatCode: seatcode, roomName: this.data.roomName })
        }
      } else {
        favList = favList.filter(s => !(s.roomId === rooms_id && s.seatId === seatid))
      }
      // 同步座位图标记
      const seats = this.data.seats || []
      seats.forEach(group => {
        group.seats.forEach(s => {
          if (s.id === seatid) s._favorite = fav
        })
      })
      if (this.data.selectedSeat && this.data.selectedSeat.id === seatid) {
        this.data.selectedSeat._favorite = fav
      }
      this.setData({ favoriteSeats: favList, seats, selectedSeat: this.data.selectedSeat })
    }

    if (exists) {
      try {
        await api.removeFavoriteSeat(rooms_id, seatid)
        localSync(false)
        wx.showToast({ title: '已取消收藏', icon: 'success' })
      } catch (err) {
        wx.showToast({ title: err.message || '操作失败', icon: 'none' })
      }
    } else {
      try {
        await api.saveFavoriteSeat({
          roomId: rooms_id,
          seatId: seatid,
          seatCode: seatcode,
          roomName: this.data.roomName
        })
        localSync(true)
        wx.showToast({ title: '已收藏', icon: 'success' })
      } catch (err) {
        wx.showToast({ title: err.message || '操作失败', icon: 'none' })
      }
    }
  },

  /** 弹窗里的收藏按钮（用 selectedSeat 当前状态） */
  toggleFavoriteModal() {
    const seat = this.data.selectedSeat
    if (!seat) return
    const fakeEvt = {
      currentTarget: {
        dataset: { seatid: seat.id, seatcode: seat.code }
      }
    }
    this.toggleFavorite(fakeEvt)
  },

  /** 判断某座位是否已收藏（给 WXML 用） */
  isFavoriteSeat(seatId) {
    return this.data.favoriteSeats.some(s => s.roomId === this.data.roomId && s.seatId === seatId)
  },

  /** 生成营业时间内的 30 分钟槽；返回 {slots, ticks, totalSlots}，长条滑块用 */
  buildHourSlots(bookedSlots) {
    const [oh, om] = this.data.openTime.split(':').map(Number)
    const [ch, cm] = this.data.closeTime.split(':').map(Number)
    const nowTs = Date.now()

    const startMin = Math.ceil((oh * 60 + om) / 30) * 30
    const endMin = Math.floor((ch * 60 + cm) / 30) * 30
    const totalSlots = Math.max(0, (endMin - startMin) / 30)
    if (totalSlots === 0) {
      this.setData({ hourSlots: [], selStartIdx: -1, selEndIdx: -1, selRangeText: '营业时间异常', stripHasAvailable: false })
      return
    }

    const toLabel = total => `${String(Math.floor(total / 60)).padStart(2, '0')}:${total % 60 === 0 ? '00' : '30'}`

    const slots = []
    let availCount = 0
    for (let m = startMin; m < endMin; m += 30) {
      const label = toLabel(m)
      const endLabel = toLabel(m + 30)
      const booked = bookedSlots.some(s => s.startTime < endLabel && s.endTime > label)
      const past = new Date(`${this.data.selectedDate}T${label}:00+08:00`).getTime() <= nowTs
      const selectable = !booked && !past
      if (selectable) availCount += 1
      slots.push({ label, endLabel, booked, past, selectable })
    }

    const ticks = []
    for (let m = startMin; m <= endMin; m += 60) {
      const pct = ((m - startMin) / (endMin - startMin)) * 100
      ticks.push({ label: toLabel(m), pct })
    }

    // 选中初始值：第一个可用槽 → 第二个可用槽（选半小时）
    let firstAvail = -1
    let secondAvail = -1
    for (let i = 0; i < slots.length; i++) {
      if (slots[i].selectable) {
        if (firstAvail === -1) firstAvail = i
        else if (secondAvail === -1) { secondAvail = i; break }
      }
    }

    this.setData({
      hourSlots: slots,
      stripTicks: ticks,
      stripTotalSlots: totalSlots,
      stripSegWidthPct: (100 / totalSlots).toFixed(3),
      stripHasAvailable: availCount > 0,
      selStartIdx: firstAvail,
      selEndIdx: secondAvail !== -1 ? secondAvail : firstAvail
    }, () => this.refreshStripSelection())
  },

  /** 把百分比索引（浮点数）吸附到最近的可用槽 */
  snapToNearestAvailable(floatIdx, prefer) {
    const slots = this.data.hourSlots
    const total = slots.length
    if (total === 0) return -1
    let target = Math.round(floatIdx)
    target = Math.max(0, Math.min(total - 1, target))
    if (slots[target].selectable) return target
    // 不可用 → 优先向 prefer 方向找，找不到再反向
    const dirs = prefer === 'right' ? [1, -1] : prefer === 'left' ? [-1, 1] : [1, -1]
    for (const d of dirs) {
      for (let i = target + d; i >= 0 && i < total; i += d) {
        if (slots[i].selectable) return i
      }
    }
    return -1
  },

  /** 区间内校验：确保 start..end 之间没有不可用槽；若有则自动截断，返回新的 endIdx */
  clampEndWithinSelectable(startIdx, endIdx) {
    const slots = this.data.hourSlots
    let lastGood = startIdx
    for (let i = startIdx + 1; i <= endIdx; i++) {
      if (!slots[i].selectable) break
      lastGood = i
    }
    return lastGood
  },

  /** 滑动选择：记录当前拖动的是哪个滑块 + 长条容器 rect（touchstart 时查一次） */
  onStripTouchStart(e) {
    if (!this.data.stripHasAvailable) return
    const touch = e.touches[0]
    if (!touch) return

    const { selStartIdx, selEndIdx, stripTotalSlots } = this.data
    const cur = selStartIdx >= 0 ? selStartIdx : 0
    const curEnd = selEndIdx >= 0 ? selEndIdx : 0
    const xFromLeft = touch.clientX

    wx.createSelectorQuery().in(this)
      .select('.time-strip-body').boundingClientRect(rect => {
        if (!rect) return
        const ratio = (xFromLeft - rect.left) / rect.width
        const floatIdx = ratio * stripTotalSlots
        const mid = (cur + curEnd) / 2
        const active = floatIdx <= mid ? 'start' : 'end'
        this.setData({
          _activeThumb: active,
          _stripRectLeft: rect.left,
          _stripRectWidth: rect.width
        })
        this.updateStripByFloat(floatIdx)
      }).exec()
  },

  onStripTouchMove(e) {
    const touch = e.touches[0]
    if (!touch || !this.data._activeThumb) return
    const { _stripRectLeft, _stripRectWidth, stripTotalSlots } = this.data
    if (!_stripRectWidth) return
    const ratio = (touch.clientX - _stripRectLeft) / _stripRectWidth
    const clamped = Math.max(0, Math.min(1, ratio))
    // 帧级节流：缓存当前浮点索引，33ms 内只处理最后一次（约 30fps）
    this._pendingFloatIdx = clamped * stripTotalSlots
    if (this._stripThrottleTimer) return
    this._stripThrottleTimer = setTimeout(() => {
      this._stripThrottleTimer = null
      const idx = this._pendingFloatIdx
      if (idx !== undefined) this.updateStripByFloat(idx)
    }, 33)
  },

  onStripTouchEnd() {
    // 立即刷新最后一次位置，不留尾帧
    if (this._stripThrottleTimer) {
      clearTimeout(this._stripThrottleTimer)
      this._stripThrottleTimer = null
    }
    if (this._pendingFloatIdx !== undefined) {
      this.updateStripByFloat(this._pendingFloatIdx)
      this._pendingFloatIdx = undefined
    }
    this.setData({ _activeThumb: '', _stripRectLeft: 0, _stripRectWidth: 0 })
  },

  /** 根据浮点槽索引更新选中区间（核心 —— 合并 setData 降频） */
  updateStripByFloat(floatIdx) {
    const active = this.data._activeThumb
    const slots = this.data.hourSlots
    const total = slots.length
    if (!total) return

    const rawIdx = Math.round(Math.max(0, Math.min(total - 1, floatIdx)))
    let snapped, clampedEnd
    const patch = {}

    if (active === 'start') {
      snapped = this.snapToNearestAvailable(floatIdx, 'right')
      if (snapped < 0) return
      const endIdx = this.data.selEndIdx >= 0 ? this.data.selEndIdx : total - 1
      if (snapped > endIdx) snapped = this.snapToNearestAvailable(endIdx, 'left')
      clampedEnd = this.clampEndWithinSelectable(snapped, endIdx)
      if (snapped < 0) return
      patch.selStartIdx = snapped
      patch.selEndIdx = clampedEnd
    } else if (active === 'end') {
      snapped = this.snapToNearestAvailable(floatIdx, 'right')
      if (snapped < 0) return
      const startIdx = this.data.selStartIdx >= 0 ? this.data.selStartIdx : 0
      if (snapped < startIdx) snapped = this.snapToNearestAvailable(startIdx, 'right')
      patch.selEndIdx = snapped
    }

    // 吸附反馈：原始目标 != snapped 槽 → 说明被拉回/跳过了不可选段
    if (snapped !== undefined && rawIdx !== snapped && active) {
      patch.bubbleFeedback = active
      if (!this._snapToastTimer) {
        wx.showToast({ title: '已跳到可用时段', icon: 'none', duration: 700 })
      }
      clearTimeout(this._snapToastTimer)
      this._snapToastTimer = setTimeout(() => {
        this.setData({ bubbleFeedback: '' })
      }, 220)
    }

    // 合并：selStartIdx/selEndIdx + 6 个百分比/标签字段 → 一次 setData
    Object.assign(patch, this._calcStripSelection(patch))
    this.setData(patch)
  },

  /** 纯计算：根据 selStartIdx/selEndIdx 算出长条渲染需要的 6 个字段（无 setData） */
  _calcStripSelection(override) {
    const slots = this.data.hourSlots
    const selStartIdx = override.selStartIdx !== undefined ? override.selStartIdx : this.data.selStartIdx
    const selEndIdx = override.selEndIdx !== undefined ? override.selEndIdx : this.data.selEndIdx
    const total = slots.length
    let selStartPct = 0, selEndPct = 0, thumbStartPct = 0, thumbEndPct = 0
    let thumbStartLabel = '', thumbEndLabel = '', selRangeText = ''

    if (selStartIdx >= 0 && selEndIdx >= 0 && total > 0) {
      selStartPct = (selStartIdx / total) * 100
      selEndPct = ((selEndIdx + 1) / total) * 100
      thumbStartPct = ((selStartIdx + 0.5) / total) * 100
      thumbEndPct = ((selEndIdx + 0.5) / total) * 100
      thumbStartLabel = slots[selStartIdx].label
      thumbEndLabel = slots[selEndIdx].endLabel
      selRangeText = `${slots[selStartIdx].label} - ${slots[selEndIdx].endLabel}`
    } else if (selStartIdx >= 0 && total > 0) {
      selStartPct = (selStartIdx / total) * 100
      selEndPct = ((selStartIdx + 1) / total) * 100
      thumbStartPct = thumbEndPct = ((selStartIdx + 0.5) / total) * 100
      thumbStartLabel = slots[selStartIdx].label
      thumbEndLabel = slots[selStartIdx].endLabel
      selRangeText = `${slots[selStartIdx].label} - ${slots[selStartIdx].endLabel}`
    }
    return { selStartPct, selEndPct, thumbStartPct, thumbEndPct, thumbStartLabel, thumbEndLabel, selRangeText }
  },

  /** 刷新长条选中态 + 滑块位置百分比 + 已选文本（保留给 buildHourSlots/confirm 等场景） */
  refreshStripSelection() {
    this.setData(this._calcStripSelection({}))
  },

  /** 弹窗确定：把所选时段写回主页面 */
  confirmTimeSel() {
    const { selStartIdx, selEndIdx, hourSlots } = this.data
    if (selStartIdx < 0 || selEndIdx < 0) {
      wx.showToast({ title: '请在长条上滑动选择时段', icon: 'none' })
      return
    }
    const selectedStartTime = hourSlots[selStartIdx].label
    const selectedEndTime = hourSlots[selEndIdx].endLabel
    this.setData({ selectedStartTime, selectedEndTime, showTimeModal: false })
  },

  closeTimeModal() {
    this.setData({ showTimeModal: false })
  },

  noop() {},

  /** 请求订阅消息授权（超时/开始提醒用；云端未配置模板 ID 时自动跳过） */
  requestSubscribe() {
    const tmplId = (getApp().globalData.subscribeTemplateId || '').trim()
    if (!tmplId) return
    wx.requestSubscribeMessage({
      tmplIds: [tmplId],
      fail: (err) => console.warn('订阅消息授权失败:', err)
    })
  },

  // ========== 确认预约 ==========

  /** 释放当前选中座位的锁（成功或失败都要释放，避免残留） */
  releaseCurrentLock() {
    if (!this.data.selectedSeat) return
    api.releaseLock({
      roomId: this.data.roomId,
      seatId: this.data.selectedSeat.id,
      date: this.data.selectedDate,
      kind: 'selecting'
    }).catch(() => {})
  },

  async confirmBooking() {
    const { selectedDate, selectedStartTime, selectedEndTime, selectedSeat, roomId, roomName, minMinutes, showBatchSwitch, batchDays } = this.data

    if (!selectedSeat) {
      wx.showToast({ title: '请先点击座位选择时段', icon: 'none' })
      return
    }
    if (!selectedStartTime || !selectedEndTime) {
      wx.showToast({ title: '请在弹窗中选择时间段', icon: 'none' })
      return
    }

    // 检查是否超出营业时间
    if (selectedStartTime < this.data.openTime || selectedEndTime > this.data.closeTime) {
      wx.showToast({ title: `营业时间 ${this.data.openTime}-${this.data.closeTime}`, icon: 'none' })
      return
    }

    // t1: 前端校验最短时长
    const durationMin = (parseInt(selectedEndTime.slice(0, 2)) * 60 + parseInt(selectedEndTime.slice(3))) -
                        (parseInt(selectedStartTime.slice(0, 2)) * 60 + parseInt(selectedStartTime.slice(3)))
    if (durationMin < minMinutes) {
      wx.showToast({ title: `最少预约 ${minMinutes} 分钟`, icon: 'none' })
      return
    }

    // 已结束的时段不能预约，否则会被超时机制立刻取消
    const endMoment = new Date(`${selectedDate}T${selectedEndTime}:00+08:00`)
    if (endMoment.getTime() <= Date.now()) {
      wx.showToast({ title: '该时段已结束，请选择未来的时间', icon: 'none' })
      return
    }

    const slotLabel = `${selectedStartTime} - ${selectedEndTime}`

    const modalContent = showBatchSwitch
      ? `${roomName}\n📅 ${selectedDate} 起连续 ${batchDays} 天\n⏰ 每天 ${slotLabel}\n🪑 ${selectedSeat.code}`
      : `${roomName}\n📅 ${selectedDate}\n⏰ ${slotLabel}\n🪑 ${selectedSeat.code}`

    wx.showModal({
      title: showBatchSwitch ? '批量连续预约' : '确认预约',
      content: modalContent,
      success: async (res) => {
        if (res.confirm) {
          this.setData({ loading: true })
          try {
            if (showBatchSwitch) {
              // t5: 批量预约
              const result = await api.createBookingBatch({
                roomId, roomName,
                seatId: selectedSeat.id,
                seatCode: selectedSeat.code,
                startDate: selectedDate,
                startTime: selectedStartTime,
                endTime: selectedEndTime,
                days: batchDays
              })
              const { created, skipped, failed } = result
              this.releaseCurrentLock()
              wx.showModal({
                title: '批量预约完成',
                content: `✅ 成功 ${created} 条\n⏭️ 跳过 ${skipped} 条\n❌ 失败 ${failed} 条`,
                showCancel: false,
                success: () => {
                  if (created > 0) {
                    this.requestSubscribe()
                    setTimeout(() => wx.navigateTo({ url: '/pages/my-bookings/my-bookings' }), 1000)
                  }
                }
              })
            } else {
              // 单次预约
              const result = await api.createBooking({
                roomId,
                roomName,
                seatId: selectedSeat.id,
                seatCode: selectedSeat.code,
                date: selectedDate,
                startTime: selectedStartTime,
                endTime: selectedEndTime
              })
              this.releaseCurrentLock()
              if (result && result.code && result.code !== 0) {
                wx.showToast({ title: result.message || '预约失败', icon: 'none' })
              } else {
                wx.showToast({ title: '预约成功', icon: 'success' })
                this.requestSubscribe()
                setTimeout(() => wx.navigateTo({ url: '/pages/my-bookings/my-bookings' }), 1500)
              }
            }
          } catch (err) {
            this.releaseCurrentLock()
            wx.showToast({ title: (err && (err.message || err.errMsg)) || '预约失败', icon: 'none' })
          } finally {
            this.setData({ loading: false })
          }
        }
      }
    })
  },

  // t5: 切换批量预约开关
  toggleBatchSwitch(e) {
    this.setData({ showBatchSwitch: e.detail.value })
  },

  onBatchDaysChange(e) {
    this.setData({ batchDays: Number(e.detail.value) || 7 })
  }
})
