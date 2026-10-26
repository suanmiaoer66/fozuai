import test from 'node:test'
import assert from 'node:assert/strict'
import { getApiConfig, requestChat, requestImage, downloadImage } from './api.js'

const config = getApiConfig({ VITE_DEEPSEEK_API_PROXY_URL: 'https://proxy.example/v1/', VITE_IMAGE_API_PROXY_URL: 'https://proxy.example/v1/' })
const json = (data, status = 200) => new Response(JSON.stringify(data), { status })
const chatRequest = { config, model: '导管佛祖模型', messages: [{ role: 'user', content: '你好' }] }

test('chat calls a configured proxy without an access code or browser API key', async () => {
  const reply = await requestChat({ ...chatRequest, fetchImpl: async (url, options) => {
    assert.equal(url, 'https://proxy.example/v1/chat/completions')
    assert.deepEqual(options.headers, { 'Content-Type': 'application/json' })
    assert.equal(JSON.parse(options.body).model, '导管佛祖模型')
    return json({ choices: [{ message: { content: '真实回复' } }] })
  } })
  assert.equal(reply, '真实回复')
})

test('access failures explain service permissions without asking for an access code', async () => {
  for (const status of [401, 403]) {
    await assert.rejects(requestChat({ ...chatRequest, fetchImpl: async () => json({}, status) }), (error) => {
      assert.equal(error.code, 'unauthorized')
      assert.equal(error.status, status)
      assert.match(error.message, /检查服务权限/)
      assert.doesNotMatch(error.message, /口令|密码|填写|设置/)
      return true
    })
  }
})

test('missing proxy reports a configuration error without making a request', async () => {
  await assert.rejects(requestChat({ ...chatRequest, config: getApiConfig(), fetchImpl: () => assert.fail('must not request') }), { code: 'not_configured' })
})

test('HTTP failures and empty replies never turn into successful assistant replies', async () => {
  for (const [status, code] of [[401, 'unauthorized'], [403, 'unauthorized'], [429, 'rate_limited'], [502, 'service_error']]) {
    await assert.rejects(requestChat({ ...chatRequest, fetchImpl: async () => json({ error: 'upstream failure' }, status) }), { code, status })
  }
  await assert.rejects(requestChat({ ...chatRequest, fetchImpl: async () => json({ choices: [] }) }), { code: 'invalid_response' })
  await assert.rejects(requestChat({ ...chatRequest, fetchImpl: async () => new Response('<html>error</html>') }), { code: 'invalid_response' })
})

test('image generation keeps an existing /v1 and submits and polls without credentials', async () => {
  const urls = []
  const responses = [{ data: [{ task_id: 'image-task' }] }, { data: { status: 'processing' } }, { data: { status: 'completed', result: { images: [{ url: ['https://images.example/result.png'] }] } } }]
  const imageUrl = await requestImage({ config, prompt: '一朵花', pollInterval: 0, fetchImpl: async (url, options) => {
    urls.push(url)
    assert.deepEqual(options.headers || {}, urls.length === 1 ? { 'Content-Type': 'application/json' } : {})
    return json(responses.shift())
  } })
  assert.deepEqual(urls, ['https://proxy.example/v1/images/generations', 'https://proxy.example/v1/tasks/image-task', 'https://proxy.example/v1/tasks/image-task'])
  assert.deepEqual(imageUrl, { imageUrl: 'https://images.example/result.png', taskId: 'image-task' })
})

test('image download returns a safe blob filename without browser credentials', async () => {
  const result = await downloadImage({ config, taskId: 'image-task', fetchImpl: async (url, options) => {
    assert.equal(url, 'https://proxy.example/v1/tasks/image-task/image')
    assert.equal(options.headers, undefined)
    return new Response(new Blob(['png-bytes'], { type: 'image/png' }), { headers: { 'Content-Disposition': 'attachment; filename="fozuai-image.png"' } })
  } })
  assert.equal(result.filename, 'fozuai-image.png')
  assert.equal(result.blob.type, 'image/png')
  assert.equal(await result.blob.text(), 'png-bytes')
})

test('image download explains unfinished tasks and rejects non-image responses', async () => {
  await assert.rejects(downloadImage({ config, taskId: 'image-task', fetchImpl: async () => new Response('', { status: 409 }) }), { code: 'image_not_ready', status: 409 })
  await assert.rejects(downloadImage({ config, taskId: 'image-task', fetchImpl: async () => new Response('<html>bad</html>', { headers: { 'Content-Type': 'text/html' } }) }), { code: 'invalid_response' })
})

test('image request sends selected ratio and resolution instead of build defaults', async () => {
  let submitted
  const result = await requestImage({ config, prompt: '海报', size: '9:16', resolution: '2k', pollInterval: 0, fetchImpl: async (_url, options) => {
    if (options.method === 'POST') {
      submitted = JSON.parse(options.body)
      return json({ data: [{ task_id: 'portrait-task' }] })
    }
    return json({ data: { status: 'completed', result: { images: [{ url: 'https://images.example/portrait.webp' }] } } })
  } })
  assert.equal(submitted.size, '9:16')
  assert.equal(submitted.resolution, '2k')
  assert.deepEqual(result, { imageUrl: 'https://images.example/portrait.webp', taskId: 'portrait-task' })
})

test('image download never accepts arbitrary URLs and chooses a matching fallback extension', async () => {
  await assert.rejects(downloadImage({ config, taskId: 'https://attacker.example/image', fetchImpl: () => assert.fail('must not request') }), { code: 'invalid_request' })
  const { filename } = await downloadImage({ config, taskId: 'image-task', fetchImpl: async () => new Response('webp-bytes', { headers: { 'Content-Type': 'image/webp', 'Content-Disposition': 'attachment; filename="../../unsafe.html"' } }) })
  assert.equal(filename, 'fozuai-image-task.webp')
})

test('polling errors are checked instead of being hidden until a timeout', async () => {
  let count = 0
  await assert.rejects(requestImage({ config, prompt: '一朵花', pollInterval: 0, fetchImpl: async () => ++count === 1 ? json({ data: [{ task_id: 'task' }] }) : json({}, 503) }), { code: 'service_error', status: 503 })
  assert.equal(count, 2)
})

test('aborting an image request cancels the wait before its next poll', async () => {
  const controller = new AbortController()
  let calls = 0
  const request = requestImage({ config, prompt: '一朵花', signal: controller.signal, pollInterval: 10000, fetchImpl: async () => {
    calls += 1
    controller.abort()
    return json({ data: [{ task_id: 'task' }] })
  } })
  await assert.rejects(request, { name: 'AbortError' })
  assert.equal(calls, 1)
})

const referenceDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6ZQAAAABJRU5ErkJggg=='

test('reference generation uploads multipart files in order before submitting URL references', async () => {
  const calls = []
  const progress = []
  const result = await requestImage({ config, prompt: '把图1画成图2的风格', referenceImages: [referenceDataUrl, referenceDataUrl], onProgress: (text) => progress.push(text), pollInterval: 0, fetchImpl: async (url, options) => {
    calls.push(url)
    if (url.endsWith('/uploads/images')) {
      assert.equal(options.headers, undefined)
      assert.ok(options.body instanceof FormData)
      assert.equal(options.body.get('file').type, 'image/png')
      return json({ url: `https://upload.apimart.ai/f/ref-${calls.length}.png` })
    }
    if (url.endsWith('/images/generations')) {
      const payload = JSON.parse(options.body)
      assert.deepEqual(payload.image_urls, ['https://upload.apimart.ai/f/ref-1.png', 'https://upload.apimart.ai/f/ref-2.png'])
      assert.equal(payload.prompt, '把图1画成图2的风格')
      assert.doesNotMatch(options.body, /base64/)
      return json({ data: [{ task_id: 'reference-task' }] })
    }
    return json({ data: { status: 'completed', result: { images: [{ url: 'https://images.example/edited.png' }] } } })
  } })
  assert.equal(calls.length, 4)
  assert.match(progress[0], /1\/2/)
  assert.match(progress[1], /2\/2/)
  assert.equal(result.taskId, 'reference-task')
})

test('failed, cancelled and invalid reference uploads never submit an image generation task', async () => {
  for (const failure of [json({}, 413), json({ url: 'https://evil.example/reference.png' })]) {
    let calls = 0
    await assert.rejects(requestImage({ config, prompt: 'test', referenceImages: [referenceDataUrl], fetchImpl: async (url) => {
      calls++
      assert.match(url, /\/uploads\/images$/)
      return failure
    } }), /第 1 张参考图上传失败/)
    assert.equal(calls, 1)
  }
  for (const refs of [Array(4).fill(referenceDataUrl), ['data:image/svg+xml;base64,abcd'], ['https://somewhere.example/image.png']]) {
    await assert.rejects(requestImage({ config, prompt: 'test', referenceImages: refs, fetchImpl: () => assert.fail('invalid references must not upload') }), { code: 'invalid_reference' })
  }
  const controller = new AbortController()
  let calls = 0
  await assert.rejects(requestImage({ config, prompt: 'test', referenceImages: [referenceDataUrl, referenceDataUrl], signal: controller.signal, fetchImpl: async () => {
    calls++
    controller.abort()
    return json({ url: 'https://upload.apimart.ai/f/reference.png' })
  } }), { name: 'AbortError' })
  assert.equal(calls, 1)
})
