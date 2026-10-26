import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { inflateRawSync, inflateSync } from 'node:zlib';
import { createDocumentExport } from './exportDocument.js';
import { documentHasTitle, inlinePlainText, parseDocumentMarkdown, safeDocumentLink } from './markdown.js';

const sample = await readFile(new URL('../../test/fixtures/workspace-sample.md', import.meta.url), 'utf8');
const circle = await readFile(new URL('../../test/fixtures/reference-circle.png', import.meta.url));
const document = { title: '春季活动方案', content: sample, pageSize: 'A4', assets: [{ id: 'sample-circle', name: '活动示意图.png', dataUrl: `data:image/png;base64,${circle.toString('base64')}`, width: 512, height: 512 }] };

// Read the actual ZIP output using its central directory, including data-descriptor archives.
function unzipEntries(buffer) {
  const result = new Map();
  for (let offset = 0; offset < buffer.length - 46; offset++) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) continue;
    const compression = buffer.readUInt16LE(offset + 10);
    const size = buffer.readUInt32LE(offset + 20);
    const nameSize = buffer.readUInt16LE(offset + 28);
    const name = buffer.subarray(offset + 46, offset + 46 + nameSize).toString();
    const localOffset = buffer.readUInt32LE(offset + 42);
    const start = localOffset + 30 + buffer.readUInt16LE(localOffset + 26) + buffer.readUInt16LE(localOffset + 28);
    const data = buffer.subarray(start, start + size);
    result.set(name, compression === 8 ? inflateRawSync(data) : data);
  }
  return result;
}

test('Markdown is tokenized without evaluating HTML; unsafe links never become active', () => {
  const tokens = parseDocumentMarkdown('# **标题**\n\n<script>alert(1)</script>\n\n[点我](javascript:alert(1))');
  assert.equal(documentHasTitle(tokens, '标题'), true);
  assert.equal(inlinePlainText(tokens[0].tokens), '标题');
  assert.ok(tokens.some((token) => token.type === 'html'));
  assert.equal(safeDocumentLink('javascript:alert(1)'), null);
  assert.equal(safeDocumentLink('data:text/html;base64,a'), null);
  assert.equal(safeDocumentLink('https://fozu.zoreai.cn/'), 'https://fozu.zoreai.cn/');
});

test('Markdown export is portable and plain text retains headings, list content and tabular data', async () => {
  const markdown = await createDocumentExport(document, 'md');
  const text = await markdown.blob.text();
  assert.equal(markdown.filename, '春季活动方案.md');
  assert.equal((text.match(/# 春季活动方案/g) || []).length, 1);
  assert.ok(text.includes(document.assets[0].dataUrl));
  assert.ok(!text.includes('asset:sample-circle'));
  const plain = await (await createDocumentExport(document, 'txt')).blob.text();
  assert.ok(plain.includes('中文排版'));
  assert.ok(plain.includes('工作内容\t负责人\t完成时间'));
  assert.ok(plain.includes('[x] 文案已确认'));
  assert.ok(!plain.includes('**'));
  assert.ok(!plain.includes('base64'));
});

test('Word output contains editable Chinese text, embedded image, table header and correct paper geometry', async () => {
  const output = await createDocumentExport(document, 'docx');
  const entries = unzipEntries(Buffer.from(await output.blob.arrayBuffer()));
  const xml = entries.get('word/document.xml').toString();
  const styles = entries.get('word/styles.xml').toString();
  assert.equal((xml.match(/春季活动方案/g) || []).length, 2); // Main heading plus the literal code example.
  assert.ok(xml.includes('中文排版'));
  assert.ok(xml.includes('<w:tblHeader'));
  assert.ok(xml.includes('<w:numPr>'));
  assert.ok(xml.includes('<w:pStyle w:val="Title"'));
  const taskParagraph = xml.match(/<w:p[ >][\s\S]*?<\/w:p>/g).find((paragraph) => paragraph.includes('[x]'));
  assert.ok(taskParagraph?.includes('文案已确认'), 'task label and text stay in one paragraph');
  assert.ok(xml.includes('<w:drawing>'));
  assert.match(xml, /w:pgSz[^>]*w:w="11906"[^>]*w:h="16838"/);
  assert.match(styles, /w:eastAsia="Noto Sans SC"/);
  assert.ok([...entries.keys()].some((name) => name.startsWith('word/media/')));
  assert.ok(!xml.includes('asset:'));
  const letter = await createDocumentExport({ ...document, pageSize: 'LETTER' }, 'docx');
  assert.match(unzipEntries(Buffer.from(await letter.blob.arrayBuffer())).get('word/document.xml').toString(), /w:pgSz[^>]*w:w="12240"[^>]*w:h="15840"/);
});

test('PDF is a real multipage document with embedded Chinese font, Unicode mapping and image', async () => {
  const nativeFetch = globalThis.fetch;
  const requestedFonts = [];
  let corruptFirstResponse = true;
  globalThis.fetch = async (url) => {
    requestedFonts.push(url);
    assert.ok(['/fonts/NotoSansSC-Common.woff2', '/fonts/NotoSansSC-Regular.woff2'].includes(url));
    if (corruptFirstResponse) {
      corruptFirstResponse = false;
      return new Response('<html>temporary upstream error</html>');
    }
    return new Response(await readFile(new URL(`../../public${url}`, import.meta.url)));
  };
  try {
    await assert.rejects(createDocumentExport(document, 'pdf'), /中文字体下载失败/);
    requestedFonts.length = 0;
    const rows = Array.from({ length: 70 }, (_, index) => `| 第 ${index + 1} 项 | 核对中文资料、整理文档并完成验收 |`).join('\n');
    const output = await createDocumentExport({ ...document, content: `${sample}\n\n## 长表格\n\n| 序号 | 内容 |\n|---|---|\n${rows}` }, 'pdf');
    const bytes = Buffer.from(await output.blob.arrayBuffer());
    const raw = bytes.toString('latin1');
    assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
    assert.equal(output.blob.type, 'application/pdf');
    const pageCount = (raw.match(/\/Type \/Page\b/g) || []).length;
    assert.ok(pageCount >= 3 && pageCount <= 6, 'the fixture paginates without a trailing header-only page');
    assert.ok(raw.includes('/FontFile3'));
    assert.ok(raw.includes('/ToUnicode'));
    assert.ok(raw.includes('/Subtype /Image'));
    assert.match(raw, /\/MediaBox \[0 0 595\.28 841\.89\]/);
    assert.deepEqual(requestedFonts, ['/fonts/NotoSansSC-Common.woff2']);
    const rare = await createDocumentExport({ title: '罕见字', content: '# 罕见字\n\n龘', assets: [] }, 'pdf');
    const rareRaw = Buffer.from(await rare.blob.arrayBuffer()).toString('latin1');
    const streams = [...rareRaw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)].map((match) => {
      try { return inflateSync(Buffer.from(match[1], 'latin1')).toString(); } catch { return ''; }
    });
    assert.ok(streams.some((stream) => /<9f98>/i.test(stream)), 'rare character 龘 retains its PDF Unicode mapping');
    assert.deepEqual(requestedFonts, ['/fonts/NotoSansSC-Common.woff2', '/fonts/NotoSansSC-Regular.woff2']);
    await createDocumentExport({ ...document, content: '# 春季活动方案\n\n再次导出' }, 'pdf');
    assert.equal(requestedFonts.length, 2, 'completed font downloads are reused');
  } finally {
    globalThis.fetch = nativeFetch;
  }
});

test('Exports reject oversized or unsupported input before fetching or loading document libraries', async () => {
  await assert.rejects(createDocumentExport({ ...document, content: '文'.repeat(48001) }, 'pdf'), /48,000/);
  await assert.rejects(createDocumentExport({ ...document, assets: Array(7).fill(document.assets[0]) }, 'docx'), /6 张/);
  await assert.rejects(createDocumentExport({ ...document, assets: [{ ...document.assets[0], dataUrl: 'https://example.com/image.png' }] }, 'pdf'), /失效/);
  await assert.rejects(createDocumentExport(document, 'html'), /不支持/);
  assert.equal((await createDocumentExport({ ...document, title: '../文件:名称?' }, 'txt')).filename, '..-文件-名称-.txt');
});
