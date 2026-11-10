// utils/util.js - 通用工具函数

// 格式化日期 YYYY-MM-DD
const formatDate = (date) => {
  const d = new Date(date)
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

// 格式化时间 HH:mm
const formatTime = (date) => {
  const d = new Date(date)
  const hour = String(d.getHours()).padStart(2, '0')
  const minute = String(d.getMinutes()).padStart(2, '0')
  return `${hour}:${minute}`
}

// 格式化日期时间
const formatDateTime = (date) => {
  return `${formatDate(date)} ${formatTime(date)}`
}

// 获取今天
const getToday = () => formatDate(new Date())

// 获取未来N天的日期列表
const getDateList = (days = 7) => {
  const list = []
  for (let i = 0; i < days; i++) {
    const date = new Date()
    date.setDate(date.getDate() + i)
    list.push({
      date: formatDate(date),
      label: i === 0 ? '今天' : i === 1 ? '明天' : formatWeekday(date)
    })
  }
  return list
}

const formatWeekday = (date) => {
  const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
  return weekdays[date.getDay()]
}

// 预约状态文字
const statusText = {
  booked: { text: '已预约', tagClass: 'tag-booked' },
  checkedin: { text: '已签到', tagClass: 'tag-checkedin' },
  completed: { text: '已完成', tagClass: 'tag-completed' },
  cancelled: { text: '已取消', tagClass: 'tag-cancelled' }
}

// 座位类型文字
const seatTypeText = {
  normal: '普通',
  power: '充电',
  window: '靠窗',
  vip: 'VIP'
}

// 相对时间（论坛用）
const formatTimeAgo = (time) => {
  if (!time) return ''
  const t = new Date(time)
  const diff = Date.now() - t.getTime()
  if (diff < 60000) return '刚刚'
  if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`
  if (diff < 7 * 86400000) return `${Math.floor(diff / 86400000)} 天前`
  return formatDate(t)
}

module.exports = {
  formatDate,
  formatTime,
  formatDateTime,
  formatTimeAgo,
  getToday,
  getDateList,
  formatWeekday,
  statusText,
  seatTypeText
}
