import { track } from '@vercel/analytics'

export const trackPromotionEvent = (event: string, properties: Record<string, string>) => {
  track(event, properties)
  if (typeof window !== 'undefined') {
    const runtimeWindow = window as Window & {
      gtag?: (...args: unknown[]) => void
    }
    if (!runtimeWindow.gtag) return
    try {
      runtimeWindow.gtag('event', event, { ...properties })
      if (properties.action_detail) {
        runtimeWindow.gtag('event', properties.action_detail)
      }
    } catch (error) {
      console.error(error)
    }
  }
}
