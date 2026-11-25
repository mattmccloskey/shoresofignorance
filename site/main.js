/**
 * Shores of Ignorance — One Page Site
 *
 * Episode data is now baked into index.html at build time from the RSS feed.
 * This file only handles runtime polish that doesn't affect content.
 */

(function () {
  // Update footer year
  const yearEl = document.getElementById('year');
  if (yearEl) yearEl.textContent = new Date().getFullYear();
})();
