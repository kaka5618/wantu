const express = require('express')
const crypto = require('crypto')

const app = express()
let accessTokenCache = { token: '', expiresAt: 0 }

function missingConfig() {
  return [
    'WECHATPAY_APPID',
    'WECHATPAY_MCHID',
    'WECHATPAY_API_V3_KEY',
    'WECHATPAY_PLATFORM_PUBLIC_KEY_BASE64',
    'WECHATPAY_PLATFORM_PUBLIC_KEY_ID',
    'WECHAT_MINIPROGRAM_SECRET',
    'CLOUDBASE_ENV_ID',
    'PAYMENT_CALLBACK_SECRET'
  ].filter((name) => !process.env[name])
}

function platformPublicKey() {
  return Buffer.from(process.env.WECHATPAY_PLATFORM_PUBLIC_KEY_BASE64, 'base64').toString('utf8')
}

function verifyWechatPaySignature(headers, rawBody) {
  const serial = headers['wechatpay-serial']
  const signature = headers['wechatpay-signature']
  const timestamp = headers['wechatpay-timestamp']
  const nonce = headers['wechatpay-nonce']

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
    throw new Error('unsupported encrypted resource')
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
  return JSON.parse(Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8'))
}

async function getMiniProgramAccessToken() {
  if (accessTokenCache.token && Date.now() < accessTokenCache.expiresAt) {
    return accessTokenCache.token
  }

  const query = new URLSearchParams({
    grant_type: 'client_credential',
    appid: process.env.WECHATPAY_APPID,
    secret: process.env.WECHAT_MINIPROGRAM_SECRET
  })
  const response = await fetch(`https://api.weixin.qq.com/cgi-bin/token?${query}`)
  const data = await response.json()
  if (!response.ok || !data.access_token) {
    throw new Error(`failed to get mini program access token: ${data.errcode || response.status}`)
  }
  // Refresh a little early so a retry never uses an expired token.
  accessTokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + Math.max(60, (data.expires_in || 7200) - 300) * 1000
  }
  return accessTokenCache.token
}

async function fulfilViaCloudFunction(paidTransaction) {
  const token = await getMiniProgramAccessToken()
  const query = new URLSearchParams({
    access_token: token,
    env: process.env.CLOUDBASE_ENV_ID,
    name: 'payment'
  })
  const response = await fetch(`https://api.weixin.qq.com/tcb/invokecloudfunction?${query}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'paymentNotify',
      callbackSecret: process.env.PAYMENT_CALLBACK_SECRET,
      outTradeNo: paidTransaction.out_trade_no,
      transactionId: paidTransaction.transaction_id,
      amountFen: paidTransaction.amount && paidTransaction.amount.total
    })
  })
  const data = await response.json()
  if (!response.ok || data.errcode) {
    throw new Error(`cloud function invoke failed: ${data.errcode || response.status}`)
  }

  // The HTTP API returns the ordinary cloud-function result as a JSON string.
  const result = typeof data.resp_data === 'string' ? JSON.parse(data.resp_data) : data.resp_data
  if (!result || !result.ok) {
    throw new Error(`cloud function fulfilment rejected: ${(result && result.code) || 'unknown'}`)
  }
  return result
}

app.get('/healthz', (_request, response) => {
  response.status(200).json({ ok: true, service: 'payment-notify-web' })
})

// Keep the original bytes for WeChat Pay signature verification. Do not replace
// this middleware with express.json() on this route.
app.post('/wechatpay/notify', express.raw({ type: '*/*', limit: '1mb' }), async (request, response) => {
  const rawBody = Buffer.isBuffer(request.body) ? request.body.toString('utf8') : ''

  try {
    const missing = missingConfig()
    if (missing.length) {
      console.error('payment callback configuration incomplete:', missing.join(','))
      return response.status(500).json({ code: 'FAIL', message: 'callback not configured' })
    }
    if (!rawBody || !verifyWechatPaySignature(request.headers, rawBody)) {
      return response.status(401).json({ code: 'FAIL', message: 'invalid signature' })
    }

    const notification = JSON.parse(rawBody)
    // Other legal event types require acknowledgement but must never issue credits.
    if (notification.event_type !== 'TRANSACTION.SUCCESS') return response.sendStatus(204)

    const paidTransaction = decryptResource(notification.resource)
    if (
      paidTransaction.appid !== process.env.WECHATPAY_APPID ||
      paidTransaction.mchid !== process.env.WECHATPAY_MCHID ||
      paidTransaction.trade_state !== 'SUCCESS' ||
      !paidTransaction.out_trade_no ||
      !paidTransaction.transaction_id
    ) {
      return response.status(400).json({ code: 'FAIL', message: 'transaction validation failed' })
    }

    await fulfilViaCloudFunction(paidTransaction)
    return response.sendStatus(204)
  } catch (error) {
    console.error('payment notify failed:', error && error.message ? error.message : error)
    return response.status(500).json({ code: 'FAIL', message: 'callback processing failed' })
  }
})

app.use((_request, response) => response.status(404).json({ code: 'NOT_FOUND' }))

const port = Number(process.env.PORT || 9000)
app.listen(port, '0.0.0.0', () => {
  console.log(`payment-notify-web listening on ${port}`)
})
