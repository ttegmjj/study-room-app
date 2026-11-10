// cloudfunctions/autoCancelTimeout/index.js
// 定时触发器：每分钟扫一遍，把「开始时间已过15分钟仍未签到」的预约强制取消
// 配置：config.json 里加 triggers，或在云开发控制台手动添加
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const TZ_OFFSET_HOURS = 8
const TIMEOUT_MINUTES = 15
// 仅用于提取北京时间日期字符串，禁止与 parseBeijingDate 结果比较
function getBeijingNow() {
  return new Date(Date.now() + TZ_OFFSET_HOURS * 3600 * 1000)
}

exports.main = async (event, context) => {
  const now = new Date() // 绝对时间比较用真实当前时间
  const beijingNow = getBeijingNow()
  const today = beijingNow.toISOString().split('T')[0]

  // 遍历最近 7 天所有 booked 预约
  const cutoff = new Date(beijingNow.getTime() - 7 * 24 * 3600 * 1000)
  const cutoffDate = cutoff.toISOString().split('T')[0]

  const res = await db.collection('bookings').where({
    status: 'booked',
    date: _.gte(cutoffDate)
  }).limit(100).get()

  let cancelled = 0
  const results = []

  for (const booking of res.data) {
    const bookingStart = new Date(`${booking.date}T${booking.startTime}:00+08:00`)
    const timeoutAt = new Date(bookingStart.getTime() + TIMEOUT_MINUTES * 60000)
    if (now > timeoutAt) {
      await db.collection('bookings').doc(booking._id).update({
        data: {
          status: 'cancelled',
          cancelledBy: 'system_timeout',
          cancelledAt: db.serverDate(),
          cancelReason: '预约超时：开始15分钟后仍未签到，系统自动取消'
        }
      })
      cancelled++
      results.push(`${booking._id} ${booking.date} ${booking.startTime}-${booking.endTime} for ${booking._openid}`)
    }
  }

  return {
    code: 0,
    scanned: res.data.length,
    cancelled,
    results,
    nowUTC: now.toISOString()
  }
}
