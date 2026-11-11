# 📚 自习室预约小程序

一个基于 **微信小程序 + 云开发** 的智能自习室座位预约管理系统，内置 AI 助手、爽约惩罚、管理员用户管理等完整功能。

## ✨ 功能特性

### 用户端
- 🏫 **自习室浏览** - 查看所有自习室信息、营业时段、剩余座位
- 📅 **双拇指时段选择器** - 拖拽上下滑块快速选择起止时段
- 🪑 **座位网格选择** - 按行/列可视化显示座位状态（空/已约/现场占用）
- 📋 **我的预约** - 查看/筛选预约记录，取消预约
- ✅ **签到签退** - Canvas 动态签到码，支持扫码签到
- 🤖 **AI 悬浮球助手** - 全局可拖拽 AI 助手，随时解答自习问题
- 📊 **预约统计** - 总自习时长、签到天数、本周预约数
- 💬 **学习论坛** - 发帖/评论/点赞，学习交流
- 👤 **个人中心** - 微信授权登录、收藏座位、爽约记录

### AI 智能助手
- 🎯 **座位推荐** - 选座时 AI 自动分析空座情况给出选座建议
- 💬 **全局悬浮球** - 任何页面右下角出现紫色 🤖 悬浮球，可全屏拖拽、自动吸附边缘
- ⏱️ **超时兜底** - AI 3-5 秒超时自动显示预设文案，不让用户等待
- 🧠 **system prompt 优化** - 明确角色定义 + 回答规则，答非所问率低

### 爽约惩罚机制
- 预约开始 **15 分钟**后未签到 → 系统自动取消 + 记录一次爽约
- 连续爽约 **3 次** → 自动禁止预约 **1 天**
- 禁约过期后 → 下次预约时**自动解封**（自愈机制）
- 管理员 **完全豁免** - 不记爽约、不被禁约、预约不会被自动取消

### 管理后台
- 🏫 **自习室管理** - 新增/编辑/删除自习室
- 🪑 **座位管理** - 批量添加座位、按行管理
- 📋 **预约管理** - 查看全部预约、修改状态、手动取消
- 👤 **管理员管理** - 设置/取消其他管理员
- ⛔ **用户管理** - 筛选爽约/禁约用户、手动禁约/解封、删除用户
- 📊 **数据统计** - 预约趋势、自习室使用率可视化

### 性能优化（防卡顿）
- 🔥 **云函数预热** - app.js onLaunch 静默调 getRooms() 预热冷启动
- 💾 **内存缓存层** - 24 个读接口自动 30s 缓存，15 个写接口自动失效关联缓存
- ⚡ **onShow 节流** - 首页 5s、收藏 10s 节流，快速切 Tab 不重复请求
- 🎮 **touchMove 降频** - 时段选择器 60fps → 30fps，setData 帧级合并
- 📦 **源码包** - 0.73MB（限制 2MB），首次加载快

## 🛠️ 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | 原生微信小程序 (WXML/WXSS/JS) + 自定义 TabBar |
| 后端 | 微信云开发 (Cloud Functions) 单入口 switch 分发 |
| 数据库 | 微信云开发数据库 (NoSQL) |
| AI | wx.cloud.extend.AI + deepseek-v4-flash |
| 签到码 | Canvas 绘制普通二维码（个人主体不能用 wxacode） |

## 📁 项目结构

```
study-room-app/
├── project.config.json          # 微信小程序项目配置
├── project.private.config.json  # 私有配置（自动生成）
├── cloudfunctions/               # 云函数目录
│   ├── api/                     # 统一 API 云函数（主入口）
│   │   ├── index.js             # 所有业务逻辑（switch(action) 分发）
│   │   └── package.json
│   ├── autoCancelTimeout/       # 预约超时自动取消（Timer 触发）
│   ├── cleanTimeout/
│   ├── initAdmin/
│   └── seedData/
├── miniprogram/                 # 小程序前端代码
│   ├── app.js                   # 小程序入口（云开发初始化 + 预热）
│   ├── app.json                 # 全局配置 & 路由（所有页面注册）
│   ├── app.wxss                 # 全局样式
│   ├── sitemap.json
│   ├── custom-tab-bar/          # 自定义 TabBar
│   ├── components/
│   │   └── ai-ball/             # 🆕 全局 AI 悬浮球组件
│   │       ├── ai-ball.js       #   拖拽逻辑 + AI 对话 + 超时兜底
│   │       ├── ai-ball.wxml     #   悬浮球 + 对话面板
│   │       ├── ai-ball.wxss     #   紫色渐变 + 呼吸光环
│   │       └── ai-ball.json
│   ├── pages/
│   │   ├── index/               # 首页 - 自习室列表（onShow 节流）
│   │   ├── booking/             # 预约页面（双拇指时段选择器 + AI 推荐）
│   │   ├── my-bookings/         # 我的预约
│   │   ├── checkin/             # Canvas 签到码
│   │   ├── ai-demo/             # AI 助手独立页（已移除入口，保留代码）
│   │   ├── forum/               # 论坛（列表 + 发帖 + 详情）
│   │   ├── profile/             # 个人中心
│   │   │   └── edit/            # 编辑资料
│   │   ├── suggestion/          # 征集建议
│   │   └── admin/               # 管理后台
│   │       ├── admin.js         # 后台首页
│   │       ├── rooms/           # 自习室管理
│   │       ├── room-edit/       # 自习室编辑
│   │       ├── seats/           # 座位管理
│   │       ├── bookings/        # 预约管理
│   │       ├── admins/          # 管理员管理
│   │       ├── users/           # 🆕 用户管理（爽约/禁约/删除）
│   │       └── stats/           # 数据统计
│   ├── utils/
│   │   ├── api.js               # 云函数调用封装（🆕 内存缓存层）
│   │   ├── cache.js             # 🆕 通用内存缓存工具（get/set/wrap/invalidate）
│   │   ├── weapp.qrcode.js      # Canvas 二维码生成库
│   │   └── util.js              # 通用工具函数
│   └── images/tabbar/           # TabBar 图标（4 张约 453KB）
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
  cloudEnv: 'cloud1-d0gc4kpkl68d2072f',  // 替换为你的云开发环境ID
}
```

打开 `cloudfunctions/api/index.js` 第 3 行，确保：

```js
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
```

### 5. 创建数据库集合

在云开发控制台 → 数据库 → 新建集合：

| 集合名 | 说明 | 关键字段 |
|--------|------|----------|
| `rooms` | 自习室信息 | name, location, openTime, closeTime, seats[] |
| `bookings` | 预约记录 | _openid, roomId, seatId, date, startTime, endTime, status |
| `users` | 用户信息 | name, avatar, isAdmin, noShowCount, banUntil |
| `forum_posts` | 论坛帖子 | _openid, content, images[], likes, createdAt |
| `forum_comments` | 论坛评论 | _openid, postId, content, createdAt |
| `suggestions` | 用户建议 | _openid, content, createdAt |

### 6. 开通云 AI 能力

1. 云开发控制台 → 左侧菜单找「AI」
2. 开通云 AI 服务（选择 deepseek-v4-flash 模型即可）
3. 开通后 AI 悬浮球和座位推荐就能正常工作了

### 7. 部署云函数

1. 在开发者工具左侧找到 `cloudfunctions/api` 目录
2. **右键点击 api 文件夹** → 选择「上传并部署：云端安装依赖」
3. 等待部署完成（约 1-2 分钟）
4. 同样上传 `autoCancelTimeout`（定时任务）

### 8. 配置定时任务（自动取消超时预约）

1. 云开发控制台 → 云函数 → 找到 `api` 函数（主入口）
2. 新建定时器触发器，Cron 表达式：`* * * * * * *`（每分钟执行一次 autoCancelOverdueBookings）
3. 或者单独部署 `autoCancelTimeout` 云函数并配置 Timer

### 9. 设置管理员

1. 先让自己的微信账号登录一次小程序（打开小程序即可）
2. 在云开发控制台 → 数据库 → `users` 集合
3. 找到你的用户记录，把 `isAdmin` 字段改为 `true`
4. 保存后重新进入小程序，个人中心会显示「管理员」标签

### 10. 初始化数据

可以在云开发控制台的数据库页面手动添加示例数据，或通过 `cloudfunctions/seedData` 初始化。

## 📦 数据库 Schema

### users 集合（关键更新）
```json
{
  "_id": "自动生成",
  "_openid": "用户openid",
  "name": "昵称",
  "avatar": "头像URL",
  "phone": "手机号",
  "isAdmin": false,
  "noShowCount": 0,
  "banUntil": null,
  "favorites": ["seatCode1", "seatCode2"],
  "createdAt": "服务器时间"
}
```

## 🧩 云函数 Action 列表

统一 API 云函数，通过 `action` 参数区分操作：

### 自习室
- `getRooms` - 获取列表（🆕 已缓存 30s）
- `getRoomDetail` - 获取详情
- `createRoom` / `updateRoom` / `deleteRoom` - 管理员操作

### 座位
- `getSeats` - 获取座位及预约状态
- `addSeats` / `removeSeats` - 管理员操作

### 预约
- `createBooking` - 创建预约（含爽约禁约检查 + 管理员豁免 + 自愈解封）
- `getMyBookings` - 我的预约
- `cancelBooking` - 取消预约

### 签到
- `checkIn` / `checkOut` / `getCheckinInfo`

### 管理员
- `checkIsAdmin` / `setAdmin` / `getAdminCandidates`
- `adminGetBookings` / `updateBookingStatus`
- `getStats`
- `adminSetUserBan` - 🆕 手动禁约用户
- `adminListUsers` - 🆕 列出全部用户（含爽约/禁约状态，支持筛选）
- `adminDeleteUser` - 🆕 删除用户（连带删预约记录）

### 系统
- `getUserInfo` / `updateUserInfo`
- `autoCancelOverdueBookings` - 定时任务：每分钟扫描超时未签到预约（🆕 管理员豁免）

## 📱 使用流程

### 普通用户
1. 打开小程序 → 首页看自习室列表（已缓存，秒开）
2. 点自习室 → 双拇指拖拽选时段 → 选座位
3. 点 AI 推荐按钮 → 获取 AI 选座建议（3s 超时兜底）
4. 到现场后 → 预约页点「签到」→ Canvas 签到码 / 扫码签到
5. 离开时 → 「签退」释放座位
6. 右下角 🤖 AI 悬浮球随时可问自习问题

### 管理员
1. 个人中心 → 管理后台
2. 自习室管理 / 座位管理 / 预约管理
3. 🆕 **用户管理** → 筛选爽约用户 → 禁约/解封/删除
4. 🆕 **管理员管理** → 设置其他管理员

## 🧠 AI Prompt 设计要点

### 悬浮球 AI（ai-ball）
```
角色：智能自习室助手"小自"
规则：
- 先理解问题，直接回答，不要跑题
- 口语化，像朋友聊天，不用"好的我来解答"
- 100 字以内
- 问题太简短时先反问补充
```

### 座位推荐 AI（booking）
```
角色：自习室选座助手
规则：
- 先报紧张度（宽松/一般/紧张），再给选座建议
- 直接说，不要套话
- 60 字以内
```

## 🛡️ 管理员特权一览

| 特权 | 普通用户 | 管理员 |
|------|:-:|:-:|
| 爽约累计 | ✅ 记录 | ❌ 豁免 |
| 禁约限制 | ✅ 3次爽约禁约1天 | ❌ 豁免 |
| 预约自动取消 | ✅ 15min未签到取消 | ❌ 豁免 |
| 用户管理 | ❌ | ✅ 禁约/解封/删除 |
| 设置其他管理员 | ❌ | ✅ |

## ⚠️ 注意事项

1. **AppID**: `project.config.json` 中的 AppID 需替换为你自己的
2. **云环境ID**: `app.js` 中的 `cloudEnv` 需替换为你自己的
3. **首次部署**: 右键云函数文件夹 → **上传并部署：云端安装依赖**
4. **Timer 触发器**: autoCancelTimeout 云函数需在云开发控制台配置 Timer 触发器
5. **AI 能力**: 需在云开发控制台开通 AI 服务（deepseek-v4-flash）
6. **源码包**: 限制 2MB，当前约 0.73MB；图片用 emoji 替代
7. **签到码**: 个人主体不能用 wxacode.getUnlimited，已换 Canvas 普通二维码

## 🔧 常见问题

**Q: 云函数调用失败 "请选择云环境"？**
A: 开发者工具左侧 `cloudfunctions` 文件夹旁有个小云朵 ☁️，点击选择你的云环境。

**Q: AI 悬浮球不响应？**
A: 检查云开发控制台是否已开通 AI 能力。AI 走前端直接调用 `wx.cloud.extend.AI.createModel('cloudbase')`。

**Q: 用户爽约后还是不能预约？**
A: createBooking 有自愈机制：banUntil 过期后自动清掉。管理员也可以进用户管理页一键「解封」。

**Q: 管理员自己想爽约测试？**
A: 管理员完全豁免爽约记录，不会被禁约。但预约超时 15min 也不会被自动取消（你得手动取消）。

**Q: 如何让多个管理员？**
A: 管理员后台 → 系统管理 → 管理员。或者在 users 集合把 isAdmin 设为 true。

## 📝 今天的更新日志（2026-11-11）

### 新增功能
- ✨ **AI 悬浮球组件** - 全局可拖拽 🤖，紫色渐变 + 呼吸光环，10 个前台页面全覆盖
- ✨ **内存缓存层** - cache.js + api.js 自动缓存 30s，切 Tab 不重复请求
- ✨ **管理员用户管理页** - admin/users/，筛选爽约/禁约用户，支持禁约/解封/删除
- ✨ **管理员爽约豁免** - recordNoShow / createBooking / autoCancel 三重豁免

### 优化
- 🔧 AI prompt 强化 - 悬浮球 + 座位推荐的 system prompt 全部重写，明确角色和回答规则
- 🔧 AI 超时兜底 - 3-5s 超时显示预设文案，不让界面空着
- 🔧 座位推荐 prompt 简化 - 之前太长太死板，现在数据简洁 + 指令明确
- 🔧 createBooking 自愈解封 - banUntil 过期自动清除，不用管理员手动处理
- 🔧 源码包体积 - 0.73MB，远低于 2MB 限制

### 修复
- 🐛 移除个人中心 AI 助手入口（只保留悬浮球）
- 🐛 去掉 adminSetUserBan 里"已在禁约期"提示，改为"延长期限"

## 📄 License

MIT License
