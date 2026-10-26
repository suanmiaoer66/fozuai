import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { IDBFactory } from 'fake-indexeddb'
import {
  createDocumentStore, makeDocument, validateDocument, describeStorageError,
  DOCUMENT_DB_VERSION, DOCUMENT_STORE_NAME, DOCUMENT_LIMITS,
} from './documentStore.js'

const fixture = await readFile(new URL('../../test/fixtures/reference-circle.png', import.meta.url))
const image = { id: 'image-1', name: '圆形.png', dataUrl: `data:image/png;base64,${fixture.toString('base64')}`, width: 512, height: 512 }
const document = (id, fields = {}) => makeDocument(fields, { now: 1000, id })

async function rawTransaction(indexedDB, name, mode, operation) {
  const database = await new Promise((resolve, reject) => {
    const request = indexedDB.open(name, DOCUMENT_DB_VERSION)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(DOCUMENT_STORE_NAME, mode)
      const request = operation(transaction.objectStore(DOCUMENT_STORE_NAME))
      transaction.oncomplete = () => resolve(request.result)
      transaction.onabort = () => reject(transaction.error)
    })
  } finally { database.close() }
}

test('drafts preserve Chinese Markdown, image assets and paper size across closing and reopening', async () => {
  const indexedDB = new IDBFactory()
  const store = createDocumentStore({ indexedDB })
  const draft = document('one', { title: '工作报告', content: '# 进度\n\n| 项目 | 状态 |\n| --- | --- |\n| 排版 | 完成 |', assets: [image], pageSize: 'LETTER' })
  await store.put(draft)
  await store.close()
  const reopened = createDocumentStore({ indexedDB })
  assert.deepEqual(await reopened.readAll(), { documents: [draft], warning: '' })
  await reopened.close()
})

test('queued updates, reads and deletion commit in request order, including immutable image snapshots', async () => {
  const store = createDocumentStore({ indexedDB: new IDBFactory() })
  const original = document('one', { content: '第一稿', assets: [{ ...image }] })
  const saveOriginal = store.put(original)
  original.assets[0].name = 'caller-mutated.png'
  const readOriginal = store.readAll()
  const saveRevised = store.put({ ...original, content: '修订稿', updatedAt: 2000 })
  const readRevised = store.readAll()
  const remove = store.remove('one')
  const readRemoved = store.readAll()
  await Promise.all([saveOriginal, saveRevised, remove])
  assert.equal((await readOriginal).documents[0].assets[0].name, '圆形.png')
  assert.equal((await readOriginal).documents[0].content, '第一稿')
  assert.equal((await readRevised).documents[0].content, '修订稿')
  assert.deepEqual((await readRemoved).documents, [])
  await store.close()
})

test('malformed and future-version records remain in the database while valid drafts load', async () => {
  const indexedDB = new IDBFactory()
  const name = 'corrupt-test'
  const store = createDocumentStore({ indexedDB, name })
  const valid = document('valid')
  await store.put(valid)
  await rawTransaction(indexedDB, name, 'readwrite', objectStore => objectStore.put({ id: 'corrupt', schemaVersion: 1, content: null }))
  await rawTransaction(indexedDB, name, 'readwrite', objectStore => objectStore.put({ ...document('future'), schemaVersion: 99 }))
  const result = await store.readAll()
  assert.deepEqual(result.documents, [valid])
  assert.match(result.warning, /2 份.*原数据仍然保留/)
  assert.equal((await rawTransaction(indexedDB, name, 'readonly', objectStore => objectStore.getAll())).length, 3)
  await store.close()
})

test('separate browser tabs update individual documents without wiping unrelated drafts', async () => {
  const indexedDB = new IDBFactory()
  const first = createDocumentStore({ indexedDB })
  const second = createDocumentStore({ indexedDB })
  await Promise.all([first.put(document('a')), second.put(document('b'))])
  await first.put(document('a', { content: '更新 A' }))
  assert.deepEqual((await second.readAll()).documents.map(item => item.id), ['a', 'b'])
  await second.remove('b')
  assert.equal((await first.readAll()).documents[0].content, '更新 A')
  await first.close()
  await second.close()
})

test('validation failures do not enqueue invalid writes or poison subsequent saves', async () => {
  const store = createDocumentStore({ indexedDB: new IDBFactory() })
  await assert.rejects(store.put({ ...document('one'), content: 'x'.repeat(DOCUMENT_LIMITS.content + 1) }), /48,000/)
  await store.put(document('valid'))
  await assert.rejects(store.remove(''), /标识/)
  assert.deepEqual((await store.readAll()).documents.map(item => item.id), ['valid'])
  await store.close()
})

test('transaction failures reject instead of reporting saved and the same draft can be retried', async () => {
  const indexedDB = new IDBFactory()
  const name = 'retry-test'
  const store = createDocumentStore({ indexedDB, name })
  await store.readAll()
  const request = indexedDB.open(name, DOCUMENT_DB_VERSION)
  const database = await new Promise(resolve => { request.onsuccess = () => resolve(request.result) })
  const transactionPrototype = Object.getPrototypeOf(database.transaction(DOCUMENT_STORE_NAME, 'readonly'))
  const originalObjectStore = transactionPrototype.objectStore
  let shouldAbort = true
  transactionPrototype.objectStore = function (...args) {
    const result = originalObjectStore.apply(this, args)
    if (this.mode === 'readwrite' && shouldAbort) {
      shouldAbort = false
      queueMicrotask(() => this.abort())
    }
    return result
  }
  try {
    await assert.rejects(store.put(document('draft')), /取消|失败|abort/i)
    assert.deepEqual((await store.readAll()).documents, [])
    await store.put(document('draft', { content: '重试后成功' }))
    assert.equal((await store.readAll()).documents[0].content, '重试后成功')
  } finally {
    transactionPrototype.objectStore = originalObjectStore
    database.close()
    await store.close()
  }
})

test('document validation rejects oversized content, unsafe images, duplicate assets and invalid timestamps', () => {
  const good = document('good', { assets: [image] })
  assert.deepEqual(validateDocument({ ...good, ignored: 'not persisted' }), good)
  for (const patch of [
    { title: 'x'.repeat(121) }, { content: 'x'.repeat(48001) }, { createdAt: NaN }, { pageSize: 'invalid' },
    { assets: Array(7).fill(image) }, { assets: [image, image] },
    { assets: [{ ...image, dataUrl: 'data:image/svg+xml;base64,PHN2Zy8+' }] },
    { assets: [{ ...image, dataUrl: 'data:image/png;base64,aGVsbG8=' }] },
    { assets: [{ ...image, dataUrl: `data:image/png;base64,${'A'.repeat(1024 * 1024)}` }] },
  ]) assert.throws(() => validateDocument({ ...good, ...patch }))
})

test('storage unavailability and quota errors are actionable without claiming a save', async () => {
  const unavailable = createDocumentStore({ indexedDB: null })
  await assert.rejects(unavailable.readAll(), /不支持/)
  await assert.rejects(unavailable.put(document('a')), /不支持/)
  assert.match(describeStorageError({ name: 'QuotaExceededError' }), /尚未保存.*下载备份/)
  assert.match(describeStorageError({ name: 'SecurityError' }), /允许网站存储/)
  assert.match(describeStorageError(new Error('failed')), /最新修改仍保留/)
})

test('a failed initial read can be retried and adding a fresh draft preserves previously unseen records', async () => {
  const indexedDB = new IDBFactory()
  const existing = createDocumentStore({ indexedDB })
  await existing.put(document('previously-saved', { content: '不能丢失的旧草稿' }))
  await existing.close()
  let failOpen = true
  const flaky = { open(...args) {
    if (failOpen) { failOpen = false; throw new DOMException('Temporary unavailable', 'InvalidStateError') }
    return indexedDB.open(...args)
  } }
  const recovering = createDocumentStore({ indexedDB: flaky })
  await assert.rejects(recovering.readAll(), { name: 'InvalidStateError' })
  await recovering.put(document('new-draft', { content: '读取失败期间的新草稿' }))
  const result = await recovering.readAll()
  assert.equal(result.documents.length, 2)
  assert.equal(result.documents.find(item => item.id === 'previously-saved').content, '不能丢失的旧草稿')
  assert.equal(result.documents.find(item => item.id === 'new-draft').content, '读取失败期间的新草稿')
  await recovering.close()
})
