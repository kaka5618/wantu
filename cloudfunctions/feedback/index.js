const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const FEEDBACK_COLLECTION = 'plog_feedback'
const VALID_TYPES = new Set(['issue', 'suggestion', 'other'])

function cleanText(value, maxLength) {
  return String(value || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, maxLength)
}

exports.main = async (event) => {
  const { OPENID: openId } = cloud.getWXContext()
  if (!openId) return { ok: false, message: '无法识别当前用户，请重新进入小程序。' }

  const type = VALID_TYPES.has(event.type) ? event.type : 'other'
  const content = cleanText(event.content, 300)
  const contact = cleanText(event.contact, 80)
  const imageFileIds = Array.isArray(event.imageFileIds)
    ? event.imageFileIds.filter((fileId) => typeof fileId === 'string' && fileId.startsWith('cloud://')).slice(0, 3)
    : []

  if (content.length < 5) return { ok: false, message: '反馈内容至少需要 5 个字。' }

  try {
    await db.collection(FEEDBACK_COLLECTION).add({
      data: {
        openId,
        type,
        content,
        contact,
        imageFileIds,
        status: 'new',
        createdAt: db.serverDate()
      }
    })
    return { ok: true }
  } catch (error) {
    console.error('feedback submit failed', error.message)
    return { ok: false, message: '反馈暂未提交成功，请稍后再试。' }
  }
}
