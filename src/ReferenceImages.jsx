import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CloseCircle } from 'reicon-react/icons/CloseCircle'
import { Expand } from 'reicon-react/icons/Expand'
import { Plus } from 'reicon-react/icons/Plus'
import { Trash } from 'reicon-react/icons/Trash'
import './ReferenceImages.css'

function ReferencePreview({ image, number, onClose }) {
  const dialogRef = useRef(null)
  const closeRef = useRef(null)
  const titleId = useId()

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

  return createPortal(
    <dialog ref={dialogRef} className="reference-preview-dialog" aria-modal="true" aria-labelledby={titleId}
      onCancel={(event) => { event.preventDefault(); onClose() }}
      onClick={(event) => { if (event.target === event.currentTarget) onClose() }}
      onKeyDown={(event) => { if (event.key === 'Tab') { event.preventDefault(); closeRef.current.focus() } }}>
      <div className="reference-preview-panel">
        <header className="reference-preview-header"><div><h2 id={titleId}>参考图 {number}</h2><span>{image.width} × {image.height}</span></div><button ref={closeRef} className="icon-button" onClick={onClose} aria-label="关闭参考图预览"><CloseCircle size={22} /></button></header>
        <div className="reference-preview-content"><img src={image.dataUrl} alt={`参考图 ${number}：${image.name}`} /></div>
        <div className="reference-preview-name">{image.name}</div>
      </div>
    </dialog>, document.body,
  )
}

export default function ReferenceImages({ images, onRemove, onAdd, disabled = false, processing = false }) {
  const [preview, setPreview] = useState(null)
  const editable = Boolean(onRemove)
  return (
    <div className={`reference-images ${editable ? 'is-editable' : 'is-message'}`}>
      <div className="reference-images-heading"><span>参考图 {images.length}{editable ? ' / 3' : ' 张'}</span>{editable && <span>点击生成时上传</span>}</div>
      <div className="reference-image-list">
        {images.map((image, index) => <div className="reference-image-item" key={image.id}>
          <button className="reference-image-view" onClick={() => setPreview({ image, number: index + 1 })} aria-label={`查看参考图 ${index + 1}：${image.name}`}>
            <img src={image.dataUrl} alt={`参考图 ${index + 1}`} />
            <span className="reference-image-number">图 {index + 1}</span><Expand className="reference-expand-icon" size={14} />
          </button>
          {editable && <button className="reference-image-remove" disabled={disabled} onClick={() => onRemove(image.id)} aria-label={`移除参考图 ${index + 1}`}><Trash size={13} /></button>}
        </div>)}
        {onAdd && images.length < 3 && <button className="reference-image-add" onClick={onAdd} disabled={disabled} aria-label="添加参考图片"><Plus size={19} /><span>{processing ? '处理中' : '添加图片'}</span></button>}
      </div>
      {preview && <ReferencePreview {...preview} onClose={() => setPreview(null)} />}
    </div>
  )
}
