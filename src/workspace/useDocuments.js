import { useCallback, useEffect, useRef, useState } from 'react'
import { createDocumentStore, describeStorageError, makeDocument, sortDocuments, validateDocument } from './documentStore.js'

const SAVE_DELAY_MS = 200

/** Local-only drafts: UI updates synchronously; saved is reported only after an IndexedDB commit. */
export function useDocuments() {
  const [documents, setDocuments] = useState([])
  const [loading, setLoading] = useState(true)
  const [saveStatus, setSaveStatus] = useState('loading')
  const [error, setError] = useState('')
  const store = useRef(null)
  if (!store.current) store.current = createDocumentStore()
  const current = useRef([])
  const pending = useRef(new Map())
  const loaded = useRef(false)
  const readFailed = useRef(false)
  const retryingRead = useRef(false)
  const alive = useRef(true)
  const flushing = useRef(false)
  const timer = useRef(null)

  const flush = useCallback(async () => {
    clearTimeout(timer.current)
    if (flushing.current || !loaded.current || !pending.current.size) return
    flushing.current = true
    if (alive.current) setSaveStatus('saving')
    let failed = false
    try {
      while (pending.current.size) {
        // A confirmed deletion can free quota even when an earlier write failed.
        const [id, operation] = [...pending.current].find(([, item]) => item.type === 'remove') || pending.current.entries().next().value
        await (operation.type === 'remove' ? store.current.remove(id) : store.current.put(operation.document))
        // An edit made during the transaction remains queued and is saved next.
        if (pending.current.get(id) === operation) pending.current.delete(id)
      }
      if (alive.current) { setSaveStatus('saved'); setError('') }
    } catch (cause) {
      failed = true
      if (alive.current) { setSaveStatus('error'); setError(describeStorageError(cause)) }
    } finally {
      flushing.current = false
      if (!failed && pending.current.size) timer.current = setTimeout(flush, SAVE_DELAY_MS)
    }
  }, [])

  const queue = useCallback((id, operation) => {
    pending.current.set(id, operation)
    setSaveStatus('saving')
    setError('')
    clearTimeout(timer.current)
    timer.current = setTimeout(flush, SAVE_DELAY_MS)
  }, [flush])

  useEffect(() => {
    let cancelled = false
    alive.current = true
    store.current.readAll().then(result => {
      if (cancelled) return
      readFailed.current = false
      current.current = result.documents
      setDocuments(result.documents)
      setError(result.warning)
      setSaveStatus('saved')
    }).catch(() => {
      if (cancelled) return
      readFailed.current = true
      setError('无法读取本机草稿。已有数据未被删除；新编辑会暂存在当前页面，请下载备份，并尝试重新打开网页。')
      setSaveStatus('error')
    }).finally(() => {
      if (!cancelled) { loaded.current = true; setLoading(false) }
    })
    const beforeUnload = (event) => {
      if (!pending.current.size) return
      void flush()
      event.preventDefault()
      event.returnValue = ''
    }
    const pageHide = () => { void flush() }
    const visibilityChange = () => { if (document.visibilityState === 'hidden') void flush() }
    window.addEventListener('beforeunload', beforeUnload)
    window.addEventListener('pagehide', pageHide)
    document.addEventListener('visibilitychange', visibilityChange)
    return () => {
      cancelled = true
      alive.current = false
      clearTimeout(timer.current)
      void flush()
      window.removeEventListener('beforeunload', beforeUnload)
      window.removeEventListener('pagehide', pageHide)
      document.removeEventListener('visibilitychange', visibilityChange)
    }
  }, [flush])

  const ready = useCallback(() => {
    if (loaded.current) return true
    setError('正在读取本机草稿，请稍候。')
    return false
  }, [])

  const publish = useCallback((next) => {
    current.current = sortDocuments(next)
    setDocuments(current.current)
  }, [])

  const createDocument = useCallback((fields = {}) => {
    if (!ready()) return null
    try {
      const document = makeDocument(fields)
      publish([document, ...current.current])
      queue(document.id, { type: 'put', document })
      return document
    } catch (cause) { setError(cause.message); return null }
  }, [publish, queue, ready])

  const updateDocument = useCallback((id, patch) => {
    if (!ready()) return null
    const previous = current.current.find(document => document.id === id)
    if (!previous) { setError('这份草稿已经不存在，请选择其他文档。'); return null }
    try {
      const document = validateDocument({ ...previous, ...patch, id: previous.id, createdAt: previous.createdAt, updatedAt: Date.now() })
      publish(current.current.map(item => item.id === id ? document : item))
      queue(id, { type: 'put', document })
      return document
    } catch (cause) { setError(cause.message); return null }
  }, [publish, queue, ready])

  const removeDocument = useCallback((id) => {
    if (!ready()) return null
    const previous = current.current.find(document => document.id === id)
    if (!previous) return null
    publish(current.current.filter(document => document.id !== id))
    queue(id, { type: 'remove' })
    return previous
  }, [publish, queue, ready])

  const clearError = useCallback(() => setError(''), [])
  const retrySave = useCallback(async () => {
    if (readFailed.current) {
      if (retryingRead.current) return
      retryingRead.current = true
      setSaveStatus('saving')
      try {
        const result = await store.current.readAll()
        // Preserve edits made during recovery and keep pending deletions deleted.
        const merged = new Map(result.documents.map(document => [document.id, document]))
        for (const document of current.current) merged.set(document.id, document)
        for (const [id, operation] of pending.current) if (operation.type === 'remove') merged.delete(id)
        current.current = sortDocuments([...merged.values()])
        readFailed.current = false
        if (alive.current) {
          setDocuments(current.current)
          setError(result.warning)
          setSaveStatus(pending.current.size ? 'saving' : 'saved')
        }
      } catch {
        if (alive.current) {
          setSaveStatus('error')
          setError('仍然无法读取本机草稿。已有数据未被删除，请先下载当前文档备份后再重试。')
        }
        return
      } finally { retryingRead.current = false }
    }
    await flush()
  }, [flush])

  return { documents, loading, saveStatus, error, createDocument, updateDocument, removeDocument, clearError, retrySave }
}

export default useDocuments
