// App limits are intentionally smaller than the model provider's limits.
export const MAX_CHAT_IMAGES = 12
export const MAX_CHAT_IMAGE_DATA_URL_BYTES = 1024 * 1024
export const MAX_CHAT_REQUEST_BYTES = MAX_CHAT_IMAGES * MAX_CHAT_IMAGE_DATA_URL_BYTES + 512 * 1024
export const MAX_CHAT_MESSAGE_CHARS = 16000
export const MAX_CHAT_TEXT_CHARS = 64000
export const MAX_CHAT_MESSAGES = 50
