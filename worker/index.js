const DEFAULT_ORIGIN = 'https://suanmiaoer66.github.io'
const MAX_REQUEST_BYTES = 128 * 1024
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024
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

function responseHeaders(request, env) {
  const headers = new Headers({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    Vary: 'Origin',
  })
  if (request.headers.get('Origin') === (env.ALLOWED_ORIGIN || DEFAULT_ORIGIN)) {
    headers.set('Access-Control-Allow-Origin', request.headers.get('Origin'))
  }
  return headers
}

async function authorize(request, env) {
  const expectedSecret = typeof env.SITE_ACCESS_KEY === 'string' ? env.SITE_ACCESS_KEY.trim() : ''
  if (!configuredSecret(expectedSecret)) {
    throw new HttpError(503, 'not_configured', '网站访问口令尚未配置，请联系网站管理员。')
  }
  const supplied = (request.headers.get('X-Fozu-Access-Key') || '').trim()
  if (!supplied || supplied.length > 512 || expectedSecret.length > 512) {
    throw new HttpError(401, 'unauthorized', '请填写正确的网站访问口令。')
  }
  // Compare fixed-length digests so matching prefixes do not change comparison work.
  const encoder = new TextEncoder()
  const [expected, actual] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(expectedSecret)),
    crypto.subtle.digest('SHA-256', encoder.encode(supplied)),
  ])
  const expectedBytes = new Uint8Array(expected)
  const actualBytes = new Uint8Array(actual)
  let difference = 0
  for (let index = 0; index < expectedBytes.length; index += 1) difference |= expectedBytes[index] ^ actualBytes[index]
  if (difference !== 0) throw new HttpError(401, 'unauthorized', '请填写正确的网站访问口令。')
}

async function readJson(body, maxBytes, upstream = false) {
  const fail = () => {
    throw new HttpError(upstream ? 502 : 400, upstream ? 'invalid_upstream_response' : 'invalid_json', upstream ? '模型服务返回了无法识别的内容。' : '请求必须是有效的 JSON。')
  }
  if (!body) fail()
  const reader = body.getReader()
  const chunks = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > maxBytes) {
        await reader.cancel()
        throw new HttpError(upstream ? 502 : 413, upstream ? 'invalid_upstream_response' : 'payload_too_large', upstream ? '模型服务返回的内容过大。' : '输入内容过长，请缩短后重试。')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  let data
  try {
    data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  } catch {
    fail()
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) fail()
  return data
}

async function requestBody(request) {
  if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    throw new HttpError(415, 'unsupported_media_type', '请使用 application/json 发送请求。')
  }
  return readJson(request.body, MAX_REQUEST_BYTES)
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

function chatPayload(data, env) {
  const resolved = resolveChatModel(data.model, env)
  if (!resolved || !SUPPORTED_DEEPSEEK_MODELS.has(resolved.model)) invalid('请选择支持的对话模型。')
  const { model, advanced } = resolved
  if (data.stream !== undefined && data.stream !== false) invalid('暂不支持流式请求。')
  if (!Array.isArray(data.messages) || data.messages.length < 1 || data.messages.length > 50) invalid('对话消息数量须在 1 到 50 条之间。')
  let length = 0
  const messages = data.messages.map((message) => {
    if (!message || !['system', 'user', 'assistant'].includes(message.role) || typeof message.content !== 'string' || !message.content.trim() || message.content.length > 16000) invalid('每条对话必须包含有效角色及不超过 16000 字的文本。')
    length += message.content.length
    return { role: message.role, content: message.content }
  })
  if (length > 64000 || !messages.some((message) => message.role === 'user')) invalid('对话内容过长或缺少用户消息。')
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
  return { model, prompt: data.prompt.trim(), n: 1, size, resolution }
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
      headers: { Authorization: `Bearer ${key}`, Accept: 'application/json', ...(payload ? { 'Content-Type': 'application/json' } : {}) },
      ...(payload ? { body: JSON.stringify(payload) } : {}),
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

export async function handleRequest(request, env, fetchImpl = fetch, timeoutMs = 90000) {
  const headers = responseHeaders(request, env)
  const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers })
  try {
    const origin = request.headers.get('Origin')
    if (origin && origin !== (env.ALLOWED_ORIGIN || DEFAULT_ORIGIN)) throw new HttpError(403, 'origin_not_allowed', '此网站无权访问服务。')
    const url = new URL(request.url)
    const isChat = ['/chat/completions', '/v1/chat/completions'].includes(url.pathname)
    const isImage = url.pathname === '/v1/images/generations'
    const taskMatch = /^\/v1\/tasks\/([A-Za-z0-9_-]{1,128})$/.exec(url.pathname)
    const isHealth = url.pathname === '/health'
    if (!isChat && !isImage && !taskMatch && !isHealth) throw new HttpError(404, 'not_found', '接口不存在。')
    if (url.search) invalid('请求地址不能包含查询参数。')
    const method = isChat || isImage ? 'POST' : 'GET'
    if (request.method === 'OPTIONS') {
      const requestedMethod = request.headers.get('Access-Control-Request-Method')
      const requestedHeaders = (request.headers.get('Access-Control-Request-Headers') || '').split(',').map((value) => value.trim().toLowerCase()).filter(Boolean)
      if (!origin || requestedMethod !== method || requestedHeaders.some((header) => !['content-type', 'x-fozu-access-key'].includes(header))) {
        throw new HttpError(403, 'preflight_denied', '请求方式或请求头不受支持。')
      }
      headers.set('Access-Control-Allow-Methods', `${method}, OPTIONS`)
      headers.set('Access-Control-Allow-Headers', 'Content-Type, X-Fozu-Access-Key')
      headers.set('Access-Control-Max-Age', '600')
      return new Response(null, { status: 204, headers })
    }
    if (request.method !== method) {
      headers.set('Allow', `${method}, OPTIONS`)
      throw new HttpError(405, 'method_not_allowed', '请求方式不受支持。')
    }
    if (isHealth) return json({ status: 'ok', configured: { chat: configuredSecret(env.DEEPSEEK_API_KEY), image: configuredSecret(env.APIMART_API_KEY), access: configuredSecret(env.SITE_ACCESS_KEY) } })
    await authorize(request, env)
    if (isChat) {
      const payload = chatPayload(await requestBody(request), env)
      const root = upstreamRoot(env.DEEPSEEK_BASE_URL, 'https://api.deepseek.com')
      return json(chatResult(await upstreamRequest(`${root}/chat/completions`, 'POST', payload, env.DEEPSEEK_API_KEY, fetchImpl, timeoutMs), env))
    }
    const root = upstreamRoot(env.APIMART_BASE_URL, 'https://api.apimart.ai')
    if (isImage) {
      const payload = imagePayload(await requestBody(request), env)
      return json(imageSubmission(await upstreamRequest(`${root}/images/generations`, 'POST', payload, env.APIMART_API_KEY, fetchImpl, timeoutMs), env))
    }
    return json(taskResult(await upstreamRequest(`${root}/tasks/${taskMatch[1]}`, 'GET', null, env.APIMART_API_KEY, fetchImpl, timeoutMs), taskMatch[1], env))
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
