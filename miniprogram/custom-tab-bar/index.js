// custom-tab-bar/index.js
Component({
  data: {
    selected: 0,
    list: [
      {
        pagePath: '/pages/index/index',
        text: '首页',
        iconPath: '/images/tabbar/home.jpg',
        activeIconPath: '/images/tabbar/home-active.jpg'
      },
      {
        pagePath: '/pages/profile/profile',
        text: '我的',
        iconPath: '/images/tabbar/me.jpg',
        activeIconPath: '/images/tabbar/me-active.jpg'
      }
    ]
  },

  methods: {
    switchTab(e) {
      const index = e.currentTarget.dataset.index
      const url = this.data.list[index].pagePath
      wx.switchTab({ url })
      this.setData({ selected: index })
    }
  }
})
