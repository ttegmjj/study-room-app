// pages/admin/seats/seats.js
const api = require('../../../utils/api.js')
const util = require('../../../utils/util.js')
const { guardAdmin } = require('../../../utils/admin-guard.js')

Page({
  data: {
    roomId: '',
    roomName: '',
    rooms: [],
    seats: [],
    seatGroups: [],
    showAddModal: false,
    layoutMode: false,
    // 现场占用模式：开启后点击座位会在「正常/现场占用」之间切换
    occupyMode: false,
    addForm: {
      rows: 'A,B,C',
      colsPerRow: '3',
      startNum: '1'
    },
    loading: true
  },

  async onLoad(options) {
    if (!(await guardAdmin())) return
    const roomId = options.roomId || ''
    const roomName = decodeURIComponent(options.roomName || '')
    this.setData({ roomId, roomName })
    if (roomId) {
      wx.setNavigationBarTitle({ title: `${roomName} - 座位管理` })
      this.loadSeats()
    } else {
      // 从管理后台菜单直接进入：先选择自习室
      this.loadRoomPicker()
    }
  },

  async loadRoomPicker() {
    try {
      this.setData({ loading: true })
      const rooms = await api.getRooms()
      this.setData({ rooms, loading: false })
    } catch (err) {
      this.setData({ loading: false })
    }
  },

  pickRoom(e) {
    const { id, name } = e.currentTarget.dataset
    this.setData({ roomId: id, roomName: name })
    wx.setNavigationBarTitle({ title: `${name} - 座位管理` })
    this.loadSeats()
  },

  async loadSeats() {
    try {
      this.setData({ loading: true })
      const { seats } = await api.getSeats(this.data.roomId, util.getToday())
      const seatGroups = this.groupByRow(seats)
      this.setData({
        seats,
        seatGroups,
        loading: false
      })
    } catch (err) {
      console.error('[loadSeats] 失败:', err)
      this.setData({ loading: false })
      wx.showToast({ title: '加载失败', icon: 'none' })
    }
  },

  groupByRow(seats) {
    const groups = {}
    seats.forEach(s => {
      if (!groups[s.row]) groups[s.row] = []
      groups[s.row].push(s)
    })
    return Object.keys(groups).sort().map(row => {
      const sorted = groups[row].sort((a, b) => a.col - b.col)
      const gapBefore = sorted.length > 0 && !!sorted[0].rowGapBefore
      return { row, seats: sorted, gapBefore }
    })
  },

  showAdd() {
    if (this.data.layoutMode) return
    this.setData({ showAddModal: true })
  },

  /** 拍照/选图识别座位布局（云开发 AI 多模态），结果需确认后才会替换现有座位 */
  recognizeByPhoto() {
    if (this.data.layoutMode) return
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['camera', 'album'],
      sizeType: ['compressed'],
      success: (res) => {
        this.uploadAndRecognize(res.tempFiles[0].tempFilePath)
      }
    })
  },

  async uploadAndRecognize(filePath) {
    wx.showLoading({ title: '识别中...', mask: true })
    try {
      const fileID = await new Promise((resolve, reject) => {
        wx.cloud.uploadFile({
          cloudPath: `seat-layouts/${this.data.roomId}-${Date.now()}.jpg`,
          filePath,
          success: (r) => resolve(r.fileID),
          fail: () => reject(new Error('图片上传失败'))
        })
      })
      const result = await api.recognizeSeatLayout(this.data.roomId, fileID)
      wx.hideLoading()
      this.confirmApplyRecognized(result)
    } catch (err) {
      wx.hideLoading()
      wx.showToast({ title: (err && err.message) || '识别失败', icon: 'none' })
    }
  },

  confirmApplyRecognized(result) {
    const seats = (result && result.seats) || []
    if (seats.length === 0) {
      wx.showToast({ title: '未识别到座位，请换个角度重拍', icon: 'none' })
      return
    }
    const summary = (result && result.summary) || {}
    wx.showModal({
      title: '识别结果',
      content: `识别到 ${summary.rows || '?'} 排、共 ${seats.length} 个座位。\n确认后将替换当前全部座位。`,
      confirmText: '替换保存',
      success: async (res) => {
        if (!res.confirm) return
        wx.showLoading({ title: '保存中...' })
        try {
          // 同时把识别原图存为自习室底图，学生端座位图可对照实景查看
          await api.updateSeatLayout(this.data.roomId, seats, result.fileID || '')
          wx.hideLoading()
          wx.showToast({ title: `已生成 ${seats.length} 个座位`, icon: 'success' })
          this.loadSeats()
        } catch (err) {
          wx.hideLoading()
          wx.showToast({ title: (err && err.message) || '保存失败', icon: 'none' })
        }
      }
    })
  },

  closeAdd() {
    this.setData({ showAddModal: false })
  },

  onAddInput(e) {
    const { field } = e.currentTarget.dataset
    this.setData({ [`addForm.${field}`]: e.detail.value })
  },

  /** 解析排号输入：支持 "A,B,C"、"A-F"、"A，C"、小写、空格分隔、数字排号 */
  parseRows(input) {
    const rows = []
    if (!input) return rows
    input.split(/[,，、\s;；]+/).forEach(part => {
      part = part.trim()
      if (!part) return
      // 字母区间 A-F
      const letterRange = part.toUpperCase().match(/^([A-Z])(?:[-~～到至—]([A-Z]))?$/)
      if (letterRange) {
        const start = letterRange[1].charCodeAt(0)
        const end = letterRange[2] ? letterRange[2].charCodeAt(0) : start
        for (let c = start; c <= end && rows.length < 30; c++) {
          const letter = String.fromCharCode(c)
          if (rows.indexOf(letter) < 0) rows.push(letter)
        }
        return
      }
      // 数字区间 1-10
      const numRange = part.match(/^(\d{1,2})(?:[-~～到至—](\d{1,2}))?$/)
      if (numRange) {
        const start = parseInt(numRange[1])
        const end = numRange[2] ? parseInt(numRange[2]) : start
        for (let n = start; n <= end && rows.length < 30; n++) {
          const label = String(n)
          if (rows.indexOf(label) < 0) rows.push(label)
        }
        return
      }
      // 单个字母
      if (/^[A-Za-z]$/.test(part)) {
        const letter = part.toUpperCase()
        if (rows.indexOf(letter) < 0) rows.push(letter)
      } else if (/^\d{1,2}$/.test(part)) {
        if (rows.indexOf(part) < 0) rows.push(part)
      }
    })
    return rows
  },

  noop() {},

  async batchAdd() {
    const { rows, colsPerRow, startNum } = this.data.addForm
    const rowList = this.parseRows(rows)
    const cols = parseInt(colsPerRow)
    const start = parseInt(startNum)

    if (rowList.length === 0 || !cols || cols > 20 || isNaN(start)) {
      wx.showToast({ title: '参数无效', icon: 'none' })
      return
    }

    const existingIds = this.data.seats.map(s => s.id)
    const newSeats = []

    rowList.forEach(row => {
      for (let i = 0; i < cols; i++) {
        const num = start + i
        const id = `${row}${String(num).padStart(2, '0')}`
        if (!existingIds.includes(id)) {
          newSeats.push({ id, code: id, row, col: num })
        }
      }
    })

    if (newSeats.length === 0) {
      wx.showToast({ title: '没有新增座位', icon: 'none' })
      this.setData({ showAddModal: false })
      return
    }

    wx.showLoading({ title: '添加中...' })
    try {
      await api.addSeats(this.data.roomId, newSeats)
      wx.hideLoading()
      wx.showToast({ title: `已添加 ${newSeats.length} 个座位`, icon: 'success' })
      this.setData({ showAddModal: false })
      this.loadSeats()
    } catch (err) {
      wx.hideLoading()
      wx.showToast({ title: (err && err.message) || '添加失败', icon: 'none' })
    }
  },

  /** 统一的点击入口，根据当前模式分发 */
  onAdminSeatTap(e) {
    if (this.data.layoutMode) {
      this.onSeatTap(e)
    } else if (this.data.occupyMode) {
      this.onOccupySeat(e)
    }
    // 普通模式下点击座位无操作
  },

  /** 统一的长按入口，现场占用/布局模式下禁用 */
  onAdminSeatLongpress(e) {
    if (this.data.layoutMode || this.data.occupyMode) return
    this.removeSeat(e)
  },

  // ========== 布局模式（调整座位间隔 + 排间过道） ==========

  enterLayout() {
    this.setData({ layoutMode: true })
  },

  cancelLayout() {
    this.setData({ layoutMode: false })
    this.loadSeats() // 放弃未保存的修改
  },

  /** 布局模式下点击座位：切换它右方的间隔（连续无间隔的座位即为连座） */
  onSeatTap(e) {
    if (!this.data.layoutMode) return
    const { id } = e.currentTarget.dataset
    const seats = this.data.seats.map(s =>
      s.id === id ? Object.assign({}, s, { gapAfter: !s.gapAfter }) : s
    )
    this.setData({ seats, seatGroups: this.groupByRow(seats) })
  },

  /** 布局模式下点击排标题：切换该排之前是否为过道 */
  onRowTap(e) {
    if (!this.data.layoutMode) return
    const { row } = e.currentTarget.dataset
    const seats = this.data.seats.slice()
    // 找到该排第一个座位，切换 rowGapBefore
    const firstIdx = seats.findIndex(s => s.row === row)
    if (firstIdx >= 0) {
      seats[firstIdx] = Object.assign({}, seats[firstIdx], {
        rowGapBefore: !seats[firstIdx].rowGapBefore
      })
      this.setData({ seats, seatGroups: this.groupByRow(seats) })
    }
  },

  async saveLayout() {
    wx.showLoading({ title: '保存中...' })
    try {
      await api.updateSeatLayout(this.data.roomId, this.data.seats)
      wx.hideLoading()
      wx.showToast({ title: '布局已保存', icon: 'success' })
      this.setData({ layoutMode: false })
    } catch (err) {
      wx.hideLoading()
      wx.showToast({ title: (err && err.message) || '保存失败', icon: 'none' })
    }
  },

  // ========== 现场占用模式 ==========

  toggleOccupyMode() {
    this.setData({ occupyMode: !this.data.occupyMode })
  },

  async onOccupySeat(e) {
    if (!this.data.occupyMode) return
    const { id, code } = e.currentTarget.dataset
    const today = util.getToday()
    const seats = this.data.seats || []
    const seat = seats.find(s => s.id === id)
    const isOccupy = seat && seat.occupy

    wx.showLoading({ title: '处理中...' })
    try {
      if (isOccupy) {
        await api.releaseSeatOccupied({ roomId: this.data.roomId, seatId: id, date: today })
        wx.showToast({ title: `已释放 ${code}`, icon: 'success' })
      } else {
        await api.markSeatOccupied({
          roomId: this.data.roomId, seatId: id, seatCode: code, date: today, reason: '现场有人'
        })
        wx.showToast({ title: `已标记 ${code} 现场占用`, icon: 'none' })
      }
      this.loadSeats()
    } catch (err) {
      wx.showToast({ title: err.message || '操作失败', icon: 'none' })
    } finally {
      wx.hideLoading()
    }
  },

  async batchReleaseAllOccupy() {
    const today = util.getToday()
    const occupyIds = (this.data.seats || []).filter(s => s.occupy).map(s => s.id)
    if (occupyIds.length === 0) {
      wx.showToast({ title: '当前没有现场占用的座位', icon: 'none' })
      return
    }
    wx.showModal({
      title: '批量释放',
      content: `确定释放 ${occupyIds.length} 个现场占用的座位？`,
      success: async (res) => {
        if (!res.confirm) return
        wx.showLoading({ title: '释放中...' })
        try {
          await api.batchMarkOccupied({
            roomId: this.data.roomId, date: today, seatIds: occupyIds, action: 'release'
          })
          wx.hideLoading()
          wx.showToast({ title: '已全部释放', icon: 'success' })
          this.loadSeats()
        } catch (err) {
          wx.hideLoading()
          wx.showToast({ title: err.message || '操作失败', icon: 'none' })
        }
      }
    })
  },

  async removeSeat(e) {
    if (this.data.layoutMode) return
    const { id, code } = e.currentTarget.dataset
    wx.showModal({
      title: '删除座位',
      content: `确定删除座位 ${code} 吗？`,
      confirmColor: '#ff6b6b',
      success: async (res) => {
        if (res.confirm) {
          try {
            await api.removeSeats(this.data.roomId, [id])
            wx.showToast({ title: '已删除', icon: 'success' })
            this.loadSeats()
          } catch (err) {
            wx.showToast({ title: (err && err.message) || '删除失败', icon: 'none' })
          }
        }
      }
    })
  },

  async clearAll() {
    if (this.data.seats.length === 0 || this.data.layoutMode) return
    wx.showModal({
      title: '清空座位',
      content: `确定清空所有 ${this.data.seats.length} 个座位吗？`,
      confirmColor: '#ff6b6b',
      success: async (res) => {
        if (res.confirm) {
          const ids = this.data.seats.map(s => s.id)
          try {
            await api.removeSeats(this.data.roomId, ids)
            wx.showToast({ title: '已清空', icon: 'success' })
            this.loadSeats()
          } catch (err) {
            wx.showToast({ title: (err && err.message) || '清空失败', icon: 'none' })
          }
        }
      }
    })
  }
})
