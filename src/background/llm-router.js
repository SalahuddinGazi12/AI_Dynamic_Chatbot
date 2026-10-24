/*
 * llm-router.js — BYOK multi-provider router with automatic fallback.
 * Providers: Google Gemini (AI Studio), Groq, OpenRouter (e.g. DeepSeek), Ollama (local).
 * Free-tier model names change often — they are all editable in settings.
 */
(function (root) {
  'use strict';

  async function postJson(url, body, headers, timeoutMs) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs || 45000);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: Object.assign({ 'Content-Type': 'application/json' }, headers || {}),
        body: JSON.stringify(body),
        signal: ctrl.signal
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
      return JSON.parse(text);
    } finally {
      clearTimeout(t);
    }
  }

  const providers = {
    async gemini(cfg, system, user) {
      if (!cfg.key) throw new Error('no Gemini API key');
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(cfg.model)}:generateContent`;
      const data = await postJson(
        url,
        {
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: 'user', parts: [{ text: user }] }],
          generationConfig: { temperature: 0.6, responseMimeType: 'application/json' }
        },
        { 'x-goog-api-key': cfg.key }
      );
      const parts = data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts;
      if (!parts) throw new Error('Gemini returned no content');
      return parts.map((p) => p.text || '').join('');
    },

    async groq(cfg, system, user) {
      if (!cfg.key) throw new Error('no Groq API key');
      const data = await postJson(
        'https://api.groq.com/openai/v1/chat/completions',
        {
          model: cfg.model,
          temperature: 0.6,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user }
          ]
        },
        { Authorization: `Bearer ${cfg.key}` }
      );
      return data.choices[0].message.content;
    },

    async openrouter(cfg, system, user) {
      if (!cfg.key) throw new Error('no OpenRouter API key');
      const data = await postJson(
        'https://openrouter.ai/api/v1/chat/completions',
        {
          model: cfg.model,
          temperature: 0.6,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user }
          ]
        },
        { Authorization: `Bearer ${cfg.key}`, 'X-Title': 'AI Dynamic Chatbot' }
      );
      return data.choices[0].message.content;
    },

    async ollama(cfg, system, user) {
      const base = (cfg.url || 'http://localhost:11434').replace(/\/$/, '');
      const data = await postJson(
        `${base}/api/chat`,
        {
          model: cfg.model,
          stream: false,
          format: 'json',
          options: { temperature: 0.6 },
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user }
          ]
        },
        {},
        120000
      );
      return data.message.content;
    }
  };

  /** Try each configured provider in order until one answers. Returns { text, provider }. */
  async function generate(settings, system, user, onlyProvider) {
    const p = settings.providers;
    const order = onlyProvider ? [onlyProvider] : p.order;
    const errors = [];
    for (const name of order) {
      const cfg = p[name];
      if (!cfg || !providers[name]) continue;
      const usable = name === 'ollama' ? !!cfg.model : !!cfg.key;
      if (!usable && !onlyProvider) continue; // skip providers the user hasn't configured
      try {
        const text = await providers[name](cfg, system, user);
        return { text, provider: name };
      } catch (e) {
        errors.push(`${name}: ${e.message}`);
      }
    }
    throw new Error(errors.length ? errors.join(' | ') : 'No AI provider configured. Open the extension settings and add a key.');
  }

  const api = { generate };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ACC = Object.assign(root.ACC || {}, api);
})(typeof self !== 'undefined' ? self : globalThis);
