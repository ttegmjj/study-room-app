// utils/appearance.js - 页面壁纸配置

const PRESETS = [
  // 渐变色壁纸
  { id: 'default', name: '默认纯色', gradient: '' },
  { id: 'aurora', name: '极光紫', gradient: 'linear-gradient(160deg, #667eea 0%, #764ba2 100%)' },
  { id: 'ocean', name: '深海蓝', gradient: 'linear-gradient(160deg, #2b5876 0%, #4e4376 100%)' },
  { id: 'sunset', name: '落日晚霞', gradient: 'linear-gradient(160deg, #ff9a9e 0%, #fad0c4 100%)' },
  { id: 'forest', name: '青竹绿', gradient: 'linear-gradient(160deg, #134e5e 0%, #71b280 100%)' },
  { id: 'paper', name: '宣纸米', gradient: 'linear-gradient(160deg, #fdfbfb 0%, #ebedee 100%)' },
  { id: 'night', name: '深夜墨', gradient: 'linear-gradient(160deg, #232526 0%, #414345 100%)' },
  // 图片壁纸（AI 生成的自习室实景）
  { id: 'library-warm', name: '温暖图书馆', image: '/images/wallpaper/study-room-1.jpg' },
  { id: 'library-modern', name: '现代自习舱', image: '/images/wallpaper/study-room-2.jpg' },
  { id: 'cafe-study', name: '咖啡馆角落', image: '/images/wallpaper/study-room-3.jpg' }
]

const getPreset = (id) => PRESETS.filter(p => p.id === id)[0] || PRESETS[0]

/**
 * 把云端配置转成页面可直接渲染的数据（避免在 WXML 里做计算）
 */
function resolve(appearance) {
  const a = Object.assign({ wallpaperId: 'default', customFileID: '', overlay: 0 }, appearance || {})
  const isCustom = a.wallpaperId === 'custom'
  const preset = getPreset(a.wallpaperId)
  const overlay = Number(a.overlay) || 0
  const fileID = isCustom ? (a.customFileID || '') : ''

  // 图片壁纸（本地图片或自定义云存储）
  const isImage = !isCustom && !!preset.image
  const imageSrc = isCustom ? fileID : (preset.image || '')

  return {
    wallpaperId: a.wallpaperId,
    isCustom,
    isImage,
    fileID,
    imageSrc,
    hasWallpaper: isCustom ? !!fileID : (!!preset.gradient || !!preset.image),
    name: isCustom ? '自定义图片' : preset.name,
    bgStyle: preset.gradient ? `background: ${preset.gradient};` : '',
    overlayStyle: `background: rgba(0, 0, 0, ${overlay});`
  }
}

module.exports = {
  PRESETS,
  getPreset,
  resolve
}
