// pages/admin/stats/stats.js
const api = require('../../../utils/api.js')
const util = require('../../../utils/util.js')
const { guardAdmin } = require('../../../utils/admin-guard.js')

Page({
  data: {
    stats: null,
    dateFilter: '',
    loading: true
  },

  async onLoad() {
    if (!(await guardAdmin())) return
    this.loadStats()
  },

  async loadStats() {
    try {
      this.setData({ loading: true })
      const date = this.data.dateFilter || undefined
      const stats = await api.getStats(date)

      // 计算百分比
      if (stats.total > 0) {
        stats.bookedPct = Math.round(stats.booked / stats.total * 100)
        stats.checkedinPct = Math.round(stats.checkedin / stats.total * 100)
        stats.completedPct = Math.round(stats.completed / stats.total * 100)
        stats.cancelledPct = Math.round(stats.cancelled / stats.total * 100)
      } else {
        stats.bookedPct = 0
        stats.checkedinPct = 0
        stats.completedPct = 0
        stats.cancelledPct = 0
      }

      // 把 byRoom 对象转换为数组，方便 WXML 遍历
      const roomList = []
      if (stats.byRoom) {
        Object.keys(stats.byRoom).forEach(rid => {
          const room = stats.byRoom[rid]
          roomList.push({
            roomId: rid,
            name: room.name,
            total: room.total,
            pct: stats.total > 0 ? (room.total / stats.total * 100).toFixed(1) : '0.0',
            pctNum: stats.total > 0 ? room.total / stats.total * 100 : 0
          })
        })
      }
      stats.roomList = roomList

      // 时段分布按最大值归一化，方便用横向条形图对比
      const hourly = stats.hourly || []
      const maxCount = hourly.reduce((m, h) => (h.count > m ? h.count : m), 0)
      hourly.forEach(h => { h.pct = maxCount > 0 ? Math.round(h.count / maxCount * 100) : 0 })
      stats.hourly = hourly
      stats.hasHourly = hourly.length > 0

      // 近 7 天趋势：按最大值归一化
      const trend = stats.trend || []
      const maxTrend = trend.reduce((m, t) => (t.total > m ? t.total : m), 0)
      trend.forEach(t => {
        t.totalPct = maxTrend > 0 ? Math.round(t.total / maxTrend * 100) : 0
        t.checkedinPct = maxTrend > 0 ? Math.round(t.checkedin / maxTrend * 100) : 0
        t.label = (t.date || '').slice(5)
      })
      stats.trend = trend
      stats.hasTrend = trend.length > 0

      this.setData({ stats, loading: false })
    } catch {
      this.setData({ loading: false })
    }
  },

  onDateChange(e) {
    this.setData({ dateFilter: e.detail.value })
    this.loadStats()
  },

  clearDate() {
    this.setData({ dateFilter: '' })
    this.loadStats()
  },

  refresh() {
    this.loadStats()
  },

  /** 导出预约明细（CSV） */
  async exportCsv() {
    wx.showLoading({ title: '导出中...', mask: true })
    try {
      const rows = await api.adminExportBookings(this.data.dateFilter || '')
      if (!rows || rows.length === 0) {
        wx.hideLoading()
        wx.showToast({ title: '没有可导出的数据', icon: 'none' })
        return
      }
      const header = ['日期', '自习室', '座位', '开始', '结束', '状态', '取消来源', '用户', 'openid']
      const esc = v => `"${String(v === undefined || v === null ? '' : v).replace(/"/g, '""')}"`
      const lines = [header]
      rows.forEach(r => lines.push([r.date, r.room, r.seat, r.start, r.end, r.status, r.cancelledBy, r.userName, r.openid]))
      const csv = '\ufeff' + lines.map(cols => cols.map(esc).join(',')).join('\r\n')

      const filePath = `${wx.env.USER_DATA_PATH}/预约明细-${this.data.dateFilter || '全部'}.csv`
      wx.getFileSystemManager().writeFileSync(filePath, csv, 'utf8')
      wx.hideLoading()

      if (typeof wx.shareFileMessage === 'function') {
        wx.shareFileMessage({ filePath, fileName: '预约明细.csv', fail: () => this.copyCsv(csv) })
      } else {
        this.copyCsv(csv)
      }
    } catch (err) {
      wx.hideLoading()
      wx.showToast({ title: (err && err.message) || '导出失败', icon: 'none' })
    }
  },

  /** 兜底：复制到剪贴板 */
  copyCsv(csv) {
    wx.setClipboardData({ data: csv, success: () => wx.showToast({ title: '已复制到剪贴板', icon: 'success' }) })
  }
})
