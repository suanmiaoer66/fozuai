import { useEffect, useRef, useState } from 'react'
import { Download } from 'reicon-react/icons/Download'
import { Expand } from 'reicon-react/icons/Expand'
import { downloadImage } from './api.js'
import ImagePreview from './ImagePreview.jsx'
import './ImageCard.css'

export default function ImageCard({ message, config }) {
  const [previewOpen, setPreviewOpen] = useState(false)
  const [imageState, setImageState] = useState('loading')
  const [downloadState, setDownloadState] = useState({ status: 'idle', message: '' })
  const downloadRequest = useRef(null)
  const objectUrls = useRef(new Map())
  const alt = message.prompt?.slice(0, 180) || 'AI 生成的图片'
  const metadata = `${message.imageSize === 'auto' ? '自动比例' : message.imageSize} · ${message.imageResolution?.toUpperCase()}`

  useEffect(() => () => {
    downloadRequest.current?.abort()
    for (const [url, timer] of objectUrls.current) {
      clearTimeout(timer)
      URL.revokeObjectURL(url)
    }
    objectUrls.current.clear()
  }, [])

  const handleDownload = async () => {
    if (downloadRequest.current) return
    const controller = new AbortController()
    downloadRequest.current = controller
    const timeout = window.setTimeout(() => controller.abort('timeout'), 60000)
    setDownloadState({ status: 'loading', message: '正在准备原图…' })
    try {
      const { blob, filename } = await downloadImage({ config, taskId: message.taskId, signal: controller.signal })
      if (controller.signal.aborted) return
      const url = URL.createObjectURL(blob)
      const timer = window.setTimeout(() => {
        URL.revokeObjectURL(url)
        objectUrls.current.delete(url)
      }, 60000)
      objectUrls.current.set(url, timer)
      const link = document.createElement('a')
      link.href = url
      link.download = filename
      document.body.append(link)
      link.click()
      link.remove()
      setDownloadState({ status: 'success', message: '已开始下载，请查看浏览器下载记录。' })
    } catch (error) {
      if (controller.signal.reason === 'timeout') {
        setDownloadState({ status: 'error', message: '下载等待超时，请重试或打开原图保存。' })
      } else if (!controller.signal.aborted) {
        setDownloadState({ status: 'error', message: error.message || '下载失败，请稍后重试或打开原图保存。' })
      }
    } finally {
      window.clearTimeout(timeout)
      if (downloadRequest.current === controller) downloadRequest.current = null
    }
  }

  return (
    <figure className="image-result">
      <button className={`image-result-preview is-${imageState}`} onClick={() => setPreviewOpen(true)} aria-label={`查看大图：${alt}`}>
        <img src={message.imageUrl} alt={alt} onLoad={() => setImageState('loaded')} onError={() => setImageState('error')} />
        {imageState === 'loading' && <span className="image-load-message" role="status">正在加载图片…</span>}
        {imageState === 'error' && <span className="image-load-message">图片加载失败，点击查看或下载原图</span>}
        {imageState === 'loaded' && <span className="image-open-hint"><Expand size={15} /> 查看大图</span>}
      </button>
      <figcaption className="image-result-caption">
        <span className="image-result-meta">{metadata}</span>
        <button className="image-download-button" onClick={handleDownload} disabled={downloadState.status === 'loading'}>
          <Download size={15} />{downloadState.status === 'loading' ? '下载中…' : '下载图片'}
        </button>
      </figcaption>
      {downloadState.message && <div className={`image-download-feedback is-${downloadState.status}`} role={downloadState.status === 'error' ? 'alert' : 'status'}>{downloadState.message}</div>}
      {previewOpen && <ImagePreview imageUrl={message.imageUrl} alt={alt} metadata={metadata} onClose={() => setPreviewOpen(false)} onDownload={handleDownload} downloadState={downloadState} />}
    </figure>
  )
}
