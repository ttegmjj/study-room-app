// api/index.js
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV, timeout: 60000 })
const db = cloud.database()
const _ = db.command

// ============ 时区工具（云函数运行在 UTC 服务器，存的是北京时间，需转换） ============

const TZ_OFFSET_HOURS = 8 // 北京时间 UTC+8

/** 把本地日期时间字符串（如 '2026-10-30T14:00:00'）当作北京时间解析为 Date */
function parseBeijingDate(dateStr) {
  // 直接解析 ISO 格式会被当作服务器本地时区（UTC），需要显式加 +08:00
  return new Date(`${dateStr}+08:00`)
}

/** 获取当前北京时间的 Date 对象（仅用于 getUTC* 提取北京时间的年月日，禁止与 parseBeijingDate 结果做大小比较） */
function getBeijingNow() {
  const now = new Date()
  return new Date(now.getTime() + TZ_OFFSET_HOURS * 3600 * 1000)
}

/** 兜底：预约开始后 15 分钟仍未签到 → 自动取消（返回 true 表示刚取消） */
async function autoCancelIfTimeout(booking) {
  if (!booking || booking.data.status !== 'booked') return false
  const now = new Date() // 绝对时间比较必须用真实当前时间
  const start = parseBeijingDate(`${booking.data.date}T${booking.data.startTime}:00`)
  const timeoutAt = new Date(start.getTime() + 15 * 60000)
  if (now > timeoutAt) {
    await db.collection('bookings').doc(booking._id).update({
      data: {
        status: 'cancelled',
        cancelledBy: 'system_timeout',
        cancelledAt: db.serverDate(),
        cancelReason: '预约超时：开始15分钟后仍未签到，系统自动取消'
      }
    })
    console.log('[autoCancel] 自动取消超时预约:', booking._id)
    await recordNoShow(booking.data._openid)
    return true
  }
  return false
}

/** 定时任务（每分钟）：扫描仍为 booked 的预约，把开始 15 分钟后未签到的自动取消 */
async function autoCancelOverdueBookings() {
  const res = await db.collection('bookings')
    .where({ status: 'booked' })
    .limit(200)
    .get()

  let cancelledCount = 0
  for (const b of res.data) {
    // 管理员豁免：不自动取消管理员的预约
    try {
      const uRes = await db.collection('users').where({ _openid: b._openid }).get()
      if (uRes.data[0] && uRes.data[0].isAdmin) {
        console.log(`[autoCancel] 跳过管理员预约: ${b._id}`)
        continue
      }
    } catch (e) {}
    const wasCancelled = await autoCancelIfTimeout({ _id: b._id, data: b })
    if (wasCancelled) {
      cancelledCount += 1
      await sendSubscribeNotice(b._openid, {
        thing1: '预约超时已自动取消',
        thing2: `${b.roomName || ''} ${b.seatCode || ''}号座位`,
        time3: `${b.date} ${b.startTime}-${b.endTime}`
      })
    }
  }
  console.log(`[Timer] 扫描 booked 预约 ${res.data.length} 条，取消超时 ${cancelledCount} 条`)
  return { code: 0, data: { scanned: res.data.length, cancelled: cancelledCount } }
}

/** 定时任务：结束时间到点仍未签退 → 自动签退（结束即完成） */
async function autoCheckoutOverdueBookings() {
  const res = await db.collection('bookings')
    .where({ status: 'checkedin' })
    .limit(200)
    .get()

  let count = 0
  for (const b of res.data) {
    const end = parseBeijingDate(`${b.date}T${b.endTime}:00`)
    // 结束时间到了就自动签退（留 3 分钟缓冲给可能的时钟偏差）
    if (Date.now() <= end.getTime() + 3 * 60000) continue

    await db.collection('bookings').doc(b._id).update({
      data: {
        status: 'completed',
        checkOutTime: db.serverDate(),
        autoCheckout: true,
        checkOutNote: '预约结束时间到，系统自动签退'
      }
    })
    count += 1
    // 通知用户已自动签退
    await sendSubscribeNotice(b._openid, {
      thing1: '已自动签退，今天的自习结束啦',
      thing2: `${b.roomName || ''} ${b.seatCode || ''}号座位`,
      time3: `${b.date} ${b.startTime}-${b.endTime}`
    })
  }
  console.log(`[Timer] 自动签退 ${count} 条`)
  return { code: 0, data: { autoCheckout: count } }
}

/** 定时任务：预约开始前 30 分钟内发一次提醒（每条预约只发一次） */
async function sendStartReminders() {
  const today = getBeijingDateStr()
  const res = await db.collection('bookings')
    .where({ date: today, status: 'booked' })
    .limit(200)
    .get()

  const now = Date.now()
  // 先从云端预过滤：只取"开始时间在未来 30 分钟内"的预约，减少无效遍历
  const nowStr = new Date(now + 3600000).toISOString().slice(11, 16) // 当前小时 +1 作为边界
  let sent = 0
  for (const b of res.data) {
    if (b.remindedStart) continue
    const start = parseBeijingDate(`${b.date}T${b.startTime}:00`)
    const mins = Math.floor((start.getTime() - now) / 60000)
    // 只处理开始前 1~30 分钟内的（mins<0 是已开始的，跳过；mins>30 是太远的）
    if (mins < 1 || mins > 30) continue

    const ok = await sendSubscribeNotice(b._openid, {
      thing1: '你的预约即将开始，记得签到',
      thing2: `${b.roomName || ''} ${b.seatCode || ''}号座位`,
      time3: `${b.date} ${b.startTime}-${b.endTime}`
    })
    await db.collection('bookings').doc(b._id).update({ data: { remindedStart: true } })
    if (ok) sent += 1
  }
  console.log(`[Timer] 开始前提醒发送 ${sent} 条`)
  return { code: 0, data: { reminded: sent } }
}

/** 记录一次爽约；连续 3 次则禁止预约 1 天（正常签到后清零）
 *  管理员豁免：isAdmin 用户不累计爽约、不受禁约限制 */
async function recordNoShow(openid) {
  if (!openid) return
  try {
    const res = await db.collection('users').where({ _openid: openid }).get()
    if (res.data.length === 0) return
    const u = res.data[0]
    // 管理员豁免：不累计爽约
    if (u.isAdmin) {
      console.log(`[noShow] ${openid} 是管理员，豁免爽约`)
      return
    }
    const count = (u.noShowCount || 0) + 1
    const shouldBan = count >= 3
    await db.collection('users').doc(u._id).update({
      data: {
        noShowCount: shouldBan ? 0 : count,
        banUntil: shouldBan ? new Date(Date.now() + 24 * 3600 * 1000) : (u.banUntil || null),
        updatedAt: db.serverDate()
      }
    })
    console.log(`[noShow] ${openid} 连续爽约 ${count} 次${shouldBan ? '，已限制预约 1 天' : ''}`)
  } catch (e) {
    console.error('[noShow] 记录失败:', e)
  }
}

// ============ 订阅消息 ============

/** 订阅消息模板 ID（在云函数环境变量 SUBSCRIBE_TEMPLATE_ID 中配置，未配置则不发送） */
function getSubscribeTemplateId() {
  return (process.env.SUBSCRIBE_TEMPLATE_ID || '').trim()
}

/** 发送订阅消息通知；未配置模板或发送失败均不影响主流程 */
async function sendSubscribeNotice(openid, data) {
  const tmplId = getSubscribeTemplateId()
  if (!tmplId || !openid) return false
  try {
    await cloud.openapi.subscribeMessage.send({
      touser: openid,
      templateId: tmplId,
      page: 'pages/my-bookings/my-bookings',
      data
    })
    return true
  } catch (err) {
    console.warn('[subscribe] 发送失败:', (err && (err.errCode || err.errMsg)) || err)
    return false
  }
}

async function getSubscribeTemplate() {
  return { code: 0, data: { templateId: getSubscribeTemplateId() } }
}

// ============ 自习室相关 ============

async function getRooms() {
  const res = await db.collection('rooms').orderBy('createdAt', 'desc').get()
  return { code: 0, data: res.data }
}

async function getRoomDetail({ roomId }, { OPENID }) {
  const res = await db.collection('rooms').doc(roomId).get()
  const room = res.data
  // t6: 暂停开放的自习室仅管理员可查看（非管理员收到明确提示）
  if (room && room.status === 'closed') {
    const isAdmin = await checkIsAdmin(OPENID)
    if (!isAdmin) return { code: 403, message: '该自习室暂停开放，请选择其他自习室' }
  }
  return { code: 0, data: room }
}

/** 首页聚合：自习室列表 + 当日已约座位数（一次查询，避免逐房间请求） */
async function getRoomsWithStats({ date }) {
  const roomsRes = await db.collection('rooms').orderBy('createdAt', 'desc').get()
  const rooms = roomsRes.data

  const bookedByRoom = {}
  if (date) {
    const bookingsRes = await db.collection('bookings').where({
      date,
      status: _.in(['booked', 'checkedin'])
    }).get()
    bookingsRes.data.forEach(b => {
      if (!bookedByRoom[b.roomId]) bookedByRoom[b.roomId] = {}
      bookedByRoom[b.roomId][b.seatId] = true
    })
  }

  const data = rooms.map(r => ({
    ...r,
    totalSeats: (r.seats || []).length,
    bookedToday: bookedByRoom[r._id] ? Object.keys(bookedByRoom[r._id]).length : 0
  }))
  return { code: 0, data }
}

async function createRoom(params, { OPENID }) {
  const { name, location, description, openTime, closeTime, image, seatTags, roomTags } = params
  const isAdmin = await checkIsAdmin(OPENID)
  if (!isAdmin) return { code: 403, message: '无权限' }

  const res = await db.collection('rooms').add({
    data: {
      name, location, description, openTime, closeTime,
      image: image || '',
      seats: [],
      minMinutes: 30,          // t1: 最短预约时长，默认 30 分钟
      status: 'open',          // t6: open / closed / maintenance
      seatTags: seatTags || [],  // 座位自定义标签（分配给单个座位）
      roomTags: roomTags || [],  // 自习室整体标签（如「考研自习室」「24小时」）
      createdAt: db.serverDate()
    }
  })
  return { code: 0, data: res._id }
}

async function updateRoom(params, { OPENID }) {
  const { roomId, ...updateData } = params
  const isAdmin = await checkIsAdmin(OPENID)
  if (!isAdmin) return { code: 403, message: '无权限' }

  await db.collection('rooms').doc(roomId).update({ data: updateData })
  return { code: 0, message: '更新成功' }
}

async function deleteRoom({ roomId }, { OPENID }) {
  const isAdmin = await checkIsAdmin(OPENID)
  if (!isAdmin) return { code: 403, message: '无权限' }

  await db.collection('rooms').doc(roomId).remove()
  // 同时删除相关的预约
  await db.collection('bookings').where({ roomId }).update({
    data: { status: 'cancelled', cancelledBy: 'admin', cancelledAt: db.serverDate() }
  })
  return { code: 0, message: '删除成功' }
}

// ============ 座位相关 ============

async function getSeats({ roomId, date, startTime, endTime }) {
  const room = await db.collection('rooms').doc(roomId).get()
  const seats = room.data.seats || []

  // 获取当天该自习室的已预约座位
  const bookingsRes = await db.collection('bookings').where({
    roomId,
    date,
    status: _.in(['booked', 'checkedin'])
  }).get()

  // 传了时段则只算与所选时段重叠的预约；否则按整天算
  // 同时过滤：已结束的预约不算占用（用户忘了 checkOut 也不影响新预约）
  const nowMs = Date.now()
  const occupied = bookingsRes.data.filter(b => {
    // 已结束的预约不算占用
    const endMs = parseBeijingDate(`${b.date}T${b.endTime}:00`).getTime()
    if (endMs <= nowMs) return false
    if (!startTime || !endTime) return true
    return b.startTime < endTime && b.endTime > startTime
  })

  const bookedSeats = occupied.map(b => b.seatId)

  // 现场占用（kind='occupy'）的座位也视为已占用
  // locks 集合可能还没创建（首次访问），加 try/catch 保护
  const now = Date.now()
  let occupySeats = []
  try {
    const occupyRes = await db.collection('locks').where({
      roomId, date, kind: 'occupy', expireAt: _.gt(now)
    }).limit(500).get()
    occupySeats = occupyRes.data.map(l => l.seatId)
  } catch { /* locks 不存在或查询失败 → 视为无现场占用 */ }
  const occupySet = new Set(occupySeats)

  // 给每个座位标记 booked 状态 + 区分是预约占用还是现场占用
  const enriched = seats.map(s => ({
    ...s,
    booked: bookedSeats.indexOf(s.id) >= 0 || occupySet.has(s.id),
    occupy: occupySet.has(s.id)  // 现场占用标识，前端可显示不同角标
  }))

  return { code: 0, data: { seats: enriched, bookedSeats, occupySeats } }
}

/** 某座位某天的有效预约时段明细（座位时间格子弹窗用）
 *  只返回未结束的有效预约；已结束但用户未 checkOut 的预约不计入占用 */
async function getSeatBookings({ roomId, seatId, date }) {
  const res = await db.collection('bookings').where({
    roomId, seatId, date,
    status: _.in(['booked', 'checkedin'])
  }).get()

  // 过滤：只保留结束时间还没到的预约（已结束但未 checkOut 的不算占用）
  const nowMs = Date.now()
  const slots = res.data
    .filter(b => {
      const endMs = parseBeijingDate(`${b.date}T${b.endTime}:00`).getTime()
      return endMs > nowMs  // 结束时间还没到才视为占用
    })
    .map(b => ({ startTime: b.startTime, endTime: b.endTime }))

  // 若该座位被现场占用（kind='occupy'），返回全天占用标记
  let occupied = false
  try {
    const occupyRes = await db.collection('locks').where({
      roomId, seatId, date, kind: 'occupy', expireAt: _.gt(nowMs)
    }).limit(1).get()
    occupied = occupyRes.data.length > 0
  } catch { /* locks 不存在 → 视为无现场占用 */ }

  return { code: 0, data: { slots, occupied } }
}

async function addSeats(params, { OPENID }) {
  const { roomId, seats } = params
  const isAdmin = await checkIsAdmin(OPENID)
  if (!isAdmin) return { code: 403, message: '无权限' }

  const room = await db.collection('rooms').doc(roomId).get()
  const existingSeats = room.data.seats || []
  const allSeats = [...existingSeats, ...seats]

  await db.collection('rooms').doc(roomId).update({
    data: { seats: allSeats }
  })
  return { code: 0, data: allSeats }
}

async function removeSeats(params, { OPENID }) {
  const { roomId, seatIds } = params
  const isAdmin = await checkIsAdmin(OPENID)
  if (!isAdmin) return { code: 403, message: '无权限' }

  const room = await db.collection('rooms').doc(roomId).get()
  const seats = (room.data.seats || []).filter(s => !seatIds.includes(s.id))

  await db.collection('rooms').doc(roomId).update({ data: { seats } })
  return { code: 0, data: seats }
}

// ============ 座位布局拍照识别（云开发 AI 多模态理解） ============

// 视觉模型名可在云函数环境变量 VISION_MODEL 中覆盖（以环境中已开通的模型为准）
const VISION_MODEL = process.env.VISION_MODEL || 'hy-vision-2.0-instruct'

const LAYOUT_PROMPT = `你是教室座位布局识别助手。请观察这张教室照片，识别座位排布。
要求：
1. 按排统计清晰可见的座位数量（不要把桌子上的杂物、讲台算作座位）。
2. 判断每排内部是否存在明显间隔（走道、空隙、断开的座位区）。若有，给出间隔出现在该排第几个座位之后（从 1 开始计数）。
3. 按从前到后（或从近到远）的顺序排列各排。
只输出 JSON，不要任何解释文字，格式：
{"rows":[{"row":"A","count":6,"gapsAfter":[2]},{"row":"B","count":6,"gapsAfter":[]}]}
排号从 A 开始依次递增；某排座位数取该排最多的一行数量。`

/** 从模型返回文本中提取第一个完整 JSON 对象 */
function extractJson(text) {
  const cleaned = (text || '').replace(/```json/g, '').replace(/```/g, '').trim()
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    return JSON.parse(cleaned.slice(start, end + 1))
  } catch (e) {
    return null
  }
}

/** 把识别出的排布转为 seats 数组（与手动添加的座位结构一致） */
function buildSeatsFromLayout(rows) {
  const seats = []
  rows.forEach((r, idx) => {
    const label = (r.row || '').toString().trim().toUpperCase() || String.fromCharCode(65 + idx)
    const count = Math.max(0, Math.min(parseInt(r.count) || 0, 30))
    const gaps = Array.isArray(r.gapsAfter) ? r.gapsAfter.map(n => parseInt(n)).filter(n => n > 0) : []
    for (let i = 1; i <= count; i++) {
      const code = `${label}${String(i).padStart(2, '0')}`
      seats.push({
        id: code,
        code,
        row: label,
        col: i,
        type: 'normal',
        gapAfter: gaps.indexOf(i) >= 0
      })
    }
  })
  return seats
}

async function recognizeSeats({ roomId, fileID }, { OPENID }) {
  const isAdmin = await checkIsAdmin(OPENID)
  if (!isAdmin) return { code: 403, message: '无权限' }
  if (!fileID) return { code: 400, message: '缺少图片' }
  if (typeof cloud.ai !== 'function') {
    return { code: 500, message: '云函数依赖版本过低，请将 wx-server-sdk 升级到 4.0.1 以上后重新部署' }
  }

  const file = await cloud.downloadFile({ fileID })
  const buf = file.fileContent
  if (!buf || !buf.length) return { code: 400, message: '图片读取失败' }
  if (buf.length > 4 * 1024 * 1024) return { code: 400, message: '图片过大，请压缩后重试' }

  const ai = cloud.ai()
  const model = ai.createModel('cloudbase')
  let res
  try {
    res = await model.generateText({
      model: VISION_MODEL,
      temperature: 0.1,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: LAYOUT_PROMPT },
          { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${buf.toString('base64')}` } }
        ]
      }]
    }, { timeout: 60000 })
  } catch (err) {
    console.error('[recognizeSeats] AI 调用失败:', err)
    return {
      code: 500,
      message: `识别服务调用失败：${(err && err.message) || '未知错误'}。请确认云开发控制台已开通 AI 能力并可使用模型 ${VISION_MODEL}`
    }
  }

  const parsed = extractJson(res && res.text)
  if (!parsed || !Array.isArray(parsed.rows)) {
    return { code: 500, message: '未能识别出座位排布，请换个角度或光线更好的照片重试' }
  }

  const seats = buildSeatsFromLayout(parsed.rows)
  if (seats.length === 0) {
    return { code: 500, message: '照片中未识别到座位，请靠近座位区重拍' }
  }

  return {
    code: 0,
    data: {
      seats,
      summary: { rows: parsed.rows.length, total: seats.length },
      // 原图 fileID 回传，前端确认应用座位时一并存为自习室底图
      fileID,
      raw: res.text
    },
    message: '识别完成'
  }
}

// ============ 扫码签到 ============

/** 生成 8 位签到短码（小程序码 scene 最长 32 字符，不能直接放 roomId） */
function makeScanCode() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let s = ''
  for (let i = 0; i < 8; i++) s += chars[Math.floor(Math.random() * chars.length)]
  return s
}

async function ensureRoomScanCode(roomId) {
  const room = (await db.collection('rooms').doc(roomId).get()).data
  if (room.scanCode) return { room, scanCode: room.scanCode }

  let scanCode = makeScanCode()
  for (let i = 0; i < 5; i++) {
    const exists = await db.collection('rooms').where({ scanCode }).get()
    if (exists.data.length === 0) break
    scanCode = makeScanCode()
  }
  await db.collection('rooms').doc(roomId).update({ data: { scanCode } })
  return { room, scanCode }
}

/** 确保自习室有 scanCode（普通二维码用），返回 scanCode + roomId
 *  注意：个人主体不能用 wxacode.getUnlimited，改为前端 Canvas 生成普通二维码。
 *  二维码内容只写短码 "s=scanCode"，学生打开小程序点扫码签到时 wx.scanCode 拿纯文本解析。 */
async function getRoomQrCode({ roomId }, { OPENID }) {
  const isAdmin = await checkIsAdmin(OPENID)
  if (!isAdmin) return { code: 403, message: '无权限' }
  if (!roomId) return { code: 400, message: '缺少自习室参数' }

  try {
    const { room, scanCode } = await ensureRoomScanCode(roomId)
    return {
      code: 0,
      data: {
        roomId,
        roomName: room.name,
        scanCode,
        // 二维码实际内容 —— 纯短码，学生用小程序内「扫码签到」按钮扫
        qrText: `s=${scanCode}`
      },
      message: '签到码已就绪'
    }
  } catch (e) {
    console.error('[getRoomQrCode] 失败:', e)
    return { code: 404, message: '自习室不存在' }
  }
}

/** 扫码进入签到页后：按 scene 定位自习室，找到该用户当天可签到/可签退的预约 */
async function findScanBooking({ scene, roomId }, { OPENID }) {
  let decoded = scene || ''
  try {
    decoded = decodeURIComponent(decoded)
  } catch (e) { /* scene 未编码时忽略 */ }

  // 兼容三种 scene 格式：
  //   1) 旧小程序码纯 scene:        "s=ab12cd34"     → ^ 开头
  //   2) 普通二维码带完整路径:       "pages/checkin/checkin?s=ab12cd34"
  //   3) URL-encoded 或带其他参数:  "...room=xxx&s=ab12cd34&foo=bar"
  // 所以改成在字符串里任意位置搜 s= 或 r=
  let m = decoded.match(/(?:^|[?&\/])(?:s|r)=([A-Za-z0-9]+)/)
  if (!m) m = decoded.match(/^(?:s|r)=([A-Za-z0-9]+)/)   // 兜底旧格式
  const code = m ? m[1] : ''

  let room = null
  if (code) {
    const roomRes = await db.collection('rooms').where({ scanCode: code }).get()
    if (roomRes.data.length > 0) {
      room = roomRes.data[0]
    } else {
      // 兼容直接把 roomId 当作 scene 的旧码
      try {
        room = (await db.collection('rooms').doc(code).get()).data
      } catch (e) { room = null }
    }
  }
  if (!room && roomId) {
    try {
      room = (await db.collection('rooms').doc(roomId).get()).data
    } catch (e) { room = null }
  }
  if (!room) {
    return { code: 404, message: '未识别的自习室签到码，请让管理员重新生成' }
  }

  const todayStr = formatDateStr(getBeijingNow())
  const res = await db.collection('bookings').where({
    _openid: OPENID,
    roomId: room._id,
    date: todayStr,
    status: _.in(['booked', 'checkedin'])
  }).orderBy('startTime', 'asc').get()

  if (res.data.length === 0) {
    return { code: 404, message: `${room.name} 今天没有你的预约，请先在首页预约座位` }
  }

  // 优先未签到的预约，否则取当前在座的（可签退）
  const target = res.data.find(b => b.status === 'booked') || res.data[0]
  return {
    code: 0,
    data: {
      roomId: room._id,
      roomName: room.name,
      bookingId: target._id,
      status: target.status,
      date: target.date,
      startTime: target.startTime,
      endTime: target.endTime
    }
  }
}

// ============ 我的学习统计 ============

function formatDateStr(d) {
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

async function getMyStats(params, { OPENID }) {
  const res = await db.collection('bookings').where({ _openid: OPENID }).limit(500).get()
  const list = res.data

  let totalMinutes = 0
  let totalCount = 0
  const days = {}

  list.forEach(b => {
    if (b.status === 'cancelled') return
    totalCount += 1
    if (b.status === 'checkedin' || b.status === 'completed') {
      const start = parseBeijingDate(`${b.date}T${b.startTime}:00`)
      const end = parseBeijingDate(`${b.date}T${b.endTime}:00`)
      const mins = Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000))
      totalMinutes += mins
      days[b.date] = true
    }
  })

  // 本周（周一为一周起点）
  const now = getBeijingNow()
  const weekday = now.getUTCDay() === 0 ? 7 : now.getUTCDay()
  const weekStart = new Date(now.getTime() - (weekday - 1) * 86400000)
  const weekStartStr = formatDateStr(weekStart)
  const weekCount = list.filter(b => b.date >= weekStartStr && b.status !== 'cancelled').length

  // 爽约与禁约状态（个人中心展示）
  const userRes = await db.collection('users').where({ _openid: OPENID }).get()
  const u = userRes.data[0] || {}
  const banMs = u.banUntil ? new Date(u.banUntil).getTime() - Date.now() : 0

  return {
    code: 0,
    data: {
      totalMinutes,
      totalHours: Math.round((totalMinutes / 60) * 10) / 10,
      checkinDays: Object.keys(days).length,
      totalCount,
      weekCount,
      noShowCount: u.noShowCount || 0,
      banHours: banMs > 0 ? Math.ceil(banMs / 3600000) : 0
    }
  }
}

// ============ 预约相关 ============

async function createBooking(params, { OPENID }) {
  const { roomId, seatId, seatCode, roomName, date, startTime, endTime } = params

  if (!date || !startTime || !endTime) {
    return { code: 400, message: '预约信息不完整' }
  }

  // 只能预约今天起一周内的日期（按北京时间）
  const bjNow = getBeijingNow()
  const todayStr = formatDateStr(bjNow)
  const maxStr = formatDateStr(new Date(bjNow.getTime() + 7 * 86400000))
  if (date < todayStr || date > maxStr) {
    return { code: 400, message: '只能预约今天起一周内的日期' }
  }

  // 不允许预约已经结束的时段，否则创建后会被超时机制立即取消
  const endMoment = parseBeijingDate(`${date}T${endTime}:00`)
  if (endMoment.getTime() <= Date.now()) {
    return { code: 400, message: '该时段已结束，请选择未来的时间' }
  }

  // 仅允许 30 分钟粒度时段（如 09:00、09:30）
  if (!/^\d{2}:(00|30)$/.test(startTime) || !/^\d{2}:(00|30)$/.test(endTime) || startTime >= endTime) {
    return { code: 400, message: '预约时间需为整点或半点（如 09:00-10:30）' }
  }

  // 必须在自习室营业时间内
  let room
  try {
    room = (await db.collection('rooms').doc(roomId).get()).data
  } catch (e) {
    room = null
  }
  if (!room) {
    return { code: 404, message: '自习室不存在' }
  }

  // t6: 暂停开放 / 维护中的自习室不能预约
  if (room.status === 'closed' || room.status === 'maintenance') {
    return { code: 403, message: '该自习室暂停开放，请选择其他自习室' }
  }

  // 校验 seatId 真在 rooms.seats 数组里存在（防篡改请求）
  const seats = room.seats || []
  const seatExists = seats.some(s => s && s.id === seatId)
  if (!seatExists) {
    return { code: 400, message: '座位不存在，请刷新后重试' }
  }

  // t1: 最短预约时长校验（room.minMinutes 分钟）
  const minMinutes = Number(room.minMinutes) || 30
  const durationMin = (parseInt(endTime.slice(0, 2)) * 60 + parseInt(endTime.slice(3))) -
                     (parseInt(startTime.slice(0, 2)) * 60 + parseInt(startTime.slice(3)))
  if (durationMin < minMinutes) {
    return { code: 400, message: `最少预约 ${minMinutes} 分钟，请延长时段` }
  }

  if (startTime < room.openTime || endTime > room.closeTime) {
    return { code: 400, message: `请在营业时间 ${room.openTime}-${room.closeTime} 内选择时段` }
  }

  // t4: 临时锁检查 —— 同座位同日期若被他人锁住且未过期，则拒绝
  // （含 kind='selecting' 选座临时锁 和 kind='occupy' 现场占用锁）
  const now = Date.now()
  let conflictingLock = null
  try {
    const lockRes = await db.collection('locks').where({
      roomId, seatId, date,
      expireAt: _.gt(now)
    }).limit(5).get()
    conflictingLock = lockRes.data.find(l => l._openid !== OPENID)
  } catch { /* locks 不存在 → 无锁冲突 */ }
  if (conflictingLock) {
    if (conflictingLock.kind === 'occupy') {
      return { code: 423, message: '该座位被现场人员占用，请选择其他座位' }
    }
    return { code: 423, message: '有人正在选择该座位，请稍等或选择其他座位' }
  }

  // 检查用户
  const userRes = await db.collection('users').where({ _openid: OPENID }).get()
  let user
  if (userRes.data.length === 0) {
    // 创建用户记录
    const newUser = await db.collection('users').add({
      data: { _openid: OPENID, createdAt: db.serverDate() }
    })
    user = { _id: newUser._id }
  } else {
    user = userRes.data[0]
  }

  // 爽约惩罚：处于限制期内不允许预约；已过期则自动清除（自愈）
  // 管理员豁免：isAdmin 用户直接跳过禁约检查
  const isAdminUser = !!user.isAdmin
  if (!isAdminUser && user.banUntil) {
    const banMs = new Date(user.banUntil).getTime() - Date.now()
    if (banMs > 0) {
      const hours = Math.ceil(banMs / 3600000)
      return { code: 403, message: `因连续爽约，你被限制预约，约 ${hours} 小时后恢复` }
    } else {
      // 过期了 → 自动解封，清掉 banUntil 和 noShowCount
      try {
        await db.collection('users').doc(user._id).update({
          data: { banUntil: null, noShowCount: 0, updatedAt: db.serverDate() }
        })
      } catch (e) {}
    }
  }

  // 检查座位是否已被预约
  const conflict = await db.collection('bookings').where({
    roomId, date, seatId,
    status: _.in(['booked', 'checkedin']),
    startTime: _.lt(endTime),
    endTime: _.gt(startTime)
  }).get()

  if (conflict.data.length > 0) {
    return { code: 409, message: '该时段座位已被预约' }
  }

  // 检查用户是否已有同时间预约
  const userConflict = await db.collection('bookings').where({
    _openid: OPENID,
    date,
    status: _.in(['booked', 'checkedin']),
    startTime: _.lt(endTime),
    endTime: _.gt(startTime)
  }).get()

  if (userConflict.data.length > 0) {
    return { code: 400, message: '你在该时段已有预约' }
  }

  const booking = await db.collection('bookings').add({
    data: {
      roomId, roomName, seatId, seatCode,
      userId: user._id, _openid: OPENID,
      date, startTime, endTime,
      status: 'booked',
      checkInTime: null,
      checkOutTime: null,
      createdAt: db.serverDate()
    }
  })

  // 并发保护：写入后再次校验，若同座位同时段已存在别人的预约，则撤销自己这条
  // （先查后插存在竞态窗口，这里用"插入后复核"兜底，保证不会出现两人同时预约成功）
  const recheck = await db.collection('bookings').where({
    roomId, date, seatId,
    status: _.in(['booked', 'checkedin']),
    startTime: _.lt(endTime),
    endTime: _.gt(startTime)
  }).get()
  const others = recheck.data.filter(x => x._id !== booking._id)
  if (others.length > 0) {
    await db.collection('bookings').doc(booking._id).remove()
    return { code: 409, message: '该时段座位刚被他人预约，请更换座位或时段' }
  }

  return { code: 0, data: { _id: booking._id }, message: '预约成功' }
}

async function getMyBookings({ status }, { OPENID }) {
  let query = { _openid: OPENID }
  if (status) query.status = status

  const res = await db.collection('bookings')
    .where(query)
    .orderBy('date', 'desc')
    .orderBy('startTime', 'desc')
    .limit(50)
    .get()

  // 兜底：把已超时仍为 booked 的自动取消
  for (const b of res.data) {
    if (b.status === 'booked') {
      const wasCancelled = await autoCancelIfTimeout({ _id: b._id, data: b })
      if (wasCancelled) {
        // 同步补齐取消信息，前端据此识别「刚刚因超时被取消」
        b.status = 'cancelled'
        b.cancelledBy = 'system_timeout'
        b.cancelReason = '预约超时：开始15分钟后仍未签到，系统自动取消'
      }
    }
  }

  return { code: 0, data: res.data }
}

async function cancelBooking({ bookingId }, { OPENID }) {
  let booking
  try {
    const res = await db.collection('bookings').doc(bookingId).get()
    booking = res.data
  } catch (e) {
    return { code: 404, message: '预约不存在' }
  }
  if (!booking) return { code: 404, message: '预约不存在' }

  if (booking._openid !== OPENID) {
    const isAdmin = await checkIsAdmin(OPENID)
    if (!isAdmin) return { code: 403, message: '无权限' }
  }

  // 幂等处理：已取消/已完成 → 直接返回成功（前端重试时避免误导）
  if (booking.status === 'cancelled') {
    return { code: 0, message: '预约已取消' }
  }
  if (booking.status === 'completed') {
    return { code: 400, message: '预约已完成，无法取消' }
  }
  if (booking.status === 'checkedin') {
    return { code: 400, message: '已签到的预约不能取消，请先签退' }
  }

  await db.collection('bookings').doc(bookingId).update({
    data: {
      status: 'cancelled',
      cancelledBy: booking._openid === OPENID ? 'user' : 'admin',
      cancelledAt: db.serverDate()
    }
  })

  return { code: 0, message: '取消成功' }
}

// ============ 签到相关 ============

async function checkIn({ bookingId }, { OPENID }) {
  console.log('[checkIn] 请求参数:', { bookingId, OPENID })

  let bookingDoc, bookingData
  try {
    const res = await db.collection('bookings').doc(bookingId).get()
    bookingDoc = res
    bookingData = res.data
  } catch (e) {
    return { code: 404, message: '预约不存在' }
  }
  if (!bookingData) return { code: 404, message: '预约不存在' }
  console.log('[checkIn] 预约记录:', JSON.stringify(bookingData))

  if (bookingData._openid !== OPENID) {
    console.log('[checkIn] openid 不匹配:', bookingData._openid, '!==', OPENID)
    return { code: 403, message: '非本人预约' }
  }

  // 兜底：先检查是否已超时（开始15分钟未签到）→ 自动取消
  const wasTimeoutCancelled = await autoCancelIfTimeout(bookingDoc)
  if (wasTimeoutCancelled) {
    console.log('[checkIn] 已超时，系统自动取消')
    return { code: 410, message: '预约超时：开始15分钟后仍未签到，系统自动取消' }
  }

  // 幂等处理：已签到 → 直接返回成功
  if (bookingData.status === 'checkedin') {
    return { code: 0, message: '签到成功（已签到）' }
  }

  if (bookingData.status !== 'booked') {
    console.log('[checkIn] 状态不是 booked:', bookingData.status)
    return { code: 400, message: `当前状态无法签到（状态: ${bookingData.status}）` }
  }

  // 还没到开始时间（比较用真实当前时间）
  const now = new Date()
  const bookingStart = parseBeijingDate(`${bookingData.date}T${bookingData.startTime}:00`)
  const diffStartMin = (now - bookingStart) / 60000

  console.log('[checkIn] 时间检查:', {
    nowUTC: now.toISOString(),
    bookingTime: `${bookingData.startTime}-${bookingData.endTime}`,
    diffStartMin: Math.round(diffStartMin)
  })

  if (diffStartMin < 0) {
    const msg = `签到时间未到（还有 ${Math.abs(Math.round(diffStartMin))} 分钟）`
    console.log('[checkIn] 拒绝:', msg)
    return { code: 400, message: msg }
  }

  await db.collection('bookings').doc(bookingId).update({
    data: { status: 'checkedin', checkInTime: db.serverDate() }
  })

  // 正常签到 → 清除连续爽约计数
  const userRes = await db.collection('users').where({ _openid: OPENID }).get()
  if (userRes.data.length > 0 && userRes.data[0].noShowCount) {
    await db.collection('users').doc(userRes.data[0]._id).update({ data: { noShowCount: 0 } })
  }

  console.log('[checkIn] 签到成功!')
  return { code: 0, message: '签到成功' }
}

async function checkOut({ bookingId }, { OPENID }) {
  let bookingData
  try {
    const res = await db.collection('bookings').doc(bookingId).get()
    bookingData = res.data
  } catch (e) {
    return { code: 404, message: '预约不存在' }
  }
  if (!bookingData) return { code: 404, message: '预约不存在' }

  if (bookingData._openid !== OPENID) {
    return { code: 403, message: '非本人预约' }
  }

  // 幂等处理：已完成 → 直接返回成功
  if (bookingData.status === 'completed') {
    return { code: 0, message: '签退成功（已完成）' }
  }

  if (bookingData.status !== 'checkedin') {
    return { code: 400, message: '当前状态无法签退' }
  }

  await db.collection('bookings').doc(bookingId).update({
    data: { status: 'completed', checkOutTime: db.serverDate() }
  })

  return { code: 0, message: '签退成功' }
}

async function getCheckinInfo({ bookingId }, { OPENID }) {
  let bookingDoc, bookingData
  try {
    const res = await db.collection('bookings').doc(bookingId).get()
    bookingDoc = res
    bookingData = res.data
  } catch (e) {
    return { code: 404, message: '预约不存在' }
  }
  if (!bookingData) return { code: 404, message: '预约不存在' }

  if (bookingData._openid !== OPENID) {
    const isAdmin = await checkIsAdmin(OPENID)
    if (!isAdmin) return { code: 403, message: '无权限' }
  }
  // 兜底：已超时自动取消
  await autoCancelIfTimeout(bookingDoc)
  // 重新读一下最新状态
  let freshData
  try {
    const fresh = await db.collection('bookings').doc(bookingId).get()
    freshData = fresh.data
  } catch (e) {
    return { code: 404, message: '预约不存在' }
  }
  return { code: 0, data: freshData }
}

// ============ 管理员相关 ============

async function checkIsAdmin(openid) {
  // 环境变量 ADMIN_OPENIDS（逗号分隔）可固定管理员，避免数据库记录被误删后失去权限
  const allowList = (process.env.ADMIN_OPENIDS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
  if (allowList.indexOf(openid) >= 0) return true

  const res = await db.collection('users').where({ _openid: openid, isAdmin: true }).get()
  return res.data.length > 0
}

async function bootstrapAdmin(params, { OPENID }) {
  // 配置了初始化口令（环境变量 ADMIN_INIT_CODE）时，必须核对通过才允许自助初始化
  const initCode = (process.env.ADMIN_INIT_CODE || '').trim()
  if (initCode) {
    const input = ((params && params.code) || '').trim()
    if (input !== initCode) {
      return { code: 403, message: '初始化口令不正确' }
    }
  }

  // 系统已有真实管理员时不允许再自助初始化（控制台误建的 _openid 为空的记录不算）
  const exists = await db.collection('users').where({ isAdmin: true }).get()
  const validAdmins = exists.data.filter(u => u._openid)
  if (validAdmins.length > 0) {
    return { code: 403, message: '系统已有管理员，请联系管理员为你开通权限' }
  }

  const res = await db.collection('users').where({ _openid: OPENID }).get()
  if (res.data.length > 0) {
    await db.collection('users').doc(res.data[0]._id).update({
      data: { isAdmin: true, updatedAt: db.serverDate() }
    })
  } else {
    await db.collection('users').add({
      data: {
        _openid: OPENID,
        isAdmin: true,
        createdAt: db.serverDate(),
        updatedAt: db.serverDate()
      }
    })
  }

  return { code: 0, message: '已设为管理员' }
}

/** 北京时间「今天」的日期字符串 YYYY-MM-DD */
function getBeijingDateStr() {
  const d = new Date(Date.now() + TZ_OFFSET_HOURS * 3600 * 1000)
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** 删除自己的预约记录：已取消的当天可删；其余需等到第二天（日期已过）才可删 */
async function deleteMyBookings({ bookingIds }, { OPENID }) {
  const ids = Array.isArray(bookingIds) ? bookingIds.filter(Boolean).slice(0, 50) : []
  if (ids.length === 0) return { code: 400, message: '未选择要删除的记录' }

  const res = await db.collection('bookings').where({ _id: _.in(ids) }).get()
  const today = getBeijingDateStr()

  let removed = 0
  let skipped = 0
  for (const b of res.data) {
    if (b._openid !== OPENID) {
      skipped++
      continue
    }
    const canDelete = b.status === 'cancelled' || (b.date && b.date < today)
    if (!canDelete) {
      skipped++
      continue
    }
    await db.collection('bookings').doc(b._id).remove()
    removed++
  }

  return { code: 0, data: { removed, skipped } }
}

async function setAdmin({ openid, isAdminFlag }, { OPENID }) {
  // 只有管理员能设置管理员
  const currentAdmin = await checkIsAdmin(OPENID)
  if (!currentAdmin) return { code: 403, message: '无权限' }
  if (!openid) return { code: 400, message: '缺少用户标识' }
  // 不允许修改自己，避免误操作把自己踢出后台
  if (openid === OPENID) return { code: 400, message: '不能修改自己的管理员权限' }

  const res = await db.collection('users').where({ _openid: openid }).update({
    data: { isAdmin: !!isAdminFlag, updatedAt: db.serverDate() }
  })

  if (!res.stats || res.stats.updated === 0) {
    return { code: 404, message: '未找到该用户，请让对方先打开一次小程序后再试' }
  }

  return { code: 0, message: isAdminFlag ? '已设为管理员' : '已取消管理员' }
}

/** 管理员手动禁约 / 解封（days=0 表示解除） */
async function adminSetUserBan({ openid, days }, { OPENID }) {
  const isAdmin = await checkIsAdmin(OPENID)
  if (!isAdmin) return { code: 403, message: '无权限' }
  if (!openid) return { code: 400, message: '缺少用户标识' }

  const d = Math.max(0, Number(days) || 0)
  const userRes = await db.collection('users').where({ _openid: openid }).get()
  if (userRes.data.length === 0) return { code: 404, message: '未找到该用户' }

  await db.collection('users').doc(userRes.data[0]._id).update({
    data: {
      banUntil: d > 0 ? new Date(Date.now() + d * 24 * 3600 * 1000) : null,
      noShowCount: 0,
      updatedAt: db.serverDate()
    }
  })
  return { code: 0, message: d > 0 ? `已禁止该用户预约 ${d} 天` : '已解除预约限制' }
}

/** 管理员查看用户列表，用于设置/取消其他管理员 */
async function getAdminCandidates({ keyword }, { OPENID }) {
  const isAdmin = await checkIsAdmin(OPENID)
  if (!isAdmin) return { code: 403, message: '无权限' }

  const res = await db.collection('users').orderBy('createdAt', 'desc').limit(100).get()
  const kw = (keyword || '').trim()

  const list = res.data
    .filter(u => u._openid)
    .filter(u => !kw || (u.name || u.nickName || '').indexOf(kw) >= 0)
    .map(u => {
      const banMs = u.banUntil ? new Date(u.banUntil).getTime() - Date.now() : 0
      return {
        _id: u._id,
        openid: u._openid,
        name: u.name || u.nickName || '未命名用户',
        avatar: u.avatar || '',
        isAdmin: !!u.isAdmin,
        isSelf: u._openid === OPENID,
        banHours: banMs > 0 ? Math.ceil(banMs / 3600000) : 0
      }
    })

  // 管理员排前面，方便先看到现有管理员
  list.sort((a, b) => (b.isAdmin ? 1 : 0) - (a.isAdmin ? 1 : 0))

  return { code: 0, data: list }
}

/** 管理员用户管理：列出全部用户（含爽约次数、禁约状态），支持筛选连续爽约 >= threshold 的 */
async function adminListUsers({ threshold }, { OPENID }) {
  const isAdmin = await checkIsAdmin(OPENID)
  if (!isAdmin) return { code: 403, message: '无权限' }

  const res = await db.collection('users').orderBy('createdAt', 'desc').limit(200).get()
  const thr = Number(threshold) || 0

  const list = res.data
    .filter(u => u._openid)
    .map(u => {
      const banMs = u.banUntil ? new Date(u.banUntil).getTime() - Date.now() : 0
      return {
        _id: u._id,
        openid: u._openid,
        name: u.name || u.nickName || '未命名用户',
        avatar: u.avatar || '',
        isAdmin: !!u.isAdmin,
        isSelf: u._openid === OPENID,
        noShowCount: u.noShowCount || 0,
        banHours: banMs > 0 ? Math.ceil(banMs / 3600000) : 0,
        banned: banMs > 0
      }
    })
    .filter(u => u.isAdmin === false) // 管理员不参与爽约筛选
    .filter(u => thr > 0 ? u.noShowCount >= thr || u.banned : true) // 筛选
    .sort((a, b) => (b.noShowCount + (b.banned ? 100 : 0)) - (a.noShowCount + (a.banned ? 100 : 0))) // 爽约重的排前面

  return { code: 0, data: list }
}

/** 管理员删除用户（连带删除该用户的预约记录） */
async function adminDeleteUser({ openid }, { OPENID }) {
  const isAdmin = await checkIsAdmin(OPENID)
  if (!isAdmin) return { code: 403, message: '无权限' }
  if (!openid) return { code: 400, message: '缺少用户标识' }
  if (openid === OPENID) return { code: 400, message: '不能删除自己' }

  // 先查用户
  const userRes = await db.collection('users').where({ _openid: openid }).get()
  if (userRes.data.length === 0) return { code: 404, message: '未找到该用户' }
  const u = userRes.data[0]
  if (u.isAdmin) return { code: 400, message: '不能删除管理员，请先取消其管理员权限' }

  // 连带删除预约记录
  let removedBookings = 0
  try {
    const r = await db.collection('bookings').where({ _openid: openid }).remove()
    removedBookings = r.stats.removed || 0
  } catch (e) {
    console.warn('[adminDeleteUser] 删预约失败:', e.message)
  }

  // 连带删除其他集合（防止孤儿数据）
  const orphans = ['posts', 'postComments', 'suggestions', 'locks']
  for (const col of orphans) {
    try { await db.collection(col).where({ _openid: openid }).remove() } catch (e) {}
  }

  // 删除用户
  await db.collection('users').doc(u._id).remove()

  return { code: 0, message: `已删除用户「${u.name || u.nickName || ''}」及其 ${removedBookings} 条预约` }
}

async function adminGetBookings(params, { OPENID }) {
  const isAdmin = await checkIsAdmin(OPENID)
  if (!isAdmin) return { code: 403, message: '无权限' }

  const { status, roomId, date } = params
  let query = {}
  if (status) query.status = status
  if (roomId) query.roomId = roomId
  if (date) query.date = date

  const res = await db.collection('bookings')
    .where(query)
    .orderBy('date', 'desc')
    .orderBy('startTime', 'desc')
    .limit(100)
    .get()

  return { code: 0, data: res.data }
}

async function updateBookingStatus(params, { OPENID }) {
  const { bookingId, status } = params
  const isAdmin = await checkIsAdmin(OPENID)
  if (!isAdmin) return { code: 403, message: '无权限' }

  // status 白名单，防止传任意值污染数据
  const ALLOWED_STATUS = ['booked', 'checkedin', 'completed', 'cancelled']
  if (!ALLOWED_STATUS.includes(status)) {
    return { code: 400, message: `非法状态，仅允许: ${ALLOWED_STATUS.join(', ')}` }
  }

  let booking
  try {
    const res = await db.collection('bookings').doc(bookingId).get()
    booking = res.data
  } catch (e) {
    return { code: 404, message: '预约不存在' }
  }

  // 禁止改回 booked（从已完成/已取消）— 会搞乱统计
  if (status === 'booked' && (booking.status === 'completed' || booking.status === 'cancelled')) {
    return { code: 400, message: '不能将已完成/已取消的预约改回待开始' }
  }

  const updateData = { status, updatedAt: db.serverDate() }
  if (status === 'completed' && booking.status === 'checkedin' && !booking.checkOutTime) {
    updateData.checkOutTime = db.serverDate()
    updateData.autoCheckout = true
  }
  if (status === 'cancelled') {
    updateData.cancelledBy = 'admin'
    updateData.cancelledAt = db.serverDate()
  }

  await db.collection('bookings').doc(bookingId).update({ data: updateData })

  return { code: 0, message: '更新成功' }
}

async function getStats(params, { OPENID }) {
  const isAdmin = await checkIsAdmin(OPENID)
  if (!isAdmin) return { code: 403, message: '无权限' }

  const { date } = params
  let query = {}
  if (date) query.date = date

  const allRes = await db.collection('bookings').where(query).get()
  const bookings = allRes.data

  const stats = {
    total: bookings.length,
    booked: bookings.filter(b => b.status === 'booked').length,
    checkedin: bookings.filter(b => b.status === 'checkedin').length,
    completed: bookings.filter(b => b.status === 'completed').length,
    cancelled: bookings.filter(b => b.status === 'cancelled').length,
    byRoom: {}
  }

  bookings.forEach(b => {
    if (!stats.byRoom[b.roomId]) {
      stats.byRoom[b.roomId] = { name: b.roomName, total: 0, checkedin: 0 }
    }
    stats.byRoom[b.roomId].total++
    if (b.status === 'checkedin') stats.byRoom[b.roomId].checkedin++
  })

  // —— 数据看板：上座率 / 爽约率 / 高峰时段 ——
  let totalSeats = 0
  try {
    const roomsRes = await db.collection('rooms').get()
    roomsRes.data.forEach(r => { totalSeats += (r.seats || []).length })
  } catch (e) { /* 无房间数据时按 0 处理 */ }

  const activeSeats = new Set()
  const hourMap = {}
  let noShow = 0

  bookings.forEach(b => {
    if (b.status === 'booked' || b.status === 'checkedin' || b.status === 'completed') {
      activeSeats.add(`${b.roomId}:${b.seatId}`)
    }
    if (b.cancelledBy === 'system_timeout') noShow++
    if (b.startTime) {
      const h = String(b.startTime).slice(0, 2)
      hourMap[h] = (hourMap[h] || 0) + 1
    }
  })

  const hourly = Object.keys(hourMap).sort().map(h => ({ hour: `${h}:00`, count: hourMap[h] }))
  const peakHour = hourly.slice().sort((a, b) => b.count - a.count)[0] || null

  stats.totalSeats = totalSeats
  stats.activeSeats = activeSeats.size
  stats.occupancyRate = totalSeats > 0 ? Math.round(activeSeats.size / totalSeats * 100) : 0
  stats.noShow = noShow
  stats.noShowRate = bookings.length > 0 ? Math.round(noShow / bookings.length * 100) : 0
  stats.hourly = hourly
  stats.peakHour = peakHour

  // —— 近 7 天趋势（预约量 / 实际到座数） ——
  const last7 = []
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.now() + TZ_OFFSET_HOURS * 3600 * 1000 - i * 86400000)
    last7.push(formatDateStr(d))
  }
  const trendMap = {}
  last7.forEach(d => { trendMap[d] = { date: d, total: 0, checkedin: 0 } })
  try {
    const trendRes = await db.collection('bookings')
      .where({ date: _.in(last7) })
      .field({ date: true, status: true })
      .limit(1000)
      .get()
    trendRes.data.forEach(b => {
      const t = trendMap[b.date]
      if (!t) return
      t.total += 1
      if (b.status === 'checkedin' || b.status === 'completed') t.checkedin += 1
    })
  } catch (e) {
    console.warn('[stats] 趋势查询失败:', e)
  }
  stats.trend = last7.map(d => trendMap[d])

  return { code: 0, data: stats }
}

/** 管理员导出预约明细（前端拼 CSV） */
async function adminExportBookings({ date }, { OPENID }) {
  const isAdmin = await checkIsAdmin(OPENID)
  if (!isAdmin) return { code: 403, message: '无权限' }

  const query = date ? { date } : {}
  const res = await db.collection('bookings')
    .where(query)
    .orderBy('date', 'desc')
    .orderBy('startTime', 'asc')
    .limit(1000)
    .get()

  const rows = res.data.map(b => ({
    date: b.date || '',
    room: b.roomName || '',
    seat: b.seatCode || '',
    start: b.startTime || '',
    end: b.endTime || '',
    status: b.status || '',
    cancelledBy: b.cancelledBy || '',
    userName: b.userName || '',
    openid: b._openid || ''
  }))
  return { code: 0, data: rows }
}

// ============ 内容安全 ============

/** 文本内容安全检测；接口不可用时放行，不影响主流程 */
async function checkTextSecurity(content, openid, scene) {
  const text = (content || '').trim()
  if (!text || !openid) return true
  try {
    const r = await cloud.openapi.security.msgSecCheck({
      content: text.slice(0, 2500),
      version: 2,
      scene: scene || 1,
      openid
    })
    const suggest = r && r.result && r.result.suggest
    if (suggest === 'risky' || (r && r.errCode === 87014)) return false
    return true
  } catch (err) {
    console.warn('[security] msgSecCheck 不可用，已放行:', (err && (err.errCode || err.errMsg)) || err)
    return true
  }
}

// ============ 用户相关 ============

async function getUserInfo({}, { OPENID }) {
  const res = await db.collection('users').where({ _openid: OPENID }).get()
  if (res.data.length === 0) {
    const newUser = await db.collection('users').add({
      data: { _openid: OPENID, isAdmin: false, createdAt: db.serverDate() }
    })
    return { code: 0, data: { _id: newUser._id, isAdmin: false } }
  }
  return { code: 0, data: res.data[0] }
}

async function updateUserInfo(params, { OPENID }) {
  const { name, phone, avatar } = params
  const updateData = {}
  if (name !== undefined) {
    const ok = await checkTextSecurity(name, OPENID, 1)
    if (!ok) return { code: 400, message: '昵称包含敏感内容，请修改后重试' }
    updateData.name = name
  }
  if (phone !== undefined) updateData.phone = phone
  if (avatar !== undefined) {
    // t7: 头像图片安全检测（接口不可用时放行）
    if (avatar && typeof avatar === 'string' && avatar.indexOf('cloud://') === 0) {
      try {
        const file = await cloud.downloadFile({ fileID: avatar })
        const buf = file.fileContent
        if (buf && buf.length > 0 && buf.length <= 1 * 1024 * 1024) {
          const r = await cloud.openapi.security.imgSecCheck({
            media: { file_id: avatar }
          })
          if (r && r.errCode === 0) {
            // 通过
          } else if (r && (r.errCode === 87014 || (r.result && r.result.suggest === 'risky'))) {
            return { code: 400, message: '头像含违规内容，请更换后重试' }
          }
          // 接口不可用或其他错误时放行（不阻塞用户）
        }
      } catch (err) {
        console.warn('[security] imgSecCheck 不可用，已放行:', (err && (err.errCode || err.errMsg)) || err)
      }
    }
    updateData.avatar = avatar
  }

  await db.collection('users').where({ _openid: OPENID }).update({ data: updateData })
  return { code: 0, message: '更新成功' }
}

// ============ 学习搭子论坛 ============

const POST_CATEGORIES = ['搭子招募', '学习经验', '资料共享', '其他']

/** 取用户昵称头像快照（未填写资料时用默认值） */
async function getAuthorSnapshot(openid) {
  const res = await db.collection('users').where({ _openid: openid }).get()
  if (res.data.length === 0) return { name: '匿名同学', avatar: '' }
  const user = res.data[0]
  return { name: user.name || '匿名同学', avatar: user.avatar || '' }
}

async function getPosts({ category }, { OPENID }) {
  const where = {}
  if (category && category !== 'all') where.category = category

  let list = []
  try {
    const res = await db.collection('posts')
      .where(where)
      .orderBy('createdAt', 'desc')
      .limit(50)
      .get()
    list = res.data
  } catch (err) {
    console.log('[getPosts] 查询失败:', err.errCode)
    if (err.errCode === -502005) {
      return { code: 500, message: '论坛数据表未创建，请在云开发控制台新建 posts 集合' }
    }
    return { code: 500, message: '论坛数据加载失败，请稍后重试' }
  }

  return {
    code: 0,
    data: list.map(p => ({
      _id: p._id,
      category: p.category,
      title: p.title,
      content: p.content,
      subject: p.subject,
      studyTime: p.studyTime,
      location: p.location,
      authorName: p.authorName,
      authorAvatar: p.authorAvatar,
      likeCount: p.likeCount || 0,
      commentCount: p.commentCount || 0,
      createdAt: p.createdAt,
      isLiked: Array.isArray(p.likes) && p.likes.indexOf(OPENID) >= 0,
      isMine: p._openid === OPENID
    }))
  }
}

async function getPostDetail({ postId }, { OPENID }) {
  let postRes
  try {
    postRes = await db.collection('posts').doc(postId).get()
  } catch (err) {
    console.log('[getPostDetail] 读取失败:', err.errCode)
    return { code: 404, message: '帖子不存在或已被删除' }
  }
  if (!postRes.data) return { code: 404, message: '帖子不存在或已被删除' }

  let comments = []
  try {
    const commentsRes = await db.collection('postComments')
      .where({ postId })
      .orderBy('createdAt', 'asc')
      .limit(100)
      .get()
    comments = commentsRes.data
  } catch (err) {
    console.log('[getPostDetail] 评论查询失败:', err.errCode)
  }

  const post = {
    ...postRes.data,
    likes: undefined,
    likeCount: postRes.data.likeCount || 0,
    commentCount: postRes.data.commentCount || 0,
    isLiked: (postRes.data.likes || []).indexOf(OPENID) >= 0,
    isMine: postRes.data._openid === OPENID
  }

  const isAdmin = await checkIsAdmin(OPENID)
  post.canDelete = post.isMine || isAdmin

  return {
    code: 0,
    data: {
      post,
      comments: comments.map(c => ({
        _id: c._id,
        content: c.content,
        authorName: c.authorName,
        authorAvatar: c.authorAvatar,
        createdAt: c.createdAt,
        isMine: c._openid === OPENID
      }))
    }
  }
}

async function createPost(params, { OPENID }) {
  const { category, title, content, subject, studyTime, location, contact } = params

  if (!title || !title.trim()) return { code: 400, message: '请填写标题' }
  if (!content || !content.trim()) return { code: 400, message: '请填写内容' }
  if (title.trim().length > 50) return { code: 400, message: '标题不能超过 50 字' }
  if (content.trim().length > 1000) return { code: 400, message: '内容不能超过 1000 字' }

  const secOk = await checkTextSecurity(`${title} ${content}`, OPENID, 3)
  if (!secOk) return { code: 400, message: '内容包含敏感信息，请修改后重试' }

  const author = await getAuthorSnapshot(OPENID)

  try {
    const res = await db.collection('posts').add({
      data: {
        _openid: OPENID,
        category: POST_CATEGORIES.indexOf(category) >= 0 ? category : POST_CATEGORIES[0],
        title: title.trim(),
        content: content.trim(),
        subject: (subject || '').trim(),
        studyTime: (studyTime || '').trim(),
        location: (location || '').trim(),
        contact: (contact || '').trim(),
        authorName: author.name,
        authorAvatar: author.avatar,
        likes: [],
        likeCount: 0,
        commentCount: 0,
        createdAt: db.serverDate()
      }
    })
    return { code: 0, data: res._id }
  } catch (err) {
    console.log('[createPost] 写入失败:', err.errCode, err.message)
    if (err.errCode === -502005) {
      return { code: 500, message: '论坛数据表未创建，请先在云开发控制台新建 posts 集合' }
    }
    return { code: 500, message: `发布失败：${err.message || '未知错误'}` }
  }
}

async function deletePost({ postId }, { OPENID }) {
  const res = await db.collection('posts').doc(postId).get()
  if (!res.data) return { code: 404, message: '帖子不存在' }

  if (res.data._openid !== OPENID) {
    const isAdmin = await checkIsAdmin(OPENID)
    if (!isAdmin) return { code: 403, message: '只能删除自己的帖子' }
  }

  await db.collection('posts').doc(postId).remove()
  try {
    await db.collection('postComments').where({ postId }).remove()
  } catch (err) {
    console.log('[deletePost] 清理评论失败:', err.errCode)
  }

  return { code: 0, message: '已删除' }
}

async function toggleLike({ postId }, { OPENID }) {
  const res = await db.collection('posts').doc(postId).get()
  if (!res.data) return { code: 404, message: '帖子不存在' }

  const likes = Array.isArray(res.data.likes) ? res.data.likes : []
  const liked = likes.indexOf(OPENID) >= 0
  const likeCount = Math.max(0, (res.data.likeCount || 0) + (liked ? -1 : 1))

  await db.collection('posts').doc(postId).update({
    data: liked
      ? { likes: _.pull(OPENID), likeCount }
      : { likes: _.addToSet(OPENID), likeCount }
  })

  return { code: 0, data: { liked: !liked, likeCount } }
}

async function addComment({ postId, content }, { OPENID }) {
  if (!content || !content.trim()) return { code: 400, message: '请输入评论内容' }
  if (content.trim().length > 200) return { code: 400, message: '评论不能超过 200 字' }

  const secOk = await checkTextSecurity(content, OPENID, 2)
  if (!secOk) return { code: 400, message: '评论包含敏感内容，请修改后重试' }

  let postRes
  try {
    postRes = await db.collection('posts').doc(postId).get()
  } catch (err) {
    return { code: 404, message: '帖子不存在' }
  }
  if (!postRes.data) return { code: 404, message: '帖子不存在' }

  const author = await getAuthorSnapshot(OPENID)

  let res
  try {
    res = await db.collection('postComments').add({
      data: {
        _openid: OPENID,
        postId,
        content: content.trim(),
        authorName: author.name,
        authorAvatar: author.avatar,
        createdAt: db.serverDate()
      }
    })
  } catch (err) {
    console.log('[addComment] 写入失败:', err.errCode, err.message)
    if (err.errCode === -502005) {
      return { code: 500, message: '评论表未创建，请先在云开发控制台新建 postComments 集合' }
    }
    return { code: 500, message: `评论失败：${err.message || '未知错误'}` }
  }

  await db.collection('posts').doc(postId).update({
    data: { commentCount: _.inc(1) }
  })

  return { code: 0, data: res._id }
}

// ============ 外观（壁纸）设置 ============

const DEFAULT_APPEARANCE = {
  wallpaperId: 'default',
  customFileID: '',
  overlay: 0
}

async function getAppearance() {
  try {
    const res = await db.collection('settings').doc('appearance').get()
    return { code: 0, data: { ...DEFAULT_APPEARANCE, ...res.data } }
  } catch (err) {
    // settings 集合未创建或记录不存在时，回落到默认壁纸
    return { code: 0, data: DEFAULT_APPEARANCE }
  }
}

async function setAppearance(params, { OPENID }) {
  const isAdmin = await checkIsAdmin(OPENID)
  if (!isAdmin) return { code: 403, message: '仅管理员可修改壁纸' }

  const wallpaperId = params.wallpaperId || 'default'
  const data = {
    wallpaperId,
    customFileID: wallpaperId === 'custom' ? (params.customFileID || '') : '',
    overlay: Math.min(0.8, Math.max(0, Number(params.overlay) || 0)),
    updatedBy: OPENID,
    updatedAt: db.serverDate()
  }

  try {
    await db.collection('settings').doc('appearance').set({ data })
  } catch (err) {
    console.log('[setAppearance] 写入失败:', err.errCode, err.message)
    if (err.errCode === -502005) {
      return { code: 500, message: '请先在云开发控制台新建 settings 集合' }
    }
    return { code: 500, message: `保存失败：${err.message || '未知错误'}` }
  }

  return { code: 0, data }
}

// ============ 公告 ============

const DEFAULT_NOTICE = { enabled: false, title: '', content: '' }

async function getNotice() {
  try {
    const res = await db.collection('settings').doc('notice').get()
    return { code: 0, data: { ...DEFAULT_NOTICE, ...res.data } }
  } catch (err) {
    return { code: 0, data: DEFAULT_NOTICE }
  }
}

async function setNotice(params, { OPENID }) {
  const isAdmin = await checkIsAdmin(OPENID)
  if (!isAdmin) return { code: 403, message: '仅管理员可发布公告' }

  const data = {
    enabled: !!params.enabled,
    title: (params.title || '').trim().slice(0, 40),
    content: (params.content || '').trim().slice(0, 500),
    updatedBy: OPENID,
    updatedAt: db.serverDate()
  }

  if (data.enabled && !data.content) {
    return { code: 400, message: '启用公告时内容不能为空' }
  }

  if (data.content) {
    const ok = await checkTextSecurity(`${data.title} ${data.content}`, OPENID, 4)
    if (!ok) return { code: 400, message: '公告内容包含敏感内容，请修改后重试' }
  }

  try {
    await db.collection('settings').doc('notice').set({ data })
  } catch (err) {
    console.log('[setNotice] 写入失败:', err.errCode, err.message)
    if (err.errCode === -502005) {
      return { code: 500, message: '请先在云开发控制台新建 settings 集合' }
    }
    return { code: 500, message: `保存失败：${err.message || '未知错误'}` }
  }

  return { code: 0, data }
}

// ============ 征集建议 ============

async function createSuggestion(params, { OPENID }) {
  const { content, contact } = params
  if (!content || !content.trim()) {
    return { code: 400, message: '建议内容不能为空' }
  }
  // 取用户昵称（字段名容错）
  let nickname = ''
  try {
    const userRes = await db.collection('users').where({ _openid: OPENID }).get()
    if (userRes.data.length > 0) {
      nickname = userRes.data[0].nickName || userRes.data[0].nickname || ''
    }
  } catch (e) { /* 忽略 */ }

  const res = await db.collection('suggestions').add({
    data: {
      _openid: OPENID,
      nickname,
      content: content.trim(),
      contact: (contact || '').trim(),
      status: 'pending',
      createdAt: db.serverDate()
    }
  })
  return { code: 0, data: { _id: res._id }, message: '提交成功，感谢你的建议！' }
}

async function getMySuggestions(params, { OPENID }) {
  const res = await db.collection('suggestions')
    .where({ _openid: OPENID })
    .orderBy('createdAt', 'desc')
    .limit(50)
    .get()
  return { code: 0, data: res.data }
}

async function getSuggestions(params, { OPENID }) {
  const isAdmin = await checkIsAdmin(OPENID)
  if (!isAdmin) return { code: 403, message: '无权限' }
  const res = await db.collection('suggestions')
    .orderBy('createdAt', 'desc')
    .limit(100)
    .get()
  return { code: 0, data: res.data }
}

async function markSuggestionDone({ id }, { OPENID }) {
  const isAdmin = await checkIsAdmin(OPENID)
  if (!isAdmin) return { code: 403, message: '无权限' }
  await db.collection('suggestions').doc(id).update({ data: { status: 'done' } })
  return { code: 0, message: '已标记为已处理' }
}

// ============ t4: 临时锁（locks 集合） ============

/** 为某座位时段加上临时锁（默认 2 分钟）；同 openid 可续期 */
async function acquireLock({ roomId, seatId, seatCode, date, startTime, endTime, minutes, kind }, { OPENID }) {
  const mins = Math.max(1, Math.min(15, Number(minutes) || 2))
  const expireAt = Date.now() + mins * 60000
  const res = await db.collection('locks').where({
    roomId, seatId, date, _openid: OPENID, kind: kind || 'selecting'
  }).get()
  if (res.data.length > 0) {
    await db.collection('locks').doc(res.data[0]._id).update({
      data: { expireAt, seatCode, startTime, endTime, updatedAt: db.serverDate() }
    })
    return { code: 0, data: { ok: true, renewed: true } }
  }
  await db.collection('locks').add({
    data: {
      roomId, seatId, seatCode: seatCode || '', date,
      startTime: startTime || '', endTime: endTime || '',
      _openid: OPENID, kind: kind || 'selecting',
      expireAt, createdAt: db.serverDate()
    }
  })
  return { code: 0, data: { ok: true, renewed: false } }
}

/** 主动释放锁（确认预约成功后调用） */
async function releaseLock({ roomId, seatId, date, kind }, { OPENID }) {
  try {
    const where = { roomId, seatId, date, _openid: OPENID }
    if (kind) where.kind = kind
    await db.collection('locks').where(where).remove()
  } catch (e) { /* 忽略 */ }
  return { code: 0, message: 'ok' }
}

// ============ 现场占用（kind='occupy'） ============

/** 管理员手动标记某座位被现场人员占用 */
async function markSeatOccupied({ roomId, seatId, seatCode, date, reason, minutes }, { OPENID }) {
  const isAdmin = await checkIsAdmin(OPENID)
  if (!isAdmin) return { code: 403, message: '仅管理员可标记现场占用' }

  // 默认到当天 24:00，或指定分钟数（最小 30，最大 1440）
  let expireAt
  if (minutes) {
    const m = Math.max(30, Math.min(1440, Number(minutes)))
    expireAt = Date.now() + m * 60000
  } else {
    const endOfDay = new Date(`${date}T23:59:59+08:00`)
    expireAt = endOfDay.getTime()
  }

  // 先清理该座位上已有的 kind='occupy' 锁（避免重复）
  await db.collection('locks').where({
    roomId, seatId, date, kind: 'occupy'
  }).remove()

  await db.collection('locks').add({
    data: {
      roomId, seatId, seatCode: seatCode || '', date,
      startTime: '', endTime: '',
      _openid: OPENID, kind: 'occupy',
      reason: reason || '',
      expireAt, createdAt: db.serverDate()
    }
  })
  return { code: 0, message: '已标记为现场占用' }
}

/** 管理员释放现场占用 */
async function releaseSeatOccupied({ roomId, seatId, date }, { OPENID }) {
  const isAdmin = await checkIsAdmin(OPENID)
  if (!isAdmin) return { code: 403, message: '仅管理员可释放' }
  try {
    await db.collection('locks').where({
      roomId, seatId, date, kind: 'occupy'
    }).remove()
  } catch (e) {}
  return { code: 0, message: '已释放现场占用' }
}

/** 管理员批量标记/释放现场占用 */
async function batchMarkOccupied({ roomId, date, seatIds, action }, { OPENID }) {
  const isAdmin = await checkIsAdmin(OPENID)
  if (!isAdmin) return { code: 403, message: '仅管理员可操作' }
  const list = Array.isArray(seatIds) ? seatIds : []
  if (list.length === 0) return { code: 400, message: '请选择座位' }

  let count = 0
  for (const seatId of list) {
    if (action === 'release') {
      await db.collection('locks').where({
        roomId, seatId, date, kind: 'occupy'
      }).remove()
      count++
    } else {
      // 默认 expireAt 到当天 23:59:59
      const endOfDay = new Date(`${date}T23:59:59+08:00`)
      await db.collection('locks').where({
        roomId, seatId, date, kind: 'occupy'
      }).remove()
      await db.collection('locks').add({
        data: {
          roomId, seatId, seatCode: '', date,
          startTime: '', endTime: '',
          _openid: OPENID, kind: 'occupy',
          reason: '管理员批量标记',
          expireAt: endOfDay.getTime(),
          createdAt: db.serverDate()
        }
      })
      count++
    }
  }
  return { code: 0, data: { count }, message: action === 'release' ? `已释放 ${count} 个` : `已标记 ${count} 个` }
}

/** 定时清理过期锁 */
async function cleanupExpiredLocks() {
  const now = Date.now()
  let res
  try {
    res = await db.collection('locks').where({ expireAt: _.lt(now) }).limit(200).get()
  } catch { return 0 } // locks 集合不存在，跳过本次清理
  let removed = 0
  for (const l of res.data) {
    try {
      await db.collection('locks').doc(l._id).remove()
      removed++
    } catch (e) {}
  }
  console.log(`[Timer] locks 清理 ${removed} 条过期锁`)
  return { code: 0, data: { removed } }
}

// ============ t2: 座位收藏（存在 users.favoriteSeats 数组，最多 3 个） ============

async function saveFavoriteSeat({ roomId, seatId, seatCode, roomName }, { OPENID }) {
  const MAX = 3
  const userRes = await db.collection('users').where({ _openid: OPENID }).get()
  let user
  if (userRes.data.length === 0) {
    const newUser = await db.collection('users').add({
      data: { _openid: OPENID, isAdmin: false, createdAt: db.serverDate() }
    })
    user = { _id: newUser._id, favoriteSeats: [] }
  } else {
    user = userRes.data[0]
  }

  const list = Array.isArray(user.favoriteSeats) ? user.favoriteSeats.slice() : []
  // 已收藏同一座位 → 跳过
  if (list.some(s => s.roomId === roomId && s.seatId === seatId)) {
    return { code: 400, message: '该座位已在常用列表中' }
  }
  // 超过上限 → 提示
  if (list.length >= MAX) {
    return { code: 400, message: `常用座位最多 ${MAX} 个，请先删除一个` }
  }
  list.push({ roomId, seatId, seatCode: seatCode || '', roomName: roomName || '', savedAt: db.serverDate() })
  await db.collection('users').doc(user._id).update({
    data: { favoriteSeats: list }
  })
  return { code: 0, data: list, message: '已添加到常用座位' }
}

async function getFavoriteSeats({}, { OPENID }) {
  const userRes = await db.collection('users').where({ _openid: OPENID }).get()
  const list = userRes.data.length > 0 && Array.isArray(userRes.data[0].favoriteSeats)
    ? userRes.data[0].favoriteSeats : []
  return { code: 0, data: list }
}

async function removeFavoriteSeat({ roomId, seatId }, { OPENID }) {
  const userRes = await db.collection('users').where({ _openid: OPENID }).get()
  if (userRes.data.length === 0) return { code: 400, message: '未找到用户' }
  const user = userRes.data[0]
  const list = Array.isArray(user.favoriteSeats) ? user.favoriteSeats : []
  const filtered = list.filter(s => !(s.roomId === roomId && s.seatId === seatId))
  await db.collection('users').doc(user._id).update({ data: { favoriteSeats: filtered } })
  return { code: 0, data: filtered }
}

// ============ t5: 多日连续预约 ============

async function createBookingBatch(params, { OPENID }) {
  const { roomId, seatId, seatCode, roomName, startDate, startTime, endTime, days } = params
  if (!startDate || !startTime || !endTime) {
    return { code: 400, message: '预约信息不完整' }
  }

  const bjNow = getBeijingNow()
  const todayStr = formatDateStr(bjNow)
  const maxBatchDays = 30
  const batchDays = Math.max(1, Math.min(maxBatchDays, Number(days) || 7))

  // 复用 createBooking 的参数结构
  const base = { roomId, seatId, seatCode, roomName, startTime, endTime }

  let created = 0, skipped = 0, failed = 0
  const details = []

  for (let i = 0; i < batchDays; i++) {
    const d = new Date(`${startDate}T00:00:00+08:00`)
    d.setDate(d.getDate() + i)
    const dateStr = formatDateStr(d)

    // 超过一周的日期，createBooking 会拦截，这里直接跳过
    if (dateStr > formatDateStr(new Date(bjNow.getTime() + 7 * 86400000))) {
      skipped++
      details.push({ date: dateStr, status: 'skipped', reason: '超出可预约日期范围' })
      continue
    }

    try {
      const res = await createBooking({ ...base, date: dateStr }, { OPENID })
      if (res.code === 0) {
        created++
        details.push({ date: dateStr, status: 'created' })
      } else {
        skipped++
        details.push({ date: dateStr, status: 'skipped', reason: res.message })
      }
    } catch (err) {
      failed++
      details.push({ date: dateStr, status: 'failed', reason: (err && err.message) || '未知错误' })
    }
  }

  return {
    code: 0,
    data: { created, skipped, failed, details },
    message: `成功 ${created} 条，跳过 ${skipped} 条，失败 ${failed} 条`
  }
}

// ============ t8: 自习时长排行榜（周榜 / 月榜） ============

/** 获取排行榜：rankMode='week' | 'month'；返回前 10 + 当前用户排名 */
async function getStudyRanking({ rankMode }, { OPENID }) {
  const now = getBeijingNow()
  let startDateStr
  const mode = rankMode === 'month' ? 'month' : 'week'

  if (mode === 'week') {
    const weekday = now.getUTCDay() === 0 ? 7 : now.getUTCDay()
    const weekStart = new Date(now.getTime() - (weekday - 1) * 86400000)
    startDateStr = formatDateStr(weekStart)
  } else {
    // 本月第一天
    const y = now.getUTCFullYear()
    const m = String(now.getUTCMonth() + 1).padStart(2, '0')
    startDateStr = `${y}-${m}-01`
  }

  const bookingsRes = await db.collection('bookings')
    .where({
      status: _.in(['checkedin', 'completed']),
      date: _.gte(startDateStr)
    })
    .limit(2000)
    .get()

  // 按 user 分组求和
  const map = {}
  bookingsRes.data.forEach(b => {
    const key = b._openid
    const start = parseBeijingDate(`${b.date}T${b.startTime}:00`)
    const end = parseBeijingDate(`${b.date}T${b.endTime}:00`)
    const mins = Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000))
    if (!map[key]) map[key] = { _openid: key, totalMinutes: 0 }
    map[key].totalMinutes += mins
  })

  // 取前 10 用户的昵称/头像快照
  const sorted = Object.values(map).sort((a, b) => b.totalMinutes - a.totalMinutes)

  const openids = sorted.slice(0, 20).map(x => x._openid)
  let userMap = {}
  if (openids.length > 0) {
    try {
      const uRes = await db.collection('users').where({ _openid: _.in(openids) }).limit(30).get()
      uRes.data.forEach(u => {
        userMap[u._openid] = { name: u.name || '匿名同学', avatar: u.avatar || '' }
      })
    } catch (e) {}
  }

  const list = sorted.slice(0, 10).map((item, idx) => ({
    rank: idx + 1,
    _openid: item._openid,
    name: userMap[item._openid] ? userMap[item._openid].name : '匿名同学',
    avatar: userMap[item._openid] ? userMap[item._openid].avatar : '',
    totalMinutes: item.totalMinutes
  }))

  // 找出当前用户的排名（未登录 OPENID 为空时跳过）
  let myRank = 0
  let myMinutes = 0
  if (OPENID) {
    const meIdx = sorted.findIndex(x => x._openid === OPENID)
    if (meIdx >= 0) {
      myRank = meIdx + 1
      myMinutes = sorted[meIdx].totalMinutes
    }
  }

  return {
    code: 0,
    data: {
      mode,
      totalUsers: sorted.length,
      myRank,
      myMinutes,
      list
    }
  }
}

// ============ 主入口 ============

exports.main = async (event, context) => {
  // 定时触发器（config.json 里的 timer）事件带 Type: 'Timer'
  if (event && event.Type === 'Timer') {
    const cancelRes = await autoCancelOverdueBookings()
    const checkoutRes = await autoCheckoutOverdueBookings()
    const remindRes = await sendStartReminders()
    const lockRes = await cleanupExpiredLocks()
    return {
      code: 0,
      data: {
        cancelled: cancelRes.data.cancelled,
        autoCheckout: checkoutRes.data.autoCheckout,
        reminded: remindRes.data.reminded,
        locksRemoved: lockRes.data.removed
      }
    }
  }

  const wxContext = cloud.getWXContext()
  const { action, ...params } = event

  console.log(`[API] ${action}`, params)

  try {
    switch (action) {
      // 自习室
      case 'getRooms': return await getRooms()
      case 'getRoomsWithStats': return await getRoomsWithStats(params)
      case 'getRoomDetail': return await getRoomDetail(params, wxContext)
      case 'createRoom': return await createRoom(params, wxContext)
      case 'updateRoom': return await updateRoom(params, wxContext)
      case 'deleteRoom': return await deleteRoom(params, wxContext)

      // 座位
      case 'getSeats': return await getSeats(params)
      case 'getSeatBookings': return await getSeatBookings(params)
      case 'addSeats': return await addSeats(params, wxContext)
      case 'removeSeats': return await removeSeats(params, wxContext)
      case 'recognizeSeats': return await recognizeSeats(params, wxContext)
      case 'getRoomQrCode': return await getRoomQrCode(params, wxContext)
      case 'findScanBooking': return await findScanBooking(params, wxContext)

      // 预约
      case 'createBooking': return await createBooking(params, wxContext)
      case 'getMyBookings': return await getMyBookings(params, wxContext)
      case 'cancelBooking': return await cancelBooking(params, wxContext)

      // 签到
      case 'checkIn': return await checkIn(params, wxContext)
      case 'checkOut': return await checkOut(params, wxContext)
      case 'getCheckinInfo': return await getCheckinInfo(params, wxContext)

      // 管理员
      case 'checkIsAdmin': return { code: 0, data: await checkIsAdmin(wxContext.OPENID) }
      case 'bootstrapAdmin': return await bootstrapAdmin(params, wxContext)
      case 'setAdmin': return await setAdmin(params, wxContext)
      case 'getAdminCandidates': return await getAdminCandidates(params, wxContext)
      case 'adminSetUserBan': return await adminSetUserBan(params, wxContext)
      case 'adminListUsers': return await adminListUsers(params, wxContext)
      case 'adminDeleteUser': return await adminDeleteUser(params, wxContext)
      case 'adminExportBookings': return await adminExportBookings(params, wxContext)
      case 'deleteMyBookings': return await deleteMyBookings(params, wxContext)
      case 'adminGetBookings': return await adminGetBookings(params, wxContext)
      case 'updateBookingStatus': return await updateBookingStatus(params, wxContext)
      case 'getStats': return await getStats(params, wxContext)

      // 用户
      case 'getUserInfo': return await getUserInfo(params, wxContext)
      case 'updateUserInfo': return await updateUserInfo(params, wxContext)
      case 'getMyStats': return await getMyStats(params, wxContext)

      // 学习搭子论坛
      case 'getPosts': return await getPosts(params, wxContext)
      case 'getPostDetail': return await getPostDetail(params, wxContext)
      case 'createPost': return await createPost(params, wxContext)
      case 'deletePost': return await deletePost(params, wxContext)
      case 'toggleLike': return await toggleLike(params, wxContext)
      case 'addComment': return await addComment(params, wxContext)

      // 外观（壁纸）
      case 'getAppearance': return await getAppearance()
      case 'setAppearance': return await setAppearance(params, wxContext)

      // 公告
      case 'getNotice': return await getNotice()
      case 'setNotice': return await setNotice(params, wxContext)

      // 订阅消息
      case 'getSubscribeTemplate': return await getSubscribeTemplate()

      // 征集建议
      case 'createSuggestion': return await createSuggestion(params, wxContext)
      case 'getMySuggestions': return await getMySuggestions(params, wxContext)
      case 'getSuggestions': return await getSuggestions(params, wxContext)
      case 'markSuggestionDone': return await markSuggestionDone(params, wxContext)

      // t4: 临时锁
      case 'acquireLock': return await acquireLock(params, wxContext)
      case 'releaseLock': return await releaseLock(params, wxContext)

      // 现场占用（管理员手动标记）
      case 'markSeatOccupied': return await markSeatOccupied(params, wxContext)
      case 'releaseSeatOccupied': return await releaseSeatOccupied(params, wxContext)
      case 'batchMarkOccupied': return await batchMarkOccupied(params, wxContext)

      // t2: 座位收藏
      case 'saveFavoriteSeat': return await saveFavoriteSeat(params, wxContext)
      case 'getFavoriteSeats': return await getFavoriteSeats(params, wxContext)
      case 'removeFavoriteSeat': return await removeFavoriteSeat(params, wxContext)

      // t5: 多日连续预约
      case 'createBookingBatch': return await createBookingBatch(params, wxContext)

      // t8: 排行榜
      case 'getStudyRanking': return await getStudyRanking(params, wxContext)

      default:
        return { code: 404, message: `未知的 action: ${action}` }
    }
  } catch (err) {
    console.error(err)
    return { code: 500, message: err.message || '服务器错误' }
  }
}
