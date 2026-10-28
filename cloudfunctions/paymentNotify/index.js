const cloud = require('wx-server-sdk')
const crypto = require('crypto')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV, timeout: 8000 })

const db = cloud.database()
const ORDER_COLLECTION = 'plog_orders'
const USAGE_COLLECTION = 'plog_usage'

function response(statusCode, body = '') {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: body ? JSON.stringify(body) : ''
  }
}

function header(headers, name) {
  const expected = name.toLowerCase()
  const key = Object.keys(headers || {}).find((item) => item.toLowerCase() === expected)
  return key ? headers[key] : ''
}

function parseBody(event) {
  const body = event && event.body
  if (typeof body === 'string') return body
  if (Buffer.isBuffer(body)) return body.toString('utf8')
  if (body && typeof body === 'object') return JSON.stringify(body)
  return ''
}

function configMissing() {
  return [
    'WECHATPAY_APPID',
    'WECHATPAY_MCHID',
    'WECHATPAY_API_V3_KEY',
    'WECHATPAY_PLATFORM_PUBLIC_KEY_BASE64',
    'WECHATPAY_PLATFORM_PUBLIC_KEY_ID'
  ].filter((name) => !process.env[name])
}

function platformPublicKey() {
  return Buffer.from(process.env.WECHATPAY_PLATFORM_PUBLIC_KEY_BASE64, 'base64').toString('utf8')
}

function verifyWechatPaySignature(headers, rawBody) {
  const serial = header(headers, 'Wechatpay-Serial')
  const signature = header(headers, 'Wechatpay-Signature')
  const timestamp = header(headers, 'Wechatpay-Timestamp')
  const nonce = header(headers, 'Wechatpay-Nonce')

  if (!serial || !signature || !timestamp || !nonce) return false
  if (serial !== process.env.WECHATPAY_PLATFORM_PUBLIC_KEY_ID) return false
  if (signature.startsWith('WECHATPAY/SIGNTEST/')) return false

  const verifier = crypto.createVerify('RSA-SHA256')
  verifier.update(`${timestamp}\n${nonce}\n${rawBody}\n`)
  verifier.end()
  return verifier.verify(platformPublicKey(), signature, 'base64')
}

function decryptResource(resource) {
  if (!resource || resource.algorithm !== 'AEAD_AES_256_GCM') {
    throw new Error('不支持的回调加密算法。')
  }

  const encrypted = Buffer.from(resource.ciphertext, 'base64')
  const authTag = encrypted.subarray(encrypted.length - 16)
  const ciphertext = encrypted.subarray(0, encrypted.length - 16)
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    Buffer.from(process.env.WECHATPAY_API_V3_KEY, 'utf8'),
    Buffer.from(resource.nonce, 'utf8')
  )
  decipher.setAuthTag(authTag)
  decipher.setAAD(Buffer.from(resource.associated_data || '', 'utf8'))
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()])
  return JSON.parse(plaintext.toString('utf8'))
}

async function getOrCreateUsage(openId) {
  const query = await db.collection(USAGE_COLLECTION).where({ openId }).limit(1).get()
  if (query.data.length) return query.data[0]
  const created = await db.collection(USAGE_COLLECTION).add({
    data: {
      openId,
      used: 0,
      paidCredits: 0,
      paidUsed: 0,
      createdAt: db.serverDate(),
      updatedAt: db.serverDate()
    }
  })
  return { _id: created._id, openId, used: 0, paidCredits: 0, paidUsed: 0 }
}

async function fulfilPaidOrder(order, transactionId) {
  const usage = await getOrCreateUsage(order.openId)
  return db.runTransaction(async (transaction) => {
    const latestOrder = await transaction.collection(ORDER_COLLECTION).doc(order._id).get()
    if (latestOrder.data.status === 'PAID') return true

    await transaction.collection(USAGE_COLLECTION).doc(usage._id).update({
      data: {
        paidCredits: (usage.paidCredits || 0) + order.credits,
        updatedAt: db.serverDate()
      }
    })
    await transaction.collection(ORDER_COLLECTION).doc(order._id).update({
      data: {
        status: 'PAID',
        transactionId,
        paidAt: db.serverDate(),
        updatedAt: db.serverDate()
      }
    })
    return false
  })
}

exports.main = async (event) => {
  const headers = event.headers || event.header || {}
  const rawBody = parseBody(event)

  try {
    if (configMissing().length) {
      console.error('payment notify configuration incomplete', configMissing())
      return response(500, { code: 'FAIL', message: 'payment callback not configured' })
    }
    if ((event.httpMethod || event.method || 'POST').toUpperCase() !== 'POST') {
      return response(405, { code: 'FAIL', message: 'method not allowed' })
    }
    if (!rawBody || !verifyWechatPaySignature(headers, rawBody)) {
      return response(401, { code: 'FAIL', message: 'invalid signature' })
    }

    const notification = JSON.parse(rawBody)
    if (notification.event_type !== 'TRANSACTION.SUCCESS') return response(204)
    const paidTransaction = decryptResource(notification.resource)

    if (
      paidTransaction.appid !== process.env.WECHATPAY_APPID ||
      paidTransaction.mchid !== process.env.WECHATPAY_MCHID ||
      paidTransaction.trade_state !== 'SUCCESS' ||
      !paidTransaction.out_trade_no
    ) {
      return response(400, { code: 'FAIL', message: 'transaction validation failed' })
    }

    const orderResult = await db.collection(ORDER_COLLECTION)
      .where({ outTradeNo: paidTransaction.out_trade_no })
      .limit(1)
      .get()
    if (!orderResult.data.length) {
      return response(404, { code: 'FAIL', message: 'order not found' })
    }
    const order = orderResult.data[0]
    if (!paidTransaction.amount || paidTransaction.amount.total !== order.amountFen) {
      return response(400, { code: 'FAIL', message: 'amount mismatch' })
    }

    await fulfilPaidOrder(order, paidTransaction.transaction_id)
    return response(204)
  } catch (error) {
    console.error('payment notify failed', error && error.message ? error.message : error)
    return response(500, { code: 'FAIL', message: 'callback processing failed' })
  }
}
