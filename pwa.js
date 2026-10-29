/* Progressive Web App registration.
   URLs are resolved from this module's own location, so the app installs
   correctly at the domain root and under a project path such as
   https://user.github.io/SemesterOS/. */

export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  if (!/^https?:$/.test(window.location.protocol)) return;

  const swUrl = new URL('../sw.js', import.meta.url);
  const scope = new URL('../', import.meta.url);

  const register = () => {
    navigator.serviceWorker
      .register(swUrl, { scope })
      .then((registration) => {
        // Pick up a new worker promptly on the next navigation.
        registration.update().catch(() => {});
      })
      .catch((error) => {
        // A failed registration must never take the app down; it only means
        // the offline shell is unavailable in this browser/session.
        console.warn('[SemesterOS] Service worker registration failed:', error);
      });
  };

  if (document.readyState === 'complete') {
    register();
  } else {
    window.addEventListener('load', register, { once: true });
  }
}
