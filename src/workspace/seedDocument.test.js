import test from 'node:test'
import assert from 'node:assert/strict'
import { documentFromChat } from './seedDocument.js'

test('chat titles move into the title field without duplicate headings or leftover Markdown', () => {
  for (const title of ['**咖啡店开业准备清单**', '__咖啡店开业准备清单__', '# 咖啡店开业准备清单', '## **咖啡店开业准备清单**']) {
    assert.deepEqual(documentFromChat(`${title}\n\n1. 采购设备\n2. 培训店员`), {
      title: '咖啡店开业准备清单', content: '1. 采购设备\n2. 培训店员', assets: [],
    })
  }
})

test('ordinary opening paragraphs and long headings remain intact in the body', () => {
  const content = '先说明本周进度。\n\n## 下周计划\n下一步安排。'
  assert.equal(documentFromChat(content).content, content)
  const long = '# ' + '长'.repeat(130) + '\n正文'
  assert.equal(documentFromChat(long).content, long)
  assert.ok(documentFromChat(long).title.length <= 120)
})
