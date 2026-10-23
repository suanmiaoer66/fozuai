import test from 'node:test'
import assert from 'node:assert/strict'
import { handleRequest } from './index.js'

const env = {
  ALLOWED_ORIGIN: 'https://suanmiaoer66.github.io',
  DEEPSEEK_API_KEY: 'deepseek-secret',
  APIMART_API_KEY: 'apimart-secret',
  DEEPSEEK_BASE_URL: 'https://api.deepseek.com',
  DEEPSEEK_CHAT_MODEL: 'deepseek-flash',
  DEEPSEEK_REASONING_MODEL: 'deepseek-v4-pro',
  DEEPSEEK_VISION_MODEL: 'deepseek-flash',
  APIMART_BASE_URL: 'https://api.apimart.ai',
  APIMART_IMAGE_MODEL: 'gpt-image-2',
  APIMART_IMAGE_SIZE: '1:1',
  APIMART_IMAGE_RESOLUTION: '1k',
}

function request(path, { method = 'POST', body, key, origin = env.ALLOWED_ORIGIN, contentType = 'application/json' } = {}) {
  const headers = { Origin: origin }
  if (key) headers['X-Fozu-Access-Key'] = key
  if (contentType) headers['Content-Type'] = contentType
  return new Request(`https://fozuai-api.example${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

const jsonResponse = (value, status = 200, headers = {}) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json', ...headers } })
const read = async (response) => response.json()

test('chat success maps Chinese model alias and removes upstream extras', async () => {
  let call
  const response = await handleRequest(request('/v1/chat/completions', {
    body: { model: '高级佛祖模型', messages: [{ role: 'user', content: '你好' }], tools: [{ type: 'function' }] },
  }), env, async (url, options) => {
    call = { url, options }
    return jsonResponse({ choices: [{ message: { role: 'assistant', content: '你好，佛祖 AI 在。' } }], usage: { total_tokens: 99 } })
  })
  assert.equal(response.status, 200)
  assert.equal(call.url, 'https://api.deepseek.com/v1/chat/completions')
  assert.equal(call.options.headers.Authorization, 'Bearer deepseek-secret')
  assert.deepEqual(JSON.parse(call.options.body), {
    model: 'deepseek-v4-pro', messages: [{ role: 'user', content: '你好' }], stream: false, max_tokens: 16384,
    thinking: { type: 'enabled' }, reasoning_effort: 'high',
  })
  assert.deepEqual(await read(response), { choices: [{ message: { role: 'assistant', content: '你好，佛祖 AI 在。' } }] })
})

test('fast and legacy model mappings use configured IDs safely', async () => {
  const calls = []
  const fetchImpl = async (url, options) => {
    calls.push(JSON.parse(options.body))
    return jsonResponse({ choices: [{ message: { content: 'ok' } }] })
  }
  const fast = await handleRequest(request('/chat/completions', { body: { model: '导管佛祖模型', messages: [{ role: 'user', content: 'hi' }] } }), env, fetchImpl)
  assert.equal(fast.status, 200)
  assert.deepEqual(calls[0], { model: 'deepseek-flash', messages: [{ role: 'user', content: 'hi' }], stream: false, max_tokens: 8192, thinking: { type: 'disabled' } })
  const legacy = await handleRequest(request('/chat/completions', { body: { model: 'deepseek-reasoner', messages: [{ role: 'user', content: 'hi' }] } }), { ...env, DEEPSEEK_REASONING_MODEL: 'deepseek-reasoner' }, fetchImpl)
  assert.equal(legacy.status, 200)
  assert.deepEqual(calls[1], { model: 'deepseek-reasoner', messages: [{ role: 'user', content: 'hi' }], stream: false, max_tokens: 4096 })
  const unsafe = await handleRequest(request('/chat/completions', { body: { model: '高级佛祖模型', messages: [{ role: 'user', content: 'hi' }] } }), { ...env, DEEPSEEK_REASONING_MODEL: 'https://attacker.example' }, fetchImpl)
  assert.equal(unsafe.status, 400)
})

test('chat needs no site password even when a legacy secret remains deployed', async () => {
  let calls = 0
  for (const key of [undefined, 'outdated-password']) {
    const response = await handleRequest(request('/chat/completions', { key, body: { model: '导管佛祖模型', messages: [{ role: 'user', content: 'hi' }] } }), { ...env, SITE_ACCESS_KEY: 'old-site-secret' }, async () => {
      calls += 1
      return jsonResponse({ choices: [{ message: { content: '可以直接使用。' } }] })
    })
    assert.equal(response.status, 200)
    assert.equal((await read(response)).choices[0].message.content, '可以直接使用。')
  }
  assert.equal(calls, 2)
})

test('CORS preflight allows only the frontend origin and required headers', async () => {
  const preflight = new Request('https://fozuai-api.example/chat/completions', {
    method: 'OPTIONS',
    headers: {
      Origin: env.ALLOWED_ORIGIN,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'content-type',
    },
  })
  const response = await handleRequest(preflight, env)
  assert.equal(response.status, 204)
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), env.ALLOWED_ORIGIN)
  assert.match(response.headers.get('Access-Control-Allow-Headers'), /Content-Type/)

  const denied = await handleRequest(request('/chat/completions', { origin: 'https://evil.example', body: { model: 'deepseek-chat', messages: [{ role: 'user', content: 'hi' }] } }), env)
  assert.equal(denied.status, 403)
})

test('image submission and polling need no password and return only safe fields', async () => {
  const calls = []
  const submit = await handleRequest(request('/v1/images/generations', { body: { model: 'gpt-image-2', prompt: '一朵莲花', size: '16:9', resolution: '2k', official_fallback: true } }), env, async (url, options) => {
    calls.push({ url, options })
    return jsonResponse({ code: 200, data: [{ status: 'submitted', task_id: 'task_abc123' }], secret: 'apimart-secret' })
  })
  assert.equal(submit.status, 200)
  assert.deepEqual(await read(submit), { code: 200, data: [{ status: 'submitted', task_id: 'task_abc123' }] })
  assert.deepEqual(JSON.parse(calls[0].options.body), { model: 'gpt-image-2', prompt: '一朵莲花', n: 1, size: '16:9', resolution: '2k' })

  const task = await handleRequest(request('/v1/tasks/task_abc123', { method: 'GET' }), env, async (url) => {
    assert.equal(url, 'https://api.apimart.ai/v1/tasks/task_abc123')
    return jsonResponse({ data: { status: 'completed', progress: 100, result: { images: [{ url: ['https://upload.apimart.ai/image.png'] }] }, key: 'apimart-secret' } })
  })
  assert.equal(task.status, 200)
  assert.deepEqual(await read(task), { code: 200, data: { id: 'task_abc123', status: 'completed', progress: 100, result: { images: [{ url: ['https://upload.apimart.ai/image.png'] }] } } })
})

test('bad upstream hosts, redirects, oversized input, and invalid image URLs fail safely', async () => {
  const badHost = await handleRequest(request('/chat/completions', { body: { model: 'deepseek-chat', messages: [{ role: 'user', content: 'hi' }] } }), { ...env, DEEPSEEK_BASE_URL: 'https://attacker.example' }, async () => { throw new Error('should not call') })
  assert.equal(badHost.status, 503)

  let called = false
  const redirected = await handleRequest(request('/chat/completions', { body: { model: 'deepseek-chat', messages: [{ role: 'user', content: 'hi' }] } }), env, async () => { called = true; return new Response(null, { status: 302, headers: { Location: 'https://attacker.example/?key=deepseek-secret' } }) })
  assert.equal(redirected.status, 502)
  assert.equal(called, true)
  assert.doesNotMatch(await redirected.text(), /deepseek-secret/)

  const oversized = await handleRequest(request('/chat/completions', { body: { model: 'deepseek-chat', messages: [{ role: 'user', content: 'x'.repeat(70000) }] } }), env)
  assert.equal(oversized.status, 400)

  const unsafeImage = await handleRequest(request('/v1/tasks/task_unsafe', { method: 'GET' }), env, async () => jsonResponse({ data: { status: 'completed', result: { images: [{ url: ['http://127.0.0.1/image.png'] }] } } }))
  assert.equal(unsafeImage.status, 502)
})

test('health reports configuration state without secrets', async () => {
  const response = await handleRequest(request('/health', { method: 'GET' }), env)
  assert.equal(response.status, 200)
  assert.deepEqual(await read(response), { status: 'ok', configured: { chat: true, image: true } })
})

test('missing server configuration fails closed with CORS on errors', async () => {
  let calls = 0
  const fetchImpl = async () => { calls += 1; return jsonResponse({}) }
  const body = { model: 'deepseek-chat', messages: [{ role: 'user', content: 'hi' }] }
  for (const [path, options, missing] of [
    ['/chat/completions', { body }, 'DEEPSEEK_API_KEY'],
    ['/v1/images/generations', { body: { prompt: '莲花' } }, 'APIMART_API_KEY'],
    ['/v1/tasks/task_any', { method: 'GET' }, 'APIMART_API_KEY'],
  ]) {
    const response = await handleRequest(request(path, options), { ...env, [missing]: '' }, fetchImpl)
    assert.equal(response.status, 503)
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), env.ALLOWED_ORIGIN)
    assert.equal(response.headers.get('Cache-Control'), 'no-store')
  }
  assert.equal(calls, 0)
})

test('invalid models, oversized bodies and image parameter errors never reach upstream', async () => {
  let calls = 0
  const fetchImpl = async () => { calls += 1; return jsonResponse({}) }
  for (const model of ['unknown-model', '__proto__', 'constructor', ['deepseek-chat']]) {
    const response = await handleRequest(request('/chat/completions', { body: { model, messages: [{ role: 'user', content: 'hi' }] } }), env, fetchImpl)
    assert.equal(response.status, 400)
  }
  const tooLarge = await handleRequest(request('/chat/completions', { body: { ignored: 'x'.repeat(130 * 1024) } }), env, fetchImpl)
  assert.equal(tooLarge.status, 413)
  for (const options of [{ n: 2 }, { n: '1' }, { resolution: '8k' }, { size: '9999x9999' }, { model: 'anything-else' }]) {
    const response = await handleRequest(request('/v1/images/generations', { body: { prompt: '莲花', ...options } }), env, fetchImpl)
    assert.equal(response.status, 400)
  }
  assert.equal(calls, 0)
})

test('upstream failures do not leak credentials and successful text redacts secrets', async () => {
  const body = { model: 'deepseek-chat', messages: [{ role: 'user', content: 'hi' }] }
  for (const status of [401, 402, 429, 500]) {
    const response = await handleRequest(request('/chat/completions', { body }), env, async () => jsonResponse({ error: { message: `credential=${env.DEEPSEEK_API_KEY}` } }, status))
    assert.equal(response.status, [402, 429].includes(status) ? 429 : 502)
    assert.doesNotMatch(await response.text(), /deepseek-secret/)
  }
  const legacyEnv = { ...env, SITE_ACCESS_KEY: 'old-site-secret' }
  const response = await handleRequest(request('/chat/completions', { body }), legacyEnv, async () => jsonResponse({ choices: [{ message: { content: `echo: ${env.DEEPSEEK_API_KEY} ${env.APIMART_API_KEY} ${legacyEnv.SITE_ACCESS_KEY}` } }] }))
  assert.equal(response.status, 200)
  assert.equal((await read(response)).choices[0].message.content, 'echo: [已隐藏] [已隐藏] [已隐藏]')
})

test('upstream timeout maps to 504 and versioned base does not duplicate /v1', async () => {
  let upstreamUrl
  const response = await handleRequest(request('/chat/completions', { body: { model: 'deepseek-chat', messages: [{ role: 'user', content: 'hi' }] } }), { ...env, DEEPSEEK_BASE_URL: 'https://api.deepseek.com/v1/' }, async (url, options) => {
    upstreamUrl = url
    return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }))
  }, 5)
  assert.equal(response.status, 504)
  assert.equal(upstreamUrl, 'https://api.deepseek.com/v1/chat/completions')
})
