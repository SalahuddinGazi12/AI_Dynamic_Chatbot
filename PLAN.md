# AI Dynamic Chatbot — Technical Plan & Roadmap

*Revised from "Universal AI Client Closer & Auto-Chat Extension". Phase 1 is implemented in this repo.*

An open-source, serverless Manifest V3 browser extension. It reads the open conversation in your Facebook Page inbox (Meta Business Suite), drafts or sends replies in your own voice using only facts you gave it, and hands any chat it can't answer back to you.

## 1. Objectives

| Goal | How it is met |
|---|---|
| Bring-your-own-key, near-zero cost | Gemini (AI Studio), Groq, OpenRouter (DeepSeek) free tiers, or fully local Ollama. Automatic fallback in a user-set order. |
| Sounds like the owner, not a bot | One-call 3-stage prompt + deterministic humanizer + style samples from the owner's own past replies. |
| Never invents facts | Knowledge-base-only prompting, confidence threshold, and a hard **number guard**: any price/number in a reply that is not in the knowledge base or the chat triggers escalation. |
| Human always in control | Co-pilot (default) drafts for approval. Auto-pilot is opt-in. Unknown or risky cases pause the thread and alert the owner. |
| Easy for anyone to install | Load-unpacked in 60 seconds; `AGENTS.md` lets an AI coding assistant configure it from 4 questions. |

## 2. What changed from the original document, and why

| Original plan | Revised plan | Reason |
|---|---|---|
| Auto-pilot is a headline mode | Co-pilot is the default in every platform; auto-pilot is opt-in per install | A wrong auto-sent price or promise costs more than a click saves. |
| Bot should never reveal it is AI; "anti-detection hardening" in Phase 4 | Bot **never denies being automated**: if a customer asks "are you a bot / real person?", it pauses and alerts the owner. Optional disclosure note on the first reply. Anti-detection hardening is **dropped**. | Deceiving customers about who they're talking to is a trust and legal risk, and Meta/Fiverr/Upwork enforce against evasion. Pacing delays stay because they also make replies feel natural. |
| 3 separate reasoning stages | Same 3 stages in **one** model call returning structured JSON | Free API tiers have tight rate limits; one call per message keeps them usable. |
| "Don't hallucinate" as a prompt rule only | Prompt rule **plus** code-level guards (confidence, number check, AI-boilerplate check, rate limit, malformed-output → escalate) | Prompts alone are not reliable. |
| Fiverr/Upwork automation (Phases 2–3) | Draft-only in Phases 2–3; no automatic sending or auto-created offers | Both marketplaces restrict automation and require communication to stay human and on-platform. Drafts + pre-filled forms that the owner approves keep the benefit with far less account risk. See §6. |
| Facebook automation via DOM scraping | Same in Phase 1, flagged as the fragile path; Messenger Platform API listed as the compliant long-term route | Meta's terms restrict automated access to its UI. See §6. |
| Loop prevention | Kept, plus: thread auto-unpauses when the owner replies by hand | Matches how an owner actually works. |

## 3. Phase 1 scope (implemented)

**Core extension + Facebook Page auto-responder.**

- Manifest V3 extension: service worker, content scripts, popup/options page.
- **LLM router** with provider fallback (Gemini, Groq, OpenRouter, Ollama) and a per-provider *Test* button.
- **Facebook / Meta Business Suite adapter**: reads the open conversation, detects customer vs owner bubbles by alignment, writes into the composer with real input events, sends.
- **Scan My Page**: reads the open Page tab (name, bio, category, recent posts) into *draft* business memory the owner edits.
- **Style learning**: collects up to 10 of the owner's past replies from the open chat.
- **Business memory dashboard**: services & prices, FAQs, rules, language, style samples.
- **Decision pipeline** with guardrails and escalation (see §4).
- **Floating control bar** in the chat: mode switch, draft with *Approve & send / Regenerate / Dismiss*, pause/resume, status.
- **Auto-pilot pacing**: reading delay (default 15–35 s), per-character typing at 45–65 WPM, multi-bubble sends.
- **Holding message + desktop notification** when a chat is handed to the owner.
- Unit tests for all decision logic (`npm test`).

**Out of scope for Phase 1:** Fiverr, Upwork, WhatsApp, Messenger.com, post-based product extraction beyond raw text, scheduled follow-ups.

## 4. Decision pipeline

```
new customer message (detected by MutationObserver + 4s poll)
        │
        ├─ thread paused?  ──yes──► do nothing (unless owner replied → auto-resume)
        │
        ├─ customer asks "are you a bot / real person?" ──► ESCALATE (no model call)
        │
        ▼
 service worker: build prompt (knowledge base + style samples + last 24 messages)
        │  one call → JSON {analysis, action, confidence, replies[], reason}
        ▼
 parseDecision  (bad JSON → escalate)
        ▼
 finalizeDecision gates, in order:
   action == escalate                  → escalate
   confidence < minConfidence (0.70)   → escalate
   replies this hour ≥ limit (6)       → escalate
   humanize each bubble (strip "Certainly!", markdown, bullets, em dashes, extra emoji)
   AI boilerplate left                 → escalate
   number not in KB or chat            → escalate
        ▼
 reply  → co-pilot: show draft │ auto-pilot: wait → type → send
 escalate → pause thread, red alert, notification, holding message (auto-pilot) or draft of it (co-pilot)
```

## 5. Repository layout

```
AI_Dynamic_Chatbot/
├── AGENTS.md                 # lets an AI assistant configure the extension for a user
├── README.md                 # install + usage
├── PLAN.md                   # this document
├── business-config.example.json
├── manifest.json
├── icons/
├── src/
│   ├── shared/decision.js            # parsing, humanizer, guardrails (pure, unit-tested)
│   ├── prompts/system-persona.js     # prompt builder
│   ├── background/
│   │   ├── llm-router.js             # Gemini / Groq / OpenRouter / Ollama + fallback
│   │   └── service-worker.js         # settings, GENERATE, notifications (holds API keys)
│   ├── content/
│   │   ├── adapters/facebook-page.js # DOM adapter (all selectors in one object)
│   │   ├── page-scanner.js           # Scan My Page / learn style
│   │   ├── human-typer.js            # reading delay + typing + multi-bubble
│   │   ├── overlay-ui.js             # floating control bar (Shadow DOM)
│   │   └── main.js                   # orchestrator
│   └── popup/                        # settings dashboard (popup + full-tab options)
└── tests/decision.test.mjs
```

Security notes: API keys live in `chrome.storage.local` and are only read by the service worker; content scripts receive masked settings. Nothing is sent anywhere except to the AI provider you choose.

## 6. Risks to know before going live

1. **Selectors will break.** Meta ships obfuscated, frequently changing markup. The adapter uses structure and ARIA roles and keeps every selector in one object, and the popup has a *Copy DOM diagnostics* button. Expect to recalibrate after layout changes. **Phase 1 was written without access to a live Business Suite session; the first real test is calibration.**
2. **Meta's terms.** Automating the Business Suite web UI is outside Meta's supported integration path. For a Page you own, the compliant route is the **Messenger Platform API** (webhook + Page access token + app review), which needs a small server and the 24-hour messaging window rules. Treat this extension as a personal productivity tool, start in co-pilot, and consider an API-based Phase 5 for unattended 24/7 replies.
3. **Marketplaces.** Fiverr and Upwork restrict automated messaging and expect real human communication. Phases 2–3 are draft-and-approve only.
4. **Disclosure and local law.** Some jurisdictions and platform policies require telling people when they're talking to automation. Use the disclosure note setting if that applies to you.
5. **Free-tier terms.** Some free AI tiers may use prompts for training. Customer messages go to the provider you pick; use Ollama if that matters.

## 7. Roadmap

| Phase | Scope | Exit criteria |
|---|---|---|
| **1 (done)** | Core extension + Facebook Page co-pilot / auto-pilot | On a test Page: selectors calibrated, Scan My Page fills memory, 20 real-style messages produce on-brand drafts, invented prices are blocked, unknown questions pause the thread. |
| 2 | Fiverr inbox reader + technical estimator (**drafts only**): detect which Gig a buyer messaged from, estimate scope/timeline/budget against saved minimum rates, draft the reply | Owner approves ≥ 80% of drafts with light edits. |
| 3 | Fiverr Custom Offer **pre-fill** with owner approval; Upwork message-room drafts (hourly/fixed proposals) | Offer form pre-fills correctly; nothing is submitted without a click. |
| 4 | WhatsApp Web / Messenger.com adapters, shared adapter contract, selector self-test | Same pipeline across three surfaces. |
| 5 (optional) | Messenger Platform API server mode for compliant 24/7 Page replies | Webhook handler reusing `decision.js`. |

## 8. Phase 1 test checklist

1. Load unpacked → open Business Suite inbox → popup → **Copy DOM diagnostics**: `composerFound: true`, correct `lastMessages` roles.
2. Add a Gemini (or Ollama) key → **Test** shows *Works*.
3. **Scan this Page**, then fill Services/FAQs/Rules by hand.
4. Co-pilot: message the Page from a second account asking a known price → draft quotes exactly that price.
5. Ask something not in the knowledge base (stock, custom discount) → chat turns red, notification fires, holding-message draft appears.
6. Ask "are you a bot?" → thread pauses, no model-written denial.
7. Reply yourself in a paused chat → bot auto-resumes.
8. Only then try auto-pilot on the test Page.
