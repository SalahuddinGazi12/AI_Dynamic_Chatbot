/*
 * human-typer.js — pacing for auto-pilot sends: a reading delay, then character-by-character input
 * through execCommand('insertText') so the page's own input handlers (React) see normal typing events.
 */
(function (root) {
  'use strict';

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function readingDelay(pacing, cancelled) {
    const ms = root.ACC.randBetween(pacing.readDelayMinSec, pacing.readDelayMaxSec) * 1000;
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (cancelled && cancelled()) return false;
      await sleep(250);
    }
    return true;
  }

  /** Types `text` into the composer at a human-ish speed. Returns false if cancelled or composer vanished. */
  async function typeInto(text, pacing, cancelled) {
    const fb = root.ACC.fb;
    const box = fb.getComposer();
    if (!box) return false;
    box.focus();
    document.execCommand('selectAll', false, null);
    document.execCommand('delete', false, null);

    const wpm = root.ACC.randBetween(pacing.typingWpmMin, pacing.typingWpmMax);
    const baseMs = 60000 / (wpm * 5); // 5 chars per word
    for (const ch of text) {
      if (cancelled && cancelled()) return false;
      if (!fb.getComposer()) return false;
      document.execCommand('insertText', false, ch);
      let d = baseMs * root.ACC.randBetween(0.5, 1.6);
      if (/[.,!?]/.test(ch)) d += root.ACC.randBetween(80, 260);
      await sleep(d);
    }
    return true;
  }

  async function sendBubbles(bubbles, pacing, cancelled) {
    const fb = root.ACC.fb;
    for (let i = 0; i < bubbles.length; i++) {
      const ok = await typeInto(bubbles[i], pacing, cancelled);
      if (!ok) return false;
      await sleep(root.ACC.randBetween(300, 900));
      if (!fb.clickSend()) return false;
      if (i < bubbles.length - 1) await sleep(root.ACC.randBetween(1200, 3000));
    }
    return true;
  }

  root.ACC = Object.assign(root.ACC || {}, { typer: { readingDelay, typeInto, sendBubbles, sleep } });
})(globalThis);
