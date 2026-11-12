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
    ballX: 0,           // 悬浮球中心 X
    ballY: 0,           // 悬浮球中心 Y
    ballSize: 64,       // 悬浮球直径 px（缩小）
    winW: 375,
    winH: 667,
    showPanel: false,   // 是否弹出对话面板
    input: '',
    output: '',
    loading: false,
    lastTouchX: 0,
    lastTouchY: 0,
    moved: false        // 本次 touchmove 是否真的移动过
  },

  lifetimes: {
    attached() {
      try {
        const info = wx.getSystemInfoSync()
        const half = this.data.ballSize / 2
        this.setData({
          winW: info.windowWidth,
          winH: info.windowHeight,
          ballX: info.windowWidth - half - 16,
          ballY: info.windowHeight * 0.6
        })
      } catch (e) {}
    }
  },

  methods: {
    // ============ 拖拽 ============
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

    /** 构建系统 prompt（通用助手） */
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

      try {
        // 1. 检查 AI API 是否存在
        if (!wx.cloud || !wx.cloud.extend || !wx.cloud.extend.AI) {
          this.setData({ output: '❌ AI 能力不可用。请确认：\n1. 基础库 ≥ 3.15.0\n2. 云开发控制台已开通 AI 服务' })
          this.setData({ loading: false })
          return
        }

        const provider = wx.cloud.extend.AI.createModel('cloudbase')
        const model = 'deepseek-v4-flash'
        const messages = [
          { role: 'system', content: this.buildSystemPrompt() },
          { role: 'user', content: text }
        ]

        // 2. 优先用流式调用（更稳定 + 更快首字）
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

        // 3. 流式失败 → 回退到非流式
        try {
          const provider = wx.cloud.extend.AI.createModel('cloudbase')
          const systemPrompt = this.buildSystemPrompt()
          const model = 'deepseek-v4-flash'
          const messages = [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: this.data.input }
          ]
          const aiPromise = provider.generateText({ model, messages })

          // 12 秒超时（给 AI 足够时间）
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
            help = '⏱️ AI 响应超时了。可能原因：\n• 云开发控制台没开通 AI 服务\n• 网络较慢\n\n请先去云开发控制台确认 AI 已开通。'
          } else if (errMsg.indexOf('not found') >= 0 || errMsg.indexOf('model') >= 0) {
            help = `❌ AI 模型不可用\n\n错误：${errMsg}\n\n请去云开发控制台 → AI → 检查模型是否已开通。`
          } else if (errMsg) {
            help = `❌ AI 调用失败\n\n错误：${errMsg}\n\n请去云开发控制台确认 AI 服务已开通。`
          } else {
            help = '❌ AI 暂时不可用，请稍后重试，或去云开发控制台检查 AI 服务是否已开通。'
          }
          this.setData({ output: help })
        }
      } finally {
        this.setData({ loading: false })
      }
    }
  }
})
