App({
  onLaunch() {
    if (wx.cloud) {
      wx.cloud.init({
        env: 'cloud1-d7guqbh1xf32265fb',
        traceUser: true
      })
    }
  },
  globalData: {
    currentPhoto: '/assets/adventure-child.jpg'
  }
})
