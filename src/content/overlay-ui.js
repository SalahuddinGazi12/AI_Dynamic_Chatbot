/*
 * overlay-ui.js — floating control bar inside the chat page (Shadow DOM so Facebook's CSS can't touch it).
 * Shows: current mode, a draft with [Send] [Edit] [Dismiss] in co-pilot, status line, pause/resume.
 */
(function (root) {
  'use strict';

  let host, shadow, els = {}, handlers = {};

  const CSS = `
    :host { all: initial; }
    .bar { position: fixed; right: 16px; bottom: 16px; width: 340px; z-index: 2147483647;
      font: 13px/1.4 system-ui, sans-serif; color: #1c1e21; background: #fff; border: 1px solid #d0d4da;
      border-radius: 12px; box-shadow: 0 6px 24px rgba(0,0,0,.18); overflow: hidden; }
    .head { display:flex; align-items:center; gap:8px; padding:8px 10px; background:#f0f2f5; cursor: default; }
    .dot { width:8px; height:8px; border-radius:50%; background:#8a8d91; }
    .dot.copilot { background:#1877f2; } .dot.autopilot { background:#31a24c; } .dot.paused { background:#e41e3f; }
    .title { font-weight:600; flex:1; }
    select, button, textarea { font: inherit; }
    .body { padding:10px; display:none; }
    .body.open { display:block; }
    .status { color:#65676b; margin-bottom:8px; min-height:1.4em; }
    textarea { width:100%; box-sizing:border-box; min-height:84px; resize:vertical; padding:8px; border:1px solid #ccd0d5; border-radius:8px; }
    .row { display:flex; gap:6px; margin-top:8px; flex-wrap:wrap; }
    button { border:0; border-radius:8px; padding:6px 12px; cursor:pointer; background:#e4e6eb; }
    button.primary { background:#1877f2; color:#fff; }
    button.danger { background:#fde8ec; color:#c0152f; }
    .alert { background:#fff4e5; border:1px solid #ffd59e; padding:8px; border-radius:8px; margin-bottom:8px; display:none; }
    .alert.show { display:block; }
  `;

  function build() {
    host = document.createElement('div');
    host.id = 'acc-overlay-host';
    shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <style>${CSS}</style>
      <div class="bar">
        <div class="head">
          <span class="dot" id="dot"></span>
          <span class="title">AI Dynamic Chatbot</span>
          <select id="mode" title="Mode">
            <option value="off">Off</option>
            <option value="copilot">Co-pilot</option>
            <option value="autopilot">Auto-pilot</option>
          </select>
          <button id="toggle" title="Show / hide">▾</button>
        </div>
        <div class="body open" id="body">
          <div class="alert" id="alert"></div>
          <div class="status" id="status">Idle</div>
          <textarea id="draft" placeholder="Draft reply appears here (co-pilot)" style="display:none"></textarea>
          <div class="row" id="draftRow" style="display:none">
            <button class="primary" id="send">Approve &amp; send</button>
            <button id="regen">Regenerate</button>
            <button class="danger" id="dismiss">Dismiss</button>
          </div>
          <div class="row">
            <button id="pause">Pause this chat</button>
            <button id="resume" style="display:none">Resume bot</button>
          </div>
        </div>
      </div>`;
    const $ = (id) => shadow.getElementById(id);
    els = {
      dot: $('dot'), mode: $('mode'), toggle: $('toggle'), body: $('body'), alert: $('alert'),
      status: $('status'), draft: $('draft'), draftRow: $('draftRow'), send: $('send'),
      regen: $('regen'), dismiss: $('dismiss'), pause: $('pause'), resume: $('resume')
    };
    els.toggle.onclick = () => els.body.classList.toggle('open');
    els.mode.onchange = () => handlers.onMode && handlers.onMode(els.mode.value);
    els.send.onclick = () => handlers.onSend && handlers.onSend(els.draft.value.trim());
    els.regen.onclick = () => handlers.onRegenerate && handlers.onRegenerate();
    els.dismiss.onclick = () => handlers.onDismiss && handlers.onDismiss();
    els.pause.onclick = () => handlers.onPause && handlers.onPause();
    els.resume.onclick = () => handlers.onResume && handlers.onResume();
    document.documentElement.appendChild(host);
  }

  function init(h) {
    handlers = h || {};
    if (!host) build();
  }

  function setMode(mode) {
    els.mode.value = mode;
    els.dot.className = 'dot ' + (mode === 'off' ? '' : mode);
  }
  function setStatus(text) { els.status.textContent = text; }
  function showDraft(text) {
    els.draft.style.display = 'block';
    els.draftRow.style.display = 'flex';
    els.draft.value = text;
  }
  function hideDraft() {
    els.draft.style.display = 'none';
    els.draftRow.style.display = 'none';
    els.draft.value = '';
  }
  function setPaused(paused, reason) {
    els.pause.style.display = paused ? 'none' : '';
    els.resume.style.display = paused ? '' : 'none';
    els.alert.classList.toggle('show', !!paused);
    els.alert.textContent = paused ? `Needs you: ${reason || 'bot paused on this chat'}` : '';
    if (paused) els.dot.className = 'dot paused';
  }

  root.ACC = Object.assign(root.ACC || {}, { overlay: { init, setMode, setStatus, showDraft, hideDraft, setPaused } });
})(globalThis);
