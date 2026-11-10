// cloudfunctions/initAdmin/index.js
// 一次性脚本：把当前登录用户设为管理员
// 用法：在云开发控制台 → 云函数 → 测试运行
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  // 控制台「测试」没有微信用户上下文，可显式传 {"openid": "你的openid"}
  const openid = (event && event.openid) || wxContext.OPENID

  if (!openid) {
    return {
      success: false,
      message: '未获取到 openid：请在小程序内调用，或在测试参数中传入 {"openid": "你的openid"}'
    }
  }

  const exists = await db.collection('users').where({ isAdmin: true }).get()
  const validAdmins = exists.data.filter(u => u._openid)
  if (validAdmins.length > 0 && validAdmins.some(u => u._openid !== openid)) {
    return { success: false, message: '系统已存在其他管理员', openid }
  }

  // 查找已有用户
  const res = await db.collection('users').where({ _openid: openid }).get()

  if (res.data.length > 0) {
    // 更新为管理员
    await db.collection('users').doc(res.data[0]._id).update({
      data: { isAdmin: true, updatedAt: db.serverDate() }
    })
    return { success: true, message: '已将现有用户设为管理员', openid }
  } else {
    // 新建管理员用户
    await db.collection('users').add({
      data: {
        _openid: openid,
        isAdmin: true,
        createdAt: db.serverDate()
      }
    })
    return { success: true, message: '已创建管理员用户', openid }
  }
}
