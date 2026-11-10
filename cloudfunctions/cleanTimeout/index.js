// cloudfunctions/cleanTimeout/index.js
// 一次性运维脚本：清理「系统超时自动取消」的历史预约记录
// 用法：部署后在云开发控制台 → 云函数 → cleanTimeout → 测试（参数留空）
// 传 {"dryRun": true} 只统计数量，不删除
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const BATCH = 20
const MAX_ROUNDS = 100
const CONDITION = { status: 'cancelled', cancelledBy: 'system_timeout' }

exports.main = async (event = {}) => {
  if (event.dryRun) {
    const countRes = await db.collection('bookings').where(CONDITION).count()
    return {
      code: 0,
      dryRun: true,
      total: countRes.total,
      message: `共 ${countRes.total} 条超时取消记录（未删除）`
    }
  }

  let removed = 0

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const res = await db.collection('bookings').where(CONDITION).limit(BATCH).get()
    if (res.data.length === 0) break

    await Promise.all(res.data.map(b => db.collection('bookings').doc(b._id).remove()))
    removed += res.data.length

    if (res.data.length < BATCH) break
  }

  return {
    code: 0,
    removed,
    message: `已清理 ${removed} 条超时取消记录`
  }
}
