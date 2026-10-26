export const MAX_REFERENCE_IMAGES = 3
export const MAX_REFERENCE_SOURCE_BYTES = 10 * 1024 * 1024
export const MAX_REFERENCE_DATA_URL_BYTES = 1024 * 1024
export const MAX_REFERENCE_DIMENSION = 2048

const SUPPORTED_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])
const EXTENSION_TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' }

function declaredImageType(file) {
  const type = typeof file?.type === 'string' ? file.type.toLowerCase() : ''
  if (SUPPORTED_TYPES.has(type)) return type
  if (type && type !== 'application/octet-stream') return null
  const extension = typeof file?.name === 'string' ? file.name.match(/\.(png|jpe?g|webp)$/i)?.[1].toLowerCase() : ''
  return EXTENSION_TYPES[extension] || null
}

// This is only an inexpensive picker/paste filter. Preparation checks the bytes
// and asks the browser to decode the image before accepting it.
export function isReferenceImageFile(file) {
  return Boolean(declaredImageType(file))
}

function abortError() {
  if (typeof DOMException === 'function') return new DOMException('已取消图片处理。', 'AbortError')
  const error = new Error('已取消图片处理。')
  error.name = 'AbortError'
  return error
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw abortError()
}

function readBlob(blob, method, signal) {
  throwIfAborted(signal)
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    let settled = false
    const finish = (error, value) => {
      if (settled) return
      settled = true
      signal?.removeEventListener('abort', cancel)
      reader.onload = reader.onerror = reader.onabort = null
      if (error) reject(error)
      else resolve(value)
    }
    const cancel = () => {
      finish(abortError())
      if (reader.readyState === 1) reader.abort()
    }
    reader.onload = () => finish(null, reader.result)
    reader.onerror = () => finish(new Error('无法读取这张图片，请重新选择文件。'))
    reader.onabort = () => finish(abortError())
    signal?.addEventListener('abort', cancel, { once: true })
    if (signal?.aborted) return cancel()
    try {
      reader[method](blob)
    } catch {
      finish(new Error('无法读取这张图片，请重新选择文件。'))
    }
  })
}

function imageTypeFromBytes(buffer) {
  const bytes = new Uint8Array(buffer)
  if (bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte)) return 'image/png'
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg'
  if (bytes.length >= 12 && bytes[0] === 82 && bytes[1] === 73 && bytes[2] === 70 && bytes[3] === 70
    && bytes[8] === 87 && bytes[9] === 69 && bytes[10] === 66 && bytes[11] === 80) return 'image/webp'
  return null
}

function decodeLocalImage(blob, signal) {
  throwIfAborted(signal)
  return new Promise((resolve, reject) => {
    const image = new Image()
    const objectUrl = URL.createObjectURL(blob)
    let settled = false
    let released = false
    const release = () => {
      if (released) return
      released = true
      image.removeAttribute('src')
      URL.revokeObjectURL(objectUrl)
    }
    const cleanup = () => {
      image.onload = image.onerror = null
      signal?.removeEventListener('abort', cancel)
    }
    const fail = (error) => {
      if (settled) return
      settled = true
      cleanup()
      release()
      reject(error)
    }
    const cancel = () => fail(abortError())
    const invalid = () => fail(signal?.aborted ? abortError() : new Error('图片无法解码，文件可能已损坏。请使用有效的 PNG、JPEG 或 WebP 图片。'))
    const complete = () => {
      if (settled) return
      if (signal?.aborted) return cancel()
      if (!image.naturalWidth || !image.naturalHeight) return invalid()
      settled = true
      cleanup()
      resolve({ image, release })
    }
    image.onerror = invalid
    image.onload = () => {
      // onload is the fallback for browsers without HTMLImageElement.decode.
      if (typeof image.decode === 'function') image.decode().then(complete, invalid)
      else complete()
    }
    signal?.addEventListener('abort', cancel, { once: true })
    if (signal?.aborted) return cancel()
    image.src = objectUrl
  })
}

function encodeCanvas(canvas, type, quality, signal) {
  throwIfAborted(signal)
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (error, blob) => {
      if (settled) return
      settled = true
      signal?.removeEventListener('abort', cancel)
      if (error) reject(error)
      else resolve(blob)
    }
    const cancel = () => finish(abortError())
    signal?.addEventListener('abort', cancel, { once: true })
    if (signal?.aborted) return cancel()
    try {
      canvas.toBlob((blob) => {
        if (!blob?.size || !SUPPORTED_TYPES.has(blob.type)) {
          finish(new Error('浏览器无法处理这张图片，请换一张图片或更新浏览器后重试。'))
          return
        }
        // A browser may fall back from WebP to PNG; both preserve alpha.
        if (type !== 'image/jpeg' && blob.type === 'image/jpeg') {
          finish(new Error('浏览器无法保留图片的透明背景，请换用 PNG 图片。'))
          return
        }
        finish(null, blob)
      }, type, quality)
    } catch {
      finish(new Error('图片压缩失败，请换一张图片后重试。'))
    }
  })
}

function referenceId() {
  if (globalThis.crypto?.randomUUID) return `reference-${globalThis.crypto.randomUUID()}`
  if (globalThis.crypto?.getRandomValues) {
    const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16))
    return `reference-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`
  }
  return `reference-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

/**
 * Prepare a local File without making a network request. `size` is the encoded
 * image's binary byte count; the entire ASCII data URI is also capped at 1 MiB.
 */
export async function prepareReferenceImage(file, { signal } = {}) {
  throwIfAborted(signal)
  if (typeof Blob === 'undefined' || !(file instanceof Blob) || typeof file.name !== 'string') {
    throw new Error('请选择本地图片文件。')
  }
  const declaredType = declaredImageType(file)
  if (!declaredType) throw new Error('参考图仅支持 PNG、JPEG 和 WebP 格式。')
  if (!file.size) throw new Error('这张图片是空文件，请重新选择。')
  if (file.size > MAX_REFERENCE_SOURCE_BYTES) throw new Error('每张参考图不能超过 10 MB，请先缩小图片。')

  const header = await readBlob(file.slice(0, 12), 'readAsArrayBuffer', signal)
  const sourceType = imageTypeFromBytes(header)
  if (!sourceType || sourceType !== declaredType) {
    throw new Error('图片内容与文件格式不符，请使用有效的 PNG、JPEG 或 WebP 图片。')
  }

  // Normalize a missing/generic MIME before local object-URL decoding.
  const { image, release } = await decodeLocalImage(file.slice(0, file.size, sourceType), signal)
  let canvas
  try {
    throwIfAborted(signal)
    canvas = document.createElement('canvas')
    const context = canvas.getContext('2d', { alpha: true })
    if (!context) throw new Error('浏览器暂不支持图片处理，请更新浏览器后重试。')
    const scale = Math.min(1, MAX_REFERENCE_DIMENSION / Math.max(image.naturalWidth, image.naturalHeight))
    let width = Math.max(1, Math.round(image.naturalWidth * scale))
    let height = Math.max(1, Math.round(image.naturalHeight * scale))

    for (let attempt = 0; attempt < 12; attempt += 1) {
      throwIfAborted(signal)
      canvas.width = width
      canvas.height = height
      context.imageSmoothingEnabled = true
      context.imageSmoothingQuality = 'high'
      // A freshly resized alpha canvas stays transparent; do not paint a
      // background or convert PNG/WebP sources to JPEG.
      try {
        context.drawImage(image, 0, 0, width, height)
      } catch {
        throw new Error('图片无法绘制，可能过大或已损坏，请换一张图片后重试。')
      }
      let lastBlob
      const qualities = sourceType === 'image/png' ? [undefined] : [0.86, 0.76, 0.66]
      for (const quality of qualities) {
        const blob = await encodeCanvas(canvas, sourceType, quality, signal)
        lastBlob = blob
        const dataUrlLength = `data:${blob.type};base64,`.length + 4 * Math.ceil(blob.size / 3)
        if (dataUrlLength > MAX_REFERENCE_DATA_URL_BYTES) continue
        const dataUrl = await readBlob(blob, 'readAsDataURL', signal)
        throwIfAborted(signal)
        if (typeof dataUrl !== 'string' || dataUrl.length > MAX_REFERENCE_DATA_URL_BYTES) continue
        return { id: referenceId(), name: file.name, dataUrl, width, height, size: blob.size, type: blob.type }
      }

      if (width === 1 && height === 1) break
      const targetBytes = Math.floor((MAX_REFERENCE_DATA_URL_BYTES - 64) * 3 / 4)
      const shrink = Math.min(0.8, Math.sqrt(targetBytes / lastBlob.size) * 0.9)
      width = Math.max(1, Math.floor(width * shrink))
      height = Math.max(1, Math.floor(height * shrink))
    }
    throw new Error('图片压缩后仍然过大，请裁剪图片后重试。')
  } finally {
    release()
    if (canvas) {
      canvas.width = 0
      canvas.height = 0
    }
  }
}
