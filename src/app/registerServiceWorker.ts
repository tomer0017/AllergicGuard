/**
 * PWA registration (production only).
 *
 * The service worker caches the app shell so the tool opens instantly on a
 * kindergarten's weak Wi-Fi. It deliberately never caches provider API
 * responses: stale allergen data must never be shown as if it were fresh.
 */

export function registerServiceWorker(): void {
  if (!import.meta.env.PROD) return;
  if (!('serviceWorker' in navigator)) return;

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Offline app-shell caching is an optimization; failing to register it
      // must never break the scanner.
    });
  });
}
