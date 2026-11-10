# 📚 自习室预约小程序

一个基于 **微信小程序 + 云开发** 的自习室座位预约管理系统。

## ✨ 功能特性

### 用户端
- 🏫 **自习室浏览** - 查看所有自习室信息、营业时段、剩余座位
- 📅 **座位预约** - 选择日期、时段、座位，一键预约
- 📋 **我的预约** - 查看/筛选预约记录，取消预约
- ✅ **签到签退** - 预约后自动签到签退，超时自动释放
- 👤 **个人中心** - 微信授权登录、查看预约统计

### 管理后台
- 🏫 **自习室管理** - 新增/编辑/删除自习室
- 🪑 **座位管理** - 批量添加座位、按行管理
- 📋 **预约管理** - 查看全部预约、修改状态、手动取消
- 📊 **数据统计** - 预约趋势、自习室使用率可视化

## 🛠️ 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | 原生微信小程序 (WXML/WXSS/JS) |
| 后端 | 微信云开发 (Cloud Functions) |
| 数据库 | 微信云开发数据库 (NoSQL) |

## 📁 项目结构

```
study-room-app/
├── project.config.json          # 微信小程序项目配置
├── project.private.config.json  # 私有配置（自动生成）
├── cloudfunctions/               # 云函数目录
│   └── api/                     # 统一 API 云函数
│       ├── index.js             # 云函数入口（所有业务逻辑）
│       ├── package.json         # 依赖
│       └── init.js              # 初始化数据示例
├── miniprogram/                 # 小程序前端代码
│   ├── app.js                   # 小程序入口
│   ├── app.json                 # 全局配置 & 路由
│   ├── app.wxss                 # 全局样式
│   ├── sitemap.json
│   ├── pages/
│   │   ├── index/               # 首页 - 自习室列表
│   │   ├── booking/             # 预约页面
│   │   ├── my-bookings/         # 我的预约
│   │   ├── checkin/             # 签到/签退
│   │   ├── profile/             # 个人中心
│   │   └── admin/               # 管理后台
│   │       ├── admin.js         # 后台首页
│   │       ├── rooms/           # 自习室管理
│   │       ├── room-edit/       # 自习室编辑
│   │       ├── seats/           # 座位管理
│   │       ├── bookings/        # 预约管理
│   │       └── stats/           # 数据统计
│   └── utils/
│       ├── api.js               # 云函数调用封装
│       └── util.js              # 通用工具函数
└── README.md
```

## 🚀 快速开始

### 1. 准备工作

- 下载并安装 [微信开发者工具](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html)
- 注册微信小程序账号，获取 **AppID**

### 2. 导入项目

1. 打开微信开发者工具
2. 点击「导入项目」
3. 选择 `study-room-app` 目录
4. 填入你的 **AppID**
5. 完成导入

### 3. 开启云开发

1. 在开发者工具顶部点击「云开发」按钮
2. 点击「开通」，选择免费额度即可
3. 记录下你的 **云环境 ID**（形如 `cloud1-xxxxx`）

### 4. 配置云环境

打开 `miniprogram/app.js`，修改 `cloudEnv`：

```js
globalData: {
  cloudEnv: '你的云环境ID',  // 替换为你的云开发环境ID
}
```

打开 `cloudfunctions/api/index.js` 第 3 行，确保：

```js
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
```

### 5. 创建数据库集合

在云开发控制台 → 数据库 → 新建集合，创建以下 3 个集合：

| 集合名 | 说明 | 权限设置 |
|--------|------|----------|
| `rooms` | 自习室信息 | 所有用户可读，仅管理端云函数写 |
| `bookings` | 预约记录 | 仅创建者可读写 |
| `users` | 用户信息 | 仅创建者可读写 |

### 6. 部署云函数

1. 在开发者工具左侧找到 `cloudfunctions/api` 目录
2. **右键点击 api 文件夹** → 选择「在外部终端中打开」
3. 在终端执行：`npm install`（安装依赖）
4. **右键点击 api 文件夹** → 选择「上传并部署：云端安装依赖」
5. 等待部署完成（约 1-2 分钟）

### 7. 初始化数据（可选）

可以在云开发控制台的数据库页面手动添加示例数据，或通过云函数操作。示例自习室数据见 `cloudfunctions/api/init.js`。

### 8. 设置管理员

默认所有用户都是普通用户。要设置管理员：

1. 先让自己的微信账号登录一次小程序（打开小程序即可）
2. 在云开发控制台 → 数据库 → `users` 集合
3. 找到你的用户记录，把 `isAdmin` 字段改为 `true`
4. 保存后重新进入小程序，个人中心会显示「管理员」标签

## 📦 数据库 Schema

### rooms 集合
```json
{
  "_id": "自动生成",
  "_openid": "创建者openid",
  "name": "自习室名称",
  "location": "位置",
  "description": "描述",
  "openTime": "08:00",
  "closeTime": "22:00",
  "image": "",
  "seats": [
    { "id": "A01", "code": "A01", "row": "A", "col": 1, "type": "normal" }
  ],
  "createdAt": "服务器时间"
}
```

### bookings 集合
```json
{
  "_id": "自动生成",
  "_openid": "预约者openid",
  "roomId": "自习室ID",
  "roomName": "自习室名称",
  "seatId": "座位ID",
  "seatCode": "座位编号",
  "userId": "用户ID",
  "date": "2025-10-30",
  "startTime": "09:00",
  "endTime": "10:00",
  "status": "booked|checkedin|completed|cancelled",
  "checkInTime": null,
  "checkOutTime": null,
  "cancelledBy": "user|admin|system",
  "createdAt": "服务器时间"
}
```

### users 集合
```json
{
  "_id": "自动生成",
  "_openid": "用户openid",
  "name": "昵称",
  "avatar": "头像URL",
  "phone": "手机号",
  "isAdmin": false,
  "createdAt": "服务器时间"
}
```

## 🧩 云函数 Action 列表

统一 API 云函数，通过 `action` 参数区分操作：

### 自习室
- `getRooms` - 获取列表
- `getRoomDetail` - 获取详情
- `createRoom` - 新增（管理员）
- `updateRoom` - 更新（管理员）
- `deleteRoom` - 删除（管理员）

### 座位
- `getSeats` - 获取座位及预约状态
- `addSeats` - 批量新增（管理员）
- `removeSeats` - 删除（管理员）

### 预约
- `createBooking` - 创建预约
- `getMyBookings` - 我的预约
- `cancelBooking` - 取消预约

### 签到
- `checkIn` - 签到
- `checkOut` - 签退
- `getCheckinInfo` - 获取签到详情

### 管理员
- `checkIsAdmin` - 检查管理员权限
- `setAdmin` - 设置管理员
- `adminGetBookings` - 全部预约
- `updateBookingStatus` - 修改预约状态
- `getStats` - 统计数据

### 用户
- `getUserInfo` - 获取当前用户
- `updateUserInfo` - 更新用户信息

## 📱 使用流程

### 普通用户
1. 打开小程序 → 查看自习室列表
2. 点击自习室 → 选择日期、时段、座位
3. 确认预约 → 收到预约成功提示
4. 到自习室后 → 小程序内「去签到」
5. 离开时 → 「去签退」释放座位

### 管理员
1. 个人中心 → 管理后台
2. 自习室管理：新增/编辑自习室
3. 座位管理：批量添加座位
4. 预约管理：查看/调整全部预约
5. 数据统计：查看预约数据分析

## ⚠️ 注意事项

1. **AppID**: `project.config.json` 中的 AppID 需替换为你自己的
2. **云环境ID**: `app.js` 中的 `cloudEnv` 需替换为你自己的
3. **首次部署**: 务必先 `npm install` 再上传云函数
4. **数据库权限**: 生产环境建议收紧数据库权限，主要通过云函数读写
5. **超时签到**: 预约开始 60 分钟内未签到将自动取消

## 🔧 常见问题

**Q: 云函数调用失败？**
A: 检查云开发环境 ID 是否正确，云函数是否已上传部署。

**Q: 页面打开报错 "请使用 2.2.3 或以上的基础库"？**
A: 在 `project.config.json` 中更新 `libVersion` 到最新稳定版。

**Q: 如何让多个管理员？**
A: 在云开发控制台 `users` 集合中，把对应用户的 `isAdmin` 设为 `true`。

## 📄 License

MIT License
