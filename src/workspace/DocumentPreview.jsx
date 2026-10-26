import { Component, useMemo } from 'react'
import { Document } from 'reicon-react/icons/Document'
import { parseDocumentMarkdown, documentHasTitle } from './markdown.js'

function safeLink(href) {
  try {
    const url = new URL(href)
    return ['https:', 'http:', 'mailto:'].includes(url.protocol) ? url.href : null
  } catch { return null }
}

function imageAsset(href, assets) {
  if (typeof href !== 'string' || !href.startsWith('asset:')) return null
  const asset = assets.find((item) => item.id === href.slice(6))
  return asset && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(asset.dataUrl) ? asset : null
}

function Inline({ tokens = [], assets }) {
  return tokens.map((token, index) => {
    const children = token.tokens ? <Inline tokens={token.tokens} assets={assets} /> : token.text || ''
    switch (token.type) {
      case 'strong': return <strong key={index}>{children}</strong>
      case 'em': return <em key={index}>{children}</em>
      case 'del': return <del key={index}>{children}</del>
      case 'codespan': return <code key={index}>{token.text}</code>
      case 'br': return <br key={index} />
      case 'link': {
        const href = safeLink(token.href)
        return href ? <a key={index} href={href} target="_blank" rel="noopener noreferrer">{children}</a> : <span key={index}>{children}</span>
      }
      case 'image': {
        const asset = imageAsset(token.href, assets)
        return asset
          ? <img key={index} className="doc-inline-image" src={asset.dataUrl} alt={token.text || asset.name || '文档图片'} width={asset.width} height={asset.height} />
          : <span key={index} className="doc-image-placeholder">[图片：{token.text || '请插入本地图片'}]</span>
      }
      default: return <span key={index}>{children}</span>
    }
  })
}

function Blocks({ tokens = [], assets }) {
  return tokens.map((token, index) => {
    const children = <Inline tokens={token.tokens || [{ type: 'text', text: token.text || '' }]} assets={assets} />
    switch (token.type) {
      case 'space': return null
      case 'heading': {
        const Heading = `h${Math.max(1, Math.min(6, token.depth))}`
        return <Heading key={index}>{children}</Heading>
      }
      case 'paragraph': case 'text': return <p key={index}>{children}</p>
      case 'hr': return <hr key={index} />
      case 'blockquote': return <blockquote key={index}><Blocks tokens={token.tokens} assets={assets} /></blockquote>
      case 'code': return <pre key={index}><code>{token.text}</code></pre>
      case 'list': {
        const List = token.ordered ? 'ol' : 'ul'
        return <List key={index} start={token.ordered ? token.start : undefined}>{token.items.map((item, itemIndex) => <li key={itemIndex} className={item.task ? 'doc-task-item' : undefined}>{item.task && <input type="checkbox" checked={Boolean(item.checked)} readOnly disabled aria-label={item.checked ? '已完成' : '未完成'} />}<div><Blocks tokens={item.tokens} assets={assets} /></div></li>)}</List>
      }
      case 'table': return <div className="doc-table-wrap" key={index}><table><thead><tr>{token.header.map((cell, cellIndex) => <th key={cellIndex} style={{ textAlign: token.align[cellIndex] || 'left' }}><Inline tokens={cell.tokens} assets={assets} /></th>)}</tr></thead><tbody>{token.rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex} style={{ textAlign: token.align[cellIndex] || 'left' }}><Inline tokens={cell.tokens} assets={assets} /></td>)}</tr>)}</tbody></table></div>
      // HTML from pasted documents is rendered as text, never executed.
      case 'html': return <p key={index}>{token.text}</p>
      default: return token.text ? <p key={index}>{token.text}</p> : null
    }
  })
}

function PreviewContent({ document, content, showTitle = true, className = '' }) {
  const body = content ?? document?.content ?? ''
  const tokens = useMemo(() => parseDocumentMarkdown(body), [body])
  const assets = document?.assets || []
  const title = document?.title || '未命名文档'
  return <article className={`document-paper ${document?.pageSize === 'LETTER' ? 'paper-letter' : ''} ${className}`} aria-label="文档内容预览">
    {showTitle && !documentHasTitle(tokens, title) && <h1 className="document-paper-title">{title}</h1>}
    {body.trim() ? <Blocks tokens={tokens} assets={assets} /> : <div className="document-paper-empty"><Document size={28} weight="Outline" /><p>从一个想法开始</p><span>在左侧编辑，内容会实时出现在这里。</span></div>}
  </article>
}

class PreviewBoundary extends Component {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidUpdate(previous) {
    if (this.state.failed && previous.resetKey !== this.props.resetKey) this.setState({ failed: false })
  }
  render() {
    if (this.state.failed) return <article className="document-paper"><p className="doc-preview-warning">这段格式暂时无法预览，原文已保留，可以继续编辑。</p><pre>{this.props.content}</pre></article>
    return this.props.children
  }
}

export default function DocumentPreview(props) {
  const content = props.content ?? props.document?.content ?? ''
  return <PreviewBoundary resetKey={content} content={content}><PreviewContent {...props} /></PreviewBoundary>
}
