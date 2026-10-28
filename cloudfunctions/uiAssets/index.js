const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async (event) => {
  if (event.action !== 'storyCovers') return { ok: false, code: 'UNKNOWN_ACTION' }
  try {
    const result = await db.collection('ui_assets')
      .where({ group: 'story_cover', enabled: true })
      .orderBy('sort', 'asc')
      .limit(12)
      .get()
    const assets = result.data
      .filter((item) => item.fileId)
      .map((item) => ({ fileId: item.fileId, title: item.title || '', sort: item.sort || 0 }))
    const tempResult = assets.length
      ? await cloud.getTempFileURL({ fileList: assets.map((item) => item.fileId) })
      : { fileList: [] }
    const urlByFileId = new Map(
      tempResult.fileList
        .filter((item) => item && item.tempFileURL)
        .map((item) => [item.fileID, item.tempFileURL])
    )
    return {
      ok: true,
      items: assets
        .map((item) => ({ ...item, url: urlByFileId.get(item.fileId) || '' }))
        .filter((item) => item.url)
    }
  } catch (error) {
    console.error('uiAssets failed', error.message)
    return { ok: false, items: [] }
  }
}
