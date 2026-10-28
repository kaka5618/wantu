Page({
  data: {
    remaining: 0,
    paidRemaining: 0,
    orders: [],
    selectedId: 'trial',
    plans: [
      {
        id: 'trial',
        name: '弯一下体验包',
        credits: 3,
        price: '2.9',
        unit: '约 ¥0.97 / 张',
        tag: '先试试'
      },
      {
        id: 'starter',
        name: '首发尝鲜包',
        credits: 10,
        price: '9.9',
        unit: '约 ¥0.99 / 张',
        tag: '推荐尝鲜'
      },
      {
        id: 'value',
        name: '日常记录包',
        credits: 30,
        price: '24.9',
        unit: '约 ¥0.83 / 张',
        tag: '更划算'
      }
    ]
  },

  onShow() {
    this.loadUsage()
    this.loadOrders()
  },

  loadUsage() {
    wx.cloud.callFunction({
      name: 'generatePlog',
      data: { action: 'usage' },
      success: (res) => {
        const result = res.result || {}
        if (!result.ok) return
        this.setData({
          remaining: result.remaining || 0,
          paidRemaining: result.paidRemaining || 0
        })
      }
    })
  },

  loadOrders() {
    wx.cloud.callFunction({
      name: 'payment',
      data: { action: 'orders' },
      success: (res) => {
        const result = res.result || {}
        if (!result.ok) return
        this.setData({ orders: result.items || [] })
      }
    })
  },

  selectPlan(event) {
    this.setData({ selectedId: event.currentTarget.dataset.id })
  },

  continueCreate() {
    wx.navigateBack({ delta: 1 })
  },

  buySelected() {
    const plan = this.data.plans.find((item) => item.id === this.data.selectedId)
    if (!plan) return
    const accountInfo = wx.getAccountInfoSync ? wx.getAccountInfoSync() : null
    const isDevelopment = !!(accountInfo && accountInfo.miniProgram && accountInfo.miniProgram.envVersion === 'develop')
    wx.showLoading({ title: '创建支付订单…', mask: true })
    wx.cloud.callFunction({
      name: 'payment',
      data: { action: 'createPayment', productId: plan.id, debug: isDevelopment },
      success: (res) => {
        const result = res.result || {}
        if (!result.ok) {
          wx.hideLoading()
          const diagnostic = isDevelopment && result.diagnostic ? `\n\n调试信息：${result.diagnostic}` : ''
          wx.showModal({ title: '暂时无法支付', content: `${result.message || '支付服务暂时不可用，请稍后再试。'}${diagnostic}`, showCancel: false })
          return
        }
        wx.hideLoading()
        wx.requestPayment({
          ...result.payment,
          success: () => this.confirmPayment(result.outTradeNo),
          fail: (error) => {
            const cancelled = /cancel/i.test((error && error.errMsg) || '')
            wx.showToast({ title: cancelled ? '已取消支付' : '支付未完成，请稍后重试', icon: 'none' })
          }
        })
      },
      fail: () => {
        wx.hideLoading()
        wx.showToast({ title: '创建订单失败，请稍后重试', icon: 'none' })
      }
    })
  },

  confirmPayment(outTradeNo) {
    wx.showLoading({ title: '确认支付结果…', mask: true })
    wx.cloud.callFunction({
      name: 'payment',
      data: { action: 'confirmPayment', outTradeNo },
      success: (res) => {
        wx.hideLoading()
        const result = res.result || {}
        if (result.ok) {
          this.loadUsage()
          this.loadOrders()
          wx.showModal({ title: '购买成功', content: `已到账 ${result.credits} 次 AI 创作。`, showCancel: false })
          return
        }
        wx.showModal({ title: '支付结果待确认', content: result.message || '请稍后重新进入次数包页面确认。', showCancel: false })
      },
      fail: () => {
        wx.hideLoading()
        wx.showModal({ title: '支付结果待确认', content: '请稍后重新进入次数包页面确认。', showCancel: false })
      }
    })
  }
})
