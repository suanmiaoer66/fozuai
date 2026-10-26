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

  function confirmDelete() {
    const removed = removeDocument(deleteId)
    if (removed && activeId === deleteId) { resetDocumentTools(); setActiveId(null) }
    setDeleteId(null)
  }

  const saveLabel = loading ? '正在读取草稿…' : saveStatus === 'saving' ? '正在保存…' : saveStatus === 'error' ? '保存失败' : '已保存到本机'
  const deleteDocument = documents.find((doc) => doc.id === deleteId)

  return <section className="document-workspace" aria-label="文档工作区">
    <header className="workspace-header">
      <div className="workspace-header-title"><div className="ws-heading-icon"><Document size={21} weight="Outline" /></div><div><h1>文档工作区</h1><p>把想法写下来，把成果带走。</p></div></div>
      <div className="workspace-header-actions"><button type="button" className="ws-button ws-back" aria-label="返回对话" onClick={onBackToChat}><ArrowLeft {...icon} /><span>返回对话</span></button><button type="button" className="ws-button ws-primary" onClick={() => newDocument()} disabled={loading}><Plus {...icon} /><span>新建文档</span></button></div>
    </header>
    <div className="workspace-body">
      <aside className={`workspace-library ${libraryOpen ? 'library-open' : ''}`} aria-label="本机文档">
        <div className="ws-library-heading"><span>我的文档 <small>{documents.length}</small></span><button type="button" className="ws-icon-button ws-library-close" aria-label="关闭文档列表" onClick={() => setLibraryOpen(false)}><CloseCircle {...icon} /></button></div>
        <label className="ws-search"><Search3 size={15} weight="Outline" /><input aria-label="搜索文档" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索文档" /></label>
        <div className="ws-document-list">{loading ? <p className="ws-library-empty">正在读取本机文档…</p> : filteredDocuments.length ? filteredDocuments.map((doc) => <div className={`ws-document-row ${activeId === doc.id ? 'selected' : ''}`} key={doc.id}><button className="ws-document-select" type="button" onClick={() => selectDocument(doc.id)} aria-current={activeId === doc.id ? 'page' : undefined}><Document {...icon} /><span><b>{doc.title}</b><small>{displayDate(doc.updatedAt)} · {doc.content.length.toLocaleString()} 字</small></span></button><button className="ws-document-delete ws-icon-button" type="button" aria-label={`删除文档 ${doc.title}`} onClick={() => setDeleteId(doc.id)}><Trash size={14} weight="Outline" /></button></div>) : <p className="ws-library-empty">{query ? '没有找到这份文档。' : '还没有文档，\n从空白页或模板开始。'}</p>}</div>
        <div className="ws-local-note"><span className="ws-local-dot" /><p>仅保存在此浏览器<br /><small>重要文档请及时下载备份</small></p></div>
      </aside>
      {libraryOpen && <button className="ws-library-shade" aria-label="关闭文档列表" type="button" onClick={() => setLibraryOpen(false)} />}
      <div className="workspace-desk">
        {(saveError || actionError) && <div className="ws-alert" role="alert"><span>{saveError || actionError}</span>{saveError ? <><button type="button" onClick={() => retrySave?.()}>重新保存</button><button type="button" onClick={clearError}>关闭</button></> : <button type="button" onClick={() => setActionError('')}>关闭</button>}</div>}
        {!activeDocument ? <div className="workspace-empty">
          <button type="button" className="ws-button ws-mobile-library" onClick={() => setLibraryOpen(true)}><List {...icon} />我的文档{documents.length ? ` (${documents.length})` : ''}</button>
          <div className="ws-empty-art" aria-hidden="true"><Document size={42} weight="Outline" /><span><Magicpen size={19} weight="Outline" /></span></div>
          <p className="ws-overline">从对话，到一份好文档</p><h2>留住想法，完成作品</h2><p className="ws-empty-copy">写报告、整理方案、记录会议。<br />直接编辑或让 AI 帮你起草，预览后下载。</p>
          <button className="ws-button ws-primary ws-start-button" type="button" onClick={() => newDocument()} disabled={loading}><Plus {...icon} />创建空白文档</button>
          <div className="ws-template-label">也可以从一个结构开始</div><div className="ws-templates">{templates.map((template) => <button type="button" key={template.title} disabled={loading} onClick={() => newDocument(template)}><Document size={20} weight="Outline" /><b>{template.title}</b><span>{template.label}</span></button>)}</div>
          <p className="ws-empty-note">对话回答下方的「转为文档」，也能将内容带到这里。</p>
        </div> : <>
          <div className="ws-document-heading"><button type="button" className="ws-icon-button ws-mobile-library" aria-label="打开文档列表" onClick={() => setLibraryOpen(true)}><List {...icon} /></button><div className="ws-title-field"><input aria-label="文档标题" value={activeDocument.title} maxLength={120} onChange={(event) => patchActive({ title: event.target.value })} onBlur={() => { if (!activeDocument.title.trim()) patchActive({ title: '未命名文档' }) }} placeholder="未命名文档" /><div className={`ws-save-state ${saveStatus === 'error' ? 'is-error' : ''}`} role="status">{saveStatus === 'saved' && <Check size={12} weight="Outline" />}{saveLabel}</div></div><button type="button" className="ws-button ws-export-top" onClick={openExport}><Download {...icon} />导出文件</button></div>
          <div className="ws-view-tabs" role="tablist" aria-label="工作区视图"><button type="button" role="tab" aria-selected={mobileView === 'edit'} onClick={() => setMobileView('edit')}>编辑</button><button type="button" role="tab" aria-selected={mobileView === 'preview'} onClick={() => setMobileView('preview')}>预览</button></div>
          <div className={`ws-editor-layout view-${mobileView}`}>
            <section className="ws-edit-pane" aria-label="文档编辑">
              <div className="ws-editor-toolbar" role="toolbar" aria-label="文档格式"><span className="ws-pane-label">编辑</span><div className="ws-format-tools"><button type="button" title="插入标题" aria-label="插入标题" onClick={() => insertText('\n## ', '小节标题', '\n')}><b>H</b></button><button type="button" title="加粗" aria-label="加粗选中文字" onClick={() => insertText('**', '加粗文字', '**')}><TextBold {...icon} /></button><button type="button" title="插入列表" aria-label="插入列表" onClick={() => insertText('\n- ', '列表内容', '\n')}><List {...icon} /></button><button type="button" title="插入表格" aria-label="插入表格" onClick={() => insertText('\n\n', '| 标题 | 内容 |\n| --- | --- |\n| 项目 | 说明 |', '\n\n')}><Grid {...icon} /></button><button type="button" title="插入图片" aria-label="插入文档图片" onClick={() => fileRef.current?.click()} disabled={imageBusy || activeDocument.assets.length >= MAX_ASSETS}><Image {...icon} /></button><button type="button" title="撤销 AI 修改" aria-label="撤销 AI 修改" onClick={undoAI} disabled={!undo || undo.documentId !== activeDocument.id || undo.after !== activeDocument.content}><Undo {...icon} /></button></div></div>
              <input className="ws-file-input" type="file" ref={fileRef} accept="image/png,image/jpeg,image/webp" multiple onChange={(event) => addImages(event.target.files)} aria-label="选择文档图片" />
              <textarea ref={editorRef} className="ws-editor" aria-label="文档正文" placeholder={'在这里写下你的内容…\n\n支持标题、加粗、列表和表格。也可以在下方告诉 AI 你想写什么。'} value={activeDocument.content} maxLength={MAX_CONTENT} onChange={(event) => changeContent(event.target.value)} onSelect={rememberSelection} spellCheck="false" />
              {activeDocument.assets.length > 0 && <div className="ws-assets" aria-label="文档图片">{activeDocument.assets.map((asset) => <div className="ws-asset" key={asset.id}><img src={asset.dataUrl} alt="" /><span title={asset.name}>{asset.name}</span><button type="button" aria-label={`移除图片 ${asset.name}`} onClick={() => removeImage(asset)}><CloseCircle size={14} weight="Outline" /></button></div>)}</div>}
              <div className="ws-editor-foot"><span>{imageBusy ? '正在处理图片…' : 'Markdown 编辑 · 支持图文和表格'}</span><span>{activeDocument.content.length.toLocaleString()} / 48,000</span></div>
              <form className="ws-ai-composer" onSubmit={generateDocument}>
                <div className="ws-ai-label"><span><Magicpen size={16} weight="Outline" />让 AI 帮你写</span><small>{selection ? `已选中 ${selection.text.length} 字` : activeDocument.content.trim() ? '修改整篇文档' : '起草新内容'}</small>{selection && <button className="ws-text-button" type="button" onClick={() => setSelection(null)} disabled={aiBusy}>取消选中</button>}</div>
                <textarea aria-label="给 AI 的文档指令" placeholder={selection ? '例如：精简选中内容，保留关键信息' : '例如：写一份咖啡店开业方案，包含预算和时间计划'} value={instruction} maxLength={4000} onChange={(event) => setInstruction(event.target.value)} disabled={aiBusy} rows={2} />
                <div className="ws-ai-actions"><span>{aiBusy ? '正在撰写，你可以随时停止' : 'AI 结果确认后才会应用'}</span>{aiBusy ? <button className="ws-button ws-ai-stop" type="button" onClick={cancelGeneration}>停止生成</button> : <button type="submit" className="ws-button ws-primary" disabled={!instruction.trim() || imageBusy}><Magicpen size={15} weight="Outline" />{selection ? '修改选中内容' : activeDocument.content.trim() ? '生成修改建议' : '开始起草'}</button>}</div>
              </form>
            </section>
            <section className="ws-preview-pane" aria-label="实时预览"><div className="ws-preview-heading"><span className="ws-pane-label">实时预览</span><span>{activeDocument.pageSize === 'LETTER' ? 'Letter' : 'A4'} · 导出时自动分页</span></div><div className="ws-paper-scroll"><DocumentPreview document={activeDocument} /></div></section>
          </div>
          <footer className="ws-document-footer"><p role="status">{notice || '草稿仅保存在此浏览器，手机与电脑之间暂不同步。'}</p><button type="button" className="ws-button ws-primary ws-export-bottom" onClick={openExport}><Download {...icon} />导出文件</button></footer>
        </>}
      </div>
    </div>
    {active && deleteDocument && <Modal title="删除这份文档？" onClose={() => setDeleteId(null)}><p className="ws-modal-copy">「{deleteDocument.title}」将从本机草稿中删除。需要保留的内容，请先下载备份。</p><div className="ws-modal-actions"><button type="button" className="ws-button" onClick={() => setDeleteId(null)}>保留文档</button><button type="button" className="ws-button ws-danger" onClick={confirmDelete}>确认删除</button></div></Modal>}
    {active && proposal && <Modal title={proposal.selection ? '查看选中内容的修改建议' : '查看 AI 文档建议'} onClose={() => setProposal(null)} className="ws-proposal-modal"><p className="ws-modal-copy">{proposalChanged ? '生成期间原文已发生变化，为保护你的编辑，本次建议不能直接应用。你可以选中文字复制，或关闭后重新生成。' : proposal.selection ? '下方为选中内容的新版本，应用后仅替换原选区。' : '下方为新版本，确认后替换正文。应用后可以撤销一次。'}</p><div className="ws-proposal-preview"><DocumentPreview document={activeDocument || { title: '文档建议', assets: proposal.assets }} content={proposal.selection ? proposal.result : proposal.content} showTitle={!proposal.selection} /></div><div className="ws-modal-actions"><button type="button" className="ws-button" onClick={() => setProposal(null)}>保留原文</button><button type="button" className="ws-button ws-primary" onClick={applyProposal} disabled={proposalChanged}><Check {...icon} />应用修改</button></div></Modal>}
    {active && exportOpen && activeDocument && <Modal title="导出文档" onClose={() => { if (!exportBusy) setExportOpen(false) }} className="ws-export-modal"><form onSubmit={downloadDocument}><p className="ws-modal-copy">选择适合的格式，把这份文档带走。</p><label className="ws-export-field">文件名<input value={exportName} maxLength={120} onChange={(event) => setExportName(event.target.value)} disabled={exportBusy} autoFocus /></label><fieldset className="ws-export-formats"><legend>文件格式</legend>{formats.map((format) => <label key={format.value} className={exportFormat === format.value ? 'selected' : ''}><input type="radio" name="document-format" value={format.value} checked={exportFormat === format.value} onChange={() => setExportFormat(format.value)} disabled={exportBusy} /><span><b>{format.label}</b><small>{format.description}</small></span>{exportFormat === format.value && <Check size={16} weight="Outline" />}</label>)}</fieldset><label className="ws-export-page">纸张大小<select value={activeDocument.pageSize} onChange={(event) => patchActive({ pageSize: event.target.value })} disabled={exportBusy || ['md', 'txt'].includes(exportFormat)}><option value="A4">A4 · 210 × 297 mm</option><option value="LETTER">Letter · 216 × 279 mm</option></select></label>{exportFormat === 'txt' && activeDocument.assets.length > 0 && <p className="ws-export-hint">纯文本仅保留文字和图片说明，不包含图片。</p>}{exportFormat === 'pdf' && <p className="ws-export-hint">PDF 支持中文与可选中文字。首次生成需要加载字体，分页以导出文件为准。</p>}{exportError && <p role="alert" className="ws-export-error">{exportError}</p>}<div className="ws-modal-actions"><button type="button" className="ws-button" onClick={() => setExportOpen(false)} disabled={exportBusy}>取消</button><button type="submit" className="ws-button ws-primary" disabled={exportBusy || !exportName.trim()}><Download {...icon} />{exportBusy ? '正在生成文件…' : exportError ? '重试下载' : '下载文件'}</button></div></form></Modal>}
  </section>
}
