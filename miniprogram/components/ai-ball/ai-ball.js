// components/ai-ball/ai-ball.js
// 全屏可拖拽的 AI 悬浮球 —— 点击弹出 AI 对话浮层
const PRESET_QUESTIONS = [
  '帮我推荐一个自习好时间段',
  '怎样才能高效备考？',
  '学习累了怎么快速调整？'
]

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

    buildSystemPrompt() {
      return [
        '你是"智能自习室"小程序的 AI 助手小自。',
        '',
        '## 核心规则',
        '- 用户问什么就答什么，直接回应，绝对不要跑题！',
        '- 用户问备考→聊备考；问时间管理→聊时间管理；问心态→聊心态。',
        '- 绝对不要突然推荐座位！只有在用户明确问座位/选座时才提座位。',
        '- 语气自然，像朋友聊天，不要"好的""根据您的需求"这类套话。',
        '- 80 字以内，重要信息靠前。',
        '- 用 emoji 点缀但不要太多（1-2 个就好）。',
        '',
        '## 能力范围',
        '- 自习/备考/时间管理/专注技巧/学习心态/效率方法',
        '- 也可以聊生活、学习、情感话题，结尾可以自然引导到自习上'
      ].join('\n')
    },

    async sendAI() {
      const text = (this.data.input || '').trim()
      if (!text) { wx.showToast({ title: '先输入点什么', icon: 'none' }); return }
      if (this.data.loading) return

      this.setData({ loading: true, output: '' })

      // 先保存当前输入，避免流式调用被覆盖
      const userInput = text
      const systemPrompt = this.buildSystemPrompt()
      const model = 'deepseek-v4-flash'
      const messages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userInput }
      ]

      try {
        if (!wx.cloud || !wx.cloud.extend || !wx.cloud.extend.AI) {
          this.setData({ output: '❌ AI 不可用。请确认：基础库 ≥ 3.15.0，云开发已开通 AI 服务' })
          this.setData({ loading: false })
          return
        }

        const provider = wx.cloud.extend.AI.createModel('cloudbase')

        // 优先流式调用（更快更稳定）
        let fullOutput = ''
        await provider.streamText({
          data: { model, messages },
          onText: (delta) => {
            fullOutput += delta
            this.setData({ output: fullOutput })
          },
          onFinish: (full) => {
            if (full) this.setData({ output: full })
          }
        })
      } catch (err) {
        console.error('[AI ball] 流式失败:', err)

        // 回退：非流式 + 12s 超时
        try {
          const provider = wx.cloud.extend.AI.createModel('cloudbase')
          const aiPromise = provider.generateText({ model, messages })
          const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('AI timeout')), 12000)
          })
          const res = await Promise.race([aiPromise, timeoutPromise])

          let content = ''
          if (res && res.choices && res.choices[0]) {
            content = res.choices[0].message.content || res.choices[0].message
          } else if (typeof res === 'string') {
            content = res
          }
          this.setData({ output: content || 'AI 没返回内容，请重试～' })
        } catch (err2) {
          console.error('[AI ball] 非流式也失败:', err2)
          const isTimeout = err2 && err2.message === 'AI timeout'
          const errMsg = err2 && (err2.errMsg || err2.message) || ''

          let help = ''
          if (isTimeout) {
            help = '⏱️ AI 响应超时。请去云开发控制台 → AI → 检查服务是否已开通。'
          } else if (errMsg) {
            help = `❌ AI 调用失败\n\n${errMsg}\n\n请去云开发控制台 → AI 检查服务是否已开通。`
          } else {
            help = '❌ AI 不可用。请先去云开发控制台开通 AI 服务。'
          }
          this.setData({ output: help })
        }
      } finally {
        this.setData({ loading: false })
      }
    }
  }
})
