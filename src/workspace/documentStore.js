export const DOCUMENT_DB_NAME = 'fozuai-workspace'
export const DOCUMENT_DB_VERSION = 1
export const DOCUMENT_SCHEMA_VERSION = 1
export const DOCUMENT_STORE_NAME = 'documents'
export const DOCUMENT_LIMITS = Object.freeze({ title: 120, content: 48000, assets: 6, imageDataBytes: 1024 * 1024 })

const fail = (message) => { throw new Error(message) }

function validateAsset(asset) {
  if (!asset || typeof asset !== 'object') fail('图片数据无效，请重新添加图片。')
  if (typeof asset.id !== 'string' || !asset.id || asset.id.length > 128) fail('图片标识无效，请重新添加图片。')
  if (typeof asset.name !== 'string' || asset.name.length > 255) fail('图片名称过长。')
  if (typeof asset.dataUrl !== 'string' || asset.dataUrl.length > DOCUMENT_LIMITS.imageDataBytes) fail('处理后的每张图片不能超过 1 MB。')
  const match = asset.dataUrl.match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/)
  if (!match || match[2].length % 4 !== 0) fail('图片格式无效，仅支持 PNG、JPEG 和 WebP。')
  let header
  try { header = atob(match[2].slice(0, 24)) } catch { fail('图片数据损坏，请重新添加图片。') }
  const signatureMatches = match[1] === 'png' ? header.startsWith('\x89PNG\r\n\x1a\n')
    : match[1] === 'jpeg' ? header.startsWith('\xff\xd8\xff')
      : header.startsWith('RIFF') && header.slice(8, 12) === 'WEBP'
  if (!signatureMatches) fail('图片数据与格式不符，请重新添加图片。')
  if (![asset.width, asset.height].every(value => Number.isInteger(value) && value > 0 && value <= 8192)) fail('图片尺寸无效，请重新添加图片。')
  return { id: asset.id, name: asset.name, dataUrl: asset.dataUrl, width: asset.width, height: asset.height }
}

/** Reconstruct a bounded document so neither malformed records nor arbitrary fields reach the UI. */
export function validateDocument(document) {
  if (!document || typeof document !== 'object') fail('文档数据无效。')
  if (typeof document.id !== 'string' || !document.id || document.id.length > 128) fail('文档标识无效。')
  if (typeof document.title !== 'string' || document.title.length > DOCUMENT_LIMITS.title) fail('文档名称最多 120 个字符。')
  if (typeof document.content !== 'string' || document.content.length > DOCUMENT_LIMITS.content) fail('文档内容最多 48,000 个字符，请拆分成多份文档。')
  if (!Array.isArray(document.assets) || document.assets.length > DOCUMENT_LIMITS.assets) fail('每份文档最多添加 6 张图片。')
  if (!['A4', 'LETTER'].includes(document.pageSize)) fail('请选择 A4 或 Letter 纸张。')
  if (![document.createdAt, document.updatedAt].every(value => Number.isFinite(value) && value >= 0)) fail('文档日期无效。')
  const assets = document.assets.map(validateAsset)
  if (new Set(assets.map(asset => asset.id)).size !== assets.length) fail('文档中存在重复的图片标识。')
  return {
    id: document.id, title: document.title, content: document.content, assets,
    pageSize: document.pageSize, createdAt: document.createdAt, updatedAt: document.updatedAt,
  }
}

export function makeDocument(fields = {}, { now = Date.now(), id = globalThis.crypto.randomUUID() } = {}) {
  return validateDocument({
    id, title: fields.title ?? '未命名文档', content: fields.content ?? '', assets: fields.assets ?? [],
    pageSize: fields.pageSize ?? 'A4', createdAt: now, updatedAt: now,
  })
}

export function sortDocuments(documents) {
  return [...documents].sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id))
}

export function describeStorageError(error) {
  if (error?.name === 'QuotaExceededError') return '本机存储空间不足，最新修改尚未保存。请先下载备份，或删除不需要的草稿后重试。'
  if (error?.name === 'SecurityError' || error?.name === 'InvalidStateError') return '浏览器当前无法保存本机草稿。请允许网站存储，或先下载文件备份后重试。'
  return '本机草稿保存失败，最新修改仍保留在当前页面。请先下载备份，再点击重试保存。'
}

/** Every mutation addresses a single key. Tabs cannot erase one another's unrelated drafts. */
export function createDocumentStore({ indexedDB = globalThis.indexedDB, name = DOCUMENT_DB_NAME } = {}) {
  let databasePromise
  let database
  let operations = Promise.resolve()

  function open() {
    if (databasePromise) return databasePromise
    databasePromise = new Promise((resolve, reject) => {
      if (!indexedDB) { reject(new Error('此浏览器不支持本机草稿存储。')); return }
      let blocked = false
      const request = indexedDB.open(name, DOCUMENT_DB_VERSION)
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(DOCUMENT_STORE_NAME)) request.result.createObjectStore(DOCUMENT_STORE_NAME, { keyPath: 'id' })
      }
      request.onsuccess = () => {
        if (blocked) { request.result.close(); return }
        database = request.result
        database.onversionchange = () => { database.close(); database = undefined; databasePromise = undefined }
        resolve(database)
      }
      request.onerror = () => reject(request.error || new Error('无法打开本机草稿。'))
      request.onblocked = () => { blocked = true; reject(new Error('另一个页面正在更新草稿存储，请关闭旧页面后重试。')) }
    }).catch(error => { databasePromise = undefined; throw error })
    return databasePromise
  }

  function enqueue(operation) {
    const result = operations.then(operation)
    operations = result.catch(() => {})
    return result
  }

  async function transact(mode, execute) {
    const db = await open()
    return new Promise((resolve, reject) => {
      let transaction
      try { transaction = db.transaction(DOCUMENT_STORE_NAME, mode) } catch (error) { reject(error); return }
      let request
      try { request = execute(transaction.objectStore(DOCUMENT_STORE_NAME)) } catch (error) { transaction.abort(); reject(error); return }
      transaction.oncomplete = () => resolve(request.result)
      transaction.onerror = () => reject(transaction.error || request.error || new Error('本机草稿事务失败。'))
      transaction.onabort = () => reject(transaction.error || request.error || new Error('本机草稿事务已取消。'))
    })
  }

  return {
    readAll() {
      return enqueue(async () => {
        const records = await transact('readonly', store => store.getAll())
        const documents = []
        let invalidCount = 0
        for (const record of records) {
          try {
            if (record.schemaVersion !== DOCUMENT_SCHEMA_VERSION) throw new Error('Unsupported document version')
            documents.push(validateDocument(record))
          } catch { invalidCount++ }
        }
        return {
          documents: sortDocuments(documents),
          warning: invalidCount ? `有 ${invalidCount} 份本机草稿格式异常，未载入；原数据仍然保留。` : '',
        }
      })
    },
    put(document) {
      // Snapshot before queueing so subsequent edits cannot mutate an in-flight save.
      let snapshot
      try { snapshot = validateDocument(document) } catch (error) { return Promise.reject(error) }
      return enqueue(() => transact('readwrite', store => store.put({ ...snapshot, schemaVersion: DOCUMENT_SCHEMA_VERSION })))
    },
    remove(id) {
      if (typeof id !== 'string' || !id || id.length > 128) return Promise.reject(new Error('文档标识无效。'))
      return enqueue(() => transact('readwrite', store => store.delete(id)))
    },
    close() {
      return enqueue(() => { database?.close(); database = undefined; databasePromise = undefined })
    },
  }
}
