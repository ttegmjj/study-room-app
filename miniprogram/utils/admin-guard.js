// utils/admin-guard.js —— 管理页统一权限守卫
// 普通用户即使手动跳到管理页，也会被拦下并退回
const api = require('./api.js')

/**
 * 校验当前用户是否为管理员；非管理员弹窗提示后返回上一页
 * @returns {Promise<boolean>} true=可继续；false=已拦截
 */
async function guardAdmin() {
  const app = getApp()
  if (app.globalData.isAdmin === true) return true

  let isAdmin = false
  try {
    isAdmin = await api.checkIsAdmin()
    app.globalData.isAdmin = !!isAdmin
  } catch (e) {
    // 权限校验请求本身失败（网络异常）时不误判为无权限
    return true
  }

  if (isAdmin) return true

  wx.showModal({
    title: '无权限',
    content: '该页面仅管理员可访问',
    showCancel: false,
    confirmText: '返回',
    success: () => {
      wx.navigateBack({
        fail: () => wx.switchTab({ url: '/pages/index/index' })
      })
    }
  })
  return false
}

module.exports = { guardAdmin }
