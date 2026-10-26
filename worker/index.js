import { MAX_REFERENCE_IMAGES, MAX_REFERENCE_IMAGE_BYTES, REFERENCE_IMAGE_TYPES, isUploadedReferenceUrl } from '../shared/referenceImages.js'
import { MAX_CHAT_IMAGES, MAX_CHAT_IMAGE_DATA_URL_BYTES, MAX_CHAT_REQUEST_BYTES, MAX_CHAT_MESSAGE_CHARS, MAX_CHAT_TEXT_CHARS, MAX_CHAT_MESSAGES } from '../shared/chat.js'

const DEFAULT_ORIGIN = 'https://suanmiaoer66.github.io'
const MAX_REQUEST_BYTES = 128 * 1024
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024
const MAX_IMAGE_BYTES = 32 * 1024 * 1024
const MAX_UPLOAD_REQUEST_BYTES = MAX_REFERENCE_IMAGE_BYTES + 64 * 1024
const IMAGE_DOWNLOAD_TYPES = new Map([
  ['image/png', 'png'], ['image/jpeg', 'jpg'], ['image/webp', 'webp'],
  ['image/gif', 'gif'], ['image/avif', 'avif'],
])
const TASK_ID = /^[A-Za-z0-9_-]{1,128}$/
const CHAT_MODELS = {
  '高级佛祖模型': 'deepseek-reasoner',
  '导管佛祖模型': 'deepseek-chat',
  'deepseek-reasoner': 'deepseek-reasoner',
  'deepseek-chat': 'deepseek-chat',
  'deepseek-flash': 'deepseek-flash',
  'deepseek-v4-pro': 'deepseek-v4-pro',
}
const SUPPORTED_DEEPSEEK_MODELS = new Set(['deepseek-flash', 'deepseek-v4-pro', 'deepseek-chat', 'deepseek-reasoner'])
const IMAGE_MODELS = new Set(['gpt-image-2', 'gpt-image-2-ext'])
const IMAGE_SIZES = new Set(['auto', '1:1', '3:2', '2:3', '4:3', '3:4', '5:4', '4:5', '16:9', '9:16', '2:1', '1:2', '3:1', '1:3', '21:9', '9:21'])
const TASK_STATUSES = new Set(['submitted', 'pending', 'queued', 'processing', 'running', 'completed', 'failed', 'cancelled'])

class HttpError extends Error {
  constructor(status, code, message) {
    super(message)
    this.status = status
    this.code = code
  }
}

function invalid(message = '请求参数不正确。') {
  throw new HttpError(400, 'invalid_request', message)
}

function configuredSecret(value) {
  return typeof value === 'string' && value.trim().length > 0 && !/[\r\n]/.test(value)
}

function isAllowedOrigin(origin, env) {
  if (!origin || !/^https?:\/\//.test(origin)) return false
  const configuredList = typeof env.ALLOWED_ORIGINS === 'string' ? env.ALLOWED_ORIGINS.trim() : ''
  const legacyOrigin = typeof env.ALLOWED_ORIGIN === 'string' ? env.ALLOWED_ORIGIN.trim() : ''
  const allowed = configuredList || legacyOrigin || DEFAULT_ORIGIN
  return allowed.split(',').some((entry) => entry.trim() === origin)
}

function responseHeaders(request, env) {
  const headers = new Headers({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    Vary: 'Origin',
  })
  if (isAllowedOrigin(request.headers.get('Origin'), env)) {
    headers.set('Access-Control-Allow-Origin', request.headers.get('Origin'))
  }
  return headers
}

async function readJson(body, maxBytes, upstream = false) {
  const fail = () => {
    throw new HttpError(upstream ? 502 : 400, upstream ? 'invalid_upstream_response' : 'invalid_json', upstream ? '模型服务返回了无法识别的内容。' : '请求必须是有效的 JSON。')
  }
  if (!body) fail()
  const reader = body.getReader()
  // A single bounded buffer avoids retaining arbitrarily many tiny chunks.
  const bytes = new Uint8Array(maxBytes)
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (size + value.byteLength > maxBytes) {
        await reader.cancel()
        throw new HttpError(upstream ? 502 : 413, upstream ? 'invalid_upstream_response' : 'payload_too_large', upstream ? '模型服务返回的内容过大。' : '图片或对话内容过多，请缩小图片或新建对话。')
      }
      bytes.set(value, size)
      size += value.byteLength
    }
  } finally {
    reader.releaseLock()
  }
  let data
  try {
    data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, size)))
  } catch {
    fail()
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) fail()
  return data
}

async function requestBody(request, maxBytes = MAX_REQUEST_BYTES) {
  if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    throw new HttpError(415, 'unsupported_media_type', '请使用 application/json 发送请求。')
  }
  const length = request.headers.get('Content-Length')
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > maxBytes)) {
    await request.body?.cancel()
    throw new HttpError(413, 'payload_too_large', '图片或对话内容过多，请缩小图片或新建对话。')
  }
  return readJson(request.body, maxBytes)
}

async function referenceUploadBody(request) {
  const contentType = request.headers.get('Content-Type') || ''
  if (!/^multipart\/form-data\s*;/i.test(contentType)) throw new HttpError(415, 'invalid_image_upload', '请重新选择参考图片后上传。')
  const tooLarge = () => new HttpError(413, 'image_too_large', '参考图片过大，请缩小图片后重试。')
  const length = request.headers.get('Content-Length')
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_UPLOAD_REQUEST_BYTES)) throw tooLarge()
  if (!request.body) invalid('请选择参考图片。')
  // Bound the actual stream before invoking the multipart parser, including
  // requests without Content-Length or with a misleading declared length.
  const reader = request.body.getReader()
  const bytes = new Uint8Array(MAX_UPLOAD_REQUEST_BYTES)
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (size + value.byteLength > MAX_UPLOAD_REQUEST_BYTES) {
        await reader.cancel()
        throw tooLarge()
      }
      bytes.set(value, size)
      size += value.byteLength
    }
  } finally {
    reader.releaseLock()
  }
  let form
  try {
    form = await new Response(bytes.subarray(0, size), { headers: { 'Content-Type': contentType } }).formData()
  } catch {
    invalid('图片上传内容无效，请重新选择图片。')
  }
  const entries = [...form.entries()]
  const file = form.get('file')
  if (entries.length !== 1 || entries[0][0] !== 'file' || !(file instanceof Blob) || !file.size) invalid('每次上传须包含一张有效参考图片。')
  if (file.size > MAX_REFERENCE_IMAGE_BYTES) throw tooLarge()
  if (!REFERENCE_IMAGE_TYPES.includes(file.type)) throw new HttpError(415, 'invalid_image_type', '参考图支持 PNG、JPG 和 WebP 格式。')
  const prefix = new Uint8Array(await file.slice(0, 32).arrayBuffer())
  if (!imageSignatureMatches(prefix, file.type)) invalid('图片内容与格式不匹配，请重新选择图片。')
  const upload = new FormData()
  upload.append('file', file, `reference.${IMAGE_DOWNLOAD_TYPES.get(file.type)}`)
  return upload
}

function resolveChatModel(label, env) {
  if (label === '高级佛祖模型') return { model: env.DEEPSEEK_REASONING_MODEL || env.DEEPSEEK_VISION_MODEL || 'deepseek-flash', advanced: true }
  if (label === '导管佛祖模型') return { model: env.DEEPSEEK_CHAT_MODEL || env.DEEPSEEK_VISION_MODEL || 'deepseek-flash', advanced: false }
  if (typeof label === 'string' && Object.hasOwn(CHAT_MODELS, label)) {
    const model = CHAT_MODELS[label]
    return { model, advanced: label === 'deepseek-reasoner' }
  }
  return null
}

function chatImageUrl(value) {
  if (typeof value !== 'string' || value.length > MAX_CHAT_IMAGE_DATA_URL_BYTES) invalid('每张对话图片须小于 1 MiB，请重新选择图片。')
  const header = /^data:(image\/(?:png|jpeg|webp));base64,/.exec(value)
  if (!header) invalid('对话图片仅支持 PNG、JPEG 和 WebP，请重新选择图片。')
  const encoded = value.slice(header[0].length)
  // Check syntax and padding without decoding the whole image into another copy.
  if (!encoded.length || encoded.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) invalid('图片编码无效，请重新选择图片。')
  const prefix = Uint8Array.from(atob(encoded.slice(0, 48)), (char) => char.charCodeAt(0))
  if (!imageSignatureMatches(prefix, header[1])) invalid('图片内容与格式不匹配，请重新选择图片。')
  return value
}

function chatPayload(data, env) {
  const resolved = resolveChatModel(data.model, env)
  if (!resolved || !SUPPORTED_DEEPSEEK_MODELS.has(resolved.model)) invalid('请选择支持的对话模型。')
  const { model, advanced } = resolved
  if (data.stream !== undefined && data.stream !== false) invalid('暂不支持流式请求。')
  if (!Array.isArray(data.messages) || data.messages.length < 1 || data.messages.length > MAX_CHAT_MESSAGES) invalid('对话消息数量须在 1 到 50 条之间，请新建对话后继续。')
  let length = 0
  let imageCount = 0
  const messages = data.messages.map((message) => {
    if (!message || !['system', 'user', 'assistant'].includes(message.role)) invalid('对话角色无效。')
    let messageLength = 0
    const text = (value) => {
      if (typeof value !== 'string' || !value.trim()) invalid('对话文本不能为空。')
      messageLength += value.length
      if (messageLength > MAX_CHAT_MESSAGE_CHARS) invalid('每条对话文本不能超过 16000 字。')
      return value
    }
    let content
    if (typeof message.content === 'string') {
      content = text(message.content)
    } else {
      if (message.role !== 'user' || !Array.isArray(message.content) || !message.content.length || message.content.length > MAX_REFERENCE_IMAGES + 1) invalid('只有用户消息可以包含图片，每次最多添加 3 张。')
      let messageImages = 0
      content = message.content.map((part) => {
        if (part?.type === 'text') return { type: 'text', text: text(part.text) }
        if (part?.type !== 'image_url') invalid('对话内容类型不受支持。')
        if (++messageImages > MAX_REFERENCE_IMAGES) invalid('每次最多添加 3 张图片。')
        if (++imageCount > MAX_CHAT_IMAGES) invalid('本轮对话已超过 12 张图片，请新建对话后继续。')
        return { type: 'image_url', image_url: { url: chatImageUrl(part.image_url?.url), detail: 'auto' } }
      })
    }
    length += messageLength
    return { role: message.role, content }
  })
  if (length > MAX_CHAT_TEXT_CHARS || !messages.some((message) => message.role === 'user')) invalid('对话内容过长或缺少用户消息，请新建对话后继续。')
  if (imageCount && model !== 'deepseek-flash') throw new HttpError(400, 'vision_model_unsupported', '当前模型暂不支持看图，请切换到导管佛祖模型或联系管理员配置 deepseek-flash。')
  // Explicitly construct the payload: callers cannot override upstream URLs, tools or billing options.
  const payload = { model, messages, stream: false, max_tokens: 4096 }
  // DeepSeek-V4 models expose explicit thinking controls. Legacy chat/reasoner IDs
  // keep their historical behavior and omit these newer fields.
  if (model === 'deepseek-flash' || model === 'deepseek-v4-pro') {
    payload.max_tokens = advanced ? 16384 : 8192
    payload.thinking = { type: advanced ? 'enabled' : 'disabled' }
    if (advanced) payload.reasoning_effort = 'high'
  }
  return payload
}

function imagePayload(data, env) {
  const model = data.model ?? env.APIMART_IMAGE_MODEL ?? 'gpt-image-2'
  const size = data.size ?? env.APIMART_IMAGE_SIZE ?? '1:1'
  const resolution = data.resolution ?? env.APIMART_IMAGE_RESOLUTION ?? '1k'
  if (!IMAGE_MODELS.has(model)) invalid('请选择支持的图片模型。')
  if (typeof data.prompt !== 'string' || !data.prompt.trim() || data.prompt.length > 12000) invalid('图片描述须为 1 到 12000 字的文本。')
  if (data.n !== undefined && data.n !== 1) invalid('每次只能生成一张图片。')
  const pixels = typeof size === 'string' && /^(\d{3,4})x(\d{3,4})$/.exec(size)
  const validPixels = pixels && pixels.slice(1).every((value) => Number(value) >= 256 && Number(value) <= 4096)
  if (!IMAGE_SIZES.has(size) && !validPixels) invalid('图片比例或尺寸不受支持。')
  if (!['1k', '2k', '4k'].includes(resolution)) invalid('图片分辨率须为 1k、2k 或 4k。')
  if (data.image_urls !== undefined && (!Array.isArray(data.image_urls) || data.image_urls.length > MAX_REFERENCE_IMAGES || data.image_urls.some((value) => !isUploadedReferenceUrl(value)))) {
    invalid(`最多使用 ${MAX_REFERENCE_IMAGES} 张已上传的参考图片，请重新选择图片。`)
  }
  return { model, prompt: data.prompt.trim(), n: 1, size, resolution, ...(data.image_urls?.length ? { image_urls: data.image_urls } : {}) }
}

function upstreamRoot(configured, origin) {
  let url
  try {
    url = new URL(configured || origin)
  } catch {
    throw new HttpError(503, 'not_configured', '模型服务地址配置不正确。')
  }
  const path = url.pathname.replace(/\/+$/, '')
  if (url.origin !== origin || url.username || url.password || url.search || url.hash || !['', '/v1'].includes(path)) {
    throw new HttpError(503, 'not_configured', '模型服务地址配置不正确。')
  }
  return `${origin}/v1`
}

function secretValues(env) {
  // Keep redacting a legacy site secret if it remains in the deployment.
  // It no longer controls access to the public assistant.
  const siteAccessKey = typeof env.SITE_ACCESS_KEY === 'string' ? env.SITE_ACCESS_KEY.trim() : env.SITE_ACCESS_KEY
  return [env.DEEPSEEK_API_KEY, env.APIMART_API_KEY, siteAccessKey].filter(configuredSecret)
}

function redact(value, env) {
  let safe = value
  for (const secret of secretValues(env)) safe = safe.replaceAll(secret, '[已隐藏]')
  return safe
}

async function upstreamRequest(url, method, payload, key, fetchImpl, timeoutMs) {
  if (!configuredSecret(key)) throw new HttpError(503, 'not_configured', '模型服务密钥尚未配置，请联系网站管理员。')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetchImpl(url, {
      method,
      headers: { Authorization: `Bearer ${key}`, Accept: 'application/json', ...(payload && !(payload instanceof FormData) ? { 'Content-Type': 'application/json' } : {}) },
      ...(payload ? { body: payload instanceof FormData ? payload : JSON.stringify(payload) } : {}),
      signal: controller.signal,
      // Never forward an API key to a redirect destination.
      redirect: 'manual',
    })
    if (!response.ok) {
      // Do not return upstream bodies/headers, which may echo credentials or private account details.
      if (response.body) await response.body.cancel()
      if (response.status === 429 || response.status === 402) throw new HttpError(429, 'upstream_limit', '模型服务请求过多或额度不足，请稍后重试或联系网站管理员。')
      if (response.status === 404) throw new HttpError(404, 'not_found', '请求的模型或图片任务不存在。')
      throw new HttpError(502, 'upstream_error', '模型服务暂时不可用，请稍后重试或联系网站管理员检查服务配置。')
    }
    return await readJson(response.body, MAX_RESPONSE_BYTES, true)
  } catch (error) {
    if (controller.signal.aborted) throw new HttpError(504, 'upstream_timeout', '模型服务响应超时，请稍后重试。')
    if (error instanceof HttpError) throw error
    throw new HttpError(502, 'upstream_unavailable', '暂时无法连接模型服务，请稍后重试。')
  } finally {
    clearTimeout(timer)
  }
}

function invalidResponse() {
  throw new HttpError(502, 'invalid_upstream_response', '模型服务返回了无法识别的内容。')
}

function chatResult(data, env) {
  const content = data?.choices?.[0]?.message?.content
  if (typeof content !== 'string' || !content.trim()) invalidResponse()
  return { choices: [{ message: { role: 'assistant', content: redact(content, env) } }] }
}

function imageSubmission(data, env) {
  const taskId = data?.data?.[0]?.task_id
  if (typeof taskId !== 'string' || !TASK_ID.test(taskId) || secretValues(env).some((key) => taskId.includes(key))) invalidResponse()
  return { code: 200, data: [{ status: 'submitted', task_id: taskId }] }
}

function imageUrl(value, env) {
  if (typeof value !== 'string' || value.length > 4096 || secretValues(env).some((key) => value.includes(key))) invalidResponse()
  let url
  try {
    url = new URL(value)
  } catch {
    invalidResponse()
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.hostname === 'localhost' || url.hostname.endsWith('.localhost') || url.hostname.endsWith('.local') || url.hostname.includes(':') || /^\d+\.\d+\.\d+\.\d+$/.test(url.hostname)) invalidResponse()
  return url.href
}

function taskResult(data, taskId, env) {
  const task = data?.data
  if (!task || !TASK_STATUSES.has(task.status)) invalidResponse()
  const result = { id: taskId, status: task.status }
  if (typeof task.progress === 'number' && Number.isFinite(task.progress)) result.progress = Math.min(100, Math.max(0, task.progress))
  if (task.status === 'completed') {
    const urls = task?.result?.images?.[0]?.url
    result.result = { images: [{ url: [imageUrl(Array.isArray(urls) ? urls[0] : urls, env)] }] }
  }
  if (task.status === 'failed' || task.status === 'cancelled') result.error = { message: '图片生成未成功，请调整描述后重试。' }
  return { code: 200, data: result }
}

function imageSignatureMatches(bytes, type) {
  const matches = (offset, value) => bytes.length >= offset + value.length && value.every((byte, index) => bytes[offset + index] === byte)
  const ascii = (offset, text) => matches(offset, Array.from(text, (character) => character.charCodeAt(0)))
  if (type === 'image/png') return matches(0, [137, 80, 78, 71, 13, 10, 26, 10])
  if (type === 'image/jpeg') return matches(0, [255, 216, 255])
  if (type === 'image/gif') return ascii(0, 'GIF87a') || ascii(0, 'GIF89a')
  if (type === 'image/webp') return ascii(0, 'RIFF') && ascii(8, 'WEBP')
  if (type === 'image/avif' && bytes.length >= 16 && ascii(4, 'ftyp')) {
    const boxLength = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0)
    if (boxLength < 16) return false
    if (ascii(8, 'avif') || ascii(8, 'avis')) return true
    for (let offset = 16; offset + 4 <= Math.min(boxLength, bytes.length); offset += 4) {
      if (ascii(offset, 'avif') || ascii(offset, 'avis')) return true
    }
  }
  return false
}

async function downloadTaskImage(image, taskId, headers, fetchImpl, timeoutMs) {
  const controller = new AbortController()
  let response
  let reader
  let complete = false
  let cancellation = Promise.resolve()
  const timer = setTimeout(() => {
    controller.abort()
    // Cancel a stalled body as well as the initial fetch; await cleanup below.
    if (reader) cancellation = reader.cancel().catch(() => {})
  }, Math.min(timeoutMs, 30000))
  try {
    // Construct fresh headers. Never forward API credentials, cookies or caller headers to the CDN.
    response = await fetchImpl(image, {
      method: 'GET',
      headers: { Accept: [...IMAGE_DOWNLOAD_TYPES.keys()].join(', ') },
      credentials: 'omit',
      redirect: 'manual',
      signal: controller.signal,
    })
    if (response.status >= 300 && response.status < 400) throw new HttpError(502, 'image_redirect_denied', '图片下载地址发生跳转，暂时无法下载，请稍后重试。')
    if (response.status !== 200 || !response.body) throw new HttpError(502, 'image_download_failed', '图片文件暂时无法下载，链接可能已过期，请稍后重试。')
    const type = response.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase()
    if (!IMAGE_DOWNLOAD_TYPES.has(type)) throw new HttpError(502, 'invalid_image_type', '图片服务返回了不支持的文件格式，无法下载。')
    const length = response.headers.get('Content-Length')
    if (length !== null && (!/^\d+$/.test(length) || !Number.isSafeInteger(Number(length)))) throw new HttpError(502, 'invalid_image_file', '图片文件长度无效，请稍后重试。')
    if (length !== null && Number(length) > MAX_IMAGE_BYTES) throw new HttpError(413, 'image_too_large', '图片超过 32 MiB 下载上限，请选择较低分辨率重新生成。')

    // Validate the entire bounded input before sending headers so oversized/failed
    // downloads still return a readable JSON error, including without Content-Length.
    // Keep chunks for the response stream instead of allocating a second full buffer.
    reader = response.body.getReader()
    const chunks = []
    const prefix = new Uint8Array(256)
    let size = 0
    let prefixSize = 0
    let block = new Uint8Array(64 * 1024)
    let blockSize = 0
    while (true) {
      const { done, value } = await reader.read()
      if (controller.signal.aborted) throw new HttpError(504, 'image_download_timeout', '图片下载超时，请稍后重试。')
      if (done) break
      size += value.byteLength
      if (size > MAX_IMAGE_BYTES) throw new HttpError(413, 'image_too_large', '图片超过 32 MiB 下载上限，请选择较低分辨率重新生成。')
      if (!value.byteLength) continue
      const prefixChunk = value.subarray(0, prefix.length - prefixSize)
      prefix.set(prefixChunk, prefixSize)
      prefixSize += prefixChunk.byteLength
      // Coalesce tiny network chunks so their bookkeeping is bounded too.
      for (let offset = 0; offset < value.byteLength;) {
        const count = Math.min(block.length - blockSize, value.byteLength - offset)
        block.set(value.subarray(offset, offset + count), blockSize)
        offset += count
        blockSize += count
        if (blockSize === block.length) {
          chunks.push(block)
          block = new Uint8Array(64 * 1024)
          blockSize = 0
        }
      }
    }
    if (!size || (length !== null && size !== Number(length)) || !imageSignatureMatches(prefix.subarray(0, prefixSize), type)) throw new HttpError(502, 'invalid_image_file', '图片文件内容无效或下载不完整，请稍后重试。')
    if (blockSize) chunks.push(block.subarray(0, blockSize))
    complete = true
    const downloadHeaders = new Headers(headers)
    downloadHeaders.set('Content-Type', type)
    downloadHeaders.set('Content-Length', String(size))
    downloadHeaders.set('Content-Disposition', `attachment; filename="fozuai-${taskId}.${IMAGE_DOWNLOAD_TYPES.get(type)}"`)
    downloadHeaders.set('Access-Control-Expose-Headers', 'Content-Disposition, Content-Type, Content-Length')
    let index = 0
    const body = new ReadableStream({
      pull(stream) {
        if (index === chunks.length) {
          stream.close()
          return
        }
        stream.enqueue(chunks[index])
        chunks[index++] = null
      },
      cancel() { chunks.length = 0 },
    })
    return new Response(body, { headers: downloadHeaders })
  } catch (error) {
    if (controller.signal.aborted) throw new HttpError(504, 'image_download_timeout', '图片下载超时，请稍后重试。')
    if (error instanceof HttpError) throw error
    throw new HttpError(502, 'image_download_failed', '图片文件暂时无法下载，请稍后重试。')
  } finally {
    clearTimeout(timer)
    await cancellation
    if (reader) {
      if (!complete) await reader.cancel().catch(() => {})
      reader.releaseLock()
    } else if (response?.body) {
      await response.body.cancel().catch(() => {})
    }
  }
}

export async function handleRequest(request, env, fetchImpl = fetch, timeoutMs = 90000) {
  const headers = responseHeaders(request, env)
  const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers })
  try {
    const origin = request.headers.get('Origin')
    if (origin && !isAllowedOrigin(origin, env)) throw new HttpError(403, 'origin_not_allowed', '此网站无权访问服务。')
    const url = new URL(request.url)
    const isChat = ['/chat/completions', '/v1/chat/completions'].includes(url.pathname)
    const isImage = url.pathname === '/v1/images/generations'
    const isUpload = url.pathname === '/v1/uploads/images'
    const taskMatch = /^\/v1\/tasks\/([A-Za-z0-9_-]{1,128})(\/image)?$/.exec(url.pathname)
    const isHealth = url.pathname === '/health'
    if (!isChat && !isImage && !isUpload && !taskMatch && !isHealth) throw new HttpError(404, 'not_found', '接口不存在。')
    if (url.search) invalid('请求地址不能包含查询参数。')
    const method = isChat || isImage || isUpload ? 'POST' : 'GET'
    if (request.method === 'OPTIONS') {
      const requestedMethod = request.headers.get('Access-Control-Request-Method')
      const requestedHeaders = (request.headers.get('Access-Control-Request-Headers') || '').split(',').map((value) => value.trim().toLowerCase()).filter(Boolean)
      if (!origin || requestedMethod !== method || requestedHeaders.some((header) => !['content-type', 'x-fozu-access-key'].includes(header))) {
        throw new HttpError(403, 'preflight_denied', '请求方式或请求头不受支持。')
      }
      headers.set('Access-Control-Allow-Methods', `${method}, OPTIONS`)
      // Accept the unused legacy header while cached frontends update.
      headers.set('Access-Control-Allow-Headers', 'Content-Type, X-Fozu-Access-Key')
      headers.set('Access-Control-Max-Age', '600')
      return new Response(null, { status: 204, headers })
    }
    if (request.method !== method) {
      headers.set('Allow', `${method}, OPTIONS`)
      throw new HttpError(405, 'method_not_allowed', '请求方式不受支持。')
    }
    if (isHealth) return json({ status: 'ok', configured: { chat: configuredSecret(env.DEEPSEEK_API_KEY), image: configuredSecret(env.APIMART_API_KEY) } })
    if (isChat) {
      const payload = chatPayload(await requestBody(request, MAX_CHAT_REQUEST_BYTES), env)
      const root = upstreamRoot(env.DEEPSEEK_BASE_URL, 'https://api.deepseek.com')
      return json(chatResult(await upstreamRequest(`${root}/chat/completions`, 'POST', payload, env.DEEPSEEK_API_KEY, fetchImpl, timeoutMs), env))
    }
    const root = upstreamRoot(env.APIMART_BASE_URL, 'https://api.apimart.ai')
    if (isUpload) {
      const form = await referenceUploadBody(request)
      const result = await upstreamRequest(`${root}/uploads/images`, 'POST', form, env.APIMART_API_KEY, fetchImpl, timeoutMs)
      if (!isUploadedReferenceUrl(result.url) || secretValues(env).some((key) => result.url.includes(key))) invalidResponse()
      return json({ url: result.url })
    }
    if (isImage) {
      const payload = imagePayload(await requestBody(request), env)
      return json(imageSubmission(await upstreamRequest(`${root}/images/generations`, 'POST', payload, env.APIMART_API_KEY, fetchImpl, timeoutMs), env))
    }
    const task = taskResult(await upstreamRequest(`${root}/tasks/${taskMatch[1]}`, 'GET', null, env.APIMART_API_KEY, fetchImpl, timeoutMs), taskMatch[1], env)
    if (taskMatch[2]) {
      if (task.data.status !== 'completed') throw new HttpError(409, 'image_not_ready', task.data.error?.message || '图片尚未生成完成，请等待完成后再下载。')
      return await downloadTaskImage(task.data.result.images[0].url[0], taskMatch[1], headers, fetchImpl, timeoutMs)
    }
    return json(task)
  } catch (error) {
    if (error instanceof HttpError) return json({ error: { code: error.code, message: error.message } }, error.status)
    return json({ error: { code: 'internal_error', message: '服务暂时不可用，请稍后重试。' } }, 500)
  }
}

export default {
  fetch(request, env) {
    return handleRequest(request, env)
  },
}
