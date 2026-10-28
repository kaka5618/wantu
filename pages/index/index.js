const app = getApp()

Page({
  data: {
    photoPath: '',
    hasPhoto: false,
    starting: false,
    remaining: 1,
    storyCovers: [],
    activeFeatureIndex: 0,
    currentPlogSlide: 0,
    features: [
      {
        id: 'plog',
        title: '照片手账',
        description: '一张照片，写成一页有趣手账',
        image: '/assets/showcase/plog-hotpot.png',
        available: true
      },
      {
        id: 'collage',
        title: '拼一拼',
        description: '挖洞中.....',
        image: '/assets/brand/wantu-digging.png',
        available: false,
        isDigging: true
      },
      {
        id: 'style',
        title: '换个风格',
        description: '挖洞中.....',
        image: '/assets/brand/wantu-digging.png',
        available: false,
        isDigging: true
      }
    ],
    plogSlides: [
      { image: '/assets/showcase/plog-pet.png' },
      { image: '/assets/showcase/plog-hotpot.png' },
      { image: '/assets/showcase/plog-child.png' },
      { image: '/assets/showcase/plog-mountain.png' }
    ],
    showcases: [
      {
        image: '/assets/showcase/water-town.jpg',
        type: '旅行记录',
        caption: '把路过的风景，写成慢时光'
      },
      {
        image: '/assets/showcase/hotpot.jpg',
        type: '日常吃喝',
        caption: '一顿热辣，也值得被认真记下'
      },
      {
        image: '/assets/showcase/seaside-dog.jpg',
        type: '宠物日常',
        caption: '把毛茸茸的快乐，留在这一页'
      }
    ]
  },

  onLoad() {
    this.setData({ photoPath: '', hasPhoto: false })
  },

  onShow() {
    this.setData({ starting: false })
    this.loadUsage()
    this.loadStoryCovers()
  },

  loadStoryCovers() {
    wx.cloud.callFunction({
      name: 'uiAssets',
      data: { action: 'storyCovers' },
      success: (res) => {
        const items = (res.result && res.result.items) || []
        this.setData({ storyCovers: items })
      },
      fail: (error) => {
        console.error('[story cover] load failed', error)
      }
    })
  },

  loadUsage() {
    wx.cloud.callFunction({
      name: 'generatePlog',
      data: { action: 'usage' },
      success: (res) => {
        const result = res.result || {}
        if (result.ok && typeof result.remaining === 'number') this.setData({ remaining: result.remaining })
      }
    })
  },

  choosePhoto() {
    this.selectFromAlbum()
  },

  selectFromAlbum() {
    console.log('[photo] select from album tapped')
    if (this.data.remaining <= 0) {
      this.goCredits()
      return
    }
    this.openPhotoPicker(['album'])
  },

  takePhoto() {
    console.log('[photo] take camera tapped')
    if (this.data.remaining <= 0) {
      this.goCredits()
      return
    }
    this.openPhotoPicker(['camera'])
  },

  selectFeature(event) {
    const index = Number(event.currentTarget.dataset.index)
    if (Number.isNaN(index)) return
    this.setData({ activeFeatureIndex: index })
  },

  changeFeature(event) {
    this.setData({ activeFeatureIndex: event.detail.current })
  },

  startFeature(event) {
    const index = Number(event.currentTarget.dataset.index)
    const feature = this.data.features[index]
    if (!feature || !feature.available) {
      wx.showToast({ title: '这个玩法正在赶来', icon: 'none' })
      return
    }
    this.selectFromAlbum()
  },

  openPhotoPicker(sourceType) {
    // 不经由任何自定义授权或跳转层，直接使用微信原生图片选择接口。
    console.log('[photo] calling wx.chooseImage', sourceType)
    wx.chooseImage({
      count: 1,
      sourceType,
      success: (res) => {
        console.log('[photo] image selected')
        const photoPath = res.tempFilePaths && res.tempFilePaths[0]
        if (!photoPath) {
          wx.showToast({ title: '没有读取到照片，请重新选择', icon: 'none' })
          return
        }
        // 选图只进入确认状态；只有用户主动点击“开始弯”才会调用 AI，
        // 也因此不会因为误选照片而消耗创作次数。
        this.setData({ photoPath, hasPhoto: true, starting: false })
      },
      fail: (error) => {
        console.error('[photo] chooseImage failed', error)
        const message = (error && error.errMsg) || ''
        if (/cancel/i.test(message)) return
        const permissionDenied = /auth deny|auth denied|permission denied|authorize/i.test(message)
        if (permissionDenied) {
          wx.showModal({
            title: '需要照片权限',
            content: '请在设置中允许“弯兔”访问相册或相机，然后再选一张照片。',
            confirmText: '去设置',
            cancelText: '暂不设置',
            success: (modal) => {
              if (modal.confirm) wx.openSetting({})
            }
          })
          return
        }
        wx.showModal({
          title: '暂时无法读取照片',
          content: '请重新选择一张照片；若仍失败，可关闭小程序后重新进入。',
          showCancel: false
        })
      }
    })
  },

  goEditor() {
    if (!this.data.photoPath) {
      this.choosePhoto()
      return
    }
    if (this.data.remaining <= 0) {
      this.goCredits()
      return
    }
    this.setData({ starting: true })
    app.globalData.currentPhoto = this.data.photoPath
    wx.navigateTo({ url: '/pages/editor/editor' })
  },

  startCreate() {
    this.goEditor()
  },

  replacePhoto() {
    if (this.data.starting) return
    this.selectFromAlbum()
  },

  goHistory() {
    wx.navigateTo({ url: '/pages/history/history' })
  },

  goCredits() {
    wx.navigateTo({ url: '/pages/credits/credits' })
  },

  goFeedback() {
    wx.navigateTo({ url: '/pages/feedback/feedback' })
  },

  openStoryPicker(sourceType) {
    if (this.data.remaining <= 0) return this.goCredits()
    wx.chooseImage({ count: 1, sourceType, success: (res) => {
      const photoPath = res.tempFilePaths && res.tempFilePaths[0]
      if (!photoPath) return
      app.globalData.currentStoryPhoto = photoPath
      wx.navigateTo({ url: '/pages/story/story' })
    } })
  },

  selectStoryFromAlbum() {
    this.openStoryPicker(['album'])
  },

  takeStoryPhoto() {
    this.openStoryPicker(['camera'])
  }
})
