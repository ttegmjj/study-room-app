// 云开发数据库初始化脚本
// 在云开发控制台 -> 数据库 -> 新建集合 中创建以下集合：
// rooms: 自习室信息
// bookings: 预约记录
// users: 用户信息
//
// 权限设置建议：
// rooms: 所有用户可读，仅创建者可写（管理员通过云函数写）
// bookings: 仅创建者可读写
// users: 仅创建者可读写

// 初始化自习室和座位的示例数据（可通过云开发控制台手动导入）
const initData = {
  rooms: [
    {
      name: '图书馆一楼自习区',
      location: '图书馆 1F',
      description: '安静舒适的学习环境，提供充电插座和WiFi',
      openTime: '08:00',
      closeTime: '22:00',
      image: '',
      seats: [
        { id: 'A01', code: 'A01', row: 'A', col: 1, type: 'normal' },
        { id: 'A02', code: 'A02', row: 'A', col: 2, type: 'normal' },
        { id: 'A03', code: 'A03', row: 'A', col: 3, type: 'normal' },
        { id: 'B01', code: 'B01', row: 'B', col: 1, type: 'power' },
        { id: 'B02', code: 'B02', row: 'B', col: 2, type: 'power' },
        { id: 'B03', code: 'B03', row: 'B', col: 3, type: 'power' },
        { id: 'C01', code: 'C01', row: 'C', col: 1, type: 'window' },
        { id: 'C02', code: 'C02', row: 'C', col: 2, type: 'window' },
        { id: 'C03', code: 'C03', row: 'C', col: 3, type: 'window' }
      ]
    },
    {
      name: '教学楼三楼自习室',
      location: '教学楼 301',
      description: '宽敞明亮，适合小组讨论和自习',
      openTime: '07:30',
      closeTime: '21:30',
      image: '',
      seats: [
        { id: 'D01', code: 'D01', row: 'D', col: 1, type: 'normal' },
        { id: 'D02', code: 'D02', row: 'D', col: 2, type: 'normal' },
        { id: 'D03', code: 'D03', row: 'D', col: 3, type: 'normal' },
        { id: 'E01', code: 'E01', row: 'E', col: 1, type: 'normal' },
        { id: 'E02', code: 'E02', row: 'E', col: 2, type: 'normal' }
      ]
    }
  ]
}

console.log('请在云开发控制台手动导入以上数据，或通过云函数初始化')
