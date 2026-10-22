import test from 'node:test'
import assert from 'node:assert/strict'
import { getApiConfig, requestChat, requestImage } from './api.js'

const config = getApiConfig({ VITE_DEEPSEEK_API_PROXY_URL: 'https://proxy.example/v1/', VITE_IMAGE_API_PROXY_URL: 'https://proxy.example/v1/' })
const json = (data, status = 200) => new Response(JSON.stringify(data), { status })
const chatRequest = { config, model: '导管佛祖模型', messages: [{ role: 'user', content: '你好' }] }

test('chat calls a configured proxy without any browser API key', async () => {
  const reply = await requestChat({ ...chatRequest, fetchImpl: async (url, options) => {
    assert.equal(url, 'https://proxy.example/v1/chat/completions')
    assert.deepEqual(options.headers, { 'Content-Type': 'application/json' })
    assert.equal(JSON.parse(options.body).model, '导管佛祖模型')
    return json({ choices: [{ message: { content: '真实回复' } }] })
  } })
  assert.equal(reply, '真实回复')
})

test('runtime access code is sent only as the site header', async () => {
  await requestChat({ ...chatRequest, accessKey: ' session-code ', fetchImpl: async (_url, options) => {
    assert.equal(options.headers['X-Fozu-Access-Key'], 'session-code')
    assert.equal(options.headers.Authorization, undefined)
    return json({ choices: [{ message: { content: 'ok' } }] })
  } })
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

test('image generation keeps an existing /v1 and authenticates submission and polling', async () => {
  const urls = []
  const responses = [{ data: [{ task_id: 'image-task' }] }, { data: { status: 'processing' } }, { data: { status: 'completed', result: { images: [{ url: ['https://images.example/result.png'] }] } } }]
  const imageUrl = await requestImage({ config, prompt: '一朵花', accessKey: 'session-code', pollInterval: 0, fetchImpl: async (url, options) => {
    urls.push(url)
    assert.equal(options.headers['X-Fozu-Access-Key'], 'session-code')
    assert.equal(options.headers.Authorization, undefined)
    return json(responses.shift())
  } })
  assert.deepEqual(urls, ['https://proxy.example/v1/images/generations', 'https://proxy.example/v1/tasks/image-task', 'https://proxy.example/v1/tasks/image-task'])
  assert.equal(imageUrl, 'https://images.example/result.png')
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
