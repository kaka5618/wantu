Page({
  data: {
    loading: true,
    items: [],
    selectedWork: null,
    downloading: false
  },

  onShow() {
    this.loadHistory()
  },

  loadHistory() {
    this.setData({ loading: true })
    wx.cloud.callFunction({
      name: 'generatePlog',
      data: { action: 'history' },
      success: (res) => {
        const result = res.result || {}
        this.setData({ loading: false, items: result.ok ? (result.items || []) : [] })
      },
      fail: () => this.setData({ loading: false, items: [] })
    })
  },

  preview(event) {
    const { id, fileid } = event.currentTarget.dataset
    this.setData({ selectedWork: { id, fileId: fileid }, downloading: false })
  },

  closePreview() {
    if (this.data.downloading) return
    this.setData({ selectedWork: null })
  },

  stopTouch() {},

  downloadSelected() {
    const work = this.data.selectedWork
    if (!work || this.data.downloading) return
    this.setData({ downloading: true })
    this.ensureAlbumPermission()
      .then(() => wx.cloud.downloadFile({ fileID: work.fileId }))
      .then((result) => new Promise((resolve, reject) => {
        wx.saveImageToPhotosAlbum({ filePath: result.tempFilePath, success: resolve, fail: reject })
      }))
      .then(() => wx.showToast({ title: '已下载到相册', icon: 'success' }))
      .catch((error) => {
        if (!error || error.message !== 'ALBUM_PERMISSION_DENIED') {
          wx.showToast({ title: '下载失败，请重试', icon: 'none' })
        }
      })
      .finally(() => this.setData({ downloading: false }))
  },

  ensureAlbumPermission() {
    return new Promise((resolve, reject) => {
      wx.getSetting({
        success: (setting) => {
          const permission = setting.authSetting['scope.writePhotosAlbum']
          if (permission === true) return resolve()
          if (permission === undefined) {
            wx.authorize({
              scope: 'scope.writePhotosAlbum',
              success: resolve,
              fail: () => this.openAlbumSetting(resolve, reject)
            })
            return
          }
          this.openAlbumSetting(resolve, reject)
        },
        fail: reject
      })
    })
  },

  openAlbumSetting(resolve, reject) {
    wx.showModal({
      title: '需要相册权限',
      content: '开启“保存到相册”权限后，才能下载作品。',
      confirmText: '去开启',
      success: (modal) => {
        if (!modal.confirm) return reject(new Error('ALBUM_PERMISSION_DENIED'))
        wx.openSetting({
          success: (setting) => setting.authSetting['scope.writePhotosAlbum']
            ? resolve()
            : reject(new Error('ALBUM_PERMISSION_DENIED')),
          fail: reject
        })
      }
    })
  },

  confirmDelete(event) {
    const { id, fileid } = event.currentTarget.dataset
    wx.showModal({
      title: '删除这张作品？',
      content: '删除后将同时清除云端图片，无法恢复。',
      confirmColor: '#bf5d52',
      success: (modal) => {
        if (!modal.confirm) return
        wx.cloud.callFunction({
          name: 'generatePlog',
          data: { action: 'deleteHistory', recordId: id },
          success: (res) => {
            if (res.result && res.result.ok) {
              this.setData({
                items: this.data.items.filter((item) => item.id !== id),
                selectedWork: this.data.selectedWork && this.data.selectedWork.id === id ? null : this.data.selectedWork
              })
              wx.showToast({ title: '已删除', icon: 'success' })
            } else {
              wx.showToast({ title: '删除失败，请重试', icon: 'none' })
            }
          },
          fail: () => wx.showToast({ title: '删除失败，请重试', icon: 'none' })
        })
      }
    })
  },

  goCreate() {
    wx.navigateBack()
  },

  goFeedback() {
    wx.navigateTo({ url: '/pages/feedback/feedback' })
  }
})
