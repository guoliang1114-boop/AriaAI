/** Read only a displayable API detail; malformed payloads use the fallback. */
export function errorMessage(error: unknown, fallback: string): string {
  if (error && typeof error === 'object' && 'response' in error) {
    const response = error.response
    if (response && typeof response === 'object' && 'data' in response) {
      const data = response.data
      if (data && typeof data === 'object' && 'detail' in data && typeof data.detail === 'string' && data.detail) {
        return data.detail
      }
    }
  }
  return error instanceof Error && error.message ? error.message : fallback
}
