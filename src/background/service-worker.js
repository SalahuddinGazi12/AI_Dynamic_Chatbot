/* service-worker.js — brain of the extension. Content scripts never see API keys. */
importScripts('../shared/decision.js', '../prompts/system-persona.js', 'llm-router.js');

const A = self.ACC;

async function getSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  return mergeDeep(structuredClone(A.DEFAULT_SETTINGS), settings || {});
}
async function getBusiness() {
  const { business } = await chrome.storage.local.get('business');
  return Object.assign(structuredClone(A.DEFAULT_BUSINESS), business || {});
}

function mergeDeep(base, extra) {
  for (const k of Object.keys(extra || {})) {
    if (extra[k] && typeof extra[k] === 'object' && !Array.isArray(extra[k]) && base[k] && typeof base[k] === 'object') {
      mergeDeep(base[k], extra[k]);
    } else {
      base[k] = extra[k];
    }
  }
  return base;
}

/** Safe settings for content scripts: everything except API keys. */
function publicSettings(s) {
  const c = structuredClone(s);
  for (const n of ['gemini', 'groq', 'openrouter']) if (c.providers[n]) c.providers[n].key = c.providers[n].key ? '***' : '';
  return c;
}

async function handleGenerate({ thread, recentReplyCount }) {
  const settings = await getSettings();
  const business = await getBusiness();
  const lastCustomer = [...thread.messages].reverse().find((m) => m.role === 'customer');
  const lastCustomerText = lastCustomer ? lastCustomer.text : '';

  // Cheap pre-check: don't spend an API call if the answer is already "hand to the owner".
  if (A.customerAsksIfBot(lastCustomerText)) {
    return {
      action: 'escalate',
      replies: [],
      reason: 'customer asked whether they are talking to a bot — handing to the owner',
      provider: null
    };
  }

  const system = A.buildSystemPrompt(business, settings);
  const user = A.buildConversation(thread);
  const { text, provider } = await A.generate(settings, system, user);
  const parsed = A.parseDecision(text);
  const final = A.finalizeDecision(parsed, {
    settings,
    business,
    lastCustomerText,
    threadText: thread.messages.map((m) => m.text).join('\n'),
    recentReplyCount
  });
  return Object.assign(final, { provider, confidence: parsed.confidence, analysis: parsed.analysis });
}

async function handleTestProvider({ provider }) {
  const settings = await getSettings();
  const { text } = await A.generate(settings, 'Reply with the single word: ok', 'ping', provider);
  return { ok: true, sample: String(text).slice(0, 80) };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      switch (msg && msg.type) {
        case 'GET_SETTINGS':
          return { ok: true, settings: publicSettings(await getSettings()), business: await getBusiness() };
        case 'GENERATE':
          return { ok: true, decision: await handleGenerate(msg) };
        case 'TEST_PROVIDER':
          return await handleTestProvider(msg);
        case 'SAVE_SCAN': {
          const business = await getBusiness();
          const incoming = msg.scan || {};
          // Never overwrite what the owner typed by hand: only fill empty fields.
          for (const f of ['name', 'category', 'about']) if (!business[f] && incoming[f]) business[f] = incoming[f];
          if (incoming.scannedPosts && incoming.scannedPosts.length) business.scannedPosts = incoming.scannedPosts.slice(0, 15);
          await chrome.storage.local.set({ business });
          return { ok: true, business };
        }
        case 'SAVE_STYLE_SAMPLES': {
          const business = await getBusiness();
          const merged = [...(msg.samples || []), ...business.ownerStyleSamples];
          business.ownerStyleSamples = [...new Set(merged)].slice(0, 10);
          await chrome.storage.local.set({ business });
          return { ok: true, count: business.ownerStyleSamples.length };
        }
        case 'SET_MODE': {
          if (!['off', 'copilot', 'autopilot'].includes(msg.mode)) return { ok: false, error: 'bad mode' };
          const { settings } = await chrome.storage.local.get('settings');
          await chrome.storage.local.set({ settings: Object.assign({}, settings || {}, { mode: msg.mode }) });
          return { ok: true };
        }
        case 'ESCALATION_ALERT':
          chrome.notifications.create({
            type: 'basic',
            iconUrl: 'icons/icon128.png',
            title: 'Chatbot needs you',
            message: `${msg.customerName || 'A customer'}: ${msg.reason || 'needs a human reply'}`.slice(0, 200),
            priority: 2
          });
          return { ok: true };
        default:
          return { ok: false, error: 'unknown message type' };
      }
    } catch (e) {
      return { ok: false, error: e.message || String(e) };
    }
  })().then(sendResponse);
  return true; // keep the channel open for the async response
});
