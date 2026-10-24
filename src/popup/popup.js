(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const A = globalThis.ACC || {};
  let stored = { settings: {}, business: {} };

  const clone = (o) => JSON.parse(JSON.stringify(o));

  function mergeDeep(base, extra) {
    for (const k of Object.keys(extra || {})) {
      if (extra[k] && typeof extra[k] === 'object' && !Array.isArray(extra[k]) && base[k] && typeof base[k] === 'object') mergeDeep(base[k], extra[k]);
      else base[k] = extra[k];
    }
    return base;
  }

  function say(id, text, cls) {
    const el = $(id);
    el.textContent = text;
    el.className = 'result ' + (cls || '');
  }

  async function activeTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab;
  }

  async function toTab(msg) {
    const tab = await activeTab();
    if (!tab || !/facebook\.com/.test(tab.url || '')) throw new Error('Open your Facebook Page / Business Suite tab first.');
    return new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(tab.id, msg, (r) => {
        if (chrome.runtime.lastError) reject(new Error('Reload the Facebook tab once, then try again.'));
        else resolve(r);
      });
    });
  }

  // ---- load / render ----
  async function load() {
    const data = await chrome.storage.local.get(['settings', 'business']);
    const settings = mergeDeep(clone(A.DEFAULT_SETTINGS), data.settings || {});
    const business = Object.assign(clone(A.DEFAULT_BUSINESS), data.business || {});
    stored = { settings, business };
    render(settings, business);
  }

  function render(s, b) {
    $('mode').value = s.mode;
    $('b-name').value = b.name;
    $('b-category').value = b.category;
    $('b-language').value = b.language;
    $('b-about').value = b.about;
    $('b-services').value = b.services;
    $('b-faqs').value = b.faqs;
    $('b-rules').value = b.rules;
    $('b-styles').value = (b.ownerStyleSamples || []).join('\n');
    $('posts-count').textContent = (b.scannedPosts || []).length;
    $('b-posts').textContent = (b.scannedPosts || []).join('\n\n---\n\n');

    $('p-order').value = s.providers.order.join(', ');
    for (const n of ['gemini', 'groq', 'openrouter']) {
      $(n + '-key').value = s.providers[n].key;
      $(n + '-model').value = s.providers[n].model;
    }
    $('ollama-url').value = s.providers.ollama.url;
    $('ollama-model').value = s.providers.ollama.model;

    $('g-conf').value = s.guardrails.minConfidence;
    $('g-nums').checked = !!s.guardrails.blockUnknownNumbers;
    $('g-rate').value = s.guardrails.maxRepliesPerThreadPerHour;
    $('pc-rmin').value = s.pacing.readDelayMinSec;
    $('pc-rmax').value = s.pacing.readDelayMaxSec;
    $('pc-wmin').value = s.pacing.typingWpmMin;
    $('pc-wmax').value = s.pacing.typingWpmMax;
    $('s-lower').checked = !!s.style.lowercase;
    $('h-send').checked = !!s.sendHoldingMessage;
    $('h-msgs').value = (s.holdingMessages || []).join('\n');
    $('d-note').value = s.disclosureNote || '';
  }

  function collect() {
    const s = clone(stored.settings);
    const b = clone(stored.business);
    s.mode = $('mode').value;
    b.name = $('b-name').value.trim();
    b.category = $('b-category').value.trim();
    b.language = $('b-language').value.trim() || 'English';
    b.about = $('b-about').value.trim();
    b.services = $('b-services').value.trim();
    b.faqs = $('b-faqs').value.trim();
    b.rules = $('b-rules').value.trim();
    b.ownerStyleSamples = $('b-styles').value.split('\n').map((x) => x.trim()).filter(Boolean).slice(0, 10);

    const valid = ['gemini', 'groq', 'openrouter', 'ollama'];
    const order = $('p-order').value.split(',').map((x) => x.trim().toLowerCase()).filter((x) => valid.includes(x));
    s.providers.order = order.length ? order : valid;
    for (const n of ['gemini', 'groq', 'openrouter']) {
      s.providers[n].key = $(n + '-key').value.trim();
      s.providers[n].model = $(n + '-model').value.trim();
    }
    s.providers.ollama.url = $('ollama-url').value.trim();
    s.providers.ollama.model = $('ollama-model').value.trim();

    const num = (id, d) => (Number.isFinite(Number($(id).value)) && $(id).value !== '' ? Number($(id).value) : d);
    s.guardrails.minConfidence = Math.max(0, Math.min(1, num('g-conf', 0.7)));
    s.guardrails.blockUnknownNumbers = $('g-nums').checked;
    s.guardrails.maxRepliesPerThreadPerHour = Math.max(1, num('g-rate', 6));
    s.pacing.readDelayMinSec = num('pc-rmin', 15);
    s.pacing.readDelayMaxSec = Math.max(s.pacing.readDelayMinSec, num('pc-rmax', 35));
    s.pacing.typingWpmMin = num('pc-wmin', 45);
    s.pacing.typingWpmMax = Math.max(s.pacing.typingWpmMin, num('pc-wmax', 65));
    s.style.lowercase = $('s-lower').checked;
    s.sendHoldingMessage = $('h-send').checked;
    s.holdingMessages = $('h-msgs').value.split('\n').map((x) => x.trim()).filter(Boolean);
    s.disclosureNote = $('d-note').value.trim();
    return { s, b };
  }

  // ---- events ----
  document.querySelectorAll('nav button').forEach((btn) =>
    btn.addEventListener('click', () => {
      document.querySelectorAll('nav button, .tab').forEach((e) => e.classList.remove('active'));
      btn.classList.add('active');
      $('tab-' + btn.dataset.tab).classList.add('active');
    })
  );

  $('save').addEventListener('click', async () => {
    const { s, b } = collect();
    await chrome.storage.local.set({ settings: s, business: b });
    stored = { settings: s, business: b };
    say('res-save', 'Saved', 'ok');
    setTimeout(() => say('res-save', ''), 2000);
  });

  document.querySelectorAll('[data-test]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      const name = btn.dataset.test;
      const { s, b } = collect();
      await chrome.storage.local.set({ settings: s, business: b }); // test with what's on screen
      say('res-' + name, 'Testing…');
      const r = await chrome.runtime.sendMessage({ type: 'TEST_PROVIDER', provider: name });
      if (r && r.ok) say('res-' + name, 'Works', 'ok');
      else say('res-' + name, (r && r.error) || 'Failed', 'err');
    })
  );

  $('scan').addEventListener('click', async () => {
    try {
      const r = await toTab({ type: 'SCAN_PAGE' });
      if (!r || !r.ok) throw new Error((r && r.error) || 'scan failed');
      say('res-scan', `Found ${r.scan.scannedPosts.length} posts. Review them in the Business tab.`, 'ok');
      await load();
    } catch (e) {
      say('res-scan', e.message, 'err');
    }
  });

  $('learn').addEventListener('click', async () => {
    try {
      const r = await toTab({ type: 'LEARN_STYLE' });
      if (!r || !r.ok) throw new Error((r && r.error) || 'failed');
      say('res-learn', `Found ${r.found} of your replies (${r.total} saved).`, 'ok');
      await load();
    } catch (e) {
      say('res-learn', e.message, 'err');
    }
  });

  $('diag').addEventListener('click', async () => {
    try {
      const r = await toTab({ type: 'DIAGNOSTICS' });
      await navigator.clipboard.writeText(JSON.stringify(r.data, null, 2));
      say('res-diag', r.data.composerFound ? 'Copied. Message box found.' : 'Copied. Message box NOT found.', r.data.composerFound ? 'ok' : 'err');
    } catch (e) {
      say('res-diag', e.message, 'err');
    }
  });

  load();
})();
