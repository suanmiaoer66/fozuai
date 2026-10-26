import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { getApiConfig, requestChat, requestImage } from './api.js'
import ImageCard from './ImageCard.jsx'
import ReferenceImages from './ReferenceImages.jsx'
import { MAX_REFERENCE_IMAGES, isReferenceImageFile, prepareReferenceImage } from './referenceImages.js'
import logoUrl from '../logo.ico'
import { ArrowLeft } from 'reicon-react/icons/ArrowLeft'
import { ArrowRight } from 'reicon-react/icons/ArrowRight'
import { ChevronDown } from 'reicon-react/icons/ChevronDown'
import { Clock } from 'reicon-react/icons/Clock'
import { Cloud } from 'reicon-react/icons/Cloud'
import { Code } from 'reicon-react/icons/Code'
import { Document } from 'reicon-react/icons/Document'
import { Edit } from 'reicon-react/icons/Edit'
import { Folder } from 'reicon-react/icons/Folder'
import { HandHeart } from 'reicon-react/icons/HandHeart'
import { Home } from 'reicon-react/icons/Home'
import { Image } from 'reicon-react/icons/Image'
import { ImageSparkle } from 'reicon-react/icons/ImageSparkle'
import { Message } from 'reicon-react/icons/Message'
import { Mic } from 'reicon-react/icons/Mic'
import { More } from 'reicon-react/icons/More'
import { Paperclip } from 'reicon-react/icons/Paperclip'
import { Plus } from 'reicon-react/icons/Plus'
import { Search3 } from 'reicon-react/icons/Search3'
import { Send } from 'reicon-react/icons/Send'
import './styles.css'

const iconProps = { size: 18, weight: 'Outline', strokeWidth: 1.8 }

const navItems = [
  { label: '新对话', icon: Edit, primary: true },
  { label: '工作台', icon: Home },
  { label: '知识空间', icon: Folder },
  { label: '定时任务', icon: Clock },
  { label: '云端文件', icon: Cloud },
]

const recentChats = [
  '帮我梳理这周的工作重点',
  '写一份产品发布会开场白',
  '理解一段复杂的代码',
]

const promptCards = [
  { icon: Document, title: '总结一篇长文', copy: '提取重点，整理成清晰结构' },
  { icon: ImageSparkle, title: '生成一张图片', copy: '把想象变成一张图' },
  { icon: Code, title: '解释一段代码', copy: '从逻辑到细节，讲到你听懂' },
  { icon: HandHeart, title: '帮我做个决定', copy: '把复杂问题拆成下一步行动' },
]

const apiConfig = getApiConfig(import.meta.env)
const imageRatios = ['auto', '1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3']
const imageResolutions = ['1k', '2k', '4k']
const initialConnection = {
  chat: apiConfig.chatProxyUrl ? 'configured' : 'unconfigured',
  image: apiConfig.imageProxyUrl ? 'configured' : 'unconfigured',
}

function App() {
  const [activeNav, setActiveNav] = useState('新对话')
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState([])
  const [isThinking, setIsThinking] = useState(false)
  const [modelOpen, setModelOpen] = useState(false)
  const [model, setModel] = useState('高级佛祖模型')
  const [generationMode, setGenerationMode] = useState('chat')
  const [imageSize, setImageSize] = useState(imageRatios.includes(apiConfig.imageSize) ? apiConfig.imageSize : '1:1')
  const [imageResolution, setImageResolution] = useState(imageResolutions.includes(apiConfig.imageResolution) ? apiConfig.imageResolution : '1k')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [connection, setConnection] = useState(initialConnection)
  const [referenceImages, setReferenceImages] = useState([])
  const [referenceProcessing, setReferenceProcessing] = useState(false)
  const [referenceProgress, setReferenceProgress] = useState('')
  const [referenceError, setReferenceError] = useState('')
  const [isDragging, setIsDragging] = useState(false)
  const [requestProgress, setRequestProgress] = useState('')
  const pendingRequest = useRef(null)
  const referenceImagesRef = useRef([])
  const referenceProcessingRef = useRef(null)
  const referenceFileInput = useRef(null)
  const dragDepth = useRef(0)
  const conversationRef = useRef(null)
  const messageThreadRef = useRef(null)
  const followLatest = useRef(true)
  const hasMessages = messages.length > 0

  useEffect(() => () => {
    pendingRequest.current?.abort()
    referenceProcessingRef.current?.abort()
  }, [])

  const updateReferences = (images) => {
    referenceImagesRef.current = images
    setReferenceImages(images)
  }

  const clearReferences = () => {
    referenceProcessingRef.current?.abort()
    referenceProcessingRef.current = null
    updateReferences([])
    setReferenceProcessing(false)
    setReferenceProgress('')
    setReferenceError('')
    setIsDragging(false)
    dragDepth.current = 0
    if (referenceFileInput.current) referenceFileInput.current.value = ''
  }

  const addReferenceFiles = async (fileList) => {
    const files = Array.from(fileList || [])
    if (!files.length) return
    if (pendingRequest.current || referenceProcessingRef.current) {
      setReferenceError('请等待当前处理完成后再添加参考图。')
      return
    }
    const remaining = MAX_REFERENCE_IMAGES - referenceImagesRef.current.length
    if (remaining <= 0) {
      setReferenceError(`最多添加 ${MAX_REFERENCE_IMAGES} 张参考图，请先移除一张。`)
      return
    }
    const candidates = files.filter(isReferenceImageFile)
    const errors = []
    if (candidates.length !== files.length) errors.push('仅支持 PNG、JPEG、WebP 图片，其他文件未添加。')
    if (candidates.length > remaining) errors.push(`最多添加 ${MAX_REFERENCE_IMAGES} 张参考图，超出的图片未添加。`)
    const selectedFiles = candidates.slice(0, remaining)
    if (!selectedFiles.length) {
      setReferenceError(errors.join(' '))
      return
    }
    const controller = new AbortController()
    referenceProcessingRef.current = controller
    setGenerationMode('image')
    setModelOpen(false)
    setSidebarOpen(false)
    setReferenceError('')
    setReferenceProcessing(true)
    try {
      for (let index = 0; index < selectedFiles.length; index += 1) {
        if (controller.signal.aborted) return
        setReferenceProgress(`正在处理参考图（${index + 1}/${selectedFiles.length}）…`)
        try {
          const image = await prepareReferenceImage(selectedFiles[index], { signal: controller.signal })
          if (referenceProcessingRef.current !== controller || controller.signal.aborted) return
          updateReferences([...referenceImagesRef.current, image])
        } catch (error) {
          if (controller.signal.aborted) return
          errors.push(`${selectedFiles[index].name || `图片 ${index + 1}`}：${error.message}`)
        }
      }
      if (referenceProcessingRef.current === controller) setReferenceError(errors.join(' '))
    } finally {
      if (referenceProcessingRef.current === controller) {
        referenceProcessingRef.current = null
        setReferenceProcessing(false)
        setReferenceProgress('')
      }
    }
  }

  const pickReferenceFiles = () => {
    if (!pendingRequest.current && !referenceProcessingRef.current) referenceFileInput.current?.click()
  }

  const removeReference = (id) => {
    if (pendingRequest.current || referenceProcessingRef.current) return
    updateReferences(referenceImagesRef.current.filter((image) => image.id !== id))
    setReferenceError('')
  }

  const handlePaste = (event) => {
    const files = Array.from(event.clipboardData?.files || [])
    if (!files.length) return
    event.preventDefault()
    addReferenceFiles(files)
  }

  const isFileDrag = (event) => Array.from(event.dataTransfer?.types || []).includes('Files')

  const handleDragEnter = (event) => {
    if (!isFileDrag(event)) return
    event.preventDefault()
    dragDepth.current += 1
    setIsDragging(true)
  }

  const handleDragLeave = (event) => {
    if (!isFileDrag(event)) return
    event.preventDefault()
    dragDepth.current = Math.max(0, dragDepth.current - 1)
    if (dragDepth.current === 0) setIsDragging(false)
  }

  const handleDrop = (event) => {
    if (!isFileDrag(event)) return
    event.preventDefault()
    dragDepth.current = 0
    setIsDragging(false)
    addReferenceFiles(event.dataTransfer.files)
  }

  useLayoutEffect(() => {
    const conversation = conversationRef.current
    if (!hasMessages) {
      conversation.scrollTop = 0
      followLatest.current = true
    } else if (followLatest.current) {
      conversation.scrollTop = conversation.scrollHeight
    }
  }, [messages, isThinking, hasMessages])

  useEffect(() => {
    if (!hasMessages) return
    const conversation = conversationRef.current
    // Keep the latest reply visible when an image loads or the input area resizes.
    // Reading older messages pauses this behavior until the user scrolls back down.
    const observer = new ResizeObserver(() => {
      if (followLatest.current) conversation.scrollTop = conversation.scrollHeight
    })
    observer.observe(conversation)
    observer.observe(messageThreadRef.current)
    return () => observer.disconnect()
  }, [hasMessages])

  const handleConversationScroll = () => {
    const conversation = conversationRef.current
    followLatest.current = conversation.scrollHeight - conversation.scrollTop - conversation.clientHeight < 80
  }

  const statusLabels = {
    unconfigured: '服务尚未配置',
    configured: '服务已配置 · 待验证',
    loading: '正在请求服务',
    success: '最近请求成功',
    error: '最近请求失败',
  }
  const currentStatus = connection[generationMode]

  const greeting = useMemo(() => {
    const hour = new Date().getHours()
    if (hour < 11) return '早上好，今天想从哪件事开始？'
    if (hour < 18) return '下午好，今天想从哪件事开始？'
    return '晚上好，今天想从哪件事开始？'
  }, [])

  const sendMessage = async (text = input) => {
    const content = text.trim()
    if (!content || pendingRequest.current || referenceProcessingRef.current) return
    followLatest.current = true
    const mode = generationMode
    const size = imageSize
    const resolution = imageResolution
    const referenceSnapshot = mode === 'image' ? referenceImagesRef.current.map((image) => ({ ...image })) : []
    const controller = new AbortController()
    pendingRequest.current = controller
    const timeout = window.setTimeout(() => controller.abort('timeout'), mode === 'image' ? 360000 : 180000)
    if (mode === 'chat') setInput('')
    setMessages((current) => [...current, { role: 'user', content, mode, referenceImages: referenceSnapshot }])
    setIsThinking(true)
    setRequestProgress(mode === 'image' ? (referenceSnapshot.length ? '准备上传参考图…' : '正在生成图片…') : '')
    setConnection((current) => ({ ...current, [mode]: 'loading' }))
    try {
      let reply
      if (mode === 'image') {
        const { imageUrl, taskId } = await requestImage({ config: apiConfig, prompt: content, size, resolution, referenceImages: referenceSnapshot.map((image) => image.dataUrl), signal: controller.signal, onProgress: (progress) => {
          if (pendingRequest.current === controller && !controller.signal.aborted) setRequestProgress(progress)
        } })
        reply = { role: 'assistant', content: '图片已生成，可以点击查看大图或下载保存。', imageUrl, taskId, imageSize: size, imageResolution: resolution, prompt: content, mode }
      } else {
        const replyContent = await requestChat({
          config: apiConfig,
          signal: controller.signal,
          model,
          messages: [
            { role: 'system', content: '你是佛祖 AI，一位温和、清晰、擅长拆解复杂问题的中文助手。' },
            ...messages.filter((item) => item.role !== 'error' && item.mode !== 'image').map((item) => ({ role: item.role, content: item.content })),
            { role: 'user', content },
          ],
        })
        reply = { role: 'assistant', content: replyContent, mode }
      }
      if (pendingRequest.current !== controller || controller.signal.aborted) return
      setMessages((current) => [...current, reply])
      setConnection((current) => ({ ...current, [mode]: 'success' }))
    } catch (error) {
      if (pendingRequest.current !== controller) return
      if (controller.signal.aborted && controller.signal.reason !== 'timeout') return
      const message = controller.signal.reason === 'timeout'
        ? (mode === 'image' ? '图片生成等待超时，服务端任务可能仍在进行，请稍后再试。' : '回复等待超时，请稍后重试，或切换到导管佛祖模型。')
        : error.message
      setMessages((current) => [...current, { role: 'error', content: message, mode }])
      setInput((current) => current || content)
      setConnection((current) => ({ ...current, [mode]: error.code === 'not_configured' ? 'unconfigured' : 'error' }))
    } finally {
      window.clearTimeout(timeout)
      if (pendingRequest.current === controller) {
        pendingRequest.current = null
        setIsThinking(false)
        setRequestProgress('')
      }
    }
  }

  const startNewChat = () => {
    pendingRequest.current?.abort()
    pendingRequest.current = null
    clearReferences()
    setIsThinking(false)
    setRequestProgress('')
    setConnection((current) => Object.fromEntries(Object.entries(current).map(([key, value]) => [key, value === 'loading' ? initialConnection[key] : value])))
    setMessages([])
    setInput('')
    setActiveNav('新对话')
    setGenerationMode('chat')
    setSidebarOpen(false)
  }

  const activateImageMode = (prompt = '') => {
    setGenerationMode('image')
    setInput(prompt)
    setSidebarOpen(false)
  }

  const exitImageMode = () => {
    if (pendingRequest.current) return
    clearReferences()
    setGenerationMode('chat')
  }

  return (
    <div className="app-shell">
      <aside className={`sidebar ${sidebarOpen ? 'is-open' : ''}`}>
        <div className="brand-row">
          <div className="brand-mark" aria-hidden="true"><img src={logoUrl} alt="" /></div>
          <div>
            <div className="brand-name">佛祖 AI</div>
            <div className="brand-subtitle">把复杂的事，讲明白</div>
          </div>
          <button className="icon-button sidebar-close" onClick={() => setSidebarOpen(false)} aria-label="关闭侧栏"><ArrowLeft {...iconProps} /></button>
        </div>

        <button className="new-chat" onClick={startNewChat}>
          <Plus size={18} weight="Outline" />
          <span>新建对话</span>
          <span className="new-chat-shortcut">⌘ K</span>
        </button>

        <div className="sidebar-scroll">
        <div className="nav-list">
          {navItems.map(({ label, icon: Icon, primary }) => (
            <button key={label} className={`nav-item ${activeNav === label ? 'active' : ''} ${primary ? 'nav-primary' : ''}`} onClick={() => { setActiveNav(label); if (primary) startNewChat() }}>
              <Icon {...iconProps} />
              <span>{label}</span>
              {label === '工作台' && <span className="nav-count">3</span>}
            </button>
          ))}
        </div>

        <div className="sidebar-section">
          <div className="sidebar-heading"><span>最近对话</span><button className="tiny-button" aria-label="更多最近对话"><More size={16} /></button></div>
          <div className="chat-list">
            {recentChats.map((chat, index) => <button key={chat} className={`chat-row ${index === 0 ? 'selected' : ''}`} onClick={() => setInput(chat)}><Message size={15} weight="Outline" /><span>{chat}</span></button>)}
          </div>
        </div>
        </div>

        <div className="sidebar-bottom">
          <div className="usage-card">
            <div className="usage-top"><span className={`online-dot status-${currentStatus}`} /> {statusLabels[currentStatus]}</div>
            <div className="usage-copy">对话：{statusLabels[connection.chat]}</div>
            <div className="usage-copy">图片：{statusLabels[connection.image]}</div>
          </div>
          <div className="account-row"><span className="avatar">林</span><span className="account-copy"><b>林默</b><small>个人空间</small></span></div>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div className="topbar-left"><button className="icon-button mobile-menu" onClick={() => setSidebarOpen(true)} aria-label="打开侧栏"><More size={20} /></button><button className="icon-button desktop-arrow" aria-label="返回"><ArrowLeft size={18} /></button><button className="icon-button desktop-arrow" aria-label="前进"><ArrowRight size={18} /></button><div className="crumb-divider" /><span className="page-label">新对话</span></div>
          <div className="topbar-right"><div className="model-pill"><span className={`model-dot status-${connection.chat}`} /> {model}<ChevronDown size={14} /></div><button className="icon-button" aria-label="搜索"><Search3 {...iconProps} /></button><button className="user-avatar" aria-label="个人资料">林</button></div>
        </header>

        <section ref={conversationRef} onScroll={handleConversationScroll} className={`conversation ${hasMessages ? 'has-messages' : ''}`} aria-label="聊天记录" tabIndex={0}>
          {messages.length === 0 ? (
            <div className="welcome-panel">
              <div className="welcome-orb"><div className="orb-core"><img src={logoUrl} alt="" /></div><span className="orb-ring ring-one" /><span className="orb-ring ring-two" /></div>
              <p className="eyebrow">DEEPSEEK POWERED</p>
              <h1>{greeting}</h1>
              <p className="welcome-copy">我是你的思考搭子，可以帮你写作、分析、学习，也可以只是陪你聊聊。</p>
              <div className="mode-switch" role="tablist" aria-label="工作模式"><button className="mode active" role="tab">对话</button><button className="mode" role="tab">工作</button></div>
              <div className="prompt-grid">
                {promptCards.map(({ icon: Icon, title, copy }) => <button className="prompt-card" key={title} onClick={() => { if (pendingRequest.current || referenceProcessingRef.current) return; if (title === '生成一张图片') activateImageMode(); else if (generationMode === 'image') { exitImageMode(); setInput(title) } else sendMessage(title) }}><span className="prompt-icon"><Icon size={18} weight="Outline" /></span><span className="prompt-text"><b>{title}</b><small>{copy}</small></span><ArrowRight className="prompt-arrow" size={16} /></button>)}
              </div>
            </div>
          ) : (
            <div ref={messageThreadRef} className="message-thread">
              <div className="thread-intro"><span className="mini-mark"><img src={logoUrl} alt="" /></span><span>佛祖 AI · {model}</span></div>
              {messages.map((message, index) => <div className={`message-block ${message.role} ${message.imageUrl ? 'has-image' : ''}`} key={`${message.role}-${index}`}><div className="message-avatar">{message.role === 'user' ? '林' : <img src={logoUrl} alt="" />}</div><div className="message-body"><div className="message-author">{message.role === 'user' ? '你' : '佛祖 AI'}</div><p>{message.content}</p>{message.referenceImages?.length > 0 && <ReferenceImages images={message.referenceImages} />}{message.imageUrl && <ImageCard message={message} config={apiConfig} />}</div></div>)}
              {isThinking && <div className="message-block assistant"><div className="message-avatar"><img src={logoUrl} alt="" /></div><div className="message-body"><div className="message-author">佛祖 AI</div><div className="thinking-wrap"><div className="thinking"><span /><span /><span /></div><span className="thinking-label" role="status">{requestProgress || '正在思考…'}</span></div></div></div>}
            </div>
          )}
        </section>

        <div className="composer-wrap">
          <div className={`composer-shell ${generationMode === 'image' ? 'image-composer' : ''} ${isDragging ? 'is-dragging' : ''}`}
            onPaste={handlePaste} onDragEnter={handleDragEnter} onDragLeave={handleDragLeave}
            onDragOver={(event) => { if (isFileDrag(event)) { event.preventDefault(); event.dataTransfer.dropEffect = isThinking || referenceProcessing ? 'none' : 'copy' } }} onDrop={handleDrop}>
            <input ref={referenceFileInput} type="file" accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp" multiple hidden
              onChange={(event) => { const files = Array.from(event.target.files || []); event.target.value = ''; addReferenceFiles(files) }} aria-label="选择参考图片" />
            {generationMode === 'image' && <div className="composer-mode"><ImageSparkle size={15} /><span>图片生成 · GPT-Image-2</span><button onClick={exitImageMode} disabled={isThinking}>退出</button></div>}
            {generationMode === 'image' && <div className="image-options" aria-label="图片生成选项">
              <label>比例<select value={imageSize} onChange={(event) => setImageSize(event.target.value)} aria-label="图片比例">{imageRatios.map((size) => <option value={size} key={size}>{size === 'auto' ? '自动' : size}</option>)}</select></label>
              <label>分辨率<select value={imageResolution} onChange={(event) => setImageResolution(event.target.value)} aria-label="图片分辨率">{imageResolutions.map((resolution) => <option value={resolution} key={resolution}>{resolution.toUpperCase()}</option>)}</select></label>
              <span className="image-options-hint">{referenceImages.length ? '根据参考图继续创作' : '选好画幅，描述你的想象'}</span>
            </div>}
            {(referenceImages.length > 0 || referenceProcessing) && <ReferenceImages images={referenceImages} onAdd={pickReferenceFiles} onRemove={removeReference} disabled={isThinking || referenceProcessing} processing={referenceProcessing} />}
            {referenceProcessing && <div className="reference-processing-note" role="status">{referenceProgress}</div>}
            {referenceError && <div className="reference-error-note" role="alert">{referenceError}</div>}
            <textarea value={input} onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => { if (event.nativeEvent.isComposing || event.keyCode === 229) return; if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); sendMessage() } }}
              placeholder={generationMode === 'image' ? (referenceImages.length ? '描述参考图要怎么改，可用“图1”“图2”指明图片' : '描述你想生成的图片，也可以添加参考图') : '问我任何问题，或描述你想完成的事'} rows="1" aria-label="输入消息" />
            <div className="composer-toolbar">
              <div className="composer-actions">
                <button className={`tool-button ${referenceImages.length ? 'active' : ''}`} onClick={pickReferenceFiles} disabled={isThinking || referenceProcessing || referenceImages.length >= MAX_REFERENCE_IMAGES} aria-label="添加参考图附件" title="添加参考图"><Paperclip size={17} /></button>
                <button className={`tool-button ${referenceImages.length ? 'active' : ''}`} onClick={pickReferenceFiles} disabled={isThinking || referenceProcessing || referenceImages.length >= MAX_REFERENCE_IMAGES} aria-label="上传参考图片" title="上传参考图片"><Image size={17} /></button>
                <button className={`tool-button ${generationMode === 'image' ? 'active' : ''}`} onClick={() => generationMode === 'image' ? exitImageMode() : activateImageMode(input)} disabled={isThinking} aria-label="图片生成"><ImageSparkle size={17} /></button>
                <button className="tool-button" aria-label="语音输入"><Mic size={17} /></button>
              </div>
              <div className="composer-right">
                {generationMode === 'chat' && <div className="model-select-wrap">
                  <button className="model-select" onClick={() => setModelOpen(!modelOpen)}><span className={`model-dot status-${connection.chat}`} />{model}<ChevronDown size={14} /></button>
                  {modelOpen && <div className="model-menu">
                    <button className={model === '高级佛祖模型' ? 'selected' : ''} onClick={() => { setModel('高级佛祖模型'); setModelOpen(false) }}>高级佛祖模型<small>深度思考</small></button>
                    <button className={model === '导管佛祖模型' ? 'selected' : ''} onClick={() => { setModel('导管佛祖模型'); setModelOpen(false) }}>导管佛祖模型<small>快速对话</small></button>
                  </div>}
                </div>}
                <button className={`send-button ${input.trim() && !isThinking && !referenceProcessing ? 'ready' : ''}`} disabled={!input.trim() || isThinking || referenceProcessing} onClick={() => sendMessage()} aria-label={generationMode === 'image' ? '生成图片' : '发送'}><Send size={17} weight="Outline" /></button>
              </div>
            </div>
            {generationMode === 'image' && !referenceImages.length && !referenceProcessing && <div className="reference-upload-hint">可添加、粘贴或拖入参考图 · 最多 3 张 · PNG/JPEG/WebP · 每张不超过 10 MB</div>}
            {isDragging && <div className="reference-drop-overlay"><ImageSparkle size={25} /><span>{isThinking || referenceProcessing ? '请等待当前处理完成' : '松开添加参考图'}</span></div>}
          </div>
          <p className="composer-note">{statusLabels[currentStatus]} · 佛祖 AI 可能会犯错，请核对重要信息</p>
        </div>
      </main>
    </div>
  )
}

export default App

import { createRoot } from 'react-dom/client'
createRoot(document.getElementById('root')).render(<App />)
