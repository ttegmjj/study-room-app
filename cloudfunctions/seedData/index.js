// cloudfunctions/seedData/index.js
// 初始化脚本：创建示例自习室 + 座位
// 用法：云开发控制台 → 云函数 → seedData → 测试 → 运行
//   - 不传参数：只补充缺少的自习室（按名称去重，不动已有数据）
//   - {"reset": true}：先清空 rooms 再重建
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

// 自习室定义：layout 为每排座位数，如 { A: 5, B: 5, C: 4 }
const ROOMS = [
  {
    name: '晨光自习室',
    location: '教学楼 A 栋 301',
    description: '靠窗位置，光线充足，适合早间学习',
    openTime: '07:00',
    closeTime: '22:00',
    layout: { A: 5, B: 5, C: 4 }
  },
  {
    name: '静音自习室',
    location: '图书馆 2 层 东侧',
    description: '绝对安静，禁止交谈，有插座',
    openTime: '08:00',
    closeTime: '23:00',
    layout: { A: 4, B: 4, C: 4, D: 4 }
  },
  {
    name: '小组讨论室',
    location: '教学楼 B 栋 105',
    description: '可小声讨论，有白板和投影',
    openTime: '09:00',
    closeTime: '21:00',
    layout: { T: 8 }
  },
  {
    name: '夜读自习室',
    location: '图书馆 1 层 夜读区',
    description: '晚间开放，台灯座位，适合熬夜冲刺',
    openTime: '18:00',
    closeTime: '23:30',
    layout: { A: 3, B: 3, C: 3, D: 3 }
  },
  {
    name: '考研专区',
    location: '教学楼 C 栋 201',
    description: '大桌隔断，长时间学习友好，禁止占座',
    openTime: '07:30',
    closeTime: '22:30',
    layout: { A: 4, B: 4, C: 4, D: 4, E: 4 }
  },
  {
    name: '湖景自习室',
    location: '湖畔自习中心 2 层',
    description: '湖景落地窗，环境安静，适合阅读',
    openTime: '10:00',
    closeTime: '22:00',
    layout: { A: 5, B: 5 }
  },
  {
    name: '电子阅览自习室',
    location: '信息楼 3 层',
    description: '配有插座与网络，可带电脑学习',
    openTime: '08:00',
    closeTime: '21:00',
    layout: { A: 6, B: 6 }
  }
]

function buildSeats(layout) {
  const seats = []
  Object.keys(layout).forEach(row => {
    const count = layout[row]
    for (let i = 1; i <= count; i++) {
      seats.push({ id: `${row}${i}`, row, code: `${row}-${i}`, status: 'available' })
    }
  })
  return seats
}

exports.main = async (event, context) => {
  const results = []

  // ========== 可选：清空旧自习室 ==========
  if (event && event.reset === true) {
    const rooms = await db.collection('rooms').get()
    for (const r of rooms.data) {
      await db.collection('rooms').doc(r._id).remove()
    }
    results.push(`已清空 ${rooms.data.length} 个自习室`)
  }

  // ========== 逐个创建（按名称去重） ==========
  for (const room of ROOMS) {
    const exists = await db.collection('rooms').where({ name: room.name }).get()
    if (exists.data.length > 0) {
      results.push(`⏭ ${room.name} 已存在，跳过`)
      continue
    }

    const seats = buildSeats(room.layout)
    const res = await db.collection('rooms').add({
      data: {
        name: room.name,
        location: room.location,
        description: room.description,
        openTime: room.openTime,
        closeTime: room.closeTime,
        image: '',
        seats,
        createdAt: db.serverDate()
      }
    })
    results.push(`✅ ${room.name}（${seats.length} 座位）已创建，ID: ${res._id}`)
  }

  return {
    code: 0,
    message: '初始化完成',
    total: ROOMS.length,
    results
  }
}
