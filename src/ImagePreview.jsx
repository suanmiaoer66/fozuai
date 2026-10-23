import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowUpRight } from 'reicon-react/icons/ArrowUpRight'
import { CloseCircle } from 'reicon-react/icons/CloseCircle'
import { Download } from 'reicon-react/icons/Download'
import { Expand } from 'reicon-react/icons/Expand'
import { Minus } from 'reicon-react/icons/Minus'
import { Plus } from 'reicon-react/icons/Plus'

export default function ImagePreview({ imageUrl, alt, metadata, onClose, onDownload, downloadState }) {
  const dialogRef = useRef(null)
  const viewportRef = useRef(null)
  const closeRef = useRef(null)
  const [viewport, setViewport] = useState({ width: 1, height: 1 })
  const [naturalSize, setNaturalSize] = useState({ width: 0, height: 0 })
  const [zoom, setZoom] = useState(1)
  const [imageState, setImageState] = useState('loading')
  const titleId = useId()
  const hintId = useId()
  const fitScale = naturalSize.width ? Math.min(viewport.width / naturalSize.width, viewport.height / naturalSize.height, 1) : 1
  const imageWidth = Math.round(naturalSize.width * fitScale * zoom)
  const imageHeight = Math.round(naturalSize.height * fitScale * zoom)

  useEffect(() => {
    const previousFocus = document.activeElement
    const dialog = dialogRef.current
    dialog.showModal()
    closeRef.current.focus()
    return () => {
      dialog.close()
      if (previousFocus?.isConnected) previousFocus.focus()
    }
  }, [])

  useLayoutEffect(() => {
    const viewportElement = viewportRef.current
    const measure = () => setViewport({ width: Math.max(1, viewportElement.clientWidth), height: Math.max(1, viewportElement.clientHeight) })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(viewportElement)
    return () => observer.disconnect()
  }, [])

  useLayoutEffect(() => {
    const viewportElement = viewportRef.current
    viewportElement.scrollLeft = (viewportElement.scrollWidth - viewportElement.clientWidth) / 2
    viewportElement.scrollTop = (viewportElement.scrollHeight - viewportElement.clientHeight) / 2
  }, [zoom, imageWidth, imageHeight])

  const trapFocus = (event) => {
    if (event.key !== 'Tab') return
    const focusable = [...dialogRef.current.querySelectorAll('button:not(:disabled), a[href], [tabindex="0"]')]
    const first = focusable[0]
    const last = focusable.at(-1)
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  return createPortal(
    <dialog ref={dialogRef} className="image-preview-dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={hintId}
      onCancel={(event) => { event.preventDefault(); onClose() }} onKeyDown={trapFocus}
      onClick={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div className="image-preview-panel">
        <header className="image-preview-header">
          <div><h2 id={titleId}>图片预览</h2><span className="image-result-meta">{metadata}</span></div>
          <button ref={closeRef} className="image-preview-icon" onClick={onClose} aria-label="关闭图片预览"><CloseCircle size={22} /></button>
        </header>
        <div ref={viewportRef} className="image-preview-viewport" tabIndex={0} aria-label="图片区域，可滚动查看放大后的图片">
          <div className="image-preview-canvas" style={{ width: Math.max(viewport.width, imageWidth), height: Math.max(viewport.height, imageHeight) }}>
            <img src={imageUrl} alt={alt} draggable={false} style={{ width: imageWidth || 1, height: imageHeight || 1, visibility: imageState === 'loaded' ? 'visible' : 'hidden' }}
              onLoad={(event) => { setNaturalSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight }); setImageState('loaded') }}
              onError={() => setImageState('error')} />
            {imageState !== 'loaded' && <div className="image-preview-placeholder" role={imageState === 'error' ? 'alert' : 'status'}>{imageState === 'error' ? '图片加载失败，可以尝试下载或打开原图。' : '正在加载图片…'}</div>}
          </div>
        </div>
        <footer className="image-preview-footer">
          <div className="image-preview-tools">
            <div className="image-zoom-controls" aria-label="图片缩放">
              <button className="image-preview-icon" aria-label="缩小图片" disabled={imageState !== 'loaded' || zoom <= .25} onClick={() => setZoom((value) => Math.max(.25, value / 1.25))}><Minus size={17} /></button>
              <output className="image-zoom-value" aria-live="polite">{imageState === 'loaded' ? `${Math.round(fitScale * zoom * 100)}%` : '—'}</output>
              <button className="image-preview-icon" aria-label="放大图片" disabled={imageState !== 'loaded' || zoom >= 8} onClick={() => setZoom((value) => Math.min(8, value * 1.25))}><Plus size={17} /></button>
              <button className="image-fit-button" disabled={imageState !== 'loaded'} onClick={() => setZoom(1)}><Expand size={15} />适应窗口</button>
            </div>
            <div className="image-preview-actions">
              <a className="image-original-link" href={imageUrl} target="_blank" rel="noopener noreferrer">原图<ArrowUpRight size={15} /></a>
              <button className="image-download-button is-primary" onClick={onDownload} disabled={downloadState.status === 'loading'}><Download size={16} />{downloadState.status === 'loading' ? '下载中…' : '下载图片'}</button>
            </div>
          </div>
          <div id={hintId} className="image-preview-hint">放大后可滚动查看细节，按 Esc 关闭</div>
          {downloadState.message && <div className={`image-download-feedback is-${downloadState.status}`} role={downloadState.status === 'error' ? 'alert' : 'status'}>{downloadState.message}</div>}
        </footer>
      </div>
    </dialog>, document.body,
  )
}
