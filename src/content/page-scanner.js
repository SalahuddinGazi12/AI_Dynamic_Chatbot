/*
 * page-scanner.js — "Scan My Page": reads what is already visible on the open Facebook Page tab.
 * It only reads the active tab the owner is looking at. It never opens tabs or crawls.
 * Results are DRAFTS: the owner reviews/edits them in the settings dashboard.
 */
(function (root) {
  'use strict';

  function meta(name) {
    const el = document.querySelector(`meta[property="${name}"], meta[name="${name}"]`);
    return el ? (el.getAttribute('content') || '').trim() : '';
  }

  function scanPage() {
    const title = (meta('og:title') || document.title || '').replace(/\s*\|\s*Facebook.*$/i, '').trim();
    const about = meta('og:description') || meta('description');

    // Posts: Facebook marks feed items with role="article".
    const posts = [];
    document.querySelectorAll('div[role="article"]').forEach((a) => {
      if (posts.length >= 15) return;
      const text = (a.innerText || '').replace(/\n{2,}/g, '\n').trim();
      if (text.length > 20 && text.length < 1500) posts.push(text.slice(0, 700));
    });

    // Category / contact lines usually appear in the intro card.
    const introText = Array.from(document.querySelectorAll('div[role="main"] span[dir="auto"]'))
      .map((s) => s.innerText.trim())
      .filter((t) => t && t.length < 120);
    const category = (introText.find((t) => /^page\s*[·•]\s*/i.test(t)) || '').replace(/^page\s*[·•]\s*/i, '');

    return { name: title, category, about, scannedPosts: posts };
  }

  /** Owner's own past replies in the open conversation → style samples. */
  function collectOwnerSamples(thread) {
    if (!thread) return [];
    return thread.messages
      .filter((m) => m.role === 'owner' && m.text.length > 8 && m.text.length < 400)
      .map((m) => m.text)
      .slice(-10);
  }

  root.ACC = Object.assign(root.ACC || {}, { scanner: { scanPage, collectOwnerSamples } });
})(globalThis);
