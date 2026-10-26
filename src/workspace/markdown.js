import { marked } from 'marked';

// Consumers render tokens themselves. Raw HTML never enters the DOM or an export.
export function parseDocumentMarkdown(content = '') {
  return marked.lexer(String(content), { gfm: true, breaks: false });
}

export function inlinePlainText(tokens = []) {
  return tokens.map((token) => {
    if (token.type === 'br') return '\n';
    if (token.type === 'image') return token.text || '图片';
    if (token.tokens) return inlinePlainText(token.tokens);
    return token.text ?? token.raw ?? '';
  }).join('');
}

export function documentHasTitle(tokens, title) {
  const first = tokens.find((token) => token.type !== 'space');
  return first?.type === 'heading' && first.depth === 1
    && inlinePlainText(first.tokens).trim() === String(title || '').trim();
}

export function safeDocumentLink(href) {
  try {
    const url = new URL(href);
    return ['https:', 'http:', 'mailto:'].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}
