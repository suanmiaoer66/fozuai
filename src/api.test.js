import test from 'node:test'
import assert from 'node:assert/strict'
import { getApiConfig, buildChatMessages, buildDocumentMessages, requestDocument, requestChat, requestImage, downloadImage } from './api.js'

const config = getApiConfig({ VITE_DEEPSEEK_API_PROXY_URL: 'https://proxy.example/v1/', VITE_IMAGE_API_PROXY_URL: 'https://proxy.example/v1/' })
const json = (data, status = 200) => new Response(JSON.stringify(data), { status })
const chatRequest = { config, model: '导管佛祖模型', messages: [{ role: 'user', content: '你好' }] }

test('document writing preserves long source without exceeding existing proxy message limits', () => {
  const content = ('原文😀，包含中文和标题。\n').repeat(2500).slice(0, 48000)
  const messages = buildDocumentMessages({ instruction: '整理成正式报告，保留所有事实。', document: { title: '验收报告', content } })
  assert.ok(messages.every((message) => message.content.length <= 16000))
  assert.ok(messages.reduce((total, message) => total + message.content.length, 0) <= 64000)
  assert.equal(messages.slice(1, -1).map((message) => message.content.replace(/^原始内容（\d+\/\d+）：\n/, '')).join(''), content)
  assert.ok(messages.slice(1, -1).every((message) => !/[\uD800-\uDBFF]$/.test(message.content)))
  assert.match(messages.at(-1).content, /整理成正式报告/)
})

test('selected document rewrite sends only the selection and preserves asset references as text', async () => {
  const selection = { start: 1, end: 10, text: '请保留图片\n![示例](asset:local-1)' }
  const result = await requestDocument({ config, model: '导管佛祖模型', instruction: '精简这段文字', document: { title: '测试文档', content: '未选中的敏感段落' }, selection, fetchImpl: async (url, options) => {
    assert.equal(url, 'https://proxy.example/v1/chat/completions')
    const payload = JSON.parse(options.body)
    assert.equal(payload.model, '导管佛祖模型')
    assert.match(payload.messages[0].content, /只修改选中的片段/)
    assert.match(options.body, /asset:local-1/)
    assert.doesNotMatch(options.body, /未选中的敏感段落/)
    return json({ choices: [{ message: { content: '```markdown\n保留图片\n![示例](asset:local-1)\n```' } }] })
  } })
  assert.equal(result, '保留图片\n![示例](asset:local-1)')
})

test('document input and result limits reject before overwriting a draft', async () => {
  const input = { config, model: '导管佛祖模型', instruction: '生成报告', document: { content: '' } }
  const neverFetch = () => assert.fail('invalid input must not call API')
  for (const change of [{ instruction: '' }, { instruction: 'x'.repeat(4001) }, { document: { content: 'x'.repeat(48001) } }, { selection: { text: '' } }]) {
    await assert.rejects(requestDocument({ ...input, ...change, fetchImpl: neverFetch }), { code: 'invalid_request' })
  }
  await assert.rejects(requestDocument({ ...input, fetchImpl: async () => json({ choices: [{ message: { content: 'x'.repeat(48001) } }] }) }), { code: 'invalid_response' })
  for (const reason of ['length', 'content_filter']) {
    await assert.rejects(requestDocument({ ...input, fetchImpl: async () => json({ choices: [{ message: { content: '尚未完成的内容' }, finish_reason: reason }] }) }), { code: 'incomplete_response' })
  }
})

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

test('chat keeps the original images on follow-ups and sends only to the chat endpoint', async () => {
  const referenceImages = [{ id: 'image-1', dataUrl: referenceDataUrl, name: 'private-filename.png' }]
  const messages = buildChatMessages([
    { role: 'user', mode: 'chat', content: '图中是什么？', referenceImages },
    { role: 'assistant', mode: 'chat', content: '一个圆形。' },
    { role: 'user', mode: 'image', content: '画一个红色圆形', referenceImages },
    { role: 'assistant', mode: 'image', content: '已生成', imageUrl: 'https://example.com/generated.png' },
    { role: 'user', mode: 'chat', content: '失败的问题', referenceImages, failed: true },
    { role: 'error', mode: 'chat', content: '暂时不可用' },
    { role: 'user', mode: 'chat', content: '背景什么颜色？' },
  ])
  assert.equal(messages.length, 4)
  assert.deepEqual(messages[1].content, [
    { type: 'text', text: '图中是什么？' },
    { type: 'image_url', image_url: { url: referenceDataUrl, detail: 'auto' } },
  ])
  assert.equal(messages[3].content, '背景什么颜色？')
  let calls = 0
  const reply = await requestChat({ ...chatRequest, messages, fetchImpl: async (url, options) => {
    calls++
    assert.equal(url, 'https://proxy.example/v1/chat/completions')
    assert.deepEqual(JSON.parse(options.body).messages, messages)
    assert.doesNotMatch(options.body, /private-filename|失败的问题|画一个红色圆形|imageUrl|referenceImages/)
    return json({ choices: [{ message: { content: '米白色背景。' } }] })
  } })
  assert.equal(calls, 1)
  assert.equal(reply, '米白色背景。')
})

test('chat context limits are explicit and do not silently remove previous images', () => {
  const turn = { role: 'user', mode: 'chat', content: '描述图片', referenceImages: [{ dataUrl: referenceDataUrl }] }
  assert.equal(buildChatMessages(Array(12).fill(turn)).length, 13)
  assert.throws(() => buildChatMessages(Array(13).fill(turn)), { code: 'context_limit' })
  assert.throws(() => buildChatMessages([{ ...turn, referenceImages: Array(4).fill({ dataUrl: referenceDataUrl }) }]), { code: 'invalid_request' })
  assert.throws(() => buildChatMessages([{ ...turn, referenceImages: [{ dataUrl: 'data:image/png;base64,' + 'A'.repeat(1024 * 1024) }] }]), { code: 'invalid_request' })
  assert.throws(() => buildChatMessages(Array(50).fill({ role: 'user', content: 'hi' })), { code: 'context_limit' })
  assert.throws(() => buildChatMessages(Array(4).fill({ role: 'user', content: '字'.repeat(16000) })), { code: 'context_limit' })
})

test('unsupported vision mapping returns an actionable error instead of a generic HTTP code', async () => {
  await assert.rejects(requestChat({ ...chatRequest, fetchImpl: async () => json({ error: {
    code: 'vision_model_unsupported', message: '当前模型暂不支持看图，请切换到导管佛祖模型。',
  } }, 400) }), { code: 'vision_model_unsupported', status: 400, message: '当前模型暂不支持看图，请切换到导管佛祖模型。' })
})

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
