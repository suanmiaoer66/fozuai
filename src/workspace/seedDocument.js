// Chat answers often use a bold first line instead of a Markdown heading.
// Move that title into the title field without keeping formatting delimiters.
export function documentFromChat(content) {
  const lines = content.split('\n')
  const firstIndex = lines.findIndex((line) => line.trim())
  const firstLine = firstIndex < 0 ? '' : lines[firstIndex].trim()
  const heading = firstLine.match(/^#{1,6}\s+(.+?)(?:\s+#+)?$/)?.[1]
  const emphasis = firstLine.match(/^(?:\*\*(.+)\*\*|__(.+)__)$/)
  const titleLine = heading || emphasis?.[1] || emphasis?.[2]
  const title = (titleLine || firstLine || '对话文档').replace(/^\*\*(.+)\*\*$/, '$1').trim()
  if (titleLine && title.length <= 120) {
    lines.splice(firstIndex, 1)
    return { title, content: lines.join('\n').trim(), assets: [] }
  }
  return { title: title.slice(0, 40), content, assets: [] }
}
