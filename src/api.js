export class ApiError extends Error {
  constructor(message, code = 'request_failed', status) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = status
  }
}

export function getApiConfig(env = {}) {
  return {
    chatProxyUrl: (env.VITE_DEEPSEEK_API_PROXY_URL || '').trim().replace(/\/+$/, ''),
    imageProxyUrl: (env.VITE_IMAGE_API_PROXY_URL || '').trim().replace(/\/+$/, ''),
    imageModel: env.VITE_APIMART_IMAGE_MODEL || 'gpt-image-2',
    imageSize: env.VITE_APIMART_IMAGE_SIZE || '1:1',
    imageResolution: env.VITE_APIMART_IMAGE_RESOLUTION || '1k',
  }
}

function requestHeaders(accessKey, json = false) {
  const headers = json ? { 'Content-Type': 'application/json' } : {}
  if (accessKey?.trim()) headers['X-Fozu-Access-Key'] = accessKey.trim()
  return headers
}

async function requestJson(url, options, fetchImpl) {
  let response
  try {
    response = await fetchImpl(url, options)
  } catch (error) {
    if (error.name === 'AbortError' || options.signal?.aborted) throw error
    throw new ApiError('无法连接服务，请检查网络后重试；若持续失败，请联系网站管理员检查服务地址。', 'network_error')
  }

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new ApiError('访问口令缺失或不正确，请在左下角设置中填写网站访问口令后重试。', 'unauthorized', response.status)
    }
    if (response.status === 429) throw new ApiError('请求过于频繁或服务额度不足，请稍后重试。', 'rate_limited', response.status)
    if (response.status === 404) throw new ApiError('服务地址无法使用，请联系网站管理员检查接口配置。', 'not_found', response.status)
    if (response.status >= 500) throw new ApiError('服务暂时不可用，请稍后重试；若持续失败，请联系网站管理员检查服务配置与账户额度。', 'service_error', response.status)
    throw new ApiError(`请求未成功（${response.status}），请检查输入后重试。`, 'request_failed', response.status)
  }

  try {
    return await response.json()
  } catch (error) {
    if (options.signal?.aborted) throw error
    throw new ApiError('服务返回了无法识别的内容，请联系网站管理员检查接口配置。', 'invalid_response')
  }
}

export async function requestChat({ config, messages, model, accessKey, signal, fetchImpl = fetch }) {
  if (!config.chatProxyUrl) throw new ApiError('对话服务尚未配置，请联系网站管理员连接对话服务。', 'not_configured')
  const data = await requestJson(`${config.chatProxyUrl}/chat/completions`, {
    method: 'POST',
    headers: requestHeaders(accessKey, true),
    signal,
    body: JSON.stringify({ model, messages, stream: false }),
  }, fetchImpl)
  const content = data?.choices?.[0]?.message?.content
  if (typeof content !== 'string' || !content.trim()) {
    throw new ApiError('服务未返回有效回复，请重试或联系网站管理员检查模型配置。', 'invalid_response')
  }
  return content
}

function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason || new DOMException('Aborted', 'AbortError'))
    const abort = () => {
      clearTimeout(timer)
      reject(signal.reason || new DOMException('Aborted', 'AbortError'))
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort)
      resolve()
    }, ms)
    signal?.addEventListener('abort', abort, { once: true })
  })
}

export async function requestImage({ config, prompt, accessKey, signal, fetchImpl = fetch, pollInterval = 2500, maxAttempts = 120 }) {
  if (!config.imageProxyUrl) throw new ApiError('图片服务尚未配置，请联系网站管理员连接图片服务。', 'not_configured')
  const apiRoot = config.imageProxyUrl.endsWith('/v1') ? config.imageProxyUrl : `${config.imageProxyUrl}/v1`
  const submitData = await requestJson(`${apiRoot}/images/generations`, {
    method: 'POST',
    headers: requestHeaders(accessKey, true),
    signal,
    body: JSON.stringify({ model: config.imageModel, prompt, n: 1, size: config.imageSize, resolution: config.imageResolution }),
  }, fetchImpl)
  const taskId = submitData?.data?.[0]?.task_id
  if (typeof taskId !== 'string' || !taskId) throw new ApiError('图片任务未能创建，请重试或联系网站管理员检查图片服务。', 'invalid_response')

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    await delay(pollInterval, signal)
    const taskData = await requestJson(`${apiRoot}/tasks/${encodeURIComponent(taskId)}`, {
      headers: requestHeaders(accessKey),
      signal,
    }, fetchImpl)
    const task = taskData?.data
    if (task?.status === 'completed') {
      const urls = task?.result?.images?.[0]?.url
      const imageUrl = Array.isArray(urls) ? urls[0] : urls
      if (typeof imageUrl !== 'string' || !/^https?:\/\//i.test(imageUrl)) throw new ApiError('图片任务已完成，但未返回有效图片地址。', 'invalid_response')
      return imageUrl
    }
    if (task?.status === 'failed' || task?.status === 'cancelled') throw new ApiError('图片生成未成功，请调整描述后重试；若持续失败，请联系网站管理员检查服务状态。', 'generation_failed')
    if (!['pending', 'processing', 'queued', 'running', 'submitted'].includes(task?.status)) throw new ApiError('无法获取图片任务状态，请联系网站管理员检查图片服务。', 'invalid_response')
  }
  throw new ApiError('图片仍在生成，等待时间已超过五分钟。请稍后查询任务，避免重复提交。', 'timeout')
}
