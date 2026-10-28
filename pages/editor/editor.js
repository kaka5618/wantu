const app = getApp()
const captions = [
  { title: '今天的\n小冒险', badge: '勇敢小队长', note: '抓紧啦！', footer: '把快乐\n记下来' },
  { title: '阳光正好\n出发吧', badge: '今天也闪闪发光', note: '冲呀！', footer: '快乐集合' },
  { title: '把这一刻\n收起来', badge: '小小记录员', note: '看这里！', footer: '今日份开心' },
  { title: '勇敢一点点\n长大一点点', badge: '探索中', note: '再试一次！', footer: '成长碎片' }
]

Page({
  data: {
    photoPath: '',
    generatedImageUrl: '',
    caption: captions[0].title,
    captionIndex: 0,
    showDoodles: true,
    saved: false,
    saving: false,
    imageWidth: 0,
    imageHeight: 0,
    cardHeight: 910,
    generationSize: '768x1024',
    state: 'loading',
    errorMessage: '',
    generationTaskId: '',
    loadingTitle: '正在准备照片',
    loadingDetail: '通常需要约 40–90 秒，请保持页面打开',
    loadingElapsed: 0
  },

  onUnload() {
    if (this.pollTimer) clearTimeout(this.pollTimer)
    if (this.progressTimer) clearInterval(this.progressTimer)
  },

  onLoad() {
    const photoPath = app.globalData.currentPhoto
    if (!photoPath) {
      wx.navigateBack()
      return
    }
    this.startGenerationProgress()
    wx.getImageInfo({
      src: photoPath,
      success: (info) => {
        // 结果卡按原图比例展示，横图不再被固定竖版容器裁掉两侧文字。
        const cardHeight = Math.round(686 * info.height / info.width)
        this.setData({ photoPath, imageWidth: info.width, imageHeight: info.height, cardHeight })
        const generationSize = info.width / info.height > 1.2 ? '1024x768' : (info.width / info.height < 0.84 ? '768x1024' : '1024x1024')
        this.setData({ generationSize })
        this.generateFromPhoto(generationSize)
      },
      fail: () => {
        this.setData({ photoPath })
        this.setData({ generationSize: '768x1024' })
        this.generateFromPhoto('768x1024')
      }
    })
  },

  generateFromPhoto(size) {
    wx.cloud.uploadFile({
      cloudPath: `plog-source/${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`,
      filePath: this.data.photoPath,
      success: (uploadResult) => this.callGeneratePlog(uploadResult.fileID, size),
      fail: (err) => {
        this.setData({
          state: 'unavailable',
          errorMessage: `照片上传失败：${err.errMsg || '请检查云开发环境是否已启用。'}`
        })
        this.stopGenerationProgress()
      }
    })
  },

  callGeneratePlog(fileId, size) {
    wx.cloud.callFunction({
      name: 'generatePlog',
      data: { fileId, size, style: 'white_handwritten_plog' },
      success: (res) => {
        const result = res.result || {}
        if (result.ok && result.pending && result.taskId) {
          this.setData({
            generationTaskId: result.taskId,
            loadingTitle: 'AI 正在画这张 PLOG',
            loadingDetail: '通常还需 40–90 秒，请耐心等一会儿'
          })
          this.pollGeneratePlog(result.taskId)
          return
        }
        if (!result.ok) {
          if (result.code === 'CREDITS_EXHAUSTED') {
            this.stopGenerationProgress()
            wx.showToast({ title: '免费体验已用完', icon: 'none' })
            setTimeout(() => wx.redirectTo({ url: '/pages/credits/credits' }), 500)
            return
          }
          this.setData({
            state: 'unavailable',
            errorMessage: result.message || '这次生成暂时没有完成，请返回后重新选择照片再试，不会扣除创作次数。'
          })
          this.stopGenerationProgress()
          return
        }
        this.setData({
          state: 'ready',
          generatedImageUrl: result.imageUrl,
          caption: '',
          showDoodles: false,
          remaining: result.remaining
        })
        this.stopGenerationProgress()
      },
      fail: (err) => {
        this.setData({
          state: 'unavailable',
          errorMessage: `AI 服务调用失败：${err.errMsg || '请确认云函数已部署。'}`
        })
        this.stopGenerationProgress()
      }
    })
  },

  pollGeneratePlog(taskId) {
    if (!taskId || this.data.state !== 'loading') return
    this.pollTimer = setTimeout(() => {
      wx.cloud.callFunction({
        name: 'generatePlog',
        data: { action: 'pollGenerate', taskId },
        success: (res) => {
          const result = res.result || {}
          if (result.ok && result.pending) {
            this.pollGeneratePlog(taskId)
            return
          }
          if (result.ok && result.imageUrl) {
            this.setData({
              state: 'ready',
              generatedImageUrl: result.imageUrl,
              caption: '',
              showDoodles: false,
              remaining: result.remaining,
              generationTaskId: ''
            })
            this.stopGenerationProgress()
            return
          }
          this.setData({
            state: 'unavailable',
            generationTaskId: '',
            errorMessage: result.message || '这次生成暂时没有完成，请返回后重新选择照片再试，不会扣除创作次数。'
          })
          this.stopGenerationProgress()
        },
        fail: () => this.pollGeneratePlog(taskId)
      })
    }, 2500)
  },

  startGenerationProgress() {
    this.generationStartedAt = Date.now()
    this.updateGenerationProgress()
    if (this.progressTimer) clearInterval(this.progressTimer)
    this.progressTimer = setInterval(() => this.updateGenerationProgress(), 1000)
  },

  stopGenerationProgress() {
    if (this.progressTimer) clearInterval(this.progressTimer)
    this.progressTimer = null
  },

  updateGenerationProgress() {
    if (this.data.state !== 'loading' || !this.generationStartedAt) return
    const elapsed = Math.floor((Date.now() - this.generationStartedAt) / 1000)
    let loadingTitle = '正在准备照片'
    let loadingDetail = '通常需要约 40–90 秒，请保持页面打开'
    if (elapsed >= 12 && elapsed < 45) {
      loadingTitle = 'AI 正在读懂照片里的小细节'
      loadingDetail = '正在构思手写文字和涂鸦，大约还需半分钟'
    } else if (elapsed >= 45 && elapsed < 80) {
      loadingTitle = 'AI 正在画这张 PLOG'
      loadingDetail = `已经创作 ${elapsed} 秒，通常很快就完成啦`
    } else if (elapsed >= 80) {
      loadingTitle = '正在做最后的细节'
      loadingDetail = '这张图稍微复杂一点，请再等一会儿，不会卡住'
    }
    this.setData({ loadingTitle, loadingDetail, loadingElapsed: elapsed })
  },

  changeCaption() {
    if (this.data.state !== 'ready') return
    const captionIndex = (this.data.captionIndex + 1) % captions.length
    const copy = captions[captionIndex]
    this.setData({
      captionIndex,
      caption: copy.title,
      badge: copy.badge,
      note: copy.note,
      footer: copy.footer,
      saved: false
    })
  },

  toggleDoodles() {
    if (this.data.state !== 'ready') return
    this.setData({ showDoodles: !this.data.showDoodles, saved: false })
  },

  moveText() {
    wx.showToast({ title: '长按照片中的文字即可移动', icon: 'none' })
  },

  async save() {
    if (this.data.state !== 'ready') return
    this.setData({ saving: true })
    try {
      await this.ensureAlbumPermission()
      // 中文手写、箭头和轮廓线均已由 Pro 直接绘制在生成图里。
      // 直接保存同一张文件，预览与相册成品完全一致。
      const tempFilePath = await this.downloadGeneratedImage(this.data.generatedImageUrl)
      await new Promise((resolve, reject) => {
        wx.saveImageToPhotosAlbum({ filePath: tempFilePath, success: resolve, fail: reject })
      })
      this.setData({ saved: true })
      wx.showToast({ title: '已保存到相册', icon: 'success' })
    } catch (error) {
      if (error && error.message === 'ALBUM_PERMISSION_DENIED') return
      wx.showToast({ title: '保存失败，请稍后再试', icon: 'none' })
    } finally {
      this.setData({ saving: false })
    }
  },

  ensureAlbumPermission() {
    return new Promise((resolve, reject) => {
      wx.getSetting({
        success: (setting) => {
          const permission = setting.authSetting['scope.writePhotosAlbum']
          if (permission === true) return resolve()

          // undefined 代表用户从未选择过：主动调起微信原生授权弹窗。
          if (permission === undefined) {
            wx.authorize({
              scope: 'scope.writePhotosAlbum',
              success: resolve,
              fail: () => this.openAlbumSetting(resolve, reject)
            })
            return
          }

          // false 代表用户曾拒绝：微信不会再次弹窗，只能由用户在设置中手动开启。
          this.openAlbumSetting(resolve, reject)
        },
        fail: reject
      })
    })
  },

  openAlbumSetting(resolve, reject) {
    wx.showModal({
      title: '需要相册权限',
      content: '开启“保存到相册”权限后，才能把 PLOG 图片保存到手机。',
      confirmText: '去开启',
      success: (modal) => {
        if (!modal.confirm) return reject(new Error('ALBUM_PERMISSION_DENIED'))
        wx.openSetting({
          success: (setting) => setting.authSetting['scope.writePhotosAlbum']
            ? resolve()
            : reject(new Error('ALBUM_PERMISSION_DENIED')),
          fail: () => reject(new Error('ALBUM_PERMISSION_DENIED'))
        })
      }
    })
  },

  downloadGeneratedImage(url) {
    return new Promise((resolve, reject) => {
      if (url.indexOf('cloud://') === 0) {
        wx.cloud.downloadFile({
          fileID: url,
          success: (result) => resolve(result.tempFilePath),
          fail: reject
        })
        return
      }
      wx.downloadFile({
        url,
        success: (result) => result.statusCode === 200
          ? resolve(result.tempFilePath)
          : reject(new Error(`下载成图失败：${result.statusCode}`)),
        fail: reject
      })
    })
  },

  regenerate() {
    if (this.data.state !== 'ready') return
    wx.showModal({
      title: '重新生成？',
      content: '会消耗 1 次体验机会，继续吗？',
      confirmText: '继续',
      success: (res) => {
        if (!res.confirm) return
        this.setData({
          state: 'loading',
          generatedImageUrl: '',
          saved: false,
          errorMessage: '',
          generationTaskId: '',
          loadingTitle: '正在准备照片',
          loadingDetail: '通常需要约 40–90 秒，请保持页面打开',
          loadingElapsed: 0
        })
        this.startGenerationProgress()
        this.generateFromPhoto(this.data.generationSize)
      }
    })
  }
})
