// components/ai-ball/ai-ball.js
// 全屏可拖拽的 AI 悬浮球 —— 关键词快速回答（不依赖 AI）+ AI 兜底

/** 关键词 → 快速回答（秒出，不依赖 AI，演示绝对不翻车） */
const QUICK_ANSWERS = [
  { kw: ['时段', '时间', '几点', '什么时候好', '推荐时间'],
    ans: '📅 推荐时段：08:30-10:00 最清静；14:00-16:00 人最少；晚上 19:00-21:00 适合刷题。' },
  { kw: ['备考', '考研', '怎么学', '如何学', '学习方法', '复习'],
    ans: '🎯 高效备考：① 番茄工作法 25+5 专注循环；② 艾宾浩斯曲线复习；③ 费曼技巧讲给别人听；④ 每天固定 6-8 小时深度复习。' },
  { kw: ['累', '累了', '疲劳', '困', '状态不好', '没状态', '调整'],
    ans: '😌 累了就歇 15 分钟：起身走两步 + 远眺 + 喝口水 + 闭眼深呼吸。别硬撑，效率比时长重要！' },
  { kw: ['专注', '集中', '分心', '玩手机', '效率'],
    ans: '🎧 专注技巧：① 手机放抽屉设番茄钟；② 白噪音/BGM 降低环境干扰；③ 明确"接下来 25 分钟只做一件事"；④ 完成一个阶段给自己小奖励。' },
  { kw: ['座位', '选座', '哪个座位', '推荐座位', '靠窗', '过道'],
    ans: '💡 选座建议：追求安静→靠里位置；进出频繁→过道旁；喜欢看景→靠窗；多人讨论→靠边座位。' },
  { kw: ['自习室', '哪个自习室', '推荐自习室', '安静'],
    ans: '🏫 选自习室：优先新开的/人少的；靠窗自然光比日光灯舒服；避开门口和走廊噪音源；三楼以上通常更安静。' },
  { kw: ['预约', '怎么预约', '预约流程', '预定'],
    ans: '📱 预约步骤：选自习室 → 选日期时段 → 点击座位 → 确认预约 → 现场签到。爽约 3 次会被限制预约 1 天哦。' },
  { kw: ['签到', '签退', '怎么签'],
    ans: '✅ 签到：我的预约 → 点"去签到" → Canvas 签到码展示给管理员/扫码。签退同理，离开时释放座位。' },
  { kw: ['心态', '焦虑', '压力', '紧张', '怕考不好', '没信心'],
    ans: '💪 心态调整：接受"不可能全掌握"，抓重点放弃偏题；每天进步一点点就好；运动/作息是最大的隐形提分器。' },
  { kw: ['时间管理', '计划', '安排', '时间表', '作息'],
    ans: '⏰ 时间管理：① 要事优先（每天只抓 1-2 件最关键的）；② 固定作息比熬夜高效；③ 碎片化时间背单词/公式；④ 睡前 5 分钟复盘。' },
  { kw: ['你好', 'hi', 'hello', '在吗'],
    ans: '👋 你好！我是小自，你的自习助手。有什么学习问题尽管问～' },
  { kw: ['谢谢', '多谢', '感谢'],
    ans: '😊 不客气！祝你顺利～下次有问题再来找我！' },
  { kw: ['什么', '你是谁', '你能做什么', '功能'],
    ans: '🤖 我是智能自习室的 AI 助手小自。能帮你：推荐座位/时段、备考方法、专注技巧、时间管理、心态调整等。' }
]

const PRESET_QUESTIONS = [
  '帮我推荐一个自习好时间段',
  '怎样才能高效备考？',
  '学习累了怎么快速调整？'
]

/** 根据关键词匹配快速回答，匹配不到返回 null */
function quickMatch(text) {
  if (!text) return null
  const t = text.toLowerCase()
  for (const item of QUICK_ANSWERS) {
    for (const kw of item.kw) {
      if (t.indexOf(kw.toLowerCase()) >= 0) return item.ans
    }
  }
  return null
}

Component({
  properties: {
    showBall: { type: Boolean, value: true }
  },

  data: {
    ballX: 0, ballY: 0,
    ballSize: 64,
    winW: 375, winH: 667,
    showPanel: false,
    input: '', output: '',
    loading: false,
    lastTouchX: 0, lastTouchY: 0,
    moved: false
  },

  lifetimes: {
    attached() {
      try {
        const info = wx.getSystemInfoSync()
        const half = this.data.ballSize / 2
        this.setData({
          winW: info.windowWidth, winH: info.windowHeight,
          ballX: info.windowWidth - half - 16,
          ballY: info.windowHeight * 0.6
        })
      } catch (e) {}
    }
  },

  methods: {
    onTouchStart(e) {
      if (!e.touches[0]) return
      const t = e.touches[0]
      this.setData({ lastTouchX: t.clientX, lastTouchY: t.clientY, moved: false })
    },
    onTouchMove(e) {
      if (!e.touches[0]) return
      const t = e.touches[0]
      const dx = t.clientX - this.data.lastTouchX
      const dy = t.clientY - this.data.lastTouchY
      if (Math.abs(dx) < 2 && Math.abs(dy) < 2) return
      const half = this.data.ballSize / 2
      let nx = this.data.ballX + dx
      let ny = this.data.ballY + dy
      nx = Math.max(half + 8, Math.min(this.data.winW - half - 8, nx))
      ny = Math.max(half + 80, Math.min(this.data.winH - half - 20, ny))
      this.setData({ ballX: nx, ballY: ny, lastTouchX: t.clientX, lastTouchY: t.clientY, moved: true })
    },
    onTouchEnd() {
      if (!this.data.moved) { this.onBallTap(); return }
      const half = this.data.ballSize / 2
      const targetX = this.data.ballX < this.data.winW / 2 ? half + 12 : this.data.winW - half - 12
      this.setData({ ballX: targetX })
    },
    onBallTap() { this.setData({ showPanel: true }) },
    closePanel() { this.setData({ showPanel: false }) },
    onInput(e) { this.setData({ input: e.detail.value }) },
    onPreset(e) { this.setData({ input: e.currentTarget.dataset.text }) },
    onClear() { this.setData({ input: '', output: '' }) },

    async sendAI() {
      const text = (this.data.input || '').trim()
      if (!text) { wx.showToast({ title: '先输入点什么', icon: 'none' }); return }
      if (this.data.loading) return

      // 1. 先试关键词快速匹配（秒出，最可靠）
      const quick = quickMatch(text)
      if (quick) {
        this.setData({ output: quick, loading: false })
        return
      }

      // 2. 关键词没匹配到 → 试 AI（如果 AI 能用的话）
      this.setData({ loading: true, output: '' })

      try {
        if (!wx.cloud || !wx.cloud.extend || !wx.cloud.extend.AI) {
          this.setData({ output: '这个问题我还没学到 😅 试试"备考方法""推荐时段""累了怎么调整"？' })
          this.setData({ loading: false })
          return
        }

        const provider = wx.cloud.extend.AI.createModel('cloudbase')
        const model = 'deepseek-v4-flash'
        const messages = [
          { role: 'system', content: '你是自习室AI助手小自。回答简洁直接，80字内，语气友好。' },
          { role: 'user', content: text }
        ]

        // 非流式 + 8s 超时
        const aiPromise = provider.generateText({ model, messages })
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => reject(new Error('AI timeout')), 8000)
        })
        const res = await Promise.race([aiPromise, timeoutPromise])

        let content = ''
        if (res && res.choices && res.choices[0]) {
          content = res.choices[0].message.content || res.choices[0].message
        } else if (typeof res === 'string') {
          content = res
        }
        this.setData({ output: content || 'AI 没返回内容，换个说法试试？' })
      } catch (err) {
        // AI 调不通（403 Forbidden / 超时 / 网络错）→ 给通用回复
        this.setData({ output: '这个问题我还在学习中 📚 试试"备考方法""推荐时段""累了怎么调整"？' })
      } finally {
        this.setData({ loading: false })
      }
    }
  }
})
