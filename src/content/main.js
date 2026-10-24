/*
 * main.js — content-script orchestrator for Facebook Page / Meta Business Suite inbox.
 * Watches the open conversation, asks the service worker for a decision, then either shows a draft
 * (co-pilot) or sends it with human pacing (auto-pilot). Unknown/risky cases pause the thread.
 */
(function () {
  'use strict';
  const A = globalThis.ACC;
  if (!A || !A.fb || window.top !== window) return; // run only in the top frame

  let settings = null;
  let business = null;
  let threads = {}; // threadId -> { paused, reason, lastHash, replyTimes[], greeted, holdingSent }
  let busy = false;
  let currentDraftThread = null;

  const send = (msg) => new Promise((resolve) => chrome.runtime.sendMessage(msg, (r) => resolve(r || { ok: false, error: chrome.runtime.lastError && chrome.runtime.lastError.message })));

  async function loadAll() {
    const r = await send({ type: 'GET_SETTINGS' });
    if (r.ok) {
      settings = r.settings;
      business = r.business;
    }
    const { threads: t } = await chrome.storage.local.get('threads');
    threads = t || {};
    A.overlay.setMode(settings ? settings.mode : 'off');
  }
  const saveThreads = () => chrome.storage.local.set({ threads });
  const st = (id) => (threads[id] = threads[id] || { paused: false, reason: '', lastHash: '', replyTimes: [], greeted: false, holdingSent: false });

  function recentReplies(state) {
    const cutoff = Date.now() - 3600 * 1000;
    state.replyTimes = (state.replyTimes || []).filter((t) => t > cutoff);
    return state.replyTimes.length;
  }

  function splitBubbles(text) {
    return text.split(/\n{2,}|\n/).map((s) => s.trim()).filter(Boolean);
  }

  function withDisclosure(bubbles, state) {
    if (state.greeted || !settings.disclosureNote) return bubbles;
    const out = bubbles.slice();
    out[0] = `${out[0]} ${settings.disclosureNote}`.trim();
    return out;
  }

  async function pauseThread(threadId, customerName, reason) {
    const s = st(threadId);
    s.paused = true;
    s.reason = reason;
    await saveThreads();
    A.overlay.setPaused(true, reason);
    A.overlay.setStatus('Paused — waiting for you');
    send({ type: 'ESCALATION_ALERT', customerName, reason });
  }

  async function resumeThread(threadId) {
    const s = st(threadId);
    s.paused = false;
    s.reason = '';
    await saveThreads();
    A.overlay.setPaused(false);
    A.overlay.setStatus('Bot resumed');
  }

  async function deliver(threadId, bubbles, { paced }) {
    const s = st(threadId);
    const cancelled = () => !settings || settings.mode === 'off' || A.fb.getThreadId() !== threadId || st(threadId).paused;
    let ok;
    if (paced) {
      A.overlay.setStatus('Reading…');
      if (!(await A.typer.readingDelay(settings.pacing, cancelled))) return false;
      // A newer customer message may have arrived while we waited: abort and let the next tick handle it.
      const t = A.fb.getThread();
      const last = t && t.messages[t.messages.length - 1];
      if (!last || last.role !== 'customer') return false;
      A.overlay.setStatus('Typing…');
      ok = await A.typer.sendBubbles(bubbles, settings.pacing, cancelled);
    } else {
      ok = true;
      for (let i = 0; i < bubbles.length && ok; i++) {
        ok = A.fb.setComposerText(bubbles[i]);
        await A.typer.sleep(400);
        ok = ok && A.fb.clickSend();
        await A.typer.sleep(900);
      }
    }
    if (ok) {
      s.replyTimes.push(Date.now());
      s.greeted = true;
      await saveThreads();
    }
    return ok;
  }

  async function process(thread, state, hash) {
    A.overlay.hideDraft();
    A.overlay.setStatus('Thinking…');
    const res = await send({ type: 'GENERATE', thread: { customerName: thread.customerName, messages: thread.messages }, recentReplyCount: recentReplies(state) });
    if (!res.ok) {
      A.overlay.setStatus('AI error: ' + res.error);
      return; // lastHash is already set, so a failing provider cannot cause a request loop
    }
    const d = res.decision;
    const mode = settings.mode;

    if (d.action === 'escalate') {
      await pauseThread(thread.threadId, thread.customerName, d.reason);
      const holding = settings.holdingMessages && settings.holdingMessages.length
        ? settings.holdingMessages[Math.floor(Math.random() * settings.holdingMessages.length)]
        : '';
      if (holding && !state.holdingSent) {
        if (mode === 'autopilot' && settings.sendHoldingMessage) {
          state.holdingSent = true;
          await saveThreads();
          await deliver(thread.threadId, [holding], { paced: true });
          A.overlay.setStatus('Paused — holding message sent, waiting for you');
        } else if (mode === 'copilot') {
          currentDraftThread = thread.threadId;
          A.overlay.showDraft(holding);
        }
      }
      return;
    }

    const bubbles = withDisclosure(d.replies, state);
    if (mode === 'copilot') {
      currentDraftThread = thread.threadId;
      A.overlay.showDraft(bubbles.join('\n\n'));
      A.overlay.setStatus(`Draft ready (${d.provider}, confidence ${Number(d.confidence).toFixed(2)})`);
    } else if (mode === 'autopilot') {
      const ok = await deliver(thread.threadId, bubbles, { paced: true });
      A.overlay.setStatus(ok ? 'Replied' : 'Send cancelled or failed');
      if (!ok) state.lastHash = ''; // allow a retry on the next tick if it was only cancelled
    }
  }

  async function tick() {
    if (busy || !settings || settings.mode === 'off' || !A.fb.isInbox()) return;
    const thread = A.fb.getThread();
    if (!thread || !thread.messages.length) return;
    const state = st(thread.threadId);
    const last = thread.messages[thread.messages.length - 1];

    A.overlay.setPaused(state.paused, state.reason);

    // The human owner replied in a paused thread → bot hands control back automatically.
    if (state.paused && last.role === 'owner') {
      await resumeThread(thread.threadId);
      state.lastHash = A.simpleHash(thread.threadId + last.text + thread.messages.length);
      await saveThreads();
      return;
    }
    if (state.paused || last.role !== 'customer') return;

    const hash = A.simpleHash(thread.threadId + last.text + thread.messages.length);
    if (hash === state.lastHash) return;
    state.lastHash = hash;
    await saveThreads();

    busy = true;
    try {
      await process(thread, state, hash);
    } catch (e) {
      A.overlay.setStatus('Error: ' + (e.message || e));
    } finally {
      busy = false;
    }
  }

  // ---- overlay handlers ----
  A.overlay.init({
    onMode: async (mode) => {
      await send({ type: 'SET_MODE', mode });
      await loadAll();
      A.overlay.setStatus(mode === 'off' ? 'Off' : 'Mode: ' + mode);
    },
    onSend: async (text) => {
      if (!text) return;
      const id = currentDraftThread || A.fb.getThreadId();
      const ok = await deliver(id, splitBubbles(text), { paced: false });
      if (ok) {
        A.overlay.hideDraft();
        A.overlay.setStatus('Sent');
      } else A.overlay.setStatus('Could not send — is the chat open?');
    },
    onRegenerate: async () => {
      const t = A.fb.getThread();
      if (!t) return;
      busy = true;
      try {
        await process(t, st(t.threadId), '');
      } finally {
        busy = false;
      }
    },
    onDismiss: () => {
      A.overlay.hideDraft();
      A.overlay.setStatus('Draft dismissed');
    },
    onPause: () => {
      const id = A.fb.getThreadId();
      pauseThread(id, A.fb.getCustomerName(), 'paused manually');
    },
    onResume: () => resumeThread(A.fb.getThreadId())
  });

  // ---- messages from the popup ----
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg) return;
    if (msg.type === 'SCAN_PAGE') {
      const scan = A.scanner.scanPage();
      send({ type: 'SAVE_SCAN', scan }).then((r) => sendResponse({ ok: r.ok, scan, error: r.error }));
      return true;
    }
    if (msg.type === 'LEARN_STYLE') {
      const samples = A.scanner.collectOwnerSamples(A.fb.getThread());
      send({ type: 'SAVE_STYLE_SAMPLES', samples }).then((r) => sendResponse({ ok: r.ok, found: samples.length, total: r.count, error: r.error }));
      return true;
    }
    if (msg.type === 'DIAGNOSTICS') {
      sendResponse({ ok: true, data: A.fb.diagnostics() });
      return;
    }
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && (changes.settings || changes.business)) loadAll();
  });

  loadAll().then(() => {
    const obs = new MutationObserver(() => {
      clearTimeout(obs._t);
      obs._t = setTimeout(tick, 1200);
    });
    obs.observe(document.body, { childList: true, subtree: true, characterData: true });
    setInterval(tick, 4000); // Meta virtualises the DOM; polling is the safety net
  });
})();
