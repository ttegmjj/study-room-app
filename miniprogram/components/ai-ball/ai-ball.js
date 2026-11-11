// components/ai-ball/ai-ball.js
// 全屏可拖拽的 AI 悬浮球 —— 点击弹出 AI 对话浮层
const FALLBACK_REPLY = '💡 建议：优先选靠窗或过道旁的座位，方便进出；若追求安静选靠里位置。祝复习顺利！✨'
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
        const sizePx = this.data.ballSize / 2 // rpx → px（粗略）
        this.setData({
          winW: info.windowWidth,
          winH: info.windowHeight,
          ballX: info.windowWidth - sizePx - 16,
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

      const halfSize = this.data.ballSize / 2
      let nx = this.data.ballX + dx
      let ny = this.data.ballY + dy
      // 边界裁剪
      nx = Math.max(halfSize + 8, Math.min(this.data.winW - halfSize - 8, nx))
      ny = Math.max(halfSize + 80, Math.min(this.data.winH - halfSize - 20, ny))

      this.setData({
        ballX: nx,
        ballY: ny,
        lastTouchX: t.clientX,
        lastTouchY: t.clientY,
        moved: true
      })
    },

    onTouchEnd() {
      if (!this.data.moved) {
        // 没移动 → 当点击处理
        this.onBallTap()
        return
      }
      // 左右吸附
      const halfSize = this.data.ballSize / 2
      const mid = this.data.winW / 2
      const targetX = this.data.ballX < mid
        ? halfSize + 12
        : this.data.winW - halfSize - 12
      // 平滑吸附动画
      this.setData({ ballX: targetX })
    },

    // ============ 点击 → 打开面板 ============
    onBallTap() {
      this.setData({ showPanel: true })
    },

    closePanel() {
      this.setData({ showPanel: false })
    },

    // ============ AI 对话 ============
    onInput(e) {
      this.setData({ input: e.detail.value })
    },

    onPreset(e) {
      this.setData({ input: e.currentTarget.dataset.text })
    },

    onClear() {
      this.setData({ input: '', output: '' })
    },

    async sendAI() {
      const text = (this.data.input || '').trim()
      if (!text) {
        wx.showToast({ title: '先输入点什么', icon: 'none' })
        return
      }
      if (this.data.loading) return

      this.setData({ loading: true, output: '' })

      try {
        const provider = wx.cloud.extend.AI.createModel('cloudbase')
        const aiPromise = provider.generateText({
          model: 'deepseek-v4-flash',
          messages: [
            {
              role: 'system',
              content: [
                '你是「智能自习室」小程序的 AI 助手，名叫小自。',
                '## 你的角色',
                '- 帮助用户解决自习相关问题：选座位建议、时间安排、备考方法、专注技巧、学习心态调整等',
                '- 当用户问技术/生活/情感等非自习类问题时，也尽力友好回答，但结尾可以自然引导到自习主题',
                '## 回答规则',
                '- 先认真理解用户的问题，**直接回答用户问的内容**，不要跑题',
                '- 语言自然口语化，像朋友聊天，不用礼貌套话（不用"好的我来为你解答"这类开场白）',
                '- 控制在 100 字以内，重要的信息靠前说',
                '- 如果用户的问题很简短（如"哪个好"、"推荐一下"），先反问补充信息，再给建议'
              ].join('\n')
            },
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
