import { useMemo, useState } from 'react'
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
import { Settings } from 'reicon-react/icons/Settings'
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

const assistantReplies = [
  '收到。我会先把问题拆成清晰的步骤，再给你一份可以直接执行的答案。',
  '这个问题很适合从目标、现状和下一步三个角度来看。我先帮你理出一条主线。',
  '可以的。把你手头的材料发来，我会用更容易理解的方式整理给你。',
]

function App() {
  const [activeNav, setActiveNav] = useState('新对话')
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState([])
  const [isThinking, setIsThinking] = useState(false)
  const [modelOpen, setModelOpen] = useState(false)
  const [model, setModel] = useState('高级佛祖模型')
  const [attached, setAttached] = useState(false)
  const [generationMode, setGenerationMode] = useState('chat')
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const greeting = useMemo(() => {
    const hour = new Date().getHours()
    if (hour < 11) return '早上好，今天想从哪件事开始？'
    if (hour < 18) return '下午好，今天想从哪件事开始？'
    return '晚上好，今天想从哪件事开始？'
  }, [])

  const getImageApiConfig = () => {
    const proxyUrl = import.meta.env.VITE_IMAGE_API_PROXY_URL?.replace(/\/$/, '')
    const baseUrl = (proxyUrl || import.meta.env.VITE_APIMART_BASE_URL || 'https://api.apimart.ai').replace(/\/$/, '')
    const apiRoot = baseUrl.endsWith('/v1') ? baseUrl : `${baseUrl}/v1`
    return {
      apiRoot,
      apiKey: proxyUrl ? '' : import.meta.env.VITE_APIMART_API_KEY,
      model: import.meta.env.VITE_APIMART_IMAGE_MODEL || 'gpt-image-2',
      size: import.meta.env.VITE_APIMART_IMAGE_SIZE || '1:1',
      resolution: import.meta.env.VITE_APIMART_IMAGE_RESOLUTION || '1k',
    }
  }

  const generateImage = async (prompt) => {
    const { apiRoot, apiKey, model: imageModel, size, resolution } = getImageApiConfig()
    if (!apiKey && !import.meta.env.VITE_IMAGE_API_PROXY_URL) {
      setMessages((current) => [...current, {
        role: 'assistant',
        content: '图片生成接口还没有连接。请先配置 VITE_IMAGE_API_PROXY_URL；如果只是本地测试，也可以临时配置 VITE_APIMART_API_KEY。',
      }])
      setIsThinking(false)
      return
    }

    try {
      const headers = { 'Content-Type': 'application/json' }
      if (apiKey) headers.Authorization = `Bearer ${apiKey}`
      const submitResponse = await fetch(`${apiRoot}/images/generations`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ model: imageModel, prompt, n: 1, size, resolution }),
      })
      const submitData = await submitResponse.json()
      if (!submitResponse.ok || !submitData?.data?.[0]?.task_id) {
        throw new Error(submitData?.error?.message || '图片任务提交失败')
      }

      const taskId = submitData.data[0].task_id
      for (let attempt = 0; attempt < 40; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 2500))
        const taskResponse = await fetch(`${apiRoot}/tasks/${taskId}`, { headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {} })
        const taskData = await taskResponse.json()
        const task = taskData?.data
        if (task?.status === 'completed') {
          const imageUrl = task?.result?.images?.[0]?.url?.[0]
          if (!imageUrl) throw new Error('任务完成，但没有返回图片地址')
          setMessages((current) => [...current, { role: 'assistant', content: '图片已生成，可以继续调整提示词。', imageUrl }])
          setIsThinking(false)
          return
        }
        if (task?.status === 'failed') throw new Error(task?.error?.message || '图片生成失败')
      }
      throw new Error('图片生成等待超时，请稍后查看任务状态')
    } catch (error) {
      setMessages((current) => [...current, { role: 'assistant', content: `图片生成失败：${error.message}` }])
      setIsThinking(false)
    }
  }

  const sendMessage = async (text = input) => {
    const content = text.trim()
    if (!content || isThinking) return
    setInput('')
    setMessages((current) => [...current, { role: 'user', content }])
    setIsThinking(true)

    if (generationMode === 'image') {
      await generateImage(content)
      return
    }

    const deepseekProxyUrl = import.meta.env.VITE_DEEPSEEK_API_PROXY_URL?.replace(/\/$/, '')
    const apiKey = deepseekProxyUrl ? '' : import.meta.env.VITE_DEEPSEEK_API_KEY
    const baseUrl = deepseekProxyUrl || (import.meta.env.VITE_DEEPSEEK_BASE_URL || 'https://api.deepseek.com')
    if (apiKey) {
      try {
        const response = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({
            model: model === '高级佛祖模型' ? 'deepseek-reasoner' : 'deepseek-chat',
            messages: [
              { role: 'system', content: '你是佛祖 AI，一位温和、清晰、擅长拆解复杂问题的中文助手。' },
              ...messages.map((item) => ({ role: item.role, content: item.content })),
              { role: 'user', content },
            ],
            stream: false,
          }),
        })
        const data = await response.json()
        const reply = data?.choices?.[0]?.message?.content || assistantReplies[0]
        setMessages((current) => [...current, { role: 'assistant', content: reply }])
      } catch {
        setMessages((current) => [...current, { role: 'assistant', content: '连接 DeepSeek 时遇到一点小波动。你可以稍后再试，或先把问题留在这里。' }])
      } finally {
        setIsThinking(false)
      }
      return
    }

    window.setTimeout(() => {
      setMessages((current) => [...current, { role: 'assistant', content: assistantReplies[current.length % assistantReplies.length] }])
      setIsThinking(false)
    }, 720)
  }

  const startNewChat = () => {
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

        <div className="sidebar-bottom">
          <div className="usage-card">
            <div className="usage-top"><span className="online-dot" /> {model} 已连接</div>
            <div className="usage-copy">今天的思考额度还剩 86%</div>
            <div className="usage-track"><span /></div>
          </div>
          <button className="account-row"><span className="avatar">林</span><span className="account-copy"><b>林默</b><small>个人空间</small></span><Settings size={17} /></button>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div className="topbar-left"><button className="icon-button mobile-menu" onClick={() => setSidebarOpen(true)} aria-label="打开侧栏"><More size={20} /></button><button className="icon-button desktop-arrow" aria-label="返回"><ArrowLeft size={18} /></button><button className="icon-button desktop-arrow" aria-label="前进"><ArrowRight size={18} /></button><div className="crumb-divider" /><span className="page-label">新对话</span></div>
          <div className="topbar-right"><div className="model-pill"><span className="model-dot" /> {model}<ChevronDown size={14} /></div><button className="icon-button" aria-label="搜索"><Search3 {...iconProps} /></button><button className="user-avatar" aria-label="个人资料">林</button></div>
        </header>

        <section className={`conversation ${messages.length ? 'has-messages' : ''}`}>
          {messages.length === 0 ? (
            <div className="welcome-panel">
              <div className="welcome-orb"><div className="orb-core"><img src={logoUrl} alt="" /></div><span className="orb-ring ring-one" /><span className="orb-ring ring-two" /></div>
              <p className="eyebrow">DEEPSEEK POWERED</p>
              <h1>{greeting}</h1>
              <p className="welcome-copy">我是你的思考搭子，可以帮你写作、分析、学习，也可以只是陪你聊聊。</p>
              <div className="mode-switch" role="tablist" aria-label="工作模式"><button className="mode active" role="tab">对话</button><button className="mode" role="tab">工作</button></div>
              <div className="prompt-grid">
                {promptCards.map(({ icon: Icon, title, copy }) => <button className="prompt-card" key={title} onClick={() => title === '生成一张图片' ? activateImageMode() : sendMessage(title)}><span className="prompt-icon"><Icon size={18} weight="Outline" /></span><span className="prompt-text"><b>{title}</b><small>{copy}</small></span><ArrowRight className="prompt-arrow" size={16} /></button>)}
              </div>
            </div>
          ) : (
            <div className="message-thread">
              <div className="thread-intro"><span className="mini-mark"><img src={logoUrl} alt="" /></span><span>佛祖 AI · {model}</span></div>
              {messages.map((message, index) => <div className={`message-block ${message.role}`} key={`${message.role}-${index}`}><div className="message-avatar">{message.role === 'user' ? '林' : <img src={logoUrl} alt="" />}</div><div className="message-body"><div className="message-author">{message.role === 'user' ? '你' : '佛祖 AI'}</div><p>{message.content}</p>{message.imageUrl && <img className="generated-image" src={message.imageUrl} alt="根据提示词生成的图片" />}</div></div>)}
              {isThinking && <div className="message-block assistant"><div className="message-avatar"><img src={logoUrl} alt="" /></div><div className="message-body"><div className="message-author">佛祖 AI</div><div className="thinking"><span /><span /><span /></div></div></div>}
            </div>
          )}
        </section>

        <div className="composer-wrap">
            <div className="composer-shell">
            {generationMode === 'image' && <div className="composer-mode"><ImageSparkle size={15} /><span>图片生成 · GPT-Image-2</span><button onClick={() => setGenerationMode('chat')}>退出</button></div>}
            <textarea value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); sendMessage() } }} placeholder={generationMode === 'image' ? '描述你想生成的图片' : '问我任何问题，或描述你想完成的事'} rows="1" aria-label="输入消息" />
            <div className="composer-toolbar"><div className="composer-actions"><button className={`tool-button ${attached ? 'active' : ''}`} onClick={() => setAttached(!attached)} aria-label="添加附件"><Paperclip size={17} /></button><button className="tool-button" aria-label="添加图片"><Image size={17} /></button><button className={`tool-button ${generationMode === 'image' ? 'active' : ''}`} onClick={() => setGenerationMode(generationMode === 'image' ? 'chat' : 'image')} aria-label="图片生成"><ImageSparkle size={17} /></button><button className="tool-button" aria-label="语音输入"><Mic size={17} /></button>{attached && <span className="attachment-hint">已准备添加附件</span>}</div><div className="composer-right">{generationMode === 'chat' && <div className="model-select-wrap"><button className="model-select" onClick={() => setModelOpen(!modelOpen)}><span className="model-dot" />{model}<ChevronDown size={14} /></button>{modelOpen && <div className="model-menu"><button className={model === '高级佛祖模型' ? 'selected' : ''} onClick={() => { setModel('高级佛祖模型'); setModelOpen(false) }}>高级佛祖模型<small>深度思考</small></button><button className={model === '导管佛祖模型' ? 'selected' : ''} onClick={() => { setModel('导管佛祖模型'); setModelOpen(false) }}>导管佛祖模型<small>快速对话</small></button></div>}</div>}{generationMode === 'image' && <span className="image-settings">{import.meta.env.VITE_APIMART_IMAGE_SIZE || '1:1'} · {(import.meta.env.VITE_APIMART_IMAGE_RESOLUTION || '1k').toUpperCase()}</span>}<button className={`send-button ${input.trim() ? 'ready' : ''}`} onClick={() => sendMessage()} aria-label={generationMode === 'image' ? '生成图片' : '发送'}><Send size={17} weight="Outline" /></button></div></div>
          </div>
          <p className="composer-note">佛祖 AI 可能会犯错，请核对重要信息 · <button>使用说明</button></p>
        </div>
      </main>
    </div>
  )
}

export default App

import { createRoot } from 'react-dom/client'
createRoot(document.getElementById('root')).render(<App />)
