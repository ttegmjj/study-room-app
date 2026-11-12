// components/ai-ball/ai-ball.js
// 全屏可拖拽的 AI 悬浮球 —— 点击弹出 AI 对话浮层
const FALLBACK_REPLY = 'AI 暂时没反应过来，换个简短问题试试？或者试试"帮我推荐自习时间段"。'
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
      this.setData({
        lastTouchX: t.clientX,
        lastTouchY: t.clientY,
        moved: false
      })
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

      this.setData({
        ballX: nx, ballY: ny,
        lastTouchX: t.clientX, lastTouchY: t.clientY,
        moved: true
      })
    },

    onTouchEnd() {
      if (!this.data.moved) {
        this.onBallTap()
        return
      }
      const half = this.data.ballSize / 2
      const targetX = this.data.ballX < this.data.winW / 2
        ? half + 12 : this.data.winW - half - 12
      this.setData({ ballX: targetX })
    },

    // ============ 点击 → 打开面板 ============
    onBallTap() { this.setData({ showPanel: true }) },
    closePanel() { this.setData({ showPanel: false }) },

    // ============ AI 对话 ============
    onInput(e) { this.setData({ input: e.detail.value }) },
    onPreset(e) { this.setData({ input: e.currentTarget.dataset.text }) },
    onClear() { this.setData({ input: '', output: '' }) },

    async sendAI() {
      const text = (this.data.input || '').trim()
      if (!text) { wx.showToast({ title: '先输入点什么', icon: 'none' }); return }
      if (this.data.loading) return

      this.setData({ loading: true, output: '' })

      try {
        const provider = wx.cloud.extend.AI.createModel('cloudbase')
        const systemPrompt = [
          '你是"智能自习室"小程序的 AI 助手小自。',
          '',
          '## 绝对不要做的事',
          '- 绝对不要偏离用户问的主题。用户问备考就聊备考，问心态就聊心态，绝对不要突然开始推荐座位！',
          '- 绝对不要提"靠窗座位""过道旁""选座"等座位相关内容，除非用户明确在问座位或自习室预约。',
          '- 绝对不要用"根据您的需求""好的"这类开场白。',
          '',
          '## 回答规则',
          '- 用户问什么就答什么，直接给答案。',
          '- 语气像朋友聊天，自然口语化。',
          '- 控制在 80 字以内。',
          '- 用 emoji 点缀但不要太多。',
          '',
          '## 你的能力范围',
          '- 自习相关：选时间、备考方法、专注技巧、学习心态、时间管理、效率工具',
          '- 也可以聊生活/学习/情感话题，但结尾可以自然引导到自习上'
        ].join('\n')

        const aiPromise = provider.generateText({
          model: 'deepseek-v4-flash',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: text }
          ]
        })

        // 5 秒超时兜底
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => reject(new Error('AI timeout')), 5000)
        })

        const res = await Promise.race([aiPromise, timeoutPromise])

        let content = ''
        if (res && res.choices && res.choices[0]) {
          content = res.choices[0].message.content || res.choices[0].message
        } else if (typeof res === 'string') {
          content = res
        }
        this.setData({ output: content || FALLBACK_REPLY })
      } catch (err) {
        console.error('[AI ball]', err)
        const isTimeout = err && err.message === 'AI timeout'
        this.setData({
          output: isTimeout
            ? '⏱️ AI 响应较慢，换个简短问题试试～'
            : (err && err.errMsg ? `AI 暂时不可用：${err.errMsg}` : FALLBACK_REPLY)
        })
      } finally {
        this.setData({ loading: false })
      }
    }
  }
})
