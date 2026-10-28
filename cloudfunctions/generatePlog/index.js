const cloud = require('wx-server-sdk')
const axios = require('axios')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
  timeout: 60000
})

const db = cloud.database()
// V1 首发策略：每个微信 OpenID 仅有 1 次免费正式生成。
// 付费次数包上线后会替换为“免费额度 + 已购额度”的统一校验。
const FREE_GENERATION_LIMIT = 1
const MIN_GENERATION_INTERVAL_MS = 30 * 1000
const MAX_DAILY_GENERATIONS = 20
const USAGE_COLLECTION = 'plog_usage'
const HISTORY_COLLECTION = 'plog_history'
// 用户指定：使用 Seedream 5.0 Pro，优先保证中文手写文字与复杂图文混排的表现。
const IMAGE_MODEL = 'doubao-seedream-5-0-pro-260628'
// 用于核对云端是否已部署当前锁定的 Seedream Pro 版本，不参与提示词或出图效果。
const MODEL_DEPLOYMENT_TAG = 'seedream-pro-2026-10-28'
const MEDIAKIT_BASE_URL = (process.env.MEDIAKIT_BASE_URL || 'https://mediakit.cn-beijing.volces.com/api/v1').replace(/\/$/, '')
const VISION_MODEL = 'qwen3-vl-flash'

function createPlogPrompt(photoFacts = {}) {
  const verifiedCaptions = makeHandwrittenTextPlan(photoFacts)
    .map((item) => item.text)
    .filter(Boolean)
    .join('、') || '仅根据输入照片中真实可见的内容创作'
  return `参考我提供的照片内容，对画面中所有真实元素添加白色手绘注释与轮廓线，制作一张完整的手写风格 PLOG 图片。

【绘制风格】
白色细线手绘，单线条完成，略微粗糙不均匀；沿真实物体外轮廓描边，局部可有轻微抖动感；使用箭头、虚线、弧线引导视线；整体像随手写的笔记，轻松、有设计感。

【文字风格】
所有新增文字必须是清晰、自然、不工整的中文手写感字体；短句像日记里的随口记录，轻松、有情绪、可爱。绝对禁止任何英文字母、拼音、伪英文、乱码、不可识别字符或无意义符号。每一个新增字都必须能被人清楚读成正确中文。

【内容规则】
每一句文字都必须贴合照片中真实可见的具体对象、动作、颜色、光影或关系；只写短句，不写泛泛的“生活照片、认真记录、这一刻很好、小小发现、留在今天”。可用的事实素材仅限：${verifiedCaptions}。如果事实不足，少写，不猜测、不添加照片中没有的人物、食物、动物、建筑或物品。

【装饰元素】
少量添加星星、爱心、小表情、蒸汽线或小涂鸦；点缀即可，保留画面留白。

【画面控制】
注释分散排布，不遮挡主体；保持原图人物、脸、衣服、动作、物品、背景、相机角度和构图不变。整体为 Instagram 故事感 + 杂志手写笔记风，画幅比例保持和输入照片一致。

【出图前自检】
若不能保证全部新增文字为清晰、有意义、与照片贴合的中文手写短句，则不要生成任何文字；绝不能生成英文字母、拼音或乱码。`
}

function chinaDateKey(timestamp = Date.now()) {
  const shifted = new Date(timestamp + 8 * 60 * 60 * 1000)
  return shifted.toISOString().slice(0, 10)
}

async function getUsage(openId) {
  const query = await db.collection(USAGE_COLLECTION).where({ openId }).limit(1).get()
  if (query.data.length) return query.data[0]

  const now = db.serverDate()
  const created = await db.collection(USAGE_COLLECTION).add({
    data: {
      openId,
      used: 0,
      dailyDate: chinaDateKey(),
      dailyUsed: 0,
      createdAt: now,
      updatedAt: now
    }
  })
  return { _id: created._id, openId, used: 0, dailyDate: chinaDateKey(), dailyUsed: 0 }
}

function usagePayload(usage = {}) {
  const used = usage.used || 0
  const paidCredits = usage.paidCredits || 0
  const paidUsed = usage.paidUsed || 0
  const freeRemaining = Math.max(0, FREE_GENERATION_LIMIT - used)
  const paidRemaining = Math.max(0, paidCredits - paidUsed)
  return {
    used,
    limit: FREE_GENERATION_LIMIT,
    freeRemaining,
    paidCredits,
    paidUsed,
    paidRemaining,
    remaining: freeRemaining + paidRemaining
  }
}

function cleanCaption(value, maxLength) {
  const text = String(value || '')
    .replace(/[^\u4e00-\u9fffA-Za-z0-9，。！？、·\- ]/g, '')
    .replace(/\s+/g, '')
    .slice(0, maxLength)
  return text
}

// 只使用视觉模型确认过的短句。事实不足时少写，而不是用万能文案填满画面。
function makeHandwrittenTextPlan(photoFacts = {}) {
  const source = [
    photoFacts.scene ? { safe_caption: photoFacts.scene, position: '上方', title: true } : null,
    ...(Array.isArray(photoFacts.facts) ? photoFacts.facts : []),
    ...(Array.isArray(photoFacts.micro_details) ? photoFacts.micro_details : [])
  ].filter(Boolean)
  const seen = new Set()
  return source
    .map((item) => ({
      text: cleanCaption(item.safe_caption || item.object || item.detail, 10),
      position: item.position || '',
      title: Boolean(item.title)
    }))
    .filter((item) => item.text && !seen.has(item.text) && seen.add(item.text))
    .slice(0, 5)
}

function getJsonObject(content) {
  const text = Array.isArray(content) ? content.map((item) => item.text || '').join('') : String(content || '')
  const match = text.match(/\{[\s\S]*\}/)
  if (!match) return null
  try { return JSON.parse(match[0]) } catch (error) { return null }
}

async function analysePhoto(baseUrl, imageUrl) {
  const response = await axios.post(
    `${baseUrl}/chat/completions`,
    {
      model: VISION_MODEL,
      temperature: 0,
      max_tokens: 700,
      messages: [
        {
          role: 'system',
          content: '你是严格的照片事实核验器。只描述画面中肉眼可确认的对象及其位置，不推测，不虚构。'
        },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `分析这张照片，为白色手写 PLOG 提供事实素材。只输出一个 JSON，不要 Markdown：
{"scene":"不超过12字的客观场景","facts":[{"object":"具体可见物体","position":"左上/上方/中间/右下等","evidence":"可见的客观特征","safe_caption":"不超过10字、只陈述可见事实的中文短句"}],"micro_details":[{"detail":"颜色/纹理/水纹/光影等微小但明显的视觉细节","position":"位置","safe_caption":"不超过8字的客观短句"}],"forbidden_claims":["不可写的猜测"]}
规则：facts 最多 9 条，micro_details 给出 3 到 5 条。scene 和 safe_caption 必须描述这张图中可见的具体对象、动作、位置、颜色、光影或关系，不能写“生活照片”“认真记录”“这一刻很好”“小小发现”“留在今天”等放到任何照片都成立的话。例：若图中可见儿童、蓝色头盔、木桥和树叶，可写“蓝色头盔”“走上木桥”“阳光穿过叶子”；看不到就不要写。看不到人，就不要提人流、人来人往、游客或路人；看不清物体就不要猜；不能把云、桥、船、建筑放错位置。`
            },
            { type: 'image_url', image_url: { url: imageUrl } }
          ]
        }
      ]
    },
    {
      headers: { Authorization: `Bearer ${process.env.DASHSCOPE_API_KEY}`, 'Content-Type': 'application/json' },
      timeout: 9000
    }
  )
  const content = response.data && response.data.choices && response.data.choices[0] && response.data.choices[0].message && response.data.choices[0].message.content
  const result = getJsonObject(content)
  if (!result || !Array.isArray(result.facts)) throw new Error('视觉识别未返回有效事实')
  return result
}

async function submitSeedreamTask(apiKey, prompt, imageUrl) {
  const response = await axios.post(
    `${MEDIAKIT_BASE_URL}/tools/call-maas-proxy`,
    {
      api: 'ark.image_generation',
      maas_params: {
        model: IMAGE_MODEL,
        prompt,
        image: imageUrl,
        size: '1.5K',
        response_format: 'url',
        output_format: 'jpeg',
        watermark: false
      }
    },
    {
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      timeout: 12000
    }
  )
  const taskId = response.data && (response.data.task_id || response.data.taskId)
  if (!taskId) throw new Error(`Seedream 任务提交失败：${JSON.stringify(response.data).slice(0, 180)}`)
  return taskId
}

async function getSeedreamTask(apiKey, taskId) {
  const response = await axios.get(`${MEDIAKIT_BASE_URL}/tasks/${encodeURIComponent(taskId)}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    timeout: 10000
  })
  return response.data || {}
}

async function inspectGeneratedPlog(baseUrl, imageUrl) {
  const response = await axios.post(
    `${baseUrl}/chat/completions`,
    {
      model: VISION_MODEL,
      temperature: 0,
      max_tokens: 420,
      messages: [
        {
          role: 'system',
          content: '你是极严格的图片成品质检员。宁可误拒绝，也不能放过任何乱码、伪英文或无意义文字。'
        },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `检查这张 AI 手写 PLOG 成图，只输出 JSON，不要 Markdown：
{"passed":true,"reasons":[],"readable_chinese_count":0}
只有同时满足以下条件才可 passed=true：
1. 所有新增手写文字都是清晰可读、语义完整的中文；
2. 不能出现英文字母、拼音、伪英文、乱码、无意义字符、半截字或无法确认的字；
3. 文字和箭头注释与真实照片内容相符，不出现无关物品或万能空话；
4. 文字不过密、不遮挡主体，整体确实是白色手写 PLOG。
只要看见任何疑似乱写的文字，即使只有一个词，也必须 passed=false。不要猜测难读文字的含义。`
            },
            { type: 'image_url', image_url: { url: imageUrl } }
          ]
        }
      ]
    },
    {
      headers: { Authorization: `Bearer ${process.env.DASHSCOPE_API_KEY}`, 'Content-Type': 'application/json' },
      timeout: 12000
    }
  )
  const content = response.data && response.data.choices && response.data.choices[0] && response.data.choices[0].message && response.data.choices[0].message.content
  const result = getJsonObject(content)
  if (!result || result.passed !== true) {
    return { passed: false, reasons: (result && result.reasons) || ['质检未通过'] }
  }
  return { passed: true, reasons: [] }
}

exports.main = async (event) => {
  const { OPENID: openId } = cloud.getWXContext()
  if (!openId) return { ok: false, code: 'MISSING_OPENID', message: '无法识别当前用户，请重新进入小程序。' }
  let shouldCleanSource = Boolean(event.fileId)

  try {
    const usage = await getUsage(openId)
    if (event.action === 'usage') return { ok: true, ...usagePayload(usage) }
    if (event.action === 'history') {
      const history = await db.collection(HISTORY_COLLECTION)
        .where({ openId })
        .orderBy('createdAt', 'desc')
        .limit(50)
        .get()
      return {
        ok: true,
        items: history.data
          .filter((item) => item.status !== 'processing' && item.status !== 'failed' && item.fileId)
          .map((item) => ({ id: item._id, fileId: item.fileId, createdAt: item.createdAt }))
      }
    }
    if (event.action === 'deleteHistory') {
      if (!event.recordId) return { ok: false, code: 'MISSING_RECORD', message: '缺少作品记录。' }
      const record = await db.collection(HISTORY_COLLECTION).doc(event.recordId).get()
      if (!record.data || record.data.openId !== openId) return { ok: false, code: 'NOT_FOUND', message: '未找到该作品。' }
      if (record.data.fileId) await cloud.deleteFile({ fileList: [record.data.fileId] })
      await db.collection(HISTORY_COLLECTION).doc(event.recordId).remove()
      return { ok: true }
    }
    if (event.action === 'pollGenerate') {
      if (!event.taskId) return { ok: false, code: 'MISSING_TASK', message: '缺少生成任务。' }
      if (!process.env.MEDIAKIT_API_KEY) throw new Error('未配置 MEDIAKIT_API_KEY')
      const jobs = await db.collection(HISTORY_COLLECTION).where({ openId, taskId: event.taskId }).limit(1).get()
      const job = jobs.data[0]
      if (!job) return { ok: false, code: 'TASK_NOT_FOUND', message: '未找到这次生成任务。' }
      if (job.status === 'completed' && job.fileId) {
        return { ok: true, imageUrl: job.fileId, model: IMAGE_MODEL, deploymentTag: MODEL_DEPLOYMENT_TAG, ...usagePayload(usage) }
      }

      const task = await getSeedreamTask(process.env.MEDIAKIT_API_KEY, event.taskId)
      const taskStatus = String(task.status || '').toLowerCase()
      if (taskStatus === 'completed') {
        const output = task.result && task.result.maas_result && task.result.maas_result.data && task.result.maas_result.data[0]
        if (!output || !output.url) throw new Error(`Seedream 异步任务未返回图片：${JSON.stringify(task).slice(0, 180)}`)
        const imageBinary = await axios.get(output.url, { responseType: 'arraybuffer', timeout: 12000 })
        const savedImage = await cloud.uploadFile({
          cloudPath: `plog-result/${openId}/${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`,
          fileContent: Buffer.from(imageBinary.data)
        })
        const today = chinaDateKey()
        const dailyUsed = usage.dailyDate === today ? (usage.dailyUsed || 0) : 0
        const entitlement = usagePayload(usage)
        const usesFreeCredit = entitlement.freeRemaining > 0
        const nextUsed = usesFreeCredit ? (usage.used || 0) + 1 : (usage.used || 0)
        const nextPaidUsed = usesFreeCredit ? (usage.paidUsed || 0) : (usage.paidUsed || 0) + 1
        await db.collection(USAGE_COLLECTION).doc(usage._id).update({
          data: { used: nextUsed, paidUsed: nextPaidUsed, dailyDate: today, dailyUsed: dailyUsed + 1, lastGeneratedAtMs: Date.now(), updatedAt: db.serverDate() }
        })
        await db.collection(HISTORY_COLLECTION).doc(job._id).update({
          data: { fileId: savedImage.fileID, status: 'completed', completedAt: db.serverDate() }
        })
        if (job.sourceFileId) await cloud.deleteFile({ fileList: [job.sourceFileId] })
        return { ok: true, imageUrl: savedImage.fileID, model: IMAGE_MODEL, deploymentTag: MODEL_DEPLOYMENT_TAG, ...usagePayload({ ...usage, used: nextUsed, paidUsed: nextPaidUsed }) }
      }
      if (taskStatus === 'failed' || taskStatus === 'cancelled' || taskStatus === 'canceled') {
        await db.collection(HISTORY_COLLECTION).doc(job._id).update({ data: { status: 'failed', failedAt: db.serverDate() } })
        if (job.sourceFileId) await cloud.deleteFile({ fileList: [job.sourceFileId] })
        return { ok: false, code: 'GENERATION_FAILED', message: '这次生成暂时没有完成，请返回后重新选择照片再试，不会扣除创作次数。' }
      }
      return { ok: true, pending: true, taskId: event.taskId }
    }
    if (!event.fileId) return { ok: false, code: 'MISSING_FILE', message: '缺少图片文件。' }
    const entitlement = usagePayload(usage)
    if (entitlement.remaining <= 0) {
      return { ok: false, code: 'CREDITS_EXHAUSTED', message: '免费体验已用完，选择次数包后可继续创作。', ...entitlement }
    }

    const nowMs = Date.now()
    const today = chinaDateKey(nowMs)
    const dailyUsed = usage.dailyDate === today ? (usage.dailyUsed || 0) : 0
    if (dailyUsed >= MAX_DAILY_GENERATIONS) {
      return { ok: false, code: 'DAILY_LIMIT_REACHED', message: '今日生成次数已达安全上限，请明天再试。' }
    }
    if (usage.lastGeneratedAtMs && nowMs - usage.lastGeneratedAtMs < MIN_GENERATION_INTERVAL_MS) {
      const waitSeconds = Math.ceil((MIN_GENERATION_INTERVAL_MS - (nowMs - usage.lastGeneratedAtMs)) / 1000)
      return { ok: false, code: 'TOO_FREQUENT', message: `请 ${waitSeconds} 秒后再生成，避免重复提交。` }
    }

    const tempResult = await cloud.getTempFileURL({ fileList: [event.fileId] })
    const imageUrl = tempResult.fileList[0] && tempResult.fileList[0].tempFileURL
    if (!imageUrl) throw new Error('无法读取已上传图片')

    if (!process.env.DASHSCOPE_API_KEY) throw new Error('未配置 DASHSCOPE_API_KEY')
    const baseUrl = (process.env.DASHSCOPE_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1').replace(/\/$/, '')
    let photoFacts
    try {
      photoFacts = await analysePhoto(baseUrl, imageUrl)
      console.info('photo facts verified', JSON.stringify(photoFacts))
    } catch (visionError) {
      console.warn('vision analysis fallback', visionError.message)
      photoFacts = {
        scene: '',
        facts: [],
        micro_details: [],
        forbidden_claims: ['任何无法从照片直接确认的内容']
      }
    }
    if (!process.env.MEDIAKIT_API_KEY) throw new Error('未配置 MEDIAKIT_API_KEY')
    console.info('generation model selected', { model: IMAGE_MODEL, deploymentTag: MODEL_DEPLOYMENT_TAG })
    // Seedream Pro 的标准质量可能超过微信云函数 60 秒上限。
    // 经 AI MediaKit 提交为异步任务后，前端轮询结果，不降低模型质量或分辨率。
    const taskId = await submitSeedreamTask(process.env.MEDIAKIT_API_KEY, createPlogPrompt(photoFacts), imageUrl)
    await db.collection(HISTORY_COLLECTION).add({
      data: {
        openId,
        taskId,
        sourceFileId: event.fileId,
        status: 'processing',
        createdAt: db.serverDate(),
        style: 'white_handwritten_plog',
        model: IMAGE_MODEL,
        deploymentTag: MODEL_DEPLOYMENT_TAG
      }
    })
    // 异步任务仍需读取原图，待任务结束后由轮询分支负责清理。
    shouldCleanSource = false
    return {
      ok: true,
      pending: true,
      taskId,
      model: IMAGE_MODEL,
      deploymentTag: MODEL_DEPLOYMENT_TAG
    }
  } catch (error) {
    const detail = error.response && error.response.data ? JSON.stringify(error.response.data) : error.message
    console.error('generatePlog failed', detail)
    return {
      ok: false,
      code: 'GENERATION_FAILED',
      message: '这次生成暂时没有完成，请返回后重新选择照片再试，不会扣除创作次数。'
    }
  } finally {
    // 用户原图只用于本次生成；无论成功或失败都不长期保留在云存储。
    if (shouldCleanSource && event.fileId) {
      try {
        await cloud.deleteFile({ fileList: [event.fileId] })
      } catch (cleanupError) {
        console.warn('source cleanup skipped', cleanupError.message)
      }
    }
  }
}
