import { documentHasTitle, inlinePlainText, parseDocumentMarkdown, safeDocumentLink } from './markdown.js';

const MAX_CONTENT_LENGTH = 48_000;
const MAX_ASSETS = 6;
const MAX_IMAGE_DATA_LENGTH = 1024 * 1024;
const PDF_FONT = 'NotoSansSC-Regular.otf';
const PAGE_POINTS = { A4: [595.28, 841.89], LETTER: [612, 792] };
let pdfLibraryPromise;

function cleanFilename(title, extension) {
  const stem = String(title || '未命名文档').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').replace(/[. ]+$/g, '').trim().slice(0, 80);
  return `${stem || '未命名文档'}.${extension}`;
}

function validateDocument(document) {
  if (!document || typeof document.content !== 'string' || document.content.length > MAX_CONTENT_LENGTH) {
    throw new Error('文档正文最多支持 48,000 个字符，请拆分后导出。');
  }
  if (typeof document.title !== 'string' || document.title.length > 120) throw new Error('请填写不超过 120 个字符的文档名称。');
  const assets = document.assets || [];
  if (!Array.isArray(assets) || assets.length > MAX_ASSETS) throw new Error('每份文档最多添加 6 张图片。');
  for (const asset of assets) {
    if (typeof asset.id !== 'string' || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(asset.dataUrl || '')
      || asset.dataUrl.length > MAX_IMAGE_DATA_LENGTH || !(asset.width > 0 && asset.height > 0)
      || asset.width > 4096 || asset.height > 4096) {
      throw new Error('文档中的图片已失效或过大，请删除后重新添加。');
    }
  }
  return { ...document, assets, title: document.title.trim() || '未命名文档', pageSize: document.pageSize === 'LETTER' ? 'LETTER' : 'A4' };
}

function dataBytes(dataUrl) {
  const raw = atob(dataUrl.split(',')[1]);
  return Uint8Array.from(raw, (character) => character.charCodeAt(0));
}

function bytesBase64(bytes) {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(binary);
}

async function exportAssets(assets) {
  const normalized = await Promise.all(assets.map(async (asset) => {
    if (!asset.dataUrl.startsWith('data:image/webp;')) return asset;
    // Word and PDF expect PNG/JPEG. Conversion stays on this device.
    const image = new Image();
    image.src = asset.dataUrl;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    canvas.getContext('2d').drawImage(image, 0, 0);
    return { ...asset, dataUrl: canvas.toDataURL('image/png') };
  }));
  return new Map(normalized.map((asset) => [`asset:${asset.id}`, asset]));
}

function plainBlocks(tokens, indent = '') {
  return tokens.map((token) => {
    if (token.type === 'space') return '';
    if (token.type === 'list') return token.items.map((item, index) => `${indent}${token.ordered ? `${Number(token.start || 1) + index}.` : '•'} ${item.task ? `[${item.checked ? 'x' : ' '}] ` : ''}${plainBlocks(item.tokens, `${indent}  `).trim()}`).join('\n');
    if (token.type === 'blockquote') return plainBlocks(token.tokens, indent);
    if (token.type === 'table') return [token.header, ...token.rows].map((row) => row.map((cell) => inlinePlainText(cell.tokens)).join('\t')).join('\n');
    if (token.type === 'hr') return '────────────────';
    if (token.type === 'code' || token.type === 'html') return token.text;
    return inlinePlainText(token.tokens || [{ text: token.text || '' }]);
  }).filter(Boolean).join('\n\n');
}

function documentTokens(document) {
  const tokens = parseDocumentMarkdown(document.content);
  if (!documentHasTitle(tokens, document.title)) tokens.unshift({ type: 'heading', depth: 1, text: document.title, tokens: [{ type: 'text', text: document.title }] });
  const title = tokens.find((token) => token.type !== 'space');
  title.documentTitle = true;
  return tokens;
}

function inlineParts(tokens, inherited = {}) {
  return tokens.flatMap((token) => {
    if (token.type === 'image') return [{ image: token.href, alt: token.text || '图片' }];
    const style = { ...inherited };
    if (token.type === 'strong') style.bold = true;
    if (token.type === 'em') style.italics = true;
    if (token.type === 'del') style.strike = true;
    if (token.type === 'codespan') style.code = true;
    if (token.type === 'link') style.link = safeDocumentLink(token.href);
    if (token.tokens) return inlineParts(token.tokens, style);
    return [{ text: token.type === 'br' ? '\n' : token.text ?? token.raw ?? '', ...style }];
  });
}

function imageSize(asset, width, height) {
  const scale = Math.min(width / asset.width, height / asset.height, 0.75);
  return [asset.width * scale, asset.height * scale];
}

function pdfInline(parts) {
  return parts.map(({ text, bold, italics, strike, code, link }) => ({
    text, ...(/[\x21-\x7e]{40,}/.test(text) && { wordBreak: 'break-all' }),
    ...(bold && { bold }), ...(italics && { italics }), ...(strike && { decoration: 'lineThrough' }),
    ...(code && { background: '#f1f3f5', fontSize: 9 }), ...(link && { link, color: '#245fa6', decoration: 'underline' }),
  }));
}

function pdfBlocks(tokens, assets, width, height, depth = 0) {
  const blocks = [];
  const addInline = (token, base = {}) => {
    let text = [];
    const flush = () => { if (text.length) blocks.push({ text: pdfInline(text), margin: [0, 0, 0, 9], ...base }); text = []; };
    for (const part of inlineParts(token.tokens || [{ text: token.text || '' }])) {
      if (!part.image) { text.push(part); continue; }
      flush();
      const asset = assets.get(part.image);
      if (asset) blocks.push({ image: asset.dataUrl, fit: imageSize(asset, width, height - 80), alignment: 'center', margin: [0, 8, 0, 12] });
      else blocks.push({ text: `[图片：${part.alt}，请在工作区重新添加]`, color: '#707070', margin: [0, 0, 0, 9] });
    }
    flush();
  };
  for (const token of tokens) {
    if (token.type === 'space' || token.type === 'checkbox') continue;
    if (token.type === 'heading') {
      addInline(token, { fontSize: [23, 17, 14, 12, 11, 11][token.depth - 1], bold: true, color: '#000000', margin: [0, token.depth === 1 ? 0 : 12, 0, 10], headlineLevel: token.depth });
    } else if (token.type === 'list') {
      const items = token.items.map((item) => {
        const stack = pdfBlocks(item.tokens, assets, width - 18, height, depth + 1);
        if (item.task) {
          const marker = { text: item.checked ? '[x]  ' : '[ ]  ' };
          if (stack[0]?.text) stack[0].text = [marker, ...[].concat(stack[0].text)];
          else stack.unshift(marker);
        }
        return { stack };
      });
      const allTasks = token.items.every((item) => item.task);
      blocks.push({ [allTasks ? 'stack' : token.ordered ? 'ol' : 'ul']: items, ...(token.ordered && !allTasks && { start: Number(token.start || 1) }), margin: [0, 2, 0, 8] });
    } else if (token.type === 'blockquote') {
      blocks.push({ stack: pdfBlocks(token.tokens, assets, width - 16, height, depth), margin: [16, 4, 0, 8], color: '#626974' });
    } else if (token.type === 'table') {
      const columnCount = token.header.length;
      const cellWidth = (width - columnCount * 12) / columnCount;
      const row = (cells, header) => cells.map((cell, index) => ({
        stack: pdfBlocks([{ type: 'paragraph', tokens: cell.tokens }], assets, cellWidth, height, depth)
          .map((node) => node.text ? { ...node, margin: [0, 0, 0, 0] } : node),
        ...(header && { bold: true, fillColor: '#f3f5f7' }), alignment: token.align[index] || 'left', margin: [0, 3, 0, 0],
      }));
      blocks.push({ table: { headerRows: 1, widths: Array(columnCount).fill('*'), body: [row(token.header, true), ...token.rows.map((cells) => row(cells, false))] },
        layout: { hLineWidth: () => 0.5, vLineWidth: () => 0.5, hLineColor: () => '#d8dde3', vLineColor: () => '#d8dde3', paddingLeft: () => 6, paddingRight: () => 6 }, fontSize: 9, margin: [0, 5, 0, 14] });
    } else if (token.type === 'code') {
      blocks.push({ text: token.text || ' ', wordBreak: 'break-all', fontSize: 9, background: '#f4f5f7', margin: [10, 7, 10, 12], preserveLeadingSpaces: true, lineHeight: 1.3 });
    } else if (token.type === 'hr') {
      blocks.push({ canvas: [{ type: 'line', x1: 0, y1: 0, x2: width, y2: 0, lineWidth: 0.6, lineColor: '#d8dde3' }], margin: [0, 7, 0, 13] });
    } else addInline(token);
  }
  // A heading introducing an image must follow that image onto the next page.
  const grouped = [];
  for (let index = 0; index < blocks.length; index++) {
    if (blocks[index].headlineLevel && blocks[index + 1]?.image) {
      grouped.push({ stack: [blocks[index], blocks[index + 1]], unbreakable: true });
      index++;
    } else grouped.push(blocks[index]);
  }
  return grouped.length ? grouped : [{ text: ' ' }];
}

async function loadPdfLibrary() {
  if (!pdfLibraryPromise) pdfLibraryPromise = (async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45_000);
    try {
      const [{ default: pdfMake }, fontResponse] = await Promise.all([
        import('pdfmake/build/pdfmake.js'),
        fetch(`${import.meta.env?.BASE_URL || '/'}fonts/${PDF_FONT}`, { signal: controller.signal }),
      ]);
      if (!fontResponse.ok) throw new Error('font-unavailable');
      const font = new Uint8Array(await fontResponse.arrayBuffer());
      pdfMake.addVirtualFileSystem({ [PDF_FONT]: bytesBase64(font) });
      pdfMake.addFonts({ NotoSC: { normal: PDF_FONT, bold: PDF_FONT, italics: PDF_FONT, bolditalics: PDF_FONT } });
      return pdfMake;
    } catch {
      throw new Error('PDF 组件或中文字体加载失败，请检查网络后重新导出。');
    } finally {
      clearTimeout(timeout);
    }
  })().catch((error) => { pdfLibraryPromise = undefined; throw error; });
  return pdfLibraryPromise;
}

async function createPdf(document, tokens, assets) {
  const pdfMake = await loadPdfLibrary();
  const [pageWidth, pageHeight] = PAGE_POINTS[document.pageSize];
  return pdfMake.createPdf({
    pageSize: document.pageSize, pageMargins: [48, 48, 48, 48],
    info: { title: document.title, creator: '佛祖 AI 智能助手' },
    defaultStyle: { font: 'NotoSC', fontSize: 10.5, lineHeight: 1.45, color: '#202632' },
    content: pdfBlocks(tokens, assets, pageWidth - 96, pageHeight - 96),
    footer: (current, total) => ({ id: 'fozu-page-footer', text: `${current} / ${total}`, fontSize: 8, color: '#747b85', alignment: 'center', margin: [0, 14, 0, 0] }),
    pageBreakBefore: (currentNode, container) => currentNode.headlineLevel && !container.getFollowingNodesOnPage().some((node) => node.id !== 'fozu-page-footer'),
  }).getBlob();
}

async function createDocx(document, tokens, assets) {
  const d = await import('docx');
  const [pageWidth, pageHeight] = PAGE_POINTS[document.pageSize];
  const contentWidth = pageWidth - 96;
  const border = { style: d.BorderStyle.SINGLE, size: 4, color: 'D8DDE3' };
  const font = { ascii: 'Arial', hAnsi: 'Arial', eastAsia: 'Noto Sans SC', cs: 'Arial' };
  const numbering = [];
  function runs(inline, width) {
    return inlineParts(inline).map((part) => {
      if (part.image) {
        const asset = assets.get(part.image);
        if (!asset) return new d.TextRun({ text: `[图片：${part.alt}，请在工作区重新添加]`, color: '707070' });
        const [w, h] = imageSize(asset, width, pageHeight - 160);
        return new d.ImageRun({ data: dataBytes(asset.dataUrl), type: asset.dataUrl.startsWith('data:image/png') ? 'png' : 'jpg', transformation: { width: w / 0.75, height: h / 0.75 }, altText: { title: part.alt, description: part.alt, name: asset.name } });
      }
      const textRun = new d.TextRun({ text: part.text, bold: part.bold, italics: part.italics, strike: part.strike, ...(part.code && { shading: { fill: 'F1F3F5' }, size: 19 }), ...(part.link && { color: '245FA6', underline: {} }) });
      return part.link ? new d.ExternalHyperlink({ link: part.link, children: [textRun] }) : textRun;
    });
  }
  function blocks(items, width = contentWidth, level = 0) {
    return items.flatMap((token) => {
      if (token.type === 'space' || token.type === 'checkbox') return [];
      if (token.type === 'heading') return [new d.Paragraph({ children: runs(token.tokens, width), heading: token.documentTitle ? d.HeadingLevel.TITLE : d.HeadingLevel[`HEADING_${token.depth}`], keepNext: true, spacing: { before: token.depth === 1 ? 0 : 200, after: 160 } })];
      if (token.type === 'list') {
        const reference = `ordered-${numbering.length}`;
        if (token.ordered) numbering.push({ reference, levels: [{ level: 0, format: d.LevelFormat.DECIMAL, text: '%1.', start: Number(token.start || 1), alignment: d.AlignmentType.START, style: { paragraph: { indent: { left: (level + 1) * 300, hanging: 230 } } } }] });
        return token.items.flatMap((item) => {
        const children = blocks(item.tokens, width - 18, level + 1);
        const prefix = item.task ? `[${item.checked ? 'x' : ' '}] ` : '';
        const listStyle = item.task ? { indent: { left: (level + 1) * 300, hanging: 230 } }
          : token.ordered ? { numbering: { reference, level: 0 } } : { bullet: { level: Math.min(level, 8) } };
        const first = item.tokens.find((child) => !['space', 'checkbox'].includes(child.type));
        if (first && ['text', 'paragraph'].includes(first.type)) children[0] = new d.Paragraph({ children: [new d.TextRun(prefix), ...runs(first.tokens || [{ text: first.text }], width - 18)], ...listStyle, spacing: { after: 100 } });
        else children.unshift(new d.Paragraph({ text: prefix, ...listStyle }));
        return children;
        });
      }
      if (token.type === 'blockquote') return blocks(token.tokens, width - 18, level + 1).map((paragraph) => paragraph);
      if (token.type === 'table') {
        const cellWidth = width / token.header.length;
        return [new d.Table({ width: { size: Math.round(width * 20), type: d.WidthType.DXA }, layout: d.TableLayoutType.FIXED, columnWidths: token.header.map(() => Math.round(cellWidth * 20)),
          rows: [token.header, ...token.rows].map((cells, rowIndex) => new d.TableRow({ tableHeader: rowIndex === 0, children: cells.map((cell, index) => new d.TableCell({
            width: { size: Math.round(cellWidth * 20), type: d.WidthType.DXA }, margins: { top: 90, bottom: 90, left: 100, right: 100 }, borders: { top: border, bottom: border, left: border, right: border }, ...(rowIndex === 0 && { shading: { fill: 'F3F5F7' } }),
            children: [new d.Paragraph({ alignment: token.align[index] || 'left', children: runs(cell.tokens, cellWidth - 12).map((run) => run), ...(rowIndex === 0 && { style: 'TableHeader' }), spacing: { after: 20 } })],
          })) })),
        }), new d.Paragraph({ text: '', spacing: { after: 90 } })];
      }
      if (token.type === 'code') return token.text.split('\n').map((line) => new d.Paragraph({ children: [new d.TextRun({ text: line || ' ', size: 18 })], shading: { fill: 'F4F5F7' }, spacing: { after: 0, line: 260 } }));
      if (token.type === 'hr') return [new d.Paragraph({ border: { bottom: border }, spacing: { after: 180 } })];
      return [new d.Paragraph({ children: runs(token.tokens || [{ text: token.text || '' }], width), spacing: { after: 150, line: 330 } })];
    });
  }
  const headings = Object.fromEntries([1, 2, 3, 4, 5, 6].map((level) => [`heading${level}`, { run: { font, color: '000000', bold: true, size: [46, 34, 28, 24, 22, 22][level - 1] }, paragraph: { keepNext: true } }]));
  const children = blocks(tokens);
  const output = new d.Document({
    title: document.title, creator: '佛祖 AI 智能助手',
    numbering: { config: numbering },
    styles: { default: { document: { run: { font, size: 21, color: '202632' }, paragraph: { spacing: { line: 330, after: 150 } } }, title: { run: { font, size: 46, color: '000000', bold: true }, paragraph: { keepNext: true } }, ...headings }, paragraphStyles: [{ id: 'TableHeader', name: 'Table Header', basedOn: 'Normal', run: { bold: true, color: '000000' } }] },
    sections: [{ properties: { page: { size: { width: Math.round(pageWidth * 20), height: Math.round(pageHeight * 20) }, margin: { top: 960, right: 960, bottom: 960, left: 960 } } }, children,
      footers: { default: new d.Footer({ children: [new d.Paragraph({ alignment: d.AlignmentType.CENTER, children: [new d.TextRun({ children: [d.PageNumber.CURRENT, ' / ', d.PageNumber.TOTAL_PAGES], size: 16, color: '747B85' })] })] }) },
    }],
  });
  return d.Packer.toBlob(output);
}

export async function createDocumentExport(input, format) {
  if (!['pdf', 'docx', 'md', 'txt'].includes(format)) throw new Error('暂不支持这个导出格式。');
  const document = validateDocument(input);
  const tokens = documentTokens(document);
  const filename = cleanFilename(document.title, format);
  if (format === 'txt') return { blob: new Blob([plainBlocks(tokens)], { type: 'text/plain;charset=utf-8' }), filename };
  if (format === 'md') {
    let content = document.content;
    for (const asset of document.assets) content = content.replaceAll(`(asset:${asset.id})`, `(${asset.dataUrl})`);
    if (!documentHasTitle(parseDocumentMarkdown(document.content), document.title)) content = `# ${document.title}\n\n${content}`;
    return { blob: new Blob([content], { type: 'text/markdown;charset=utf-8' }), filename };
  }
  const assets = await exportAssets(document.assets);
  const blob = format === 'pdf' ? await createPdf(document, tokens, assets) : await createDocx(document, tokens, assets);
  return { blob, filename };
}
