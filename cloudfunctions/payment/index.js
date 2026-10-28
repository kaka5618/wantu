const cloud = require('wx-server-sdk')
const axios = require('axios')
const crypto = require('crypto')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV, timeout: 20000 })

const db = cloud.database()
const ORDER_COLLECTION = 'plog_orders'
const USAGE_COLLECTION = 'plog_usage'
const PRODUCTS = {
  trial: {
    name: '弯一下体验包',
    credits: 3,
    priceFen: 290,
    description: '弯兔 · 弯一下体验包（3次）'
  },
  starter: {
    name: '首发尝鲜包',
    credits: 10,
    priceFen: 990,
    description: '写进照片 · 首发尝鲜包（10次）'
  },
  value: {
    name: '日常记录包',
    credits: 30,
    priceFen: 2490,
    description: '写进照片 · 日常记录包（30次）'
  }
}

function missingConfig() {
  const required = [
    'WECHATPAY_MCHID',
    'WECHATPAY_APPID',
    'WECHATPAY_SERIAL_NO',
    'WECHATPAY_PRIVATE_KEY_BASE64',
    'WECHATPAY_NOTIFY_URL'
  ]
  return required.filter((name) => !process.env[name])
}

function merchantPrivateKey() {
  return Buffer.from(process.env.WECHATPAY_PRIVATE_KEY_BASE64, 'base64').toString('utf8')
}

function sign(message) {
  const signer = crypto.createSign('RSA-SHA256')
  signer.update(message)
  signer.end()
  return signer.sign(merchantPrivateKey(), 'base64')
}

function signedHeaders(method, canonicalUrl, body = '') {
  const timestamp = Math.floor(Date.now() / 1000).toString()
  const nonce = crypto.randomBytes(16).toString('hex')
  const message = `${method}\n${canonicalUrl}\n${timestamp}\n${nonce}\n${body}\n`
  const signature = sign(message)
  return {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    Authorization: `WECHATPAY2-SHA256-RSA2048 mchid="${process.env.WECHATPAY_MCHID}",nonce_str="${nonce}",timestamp="${timestamp}",serial_no="${process.env.WECHATPAY_SERIAL_NO}",signature="${signature}"`
  }
}

async function wechatPayRequest(method, canonicalUrl, payload) {
  const body = payload ? JSON.stringify(payload) : ''
  const response = await axios({
    method,
    url: `https://api.mch.weixin.qq.com${canonicalUrl}`,
    data: payload,
    headers: signedHeaders(method, canonicalUrl, body),
    timeout: 12000,
    validateStatus: () => true
  })
  if (response.status < 200 || response.status >= 300) {
    const message = response.data && (response.data.message || response.data.code)
    throw new Error(`微信支付请求失败：${message || response.status}`)
  }
  return response.data
}

function createOutTradeNo() {
  return `PLOG${Date.now()}${crypto.randomBytes(4).toString('hex').toUpperCase()}`
}

function formatOrderTime(value) {
  if (!value) return ''
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (number) => String(number).padStart(2, '0')
  return `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

async function getUsage(openId) {
  const query = await db.collection(USAGE_COLLECTION).where({ openId }).limit(1).get()
  if (query.data.length) return query.data[0]
  const created = await db.collection(USAGE_COLLECTION).add({
    data: { openId, used: 0, paidCredits: 0, paidUsed: 0, createdAt: db.serverDate(), updatedAt: db.serverDate() }
  })
  return { _id: created._id, openId, used: 0, paidCredits: 0, paidUsed: 0 }
}

function clientPaymentParams(prepayId) {
  const appId = process.env.WECHATPAY_APPID
  const timeStamp = Math.floor(Date.now() / 1000).toString()
  const nonceStr = crypto.randomBytes(16).toString('hex')
  const packageValue = `prepay_id=${prepayId}`
  const paySign = sign(`${appId}\n${timeStamp}\n${nonceStr}\n${packageValue}\n`)
  return { timeStamp, nonceStr, package: packageValue, signType: 'RSA', paySign }
}

// The payment provider's response is useful while configuring the service, but
// should never be exposed to ordinary production users. Keep only a compact,
// credential-free diagnostic for the development client.
function safeDiagnostic(error) {
  return String((error && error.message) || error || 'unknown error')
    .replace(/(mchid|serial_no|signature|private[_-]?key|apikey)="?[^"]+"?/gi, '$1=[hidden]')
    .slice(0, 180)
}

async function fulfilOrder(order, transactionId) {
  const usage = await getUsage(order.openId)
  return db.runTransaction(async (transaction) => {
    const latest = await transaction.collection(ORDER_COLLECTION).doc(order._id).get()
    if (latest.data.status === 'PAID') {
      // The client-side order query can win the race with the asynchronous
      // payment callback. Preserve WeChat's transaction id even in that case.
      if (transactionId && !latest.data.transactionId) {
        await transaction.collection(ORDER_COLLECTION).doc(order._id).update({
          data: { transactionId, updatedAt: db.serverDate() }
        })
      }
      return { alreadyFulfilled: true, credits: latest.data.credits }
    }

    await transaction.collection(USAGE_COLLECTION).doc(usage._id).update({
      data: {
        paidCredits: (usage.paidCredits || 0) + order.credits,
        updatedAt: db.serverDate()
      }
    })
    await transaction.collection(ORDER_COLLECTION).doc(order._id).update({
      data: {
        status: 'PAID',
        ...(transactionId ? { transactionId } : {}),
        paidAt: db.serverDate(),
        updatedAt: db.serverDate()
      }
    })
    return { alreadyFulfilled: false, credits: order.credits }
  })
}

async function fulfilPaidCallback(event) {
  if (!process.env.PAYMENT_CALLBACK_SECRET || event.callbackSecret !== process.env.PAYMENT_CALLBACK_SECRET) {
    return { ok: false, code: 'CALLBACK_UNAUTHORIZED' }
  }
  if (!event.outTradeNo || !event.transactionId || !Number.isInteger(event.amountFen)) {
    return { ok: false, code: 'CALLBACK_INVALID' }
  }

  const query = await db.collection(ORDER_COLLECTION).where({ outTradeNo: event.outTradeNo }).limit(1).get()
  if (!query.data.length) return { ok: false, code: 'ORDER_NOT_FOUND' }
  const order = query.data[0]
  if (order.amountFen !== event.amountFen) return { ok: false, code: 'AMOUNT_MISMATCH' }
  if (order.status === 'PAID') {
    // A successful client confirmation may arrive just before the callback.
    // Keep the callback's transaction id for auditing without awarding twice.
    if (!order.transactionId) {
      await db.collection(ORDER_COLLECTION).doc(order._id).update({
        data: { transactionId: event.transactionId, updatedAt: db.serverDate() }
      })
    }
    return { ok: true, alreadyFulfilled: true, credits: order.credits }
  }

  const usage = await getUsage(order.openId)
  return db.runTransaction(async (transaction) => {
    const latestResult = await transaction.collection(ORDER_COLLECTION).doc(order._id).get()
    const latest = latestResult.data
    if (!latest) throw new Error('order disappeared during callback fulfilment')
    if (latest.status === 'PAID') {
      if (!latest.transactionId) {
        await transaction.collection(ORDER_COLLECTION).doc(latest._id).update({
          data: { transactionId: event.transactionId, updatedAt: db.serverDate() }
        })
      }
      return { ok: true, alreadyFulfilled: true, credits: latest.credits }
    }

    await transaction.collection(USAGE_COLLECTION).doc(usage._id).update({
      data: {
        paidCredits: (usage.paidCredits || 0) + latest.credits,
        updatedAt: db.serverDate()
      }
    })
    await transaction.collection(ORDER_COLLECTION).doc(latest._id).update({
      data: {
        status: 'PAID',
        transactionId: event.transactionId,
        paidAt: db.serverDate(),
        updatedAt: db.serverDate()
      }
    })
    return { ok: true, alreadyFulfilled: false, credits: latest.credits }
  })
}

exports.main = async (event) => {
  try {
    // Only the independently verified WeChat Pay callback may use this branch.
    // It must be checked before OPENID because HTTP API calls carry no user session.
    if (event.action === 'paymentNotify') return await fulfilPaidCallback(event)

    const { OPENID: openId } = cloud.getWXContext()
    if (!openId) return { ok: false, code: 'MISSING_OPENID', message: '无法识别当前用户，请重新进入小程序。' }

    if (event.action === 'orders') {
      // Do not rely on a compound database index for this small, user-scoped
      // list. Keeping the filtering server-side also prevents one user from
      // reading another user's purchase history.
      const query = await db.collection(ORDER_COLLECTION).where({ openId }).limit(50).get()
      const items = query.data
        .filter((order) => order.status === 'PAID')
        .sort((left, right) => new Date(right.paidAt || right.updatedAt || 0) - new Date(left.paidAt || left.updatedAt || 0))
        .slice(0, 10)
        .map((order) => ({
          id: order._id,
          productName: order.productName,
          credits: order.credits,
          amount: (order.amountFen / 100).toFixed(2),
          paidAt: formatOrderTime(order.paidAt || order.updatedAt),
          orderTail: (order.outTradeNo || '').slice(-6)
        }))
      return { ok: true, items }
    }

    if (event.action === 'createPayment') {
      const product = PRODUCTS[event.productId]
      if (!product) return { ok: false, code: 'INVALID_PRODUCT', message: '未找到该次数包。' }
      if (missingConfig().length) return { ok: false, code: 'PAYMENT_NOT_CONFIGURED', message: '支付服务正在配置中，请稍后再试。' }

      const outTradeNo = createOutTradeNo()
      const addResult = await db.collection(ORDER_COLLECTION).add({
        data: {
          openId,
          outTradeNo,
          productId: event.productId,
          productName: product.name,
          credits: product.credits,
          amountFen: product.priceFen,
          status: 'CREATED',
          createdAt: db.serverDate(),
          updatedAt: db.serverDate()
        }
      })
      const requestPath = '/v3/pay/transactions/jsapi'
      try {
        const prepay = await wechatPayRequest('POST', requestPath, {
          appid: process.env.WECHATPAY_APPID,
          mchid: process.env.WECHATPAY_MCHID,
          description: product.description,
          out_trade_no: outTradeNo,
          notify_url: process.env.WECHATPAY_NOTIFY_URL,
          amount: { total: product.priceFen, currency: 'CNY' },
          payer: { openid: openId }
        })
        if (!prepay.prepay_id) throw new Error('微信支付未返回预支付交易会话。')
        await db.collection(ORDER_COLLECTION).doc(addResult._id).update({
          data: { status: 'PREPAY_CREATED', prepayId: prepay.prepay_id, updatedAt: db.serverDate() }
        })
        return { ok: true, outTradeNo, payment: clientPaymentParams(prepay.prepay_id) }
      } catch (error) {
        await db.collection(ORDER_COLLECTION).doc(addResult._id).update({
          data: { status: 'CREATE_FAILED', failureReason: String(error.message || error).slice(0, 180), updatedAt: db.serverDate() }
        })
        throw error
      }
    }

    if (event.action === 'confirmPayment') {
      if (!event.outTradeNo) return { ok: false, code: 'MISSING_ORDER', message: '缺少订单信息。' }
      if (missingConfig().length) return { ok: false, code: 'PAYMENT_NOT_CONFIGURED', message: '支付服务正在配置中，请稍后再试。' }
      const query = await db.collection(ORDER_COLLECTION).where({ openId, outTradeNo: event.outTradeNo }).limit(1).get()
      if (!query.data.length) return { ok: false, code: 'ORDER_NOT_FOUND', message: '未找到该订单。' }
      const order = query.data[0]
      if (order.status === 'PAID') return { ok: true, credits: order.credits, alreadyFulfilled: true }

      const requestPath = `/v3/pay/transactions/out-trade-no/${encodeURIComponent(order.outTradeNo)}?mchid=${encodeURIComponent(process.env.WECHATPAY_MCHID)}`
      const transaction = await wechatPayRequest('GET', requestPath)
      if (transaction.trade_state !== 'SUCCESS') {
        return { ok: false, code: 'PAYMENT_PENDING', message: '支付结果尚未确认，请稍后在此页面重试。' }
      }
      if (!transaction.amount || transaction.amount.total !== order.amountFen || transaction.out_trade_no !== order.outTradeNo) {
        throw new Error('支付订单校验不一致。')
      }
      const fulfilment = await fulfilOrder(order, transaction.transaction_id)
      return { ok: true, credits: fulfilment.credits, alreadyFulfilled: fulfilment.alreadyFulfilled }
    }

    return { ok: false, code: 'UNKNOWN_ACTION', message: '不支持的支付操作。' }
  } catch (error) {
    console.error('payment failed', error.message || error)
    const response = { ok: false, code: 'PAYMENT_FAILED', message: '支付服务暂时不可用，请稍后重试。' }
    if (event && event.debug === true) response.diagnostic = safeDiagnostic(error)
    return response
  }
}
