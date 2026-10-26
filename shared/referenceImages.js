export const MAX_REFERENCE_IMAGES = 3
export const MAX_REFERENCE_IMAGE_BYTES = 1024 * 1024
export const REFERENCE_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp']
// APIMart's documented upload host and the CDN returned by its live upload API.
const REFERENCE_UPLOAD_ORIGINS = new Set(['https://upload.apimart.ai', 'https://getapib.org'])

// Reference files must come from the image service's upload endpoint.
export function isUploadedReferenceUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) return false
  try {
    const url = new URL(value)
    return REFERENCE_UPLOAD_ORIGINS.has(url.origin) && !url.username && !url.password && !url.hash && url.pathname !== '/'
  } catch {
    return false
  }
}
