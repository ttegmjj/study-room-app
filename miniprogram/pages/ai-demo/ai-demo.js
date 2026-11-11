// pages/ai-demo/ai-demo.js
Page({
  data: {
    input: '',
    output: '',
    loading: false,
    model: 'deepseek-v4-flash',
    presets: [
      '帮我推荐一个适合考研自习的时间段',
      '根据我的预约历史推荐座位偏好',
      '写一句激励自己学习的话',
      '分析一下今天哪个自习室最安静',
    ]
  },

  onInput(e) {
    this.setData({ input: e.detail.value })
  },

  onPreset(e) {
    this.setData({ input: e.currentTarget.dataset.text })
  },

  async sendAI() {
    const text = (this.data.input || '').trim()
    if (!text) {
      wx.showToast({ title: '请输入内容', icon: 'none' })
      return
    }

    this.setData({ loading: true, output: '' })

    try {
      const provider = wx.cloud.extend.AI.createModel('cloudbase')
      const aiPromise = provider.generateText({
        model: this.data.model,
        messages: [
          { role: 'system', content: '你是「智能自习室」小程序的 AI 助手，名叫小自。回答简洁友好，不超过 100 字。' },
          { role: 'user', content: text }
        ]
      })

      // 5 秒超时兜底 —— 独立 AI 页给稍长等待时间
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('AI timeout')), 5000)
      })

      const res = await Promise.race([aiPromise, timeoutPromise])

      // 解析返回
      let content = ''
      if (res && res.choices && res.choices[0]) {
        content = res.choices[0].message.content || res.choices[0].message
      } else if (typeof res === 'string') {
        content = res
      }
      this.setData({ output: content || '(AI 未返回有效内容)' })
    } catch (err) {
      console.error('[AI] 错误:', err)
      const isTimeout = err && err.message === 'AI timeout'
      this.setData({
        output: isTimeout
          ? '⏱️ AI 响应较慢，请稍后再试，或换一个更简短的问题～'
          : `❌ 调用失败\n\n错误：${err && err.errMsg ? err.errMsg : err}\n\n提示：请在云开发控制台开通 AI 能力，并确认基础库版本 ≥ 3.15.1`
      })
    } finally {
      this.setData({ loading: false })
    }
  },

  // 流式版本（可选，更炫酷）
  async sendAIStream() {
    const text = (this.data.input || '').trim()
    if (!text) return
    this.setData({ loading: true, output: '' })
    try {
      const provider = wx.cloud.extend.AI.createModel('cloudbase')
      let buffer = ''
      await provider.streamText({
        data: {
          model: this.data.model,
          messages: [
            { role: 'system', content: '你是「智能自习室」小程序的 AI 助手小自。简洁友好，不超过 100 字。' },
            { role: 'user', content: text }
          ]
        },
        onText: (delta) => {
          buffer += delta
          this.setData({ output: buffer })
        },
        onFinish: (full) => {
          this.setData({ output: full || buffer })
        }
      })
    } catch (err) {
      console.error('[AI stream] 错误:', err)
      this.setData({ output: `❌ 流式调用失败：${err && err.errMsg ? err.errMsg : err}` })
    } finally {
      this.setData({ loading: false })
    }
  },

  onClear() {
    this.setData({ input: '', output: '' })
  },

  onCopy() {
    if (!this.data.output) return
    wx.setClipboardData({ data: this.data.output })
  }
})
