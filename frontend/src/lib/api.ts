/**
 * Unified API Configuration for RailSync AI
 * Supports environment variable VITE_API_BASE_URL for production deployments,
 * falling back to local development URL http://127.0.0.1:8001
 */
export const API_BASE_URL: string =
  (import.meta.env.VITE_API_BASE_URL as string)?.replace(/\/+$/, '') || 'http://127.0.0.1:8001'

export function getApiUrl(path: string): string {
  const cleanPath = path.startsWith('/') ? path : `/${path}`
  return `${API_BASE_URL}${cleanPath}`
}
