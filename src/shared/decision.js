/*
 * decision.js — pure logic shared by the service worker, content scripts and tests.
 * No DOM, no chrome.* APIs in here, so it can be unit tested with plain Node.
 */
(function (root) {
  'use strict';

  const DEFAULT_SETTINGS = {
    mode: 'copilot', // 'off' | 'copilot' | 'autopilot'
    providers: {
      order: ['gemini', 'groq', 'openrouter', 'ollama'],
      gemini: { key: '', model: 'gemini-2.5-flash' },
      groq: { key: '', model: 'llama-3.3-70b-versatile' },
      openrouter: { key: '', model: 'deepseek/deepseek-chat' },
      ollama: { url: 'http://localhost:11434', model: 'llama3.1' }
    },
    guardrails: {
      minConfidence: 0.7, // below this the bot escalates instead of replying
      blockUnknownNumbers: true, // escalate if reply contains a price/number not in the knowledge base
      maxRepliesPerThreadPerHour: 6,
      maxBubbles: 3
    },
    pacing: {
      readDelayMinSec: 15,
      readDelayMaxSec: 35,
      typingWpmMin: 45,
      typingWpmMax: 65
    },
    style: {
      lowercase: false, // true = casual all-lowercase replies
      stripEmojiLimit: 1 // max emojis kept per reply
    },
    holdingMessages: [
      'hey, let me quickly check on this and get back to you in a bit',
      'give me a few mins, just checking, will let you know shortly'
    ],
    sendHoldingMessage: true, // autopilot only: send a holding message when escalating
    disclosureNote: '' // e.g. "(auto-assisted reply)". Appended to the FIRST reply in a thread when set.
  };

  const DEFAULT_BUSINESS = {
    name: '',
    category: '',
    language: 'English', // 'English', 'Bangla', 'Banglish', 'bilingual', ...
    about: '',
    services: '', // free text: products/services + prices
    faqs: '', // free text: Q/A pairs
    rules: '', // hidden rules: delivery charge, min order, returns...
    ownerStyleSamples: [], // up to 10 past owner replies
    scannedPosts: [] // filled by page scanner
  };

  // Phrases that make a reply sound like a bot. Removed from the start of a reply.
  const ROBOT_OPENERS = [
    /^certainly[!,.]?\s*/i,
    /^absolutely[!,.]?\s*/i,
    /^of course[!,.]?\s*/i,
    /^sure thing[!,.]?\s*/i,
    /^great question[!,.]?\s*/i,
    /^i understand (your|that)[^.!?]*[.!?]\s*/i,
    /^thank you for (reaching out|contacting|your message)[^.!?]*[.!?]\s*/i,
    /^as an ai[^.!?]*[.!?]\s*/i,
    /^here(?:'s| is| are) (a|the|an)[^:]*:\s*/i
  ];

  const AI_GIVEAWAYS = [/\bas an ai\b/i, /\blanguage model\b/i, /\bi (?:cannot|can't) assist with that\b/i];

  // Customer is sincerely asking whether they are talking to a bot/AI.
  // We never deny it: the thread is handed to the owner instead.
  const BOT_QUESTION = [
    /\b(are|r)\s+(you|u)\s+(a\s+|an\s+)?(bot|robot|ai|chatbot|chat\s*gpt|automated|machine)\b/i,
    /\b(is\s+this|am\s+i\s+(talking|chatting)\s+(to|with))\s+(a\s+|an\s+)?(bot|robot|ai|chatbot|real\s+(person|human)|human)\b/i,
    /\b(real|actual)\s+(person|human)\b/i,
    /\b(bot|robot)\s*\?/i
  ];

  function customerAsksIfBot(text) {
    return BOT_QUESTION.some((re) => re.test(text || ''));
  }

  // ---------- JSON extraction / validation of the model output ----------

  function extractJson(raw) {
    if (raw == null) return null;
    let s = String(raw).trim();
    s = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
    try {
      return JSON.parse(s);
    } catch (_) {
      /* fall through */
    }
    const start = s.indexOf('{');
    const end = s.lastIndexOf('}');
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(s.slice(start, end + 1));
      } catch (_) {
        return null;
      }
    }
    return null;
  }

  /**
   * Normalises raw model text into a decision:
   * { action: 'reply'|'escalate', confidence, replies[], reason, analysis }
   * Anything malformed becomes an escalation — we never send garbage to a customer.
   */
  function parseDecision(raw) {
    const j = extractJson(raw);
    if (!j || typeof j !== 'object') {
      return { action: 'escalate', confidence: 0, replies: [], reason: 'model returned unparseable output', analysis: {} };
    }
    let action = j.action === 'reply' ? 'reply' : 'escalate';
    let confidence = Number(j.confidence);
    if (!Number.isFinite(confidence)) confidence = 0;
    confidence = Math.max(0, Math.min(1, confidence));
    let replies = Array.isArray(j.replies) ? j.replies : typeof j.reply === 'string' ? [j.reply] : [];
    replies = replies.filter((r) => typeof r === 'string' && r.trim()).map((r) => r.trim());
    if (action === 'reply' && replies.length === 0) action = 'escalate';
    return {
      action,
      confidence,
      replies,
      reason: typeof j.reason === 'string' ? j.reason : '',
      analysis: j.analysis && typeof j.analysis === 'object' ? j.analysis : {}
    };
  }

  // ---------- Humanizer (stage 3, deterministic part) ----------

  function limitEmoji(text, max) {
    let count = 0;
    return text.replace(/\p{Extended_Pictographic}/gu, (m) => (++count <= max ? m : ''));
  }

  function humanize(text, style) {
    style = style || DEFAULT_SETTINGS.style;
    let t = String(text || '').trim();
    for (let i = 0; i < 3; i++) for (const re of ROBOT_OPENERS) t = t.replace(re, '');
    t = t
      .replace(/\*\*(.*?)\*\*/g, '$1') // markdown bold
      .replace(/__(.*?)__/g, '$1')
      .replace(/^#{1,6}\s+/gm, '') // headings
      .replace(/^\s*[-*•]\s+/gm, '') // bullet markers
      .replace(/^\s*\d+[.)]\s+/gm, '') // numbered lists
      .replace(/\s*[—–]\s*/g, ', ') // em / en dashes are a strong AI tell
      .replace(/\n{2,}/g, '\n')
      .replace(/[ \t]{2,}/g, ' ')
      .trim();
    t = limitEmoji(t, style.stripEmojiLimit == null ? 1 : style.stripEmojiLimit);
    if (style.lowercase) t = t.toLowerCase();
    // Capitalise nothing, add nothing: keep what the model wrote, minus the giveaways.
    return t;
  }

  function hasAiGiveaway(text) {
    return AI_GIVEAWAYS.some((re) => re.test(text));
  }

  // ---------- Hallucination guard ----------

  function numbersIn(text) {
    // matches 350, 1,200, 12.5, ৳500 (digits only are compared)
    return (String(text || '').match(/\d[\d,]*(?:\.\d+)?/g) || []).map((n) => n.replace(/,/g, ''));
  }

  /**
   * Returns the list of numbers in `reply` that appear nowhere in the allowed sources
   * (knowledge base + the conversation itself). Those are likely invented prices/dates.
   */
  function unknownNumbers(reply, allowedTexts) {
    const allowed = new Set();
    for (const t of allowedTexts) numbersIn(t).forEach((n) => allowed.add(n));
    return numbersIn(reply).filter((n) => !allowed.has(n) && !(n.length === 1)); // ignore lone digits like "2 mins"
  }

  // ---------- Final gate: turn a model decision into something safe to act on ----------

  /**
   * @param decision  output of parseDecision
   * @param ctx { settings, business, lastCustomerText, threadText, recentReplyCount }
   * @returns { action, replies, reason }
   */
  function finalizeDecision(decision, ctx) {
    const g = (ctx.settings && ctx.settings.guardrails) || DEFAULT_SETTINGS.guardrails;
    const style = (ctx.settings && ctx.settings.style) || DEFAULT_SETTINGS.style;

    if (customerAsksIfBot(ctx.lastCustomerText)) {
      return { action: 'escalate', replies: [], reason: 'customer asked whether they are talking to a bot — handing to the owner' };
    }
    if (decision.action !== 'reply') {
      return { action: 'escalate', replies: [], reason: decision.reason || 'model chose to escalate' };
    }
    if (decision.confidence < g.minConfidence) {
      return { action: 'escalate', replies: [], reason: `low confidence (${decision.confidence.toFixed(2)})` };
    }
    if (ctx.recentReplyCount != null && ctx.recentReplyCount >= g.maxRepliesPerThreadPerHour) {
      return { action: 'escalate', replies: [], reason: 'reply rate limit hit for this thread' };
    }

    let replies = decision.replies.slice(0, g.maxBubbles).map((r) => humanize(r, style)).filter(Boolean);
    if (replies.length === 0) return { action: 'escalate', replies: [], reason: 'empty reply after cleanup' };
    if (replies.some(hasAiGiveaway)) {
      return { action: 'escalate', replies: [], reason: 'reply contained AI boilerplate' };
    }

    if (g.blockUnknownNumbers) {
      const kb = [
        ctx.business && ctx.business.services,
        ctx.business && ctx.business.faqs,
        ctx.business && ctx.business.rules,
        ctx.business && ctx.business.about,
        ((ctx.business && ctx.business.scannedPosts) || []).join('\n'),
        ctx.threadText
      ].filter(Boolean);
      const bad = unknownNumbers(replies.join(' '), kb);
      if (bad.length) {
        return { action: 'escalate', replies: [], reason: `reply mentioned numbers not found in your knowledge base: ${bad.join(', ')}` };
      }
    }
    return { action: 'reply', replies, reason: '' };
  }

  function simpleHash(str) {
    let h = 5381;
    for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  }

  function randBetween(min, max) {
    return min + Math.random() * (max - min);
  }

  const api = {
    DEFAULT_SETTINGS,
    DEFAULT_BUSINESS,
    extractJson,
    parseDecision,
    humanize,
    hasAiGiveaway,
    customerAsksIfBot,
    unknownNumbers,
    finalizeDecision,
    simpleHash,
    randBetween
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ACC = Object.assign(root.ACC || {}, api);
})(typeof self !== 'undefined' ? self : globalThis);
