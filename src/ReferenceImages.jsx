import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CloseCircle } from 'reicon-react/icons/CloseCircle'
import { Expand } from 'reicon-react/icons/Expand'
import { Plus } from 'reicon-react/icons/Plus'
import { Trash } from 'reicon-react/icons/Trash'
import './ReferenceImages.css'

function ReferencePreview({ image, number, label, onClose }) {
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
        <header className="reference-preview-header"><div><h2 id={titleId}>{label} {number}</h2><span>{image.width} × {image.height}</span></div><button ref={closeRef} className="icon-button" onClick={onClose} aria-label={`关闭${label}预览`}><CloseCircle size={22} /></button></header>
        <div className="reference-preview-content"><img src={image.dataUrl} alt={`${label} ${number}：${image.name}`} /></div>
        <div className="reference-preview-name">{image.name}</div>
      </div>
    </dialog>, document.body,
  )
}

export default function ReferenceImages({ images, mode = 'chat', onRemove, onAdd, disabled = false, processing = false }) {
  const [preview, setPreview] = useState(null)
  const editable = Boolean(onRemove)
  const label = mode === 'image' ? '参考图' : '图片'
  return (
    <div className={`reference-images ${editable ? 'is-editable' : 'is-message'}`} role="group" aria-label={`${editable ? '待发送' : '消息中的'}${label}`}>
      <div className="reference-images-heading"><span>{label} {images.length}{editable ? ' / 3' : ' 张'}</span>{editable && <span>{mode === 'image' ? '点击生成时上传' : '发送后即可看图提问'}</span>}</div>
      <div className="reference-image-list">
        {images.map((image, index) => <div className="reference-image-item" key={image.id}>
          <button className="reference-image-view" onClick={() => setPreview({ image, number: index + 1 })} aria-label={`查看${label} ${index + 1}：${image.name}`}>
            <img src={image.dataUrl} alt={`${label} ${index + 1}`} />
            <span className="reference-image-number">图 {index + 1}</span><Expand className="reference-expand-icon" size={14} />
          </button>
          {editable && <button className="reference-image-remove" disabled={disabled} onClick={() => onRemove(image.id)} aria-label={`移除${label} ${index + 1}`}><Trash size={13} /></button>}
        </div>)}
        {onAdd && images.length < 3 && <button className="reference-image-add" onClick={onAdd} disabled={disabled} aria-label={`添加${label}`}><Plus size={19} /><span>{processing ? '处理中' : '添加图片'}</span></button>}
      </div>
      {preview && <ReferencePreview {...preview} label={label} onClose={() => setPreview(null)} />}
    </div>
  )
}
