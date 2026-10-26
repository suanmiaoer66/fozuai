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

test('explicit CORS list allows the new and existing sites while echoing only the requesting origin', async () => {
  const newOrigin = 'https://assistant.example'
  const migrationEnv = { ...env, ALLOWED_ORIGINS: ` ${newOrigin}, ${env.ALLOWED_ORIGIN} ` }
  let calls = 0
  for (const origin of [newOrigin, env.ALLOWED_ORIGIN]) {
    const response = await handleRequest(request('/chat/completions', {
      origin, body: { model: '导管佛祖模型', messages: [{ role: 'user', content: '你好' }] },
    }), migrationEnv, async () => {
      calls += 1
      return jsonResponse({ choices: [{ message: { content: '可以使用。' } }] })
    })
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), origin)
    assert.equal(response.headers.get('Vary'), 'Origin')
    assert.equal((await read(response)).choices[0].message.content, '可以使用。')
  }
  assert.equal(calls, 2)
})

test('both CORS origins can preflight chat and image endpoints with matching headers', async () => {
  const origins = ['https://assistant.example', env.ALLOWED_ORIGIN]
  const migrationEnv = { ...env, ALLOWED_ORIGINS: origins.join(',') }
  for (const origin of origins) {
    for (const path of ['/chat/completions', '/v1/images/generations']) {
      const response = await handleRequest(new Request(`https://fozuai-api.example${path}`, {
        method: 'OPTIONS',
        headers: { Origin: origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' },
      }), migrationEnv, async () => assert.fail('preflight must not call an upstream'))
      assert.equal(response.status, 204)
      assert.equal(response.headers.get('Access-Control-Allow-Origin'), origin)
      assert.equal(response.headers.get('Access-Control-Allow-Methods'), 'POST, OPTIONS')
      assert.match(response.headers.get('Access-Control-Allow-Headers'), /Content-Type/)
      assert.equal(response.headers.get('Vary'), 'Origin')
    }
  }
})

test('an explicit CORS list rejects unlisted sites and does not silently add the legacy origin', async () => {
  const migrationEnv = { ...env, ALLOWED_ORIGINS: 'https://assistant.example' }
  for (const origin of [env.ALLOWED_ORIGIN, 'https://evil.example', 'https://assistant.example.evil.example', 'null']) {
    for (const method of ['GET', 'OPTIONS']) {
      const response = await handleRequest(new Request('https://fozuai-api.example/health', {
        method,
        headers: { Origin: origin, 'Access-Control-Request-Method': 'GET' },
      }), migrationEnv, async () => assert.fail('denied origin must not call an upstream'))
      assert.equal(response.status, 403)
      assert.equal(response.headers.get('Access-Control-Allow-Origin'), null)
      assert.equal((await read(response)).error.code, 'origin_not_allowed')
    }
  }
})

test('missing or blank CORS lists fall back to the legacy origin and then the GitHub origin', async () => {
  const legacy = 'https://legacy.example'
  for (const configuredList of [undefined, '', '   ']) {
    const legacyResponse = await handleRequest(request('/health', { method: 'GET', origin: legacy }), {
      ...env, ALLOWED_ORIGINS: configuredList, ALLOWED_ORIGIN: ` ${legacy} `,
    })
    assert.equal(legacyResponse.status, 200)
    assert.equal(legacyResponse.headers.get('Access-Control-Allow-Origin'), legacy)
    const defaultResponse = await handleRequest(request('/health', { method: 'GET' }), {
      ...env, ALLOWED_ORIGINS: configuredList, ALLOWED_ORIGIN: '',
    })
    assert.equal(defaultResponse.status, 200)
    assert.equal(defaultResponse.headers.get('Access-Control-Allow-Origin'), env.ALLOWED_ORIGIN)
  }
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

const pngBytes = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jJ1sAAAAASUVORK5CYII=', 'base64'))
const completedTask = (image = 'https://upload.apimart.ai/output.png?signature=public-download') => jsonResponse({ data: { status: 'completed', result: { images: [{ url: [image] }] } } })

test('image download returns an attachment and never forwards credentials to the CDN', async () => {
  const calls = []
  const downloadRequest = request('/v1/tasks/task_download/image', { method: 'GET', key: 'caller-site-key' })
  downloadRequest.headers.set('Authorization', 'Bearer caller-token')
  downloadRequest.headers.set('Cookie', 'session=caller-cookie')
  const response = await handleRequest(downloadRequest, env, async (url, options) => {
    calls.push({ url, options })
    if (calls.length === 1) return completedTask()
    return new Response(pngBytes, { headers: { 'Content-Type': 'image/png; charset=binary', 'Content-Length': String(pngBytes.length), 'Set-Cookie': 'secret=cdn-cookie', Authorization: 'cdn-secret' } })
  })
  assert.equal(response.status, 200)
  assert.equal(calls[0].url, 'https://api.apimart.ai/v1/tasks/task_download')
  assert.equal(calls[0].options.headers.Authorization, `Bearer ${env.APIMART_API_KEY}`)
  assert.equal(calls[1].url, 'https://upload.apimart.ai/output.png?signature=public-download')
  assert.deepEqual(Object.keys(calls[1].options.headers), ['Accept'])
  assert.equal(calls[1].options.credentials, 'omit')
  assert.equal(calls[1].options.redirect, 'manual')
  assert.doesNotMatch(JSON.stringify(calls[1].options), /apimart-secret|deepseek-secret|caller-/)
  assert.equal(response.headers.get('Content-Type'), 'image/png')
  assert.equal(response.headers.get('Content-Disposition'), 'attachment; filename="fozuai-task_download.png"')
  assert.equal(response.headers.get('Content-Length'), String(pngBytes.length))
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), env.ALLOWED_ORIGIN)
  assert.match(response.headers.get('Access-Control-Expose-Headers'), /Content-Disposition, Content-Type/)
  assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff')
  assert.equal(response.headers.get('Set-Cookie'), null)
  assert.equal(response.headers.get('Authorization'), null)
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), pngBytes)
})

test('image download accepts supported formats without Content-Length and chooses safe filenames', async () => {
  const fixtures = [
    ['image/png', 'png', pngBytes],
    ['image/jpeg', 'jpg', new Uint8Array([255, 216, 255, 224, 0, 0])],
    ['image/gif', 'gif', new TextEncoder().encode('GIF89a')],
    ['image/webp', 'webp', new TextEncoder().encode('RIFF0000WEBP')],
    ['image/avif', 'avif', new Uint8Array([0, 0, 0, 24, ...new TextEncoder().encode('ftypavif'), 0, 0, 0, 0, ...new TextEncoder().encode('avifmif1')])],
  ]
  for (const [type, extension, bytes] of fixtures) {
    let calls = 0
    const response = await handleRequest(request('/v1/tasks/task_formats/image', { method: 'GET' }), env, async () => {
      if (++calls === 1) return completedTask()
      let index = 0
      return new Response(new ReadableStream({
        pull(controller) {
          if (index === bytes.length) return controller.close()
          controller.enqueue(bytes.subarray(index, ++index))
        },
      }), { headers: { 'Content-Type': type } })
    })
    assert.equal(response.status, 200, type)
    assert.equal(response.headers.get('Content-Type'), type)
    assert.equal(response.headers.get('Content-Disposition'), `attachment; filename="fozuai-task_formats.${extension}"`)
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes)
  }
})

test('image download waits for completed tasks and rejects arbitrary URL query parameters', async () => {
  for (const status of ['submitted', 'pending', 'processing', 'failed', 'cancelled']) {
    let calls = 0
    const response = await handleRequest(request('/v1/tasks/task_pending/image', { method: 'GET' }), env, async () => {
      calls += 1
      return jsonResponse({ data: { status } })
    })
    assert.equal(response.status, 409)
    assert.equal((await read(response)).error.code, 'image_not_ready')
    assert.equal(calls, 1)
  }
  let calls = 0
  const arbitrary = await handleRequest(request('/v1/tasks/task_download/image?url=https://attacker.example/file.png', { method: 'GET' }), env, async () => { calls++; return completedTask() })
  assert.equal(arbitrary.status, 400)
  assert.equal(calls, 0)
})

test('image download rejects unsafe or credential-bearing task URLs before fetching the CDN', async () => {
  for (const image of ['http://upload.apimart.ai/file.png', 'https://127.0.0.1/file.png', 'https://localhost/file.png', 'https://user:password@cdn.example/file.png', 'https://cdn.example/apimart-secret.png']) {
    let calls = 0
    const response = await handleRequest(request('/v1/tasks/task_unsafe/image', { method: 'GET' }), env, async () => { calls++; return completedTask(image) })
    assert.equal(response.status, 502)
    assert.doesNotMatch(await response.text(), /apimart-secret|password|127\.0\.0\.1/)
    assert.equal(calls, 1)
  }
})

test('image download refuses CDN redirects, failures, HTML, SVG and forged image MIME types', async () => {
  for (const makeResponse of [
    () => new Response('apimart-secret', { status: 302, headers: { Location: 'https://attacker.example/?key=apimart-secret' } }),
    () => new Response('apimart-secret', { status: 404 }),
    () => new Response('<html>apimart-secret</html>', { headers: { 'Content-Type': 'text/html' } }),
    () => new Response('<svg>apimart-secret</svg>', { headers: { 'Content-Type': 'image/svg+xml' } }),
    () => new Response('<html>apimart-secret</html>', { headers: { 'Content-Type': 'image/png' } }),
    () => new Response(pngBytes, { headers: { 'Content-Type': 'image/jpeg' } }),
    () => new Response(pngBytes, { headers: { 'Content-Type': 'application/octet-stream' } }),
  ]) {
    let calls = 0
    const response = await handleRequest(request('/v1/tasks/task_badcdn/image', { method: 'GET' }), env, async (_url, options) => {
      if (++calls === 1) return completedTask()
      assert.equal(options.redirect, 'manual')
      return makeResponse()
    })
    assert.equal(response.status, 502)
    assert.equal(calls, 2)
    assert.equal(response.headers.get('Content-Type'), 'application/json; charset=utf-8')
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), env.ALLOWED_ORIGIN)
    assert.doesNotMatch(await response.text(), /apimart-secret|attacker\.example/)
  }
})

test('image download enforces the 32 MiB limit for declared and unknown body sizes', async () => {
  for (const declaredLength of [String(32 * 1024 * 1024 + 1), null, '1']) {
    let calls = 0
    let cancelled = false
    let emitted = 0
    const chunk = new Uint8Array(1024 * 1024)
    chunk.set(pngBytes)
    const response = await handleRequest(request('/v1/tasks/task_large/image', { method: 'GET' }), env, async () => {
      if (++calls === 1) return completedTask()
      return new Response(new ReadableStream({
        pull(controller) {
          emitted++
          controller.enqueue(chunk)
        },
        cancel() { cancelled = true },
      }), { headers: { 'Content-Type': 'image/png', ...(declaredLength === null ? {} : { 'Content-Length': declaredLength }) } })
    })
    assert.equal(response.status, 413)
    assert.equal((await read(response)).error.code, 'image_too_large')
    assert.equal(cancelled, true)
    assert.ok(emitted <= 34, 'must stop the stream shortly after the limit')
  }
})

test('image download detects truncated files and body failures without leaking upstream errors', async () => {
  for (const makeResponse of [
    () => new Response(pngBytes, { headers: { 'Content-Type': 'image/png', 'Content-Length': String(pngBytes.length + 1) } }),
    () => new Response(new Uint8Array(), { headers: { 'Content-Type': 'image/png' } }),
    () => new Response(new ReadableStream({ start(controller) { controller.error(new Error('apimart-secret')) } }), { headers: { 'Content-Type': 'image/png' } }),
  ]) {
    let calls = 0
    const response = await handleRequest(request('/v1/tasks/task_incomplete/image', { method: 'GET' }), env, async () => ++calls === 1 ? completedTask() : makeResponse())
    assert.equal(response.status, 502)
    assert.doesNotMatch(await response.text(), /apimart-secret/)
  }
})

test('image download timeout covers both response headers and a stalled body', async () => {
  for (const stalledBody of [false, true]) {
    let calls = 0
    let cancelled = false
    const response = await handleRequest(request('/v1/tasks/task_timeout/image', { method: 'GET' }), env, async (_url, options) => {
      if (++calls === 1) return completedTask()
      if (!stalledBody) return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }))
      return new Response(new ReadableStream({ cancel() { cancelled = true } }), { headers: { 'Content-Type': 'image/png' } })
    }, 5)
    assert.equal(response.status, 504)
    assert.equal((await read(response)).error.code, 'image_download_timeout')
    if (stalledBody) assert.equal(cancelled, true)
  }
})

const referencePng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6ZQAAAABJRU5ErkJggg==', 'base64')
function uploadRequest(files = [{ bytes: referencePng, type: 'image/png' }]) {
  const form = new FormData()
  for (const file of files) form.append('file', new Blob([file.bytes], { type: file.type }), 'private-filename.png')
  return new Request('https://fozuai-api.example/v1/uploads/images', { method: 'POST', headers: { Origin: env.ALLOWED_ORIGIN }, body: form })
}

test('reference upload forwards a validated multipart image with server credentials and a neutral filename', async () => {
  let calls = 0
  const response = await handleRequest(uploadRequest(), env, async (url, options) => {
    calls++
    assert.equal(url, 'https://api.apimart.ai/v1/uploads/images')
    assert.equal(options.headers.Authorization, 'Bearer apimart-secret')
    assert.equal(options.headers['Content-Type'], undefined)
    assert.equal(options.redirect, 'manual')
    assert.ok(options.body instanceof FormData)
    const file = options.body.get('file')
    assert.equal(file.name, 'reference.png')
    assert.equal(file.type, 'image/png')
    assert.deepEqual(Buffer.from(await file.arrayBuffer()), referencePng)
    return jsonResponse({ url: 'https://upload.apimart.ai/f/reference.png', filename: 'private-filename.png', extra: 'apimart-secret' })
  })
  assert.equal(calls, 1)
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), env.ALLOWED_ORIGIN)
  assert.deepEqual(await read(response), { url: 'https://upload.apimart.ai/f/reference.png' })
})

test('reference uploads reject incorrect format, empty files, duplicates and oversized files before calling upstream', async () => {
  const cases = [
    [[], 400],
    [[{ bytes: '', type: 'image/png' }], 400],
    [[{ bytes: referencePng, type: 'image/jpeg' }], 400],
    [[{ bytes: '<svg />', type: 'image/svg+xml' }], 415],
    [[{ bytes: referencePng, type: 'image/png' }, { bytes: referencePng, type: 'image/png' }], 400],
    [[{ bytes: new Uint8Array(1024 * 1024 + 1), type: 'image/png' }], 413],
  ]
  for (const [files, status] of cases) {
    const response = await handleRequest(uploadRequest(files), env, () => assert.fail('must reject before upstream'))
    assert.equal(response.status, status)
  }
  const malformed = new Request('https://fozuai-api.example/v1/uploads/images', { method: 'POST', headers: { 'Content-Type': 'multipart/form-data; boundary=bad' }, body: 'broken' })
  assert.equal((await handleRequest(malformed, env)).status, 400)
})

test('multipart body limit applies to actual bytes even when Content-Length lies', async () => {
  let cancelled = false
  const body = new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(1024 * 1024 + 64 * 1024 + 1)) },
    cancel() { cancelled = true },
  })
  const input = new Request('https://fozuai-api.example/v1/uploads/images', { method: 'POST', duplex: 'half', headers: { 'Content-Type': 'multipart/form-data; boundary=test', 'Content-Length': '1' }, body })
  const response = await handleRequest(input, env, () => assert.fail('must reject before upstream'))
  assert.equal(response.status, 413)
  assert.equal(cancelled, true)
})

test('upload CORS and upstream failures do not expose credentials or accept arbitrary result hosts', async () => {
  const preflight = new Request('https://fozuai-api.example/v1/uploads/images', { method: 'OPTIONS', headers: { Origin: env.ALLOWED_ORIGIN, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' } })
  assert.equal((await handleRequest(preflight, env)).status, 204)
  for (const upstream of [jsonResponse({ url: 'https://evil.example/image.png' }), jsonResponse({ url: 'https://upload.apimart.ai/apimart-secret.png' }), new Response(null, { status: 302, headers: { Location: 'https://evil.example' } })]) {
    const response = await handleRequest(uploadRequest(), env, async () => upstream)
    assert.equal(response.status, 502)
    assert.doesNotMatch(await response.text(), /apimart-secret|evil\.example/)
  }
})

test('image generation forwards uploaded references and rejects untrusted references', async () => {
  const image_urls = ['https://upload.apimart.ai/f/reference.png', 'https://getapib.org/f/second.webp']
  const response = await handleRequest(request('/v1/images/generations', { body: { prompt: '改成水彩风格', image_urls } }), env, async (_url, options) => {
    assert.deepEqual(JSON.parse(options.body).image_urls, image_urls)
    return jsonResponse({ data: [{ task_id: 'reference-task' }] })
  })
  assert.equal(response.status, 200)
  for (const refs of ['bad', [123], ['http://upload.apimart.ai/a'], ['https://upload.apimart.ai.evil.example/a'], ['https://user:pass@upload.apimart.ai/a'], ['data:image/png;base64,abcd'], Array(4).fill(image_urls[0])]) {
    const invalid = await handleRequest(request('/v1/images/generations', { body: { prompt: 'test', image_urls: refs } }), env, () => assert.fail('must reject before upstream'))
    assert.equal(invalid.status, 400)
  }
})
