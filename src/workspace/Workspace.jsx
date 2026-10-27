import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft } from 'reicon-react/icons/ArrowLeft'
import { Check } from 'reicon-react/icons/Check'
import { CloseCircle } from 'reicon-react/icons/CloseCircle'
import { Document } from 'reicon-react/icons/Document'
import { Download } from 'reicon-react/icons/Download'
import { Image } from 'reicon-react/icons/Image'
import { Grid } from 'reicon-react/icons/Grid'
import { List } from 'reicon-react/icons/List'
import { Magicpen } from 'reicon-react/icons/Magicpen'
import { Plus } from 'reicon-react/icons/Plus'
import { Search3 } from 'reicon-react/icons/Search3'
import { TextBold } from 'reicon-react/icons/TextBold'
import { Trash } from 'reicon-react/icons/Trash'
import { Undo } from 'reicon-react/icons/Undo'
import { requestDocument } from '../api.js'
import { prepareReferenceImage } from '../referenceImages.js'
import { useDocuments } from './useDocuments.js'
import { createDocumentExport } from './exportDocument.js'
import DocumentPreview from './DocumentPreview.jsx'
import './Workspace.css'

const icon = { size: 17, weight: 'Outline' }
const MAX_CONTENT = 48000
const MAX_ASSETS = 6
const templates = [
  { title: '工作周报', label: '复盘进展，明确下一步', content: '## 本周工作\n\n- 已完成的工作与成果\n\n## 重点进展\n\n| 事项 | 进展 | 下一步 |\n| --- | --- | --- |\n| 待填写 | 待填写 | 待填写 |\n\n## 问题与支持\n\n需要协调的问题或资源。\n\n## 下周计划\n\n1. 优先事项\n2. 后续行动\n' },
  { title: '项目方案', label: '从目标到执行的完整结构', content: '## 项目背景\n\n说明现状与需要解决的问题。\n\n## 目标与范围\n\n- 项目目标\n- 交付成果\n\n## 实施计划\n\n| 阶段 | 主要任务 | 时间 |\n| --- | --- | --- |\n| 准备 | 待填写 | 待填写 |\n| 执行 | 待填写 | 待填写 |\n\n## 风险与应对\n\n## 验收标准\n' },
  { title: '会议纪要', label: '整理讨论、决策与待办', content: '## 会议信息\n\n- 时间：\n- 参与人：\n- 主题：\n\n## 讨论要点\n\n1. 待补充\n\n## 会议决策\n\n- 待补充\n\n## 后续行动\n\n| 行动项 | 负责人 | 截止日期 |\n| --- | --- | --- |\n| 待填写 | 待填写 | 待填写 |\n' },
]
const formats = [
  { value: 'pdf', label: 'PDF', description: '固定版式 · 自动分页', extension: 'pdf' },
  { value: 'docx', label: 'Word', description: '可继续编辑 · .docx', extension: 'docx' },
  { value: 'md', label: 'Markdown', description: '保留内容与格式标记', extension: 'md' },
  { value: 'txt', label: '纯文本', description: '轻量文字 · .txt', extension: 'txt' },
]

function displayDate(value) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
}

function fileStem(value) {
  return value.trim().replace(/[\u0000-\u001f<>:"/\\|?*]/g, '_').replace(/\.(pdf|docx|md|txt)$/i, '').replace(/[. ]+$/, '').slice(0, 100) || '未命名文档'
}

function Modal({ title, children, onClose, className = '' }) {
  const ref = useRef(null)
  useEffect(() => {
    const dialog = ref.current
    if (!dialog.open) dialog.showModal()
    return () => { if (dialog.open) dialog.close() }
  }, [])
  return <dialog ref={ref} className={`workspace-modal ${className}`} aria-label={title} onCancel={(event) => { event.preventDefault(); onClose() }}>
    <div className="ws-modal-heading"><h2>{title}</h2><button className="ws-icon-button" type="button" onClick={onClose} aria-label="关闭弹窗"><CloseCircle {...icon} /></button></div>
    {children}
  </dialog>
}

export default function Workspace({ config, model, seed, onSeedConsumed, onCountChange, onBackToChat, active = true }) {
  const { documents, loading, saveStatus, error: saveError, createDocument, updateDocument, removeDocument, clearError, retrySave } = useDocuments()
  const [activeId, setActiveId] = useState(null)
  const [query, setQuery] = useState('')
  const [mobileView, setMobileView] = useState('edit')
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [instruction, setInstruction] = useState('')
  const [selection, setSelection] = useState(null)
  const [aiBusy, setAiBusy] = useState(false)
  const [proposal, setProposal] = useState(null)
  const [undo, setUndo] = useState(null)
  const [notice, setNotice] = useState('')
  const [actionError, setActionError] = useState('')
  const [deleteId, setDeleteId] = useState(null)
  const [exportOpen, setExportOpen] = useState(false)
  const [exportFormat, setExportFormat] = useState('pdf')
  const [exportName, setExportName] = useState('')
  const [exportBusy, setExportBusy] = useState(false)
  const [exportError, setExportError] = useState('')
  const [imageBusy, setImageBusy] = useState(false)
  const [workspacePrompt, setWorkspacePrompt] = useState('')
  const [promptBusy, setPromptBusy] = useState(false)
  const [promptError, setPromptError] = useState('')
  const editorRef = useRef(null)
  const fileRef = useRef(null)
  const requestRef = useRef(null)
  const imageRequestRef = useRef(null)
  const consumedSeeds = useRef(new Set())
  const activeIdRef = useRef(activeId)
  const activeRef = useRef(active)
  const documentsRef = useRef(documents)
  const activeDocument = documents.find((doc) => doc.id === activeId) || null
  const filteredDocuments = useMemo(() => documents.filter((doc) => doc.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())), [documents, query])
  activeIdRef.current = activeId
  activeRef.current = active
  documentsRef.current = documents

  useEffect(() => { onCountChange?.(documents.length) }, [documents.length, onCountChange])
  useEffect(() => () => { requestRef.current?.abort(); imageRequestRef.current?.abort() }, [])
  useEffect(() => {
    if (active) return
    requestRef.current?.abort()
    requestRef.current = null
    imageRequestRef.current?.abort()
    imageRequestRef.current = null
    setAiBusy(false)
    setImageBusy(false)
    setProposal(null)
    setDeleteId(null)
    setExportOpen(false)
    setLibraryOpen(false)
    setWorkspacePrompt('')
    setPromptBusy(false)
  }, [active])
  useEffect(() => {
    if (loading || !seed || consumedSeeds.current.has(seed.id)) return
    consumedSeeds.current.add(seed.id)
    const created = createDocument({ title: seed.title || '对话笔记', content: seed.content || '', assets: seed.assets || [] })
    if (created) {
      resetDocumentTools()
      setActiveId(created.id)
      activeIdRef.current = created.id
      setMobileView('edit')
      setLibraryOpen(false)
      setProposal(null)
      setInstruction('')
      setSelection(null)
      setNotice('对话内容已转为文档，可以继续编辑。')
      onSeedConsumed?.(seed.id)
    } else consumedSeeds.current.delete(seed.id)
  }, [loading, seed, createDocument, onSeedConsumed])

  function resetDocumentTools() {
    requestRef.current?.abort()
    requestRef.current = null
    imageRequestRef.current?.abort()
    imageRequestRef.current = null
    setAiBusy(false)
    setImageBusy(false)
    setInstruction('')
    setSelection(null)
    setProposal(null)
    setUndo(null)
    setActionError('')
    setNotice('')
    setLibraryOpen(false)
    setMobileView('edit')
  }

  function selectDocument(id) {
    if (id !== activeId) resetDocumentTools()
    setActiveId(id)
    activeIdRef.current = id
    setLibraryOpen(false)
  }

  function titleFromGeneratedContent(content, fallback = '新文档') {
    const heading = String(content || '').split(/\r?\n/).find((line) => /^#\s+/.test(line.trim()))
    const title = heading ? heading.replace(/^#+\s*/, '').replace(/[*_`]/g, '').trim() : ''
    return (title || fallback).slice(0, 120)
  }

  async function createFromPrompt(event) {
    event.preventDefault()
    const instruction = workspacePrompt.trim()
    if (!instruction || promptBusy || loading) return
    // A new document request starts a clean interaction; cancel any in-flight
    // edit and clear selection/proposal state from the previously opened draft.
    resetDocumentTools()
    setPromptBusy(true)
    setPromptError('')
    const created = createDocument({ title: '正在生成文档', content: '' })
    if (!created) {
      setPromptBusy(false)
      setPromptError('暂时无法创建文档，请稍后重试。')
      return
    }
    setActiveId(created.id)
    activeIdRef.current = created.id
    setLibraryOpen(false)
    setWorkspacePrompt('')
    setNotice('正在整理内容…')
    const controller = new AbortController()
    requestRef.current = controller
    const discardCreated = () => {
      removeDocument(created.id)
      if (activeIdRef.current === created.id) {
        setActiveId(null)
        activeIdRef.current = null
      }
    }
    try {
      const result = await requestDocument({ config, model, instruction, document: created, signal: controller.signal })
      if (controller.signal.aborted || requestRef.current !== controller) {
        discardCreated()
        return
      }
      const title = titleFromGeneratedContent(result, instruction.slice(0, 24))
      updateDocument(created.id, { title, content: result })
      setNotice('文档已生成，可以直接修改或导出。')
    } catch (error) {
      // Never leave an empty "正在生成文档" draft behind after cancellation
      // or an upstream failure. The user can submit the prompt again safely.
      discardCreated()
      if (!controller.signal.aborted) setPromptError(error.message || '文档生成失败，请重试。')
    } finally {
      if (requestRef.current === controller) requestRef.current = null
      setPromptBusy(false)
    }
  }

  function newDocument(fields = {}) {
    const doc = createDocument(fields)
    if (!doc) return
    resetDocumentTools()
    setActiveId(doc.id)
    activeIdRef.current = doc.id
    setNotice(fields.content ? '结构已准备好，填写内容或告诉 AI 你的需求。' : '')
  }

  function patchActive(patch) {
    if (!activeDocument) return null
    return updateDocument(activeDocument.id, patch)
  }

  function changeContent(content) {
    patchActive({ content })
    setSelection(null)
    setUndo(null)
    setNotice('')
  }

  function rememberSelection() {
    const editor = editorRef.current
    if (!editor) return
    const { selectionStart: start, selectionEnd: end } = editor
    setSelection(start !== end ? { start, end, text: editor.value.slice(start, end) } : null)
  }

  function insertText(before, placeholder = '', after = '') {
    const editor = editorRef.current
    if (!editor || !activeDocument) return
    const start = editor.selectionStart
    const end = editor.selectionEnd
    const selected = activeDocument.content.slice(start, end) || placeholder
    const content = `${activeDocument.content.slice(0, start)}${before}${selected}${after}${activeDocument.content.slice(end)}`
    if (content.length > MAX_CONTENT) { setActionError('文档最多 48,000 字，请先精简内容。'); return }
    changeContent(content)
    requestAnimationFrame(() => {
      editor.focus()
      editor.setSelectionRange(start + before.length, start + before.length + selected.length)
      rememberSelection()
    })
  }

  async function addImages(files) {
    if (!activeDocument || imageRequestRef.current) return
    const remaining = MAX_ASSETS - activeDocument.assets.length
    if (remaining <= 0) { setActionError('每份文档最多插入 6 张图片，请先移除一张。'); return }
    const chosen = Array.from(files || [])
    if (!chosen.length) return
    const docId = activeDocument.id
    const controller = new AbortController()
    imageRequestRef.current = controller
    setImageBusy(true)
    setActionError('')
    const errors = chosen.length > remaining ? ['最多插入 6 张图片，超出的图片未添加。'] : []
    try {
      const prepared = []
      for (const file of chosen.slice(0, remaining)) {
        try { prepared.push(await prepareReferenceImage(file, { signal: controller.signal })) }
        catch (error) { if (controller.signal.aborted) return; errors.push(`${file.name}：${error.message}`) }
      }
      if (controller.signal.aborted || activeIdRef.current !== docId) return
      const latest = documentsRef.current.find((doc) => doc.id === docId)
      if (!latest) return
      const insert = prepared.map((asset) => `![${asset.name.replace(/[\[\]\r\n]/g, '')}](asset:${asset.id})`).join('\n\n')
      const content = `${latest.content}${latest.content.trim() && insert ? '\n\n' : ''}${insert}`
      if (content.length > MAX_CONTENT) errors.push('文档长度已达上限，图片未插入。')
      else if (prepared.length) { updateDocument(docId, { assets: [...latest.assets, ...prepared], content }); setUndo(null); setNotice(`已插入 ${prepared.length} 张图片。`) }
      setActionError(errors.join(' '))
    } finally {
      if (imageRequestRef.current === controller) { imageRequestRef.current = null; setImageBusy(false) }
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  function removeImage(asset) {
    const escaped = asset.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    patchActive({ assets: activeDocument.assets.filter((item) => item.id !== asset.id), content: activeDocument.content.replace(new RegExp(`!\\[[^\\]]*\\]\\(asset:${escaped}\\)`, 'g'), '') })
    setUndo(null)
  }

  async function generateDocument(event) {
    event.preventDefault()
    if (!instruction.trim() || aiBusy || !activeDocument) return
    const snapshot = { ...activeDocument }
    const selected = selection && snapshot.content.slice(selection.start, selection.end) === selection.text ? selection : null
    const controller = new AbortController()
    requestRef.current = controller
    setAiBusy(true)
    setActionError('')
    setNotice('')
    let timedOut = false
    const timeout = setTimeout(() => { timedOut = true; controller.abort() }, 180000)
    try {
      const result = await requestDocument({ config, model, instruction: instruction.trim(), document: snapshot, selection: selected, signal: controller.signal })
      if (controller.signal.aborted || activeIdRef.current !== snapshot.id || requestRef.current !== controller) return
      const replacement = selected ? `${snapshot.content.slice(0, selected.start)}${result}${snapshot.content.slice(selected.end)}` : result
      if (replacement.length > MAX_CONTENT) throw new Error('生成的内容超过 48,000 字，请缩小修改范围后重试。')
      setProposal({ documentId: snapshot.id, baseContent: snapshot.content, content: replacement, result, selection: selected, assets: snapshot.assets })
    } catch (error) {
      if (timedOut && activeRef.current && activeIdRef.current === snapshot.id && requestRef.current === controller) setActionError('生成时间较长，已停止等待。原文已保留，请缩短要求或分段修改后重试。')
      else if (!controller.signal.aborted) setActionError(error.message || '生成失败，请重试。原文已保留。')
    } finally {
      clearTimeout(timeout)
      if (requestRef.current === controller) { requestRef.current = null; setAiBusy(false) }
    }
  }

  function cancelGeneration() {
    requestRef.current?.abort()
    requestRef.current = null
    setAiBusy(false)
    setNotice('已停止生成，原文已保留。')
  }

  const proposalChanged = proposal && (!activeDocument || activeDocument.id !== proposal.documentId || activeDocument.content !== proposal.baseContent)
  function applyProposal() {
    const latest = documentsRef.current.find((doc) => doc.id === proposal?.documentId)
    if (!proposal || activeIdRef.current !== proposal.documentId || latest?.content !== proposal.baseContent) return
    const updated = updateDocument(latest.id, { content: proposal.content })
    if (!updated) return
    setUndo({ documentId: latest.id, before: latest.content, after: proposal.content })
    setProposal(null)
    setSelection(null)
    setInstruction('')
    setNotice('AI 修改已应用。可以撤销这次修改。')
  }

  function undoAI() {
    if (!undo || undo.documentId !== activeDocument?.id || undo.after !== activeDocument.content) return
    patchActive({ content: undo.before })
    setUndo(null)
    setNotice('已恢复到 AI 修改之前的内容。')
  }

  function openExport() {
    setExportName(activeDocument.title)
    setExportError('')
    setExportOpen(true)
  }

  async function downloadDocument(event) {
    event.preventDefault()
    if (!activeDocument || exportBusy) return
    setExportBusy(true)
    setExportError('')
    try {
      const snapshot = { ...activeDocument }
      const { blob } = await createDocumentExport(snapshot, exportFormat)
      const url = URL.createObjectURL(blob)
      const link = window.document.createElement('a')
      link.href = url
      link.download = `${fileStem(exportName)}.${formats.find((format) => format.value === exportFormat).extension}`
      window.document.body.appendChild(link)
      link.click()
      link.remove()
      setTimeout(() => URL.revokeObjectURL(url), 60000)
      setNotice(`${formats.find((format) => format.value === exportFormat).label} 文件已生成，请在浏览器下载中查看。`)
      setExportOpen(false)
    } catch (error) { setExportError(error.message || '文件生成失败，请重试。') }
    finally { setExportBusy(false) }
  }

  async function downloadFormat(format) {
    if (!activeDocument || exportBusy) return
    setExportFormat(format)
    setExportBusy(true)
    setExportError('')
    try {
      const { blob } = await createDocumentExport({ ...activeDocument }, format)
      const url = URL.createObjectURL(blob)
      const link = window.document.createElement('a')
      link.href = url
      link.download = `${fileStem(activeDocument.title)}.${formats.find((item) => item.value === format).extension}`
      window.document.body.appendChild(link)
      link.click()
      link.remove()
      setTimeout(() => URL.revokeObjectURL(url), 60000)
      setNotice(`${formats.find((item) => item.value === format).label} 文件已生成。`)
    } catch (error) {
      setExportError(error.message || '文件生成失败，请重试。')
    } finally {
      setExportBusy(false)
    }
  }

  function confirmDelete() {
    const removed = removeDocument(deleteId)
    if (removed && activeId === deleteId) { resetDocumentTools(); setActiveId(null) }
    setDeleteId(null)
  }

  const saveLabel = loading ? '正在读取草稿…' : saveStatus === 'saving' ? '正在保存…' : saveStatus === 'error' ? '保存失败' : '已保存到本机'
  const deleteDocument = documents.find((doc) => doc.id === deleteId)

  return <section className="document-workspace workspace-qa" aria-label="文档工作区">
    <header className="workspace-header">
      <div className="workspace-header-title"><div className="ws-heading-icon"><Document size={21} weight="Outline" /></div><div><h1>文档工作台</h1><p>像聊天一样说出需求，直接得到一份可编辑的文档。</p></div></div>
      <div className="workspace-header-actions"><button type="button" className="ws-button ws-back" aria-label="返回对话" onClick={onBackToChat}><ArrowLeft {...icon} /><span>返回对话</span></button><button type="button" className="ws-button" onClick={() => newDocument()} disabled={loading}><Plus {...icon} /><span>空白文档</span></button></div>
    </header>
    <div className="workspace-qa-body">
      <main className="workspace-qa-main">
        {(saveError || actionError || promptError || exportError) && <div className="ws-alert" role="alert"><span>{saveError || actionError || promptError || exportError}</span>{saveError ? <><button type="button" onClick={() => retrySave?.()}>重新保存</button><button type="button" onClick={clearError}>关闭</button></> : <button type="button" onClick={() => { setActionError(''); setPromptError(''); setExportError('') }}>关闭</button>}</div>}
        <div className="ws-qa-intro">
          <p className="ws-overline">佛祖 AI · 文档助手</p>
          <h2>你想做一份什么文档？</h2>
          <p>告诉我主题、用途和希望包含的内容，我会先生成一份草稿，你可以继续追问、编辑和下载。</p>
          <form className="ws-qa-composer" onSubmit={createFromPrompt}>
            <textarea aria-label="描述你想生成的文档" value={workspacePrompt} onChange={(event) => setWorkspacePrompt(event.target.value)} disabled={promptBusy || loading} placeholder="例如：写一份咖啡店开业方案，包含预算、时间计划和检查清单" rows={3} />
            <div className="ws-qa-composer-foot"><span>{promptBusy ? '正在生成文档…' : '支持报告、方案、纪要、清单等格式'}</span><button type="submit" className="ws-button ws-primary" disabled={!workspacePrompt.trim() || promptBusy || loading}><Magicpen size={16} weight="Outline" />{promptBusy ? '生成中…' : '生成文档'}</button></div>
          </form>
          <div className="ws-qa-suggestions" aria-label="快速开始">{['写一份工作周报', '整理会议纪要', '制定项目执行方案'].map((item) => <button key={item} type="button" onClick={() => setWorkspacePrompt(item)} disabled={promptBusy}>{item}</button>)}</div>
        </div>
        <div className="ws-doc-feed-heading"><div><h3>我的文档</h3><span>{documents.length ? `${documents.length} 份草稿，点击即可展开详情` : '生成的内容会保存在这里'}</span></div><label className="ws-search"><Search3 size={15} weight="Outline" /><input aria-label="搜索文档" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索文档" /></label></div>
        {loading ? <div className="ws-doc-loading"><span /><span /><span /></div> : filteredDocuments.length ? <div className="ws-doc-grid">{filteredDocuments.map((doc) => <article className={`ws-doc-card ${activeId === doc.id ? 'selected' : ''}`} key={doc.id}><button type="button" className="ws-doc-card-main" onClick={() => selectDocument(doc.id)} aria-label={`查看文档 ${doc.title}`}><div className="ws-doc-card-icon"><Document {...icon} /></div><div className="ws-doc-card-copy"><h4>{doc.title}</h4><p>{doc.content.replace(/[#*`|>\[\]]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 92) || '空白文档，点击后开始编辑。'}</p><small>{displayDate(doc.updatedAt)} · {doc.content.length.toLocaleString()} 字</small></div><span className="ws-doc-card-arrow">查看详情</span></button><button type="button" className="ws-doc-delete" aria-label={`删除文档 ${doc.title}`} onClick={() => setDeleteId(doc.id)}><Trash size={14} weight="Outline" /></button></article>)}</div> : <div className="ws-doc-empty"><Document size={30} weight="Outline" /><p>{query ? '没有找到匹配的文档。' : '还没有文档，先在上方描述你的需求吧。'}</p>{!query && <button type="button" className="ws-button" onClick={() => newDocument()}>创建空白文档</button>}</div>}
        {!documents.length && <div className="ws-quick-templates"><span>也可以从模板开始</span><div>{templates.map((template) => <button type="button" key={template.title} onClick={() => newDocument(template)} disabled={loading}><Document size={16} weight="Outline" /><b>{template.title}</b><small>{template.label}</small></button>)}</div></div>}
        <p className="ws-local-note-inline"><span className="ws-local-dot" />草稿仅保存在此浏览器，重要文档请及时导出备份。</p>
      </main>
      {activeDocument && <aside className="ws-detail-panel" aria-label="文档详情">
        <div className="ws-detail-head"><div><span>文档详情</span><small>{saveLabel}</small></div><div className="ws-detail-actions"><div className="ws-export-wrap"><button type="button" className="ws-button ws-primary ws-export-trigger" disabled={exportBusy} aria-label="导出文档"><Download size={15} weight="Outline" />{exportBusy ? '生成中…' : '导出'}<span className="ws-export-caret">⌄</span></button><div className="ws-export-popover" role="menu" aria-label="选择导出格式">{formats.map((format) => <button type="button" role="menuitem" key={format.value} onClick={() => downloadFormat(format.value)} disabled={exportBusy}><span><b>{format.label}</b><small>{format.description}</small></span><Download size={14} weight="Outline" /></button>)}</div></div><button type="button" className="ws-icon-button" aria-label="关闭文档详情" onClick={() => { resetDocumentTools(); setActiveId(null) }}><CloseCircle {...icon} /></button></div></div>
        <div className="ws-detail-title"><input aria-label="文档标题" value={activeDocument.title} maxLength={120} onChange={(event) => patchActive({ title: event.target.value })} onBlur={() => { if (!activeDocument.title.trim()) patchActive({ title: '未命名文档' }) }} /><span>{displayDate(activeDocument.updatedAt)}</span></div>
        <div className="ws-detail-scroll"><div className="ws-detail-editor"><div className="ws-detail-toolbar" role="toolbar" aria-label="文档格式"><span>直接编辑</span><div><button type="button" title="插入标题" aria-label="插入标题" onClick={() => insertText('\n## ', '小节标题', '\n')}><b>H</b></button><button type="button" title="加粗" aria-label="加粗选中文字" onClick={() => insertText('**', '加粗文字', '**')}><TextBold {...icon} /></button><button type="button" title="插入列表" aria-label="插入列表" onClick={() => insertText('\n- ', '列表内容', '\n')}><List {...icon} /></button><button type="button" title="插入图片" aria-label="插入文档图片" onClick={() => fileRef.current?.click()} disabled={imageBusy || activeDocument.assets.length >= MAX_ASSETS}><Image {...icon} /></button><button type="button" title="撤销 AI 修改" aria-label="撤销 AI 修改" onClick={undoAI} disabled={!undo || undo.documentId !== activeDocument.id || undo.after !== activeDocument.content}><Undo {...icon} /></button></div></div><input className="ws-file-input" type="file" ref={fileRef} accept="image/png,image/jpeg,image/webp" multiple onChange={(event) => addImages(event.target.files)} aria-label="选择文档图片" /><textarea ref={editorRef} className="ws-editor" aria-label="文档正文" placeholder="在这里修改文档内容…" value={activeDocument.content} maxLength={MAX_CONTENT} onChange={(event) => changeContent(event.target.value)} onSelect={rememberSelection} spellCheck="false" />{activeDocument.assets.length > 0 && <div className="ws-assets" aria-label="文档图片">{activeDocument.assets.map((asset) => <div className="ws-asset" key={asset.id}><img src={asset.dataUrl} alt="" /><span title={asset.name}>{asset.name}</span><button type="button" aria-label={`移除图片 ${asset.name}`} onClick={() => removeImage(asset)}><CloseCircle size={14} weight="Outline" /></button></div>)}</div>}<div className="ws-editor-foot"><span>{imageBusy ? '正在处理图片…' : 'Markdown · 支持图文和表格'}</span><span>{activeDocument.content.length.toLocaleString()} / 48,000</span></div></div><div className="ws-detail-preview"><div className="ws-detail-preview-head"><span>实时预览</span><small>{activeDocument.pageSize === 'LETTER' ? 'Letter' : 'A4'}</small></div><div className="ws-paper-scroll"><DocumentPreview document={activeDocument} /></div></div></div>
        <form className="ws-detail-ai" onSubmit={generateDocument}><div><Magicpen size={15} weight="Outline" /><span>{selection ? '修改选中内容' : '继续让 AI 修改'}</span></div><textarea aria-label="给 AI 的文档指令" placeholder={selection ? '例如：把选中内容改得更简洁' : '例如：补充风险与时间安排'} value={instruction} maxLength={4000} onChange={(event) => setInstruction(event.target.value)} disabled={aiBusy} rows={2} /><div><small>{aiBusy ? '正在生成，原文不会被覆盖' : '生成后会先预览，确认后再应用'}</small>{aiBusy ? <button type="button" className="ws-button" onClick={cancelGeneration}>停止</button> : <button type="submit" className="ws-button ws-primary" disabled={!instruction.trim() || imageBusy}><Magicpen size={14} weight="Outline" />生成建议</button>}</div></form>
      </aside>}
    </div>
    {active && deleteDocument && <Modal title="删除这份文档？" onClose={() => setDeleteId(null)}><p className="ws-modal-copy">「{deleteDocument.title}」将从本机草稿中删除。需要保留的内容，请先下载备份。</p><div className="ws-modal-actions"><button type="button" className="ws-button" onClick={() => setDeleteId(null)}>保留文档</button><button type="button" className="ws-button ws-danger" onClick={confirmDelete}>确认删除</button></div></Modal>}
    {active && proposal && <Modal title={proposal.selection ? '查看选中内容的修改建议' : '查看 AI 文档建议'} onClose={() => setProposal(null)} className="ws-proposal-modal"><p className="ws-modal-copy">{proposalChanged ? '生成期间原文已发生变化，为保护你的编辑，本次建议不能直接应用。你可以选中文字复制，或关闭后重新生成。' : proposal.selection ? '下方为选中内容的新版本，应用后仅替换原选区。' : '下方为新版本，确认后替换正文。应用后可以撤销一次。'}</p><div className="ws-proposal-preview"><DocumentPreview document={activeDocument || { title: '文档建议', assets: proposal.assets }} content={proposal.selection ? proposal.result : proposal.content} showTitle={!proposal.selection} /></div><div className="ws-modal-actions"><button type="button" className="ws-button" onClick={() => setProposal(null)}>保留原文</button><button type="button" className="ws-button ws-primary" onClick={applyProposal} disabled={proposalChanged}><Check {...icon} />应用修改</button></div></Modal>}
  </section>
}
