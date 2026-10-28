Page({
  data: {
    types: [
      { value: 'issue', label: '遇到问题', icon: '◌' },
      { value: 'suggestion', label: '功能建议', icon: '✦' },
      { value: 'other', label: '其他想说', icon: '♡' }
    ],
    type: 'issue',
    content: '',
    contact: '',
    images: [],
    submitting: false,
    submitted: false
  },

  chooseType(event) {
    this.setData({ type: event.currentTarget.dataset.type })
  },

  inputContent(event) {
    this.setData({ content: event.detail.value })
  },

  inputContact(event) {
    this.setData({ contact: event.detail.value })
  },

  chooseImage() {
    const remain = 3 - this.data.images.length
    if (remain <= 0) return
    wx.chooseImage({
      count: remain,
      sizeType: ['compressed'],
      sourceType: ['album', 'camera'],
      success: (result) => {
        const additions = (result.tempFilePaths || []).map((path) => ({ path }))
        this.setData({ images: this.data.images.concat(additions).slice(0, 3) })
      }
    })
  },

  removeImage(event) {
    const index = Number(event.currentTarget.dataset.index)
    if (Number.isNaN(index)) return
    const images = this.data.images.slice()
    images.splice(index, 1)
    this.setData({ images })
  },

  async uploadImages() {
    return Promise.all(this.data.images.map(async (image, index) => {
      const result = await wx.cloud.uploadFile({
        cloudPath: `plog-feedback/${Date.now()}-${index}-${Math.random().toString(36).slice(2)}.jpg`,
        filePath: image.path
      })
      return result.fileID
    }))
  },

  async submitFeedback() {
    const content = this.data.content.trim()
    if (content.length < 5) {
      wx.showToast({ title: '再多写一点点吧', icon: 'none' })
      return
    }
    if (this.data.submitting) return
    this.setData({ submitting: true })
    try {
      const imageFileIds = await this.uploadImages()
      const response = await wx.cloud.callFunction({
        name: 'feedback',
        data: { type: this.data.type, content, contact: this.data.contact.trim(), imageFileIds }
      })
      if (!response.result || !response.result.ok) throw new Error('反馈暂未提交成功')
      this.setData({ submitted: true })
    } catch (error) {
      wx.showToast({ title: '提交失败，请稍后再试', icon: 'none' })
    } finally {
      this.setData({ submitting: false })
    }
  },

  goBack() {
    wx.navigateBack()
  }
})
