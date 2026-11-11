/**
 * 简单的内存缓存 —— 避免云函数重复调用，秒级响应评委演示
 * key: 任意字符串（建议 action + ':' + 参数）
 * value: 任意类型
 * ttl: 毫秒，默认 30 秒
 */
const _store = {}

function get(key) {
  const item = _store[key]
  if (!item) return null
  if (Date.now() > item.expireAt) {
    delete _store[key]
    return null
  }
  return item.value
}

function set(key, value, ttl = 30000) {
  _store[key] = { value, expireAt: Date.now() + ttl }
}

function clear() {
  for (const k in _store) delete _store[k]
}

function invalidate(prefix) {
  if (!prefix) return clear()
  for (const k in _store) {
    if (k.indexOf(prefix) === 0) delete _store[k]
  }
}

/** 带缓存的 Promise 包装：有缓存直接 resolve，没缓存调 fn 后存起来 */
function wrap(key, fn, ttl = 30000) {
  const hit = get(key)
  if (hit !== null) return Promise.resolve(hit)
  return fn().then(val => {
    set(key, val, ttl)
    return val
  }).catch(err => {
    // 失败不缓存
    throw err
  })
}

module.exports = { get, set, clear, invalidate, wrap }
