# AI Dynamic Chatbot

A browser extension that helps you answer your Facebook Page inbox (Meta Business Suite) in your own voice. It drafts replies from facts **you** provide, never guesses prices, and hands anything it can't answer back to you.

- **Co-pilot (default):** drafts a reply in the chat; you click *Approve & send*.
- **Auto-pilot (opt-in):** reads, waits a human-like delay, types, sends. Pauses and alerts you when unsure.
- **Bring your own AI:** Google Gemini (free tier), Groq, OpenRouter (DeepSeek), or local Ollama. No server, no subscription.

> Status: **Phase 1** (Facebook Page). Fiverr, Upwork and WhatsApp are on the [roadmap](PLAN.md). Read the *Risks* section of the plan before using auto-pilot on a real Page.

## Install (about 60 seconds)

1. Download or clone this repo.
2. Open `chrome://extensions`, turn on **Developer mode**.
3. Click **Load unpacked** and pick the repo folder.
4. Pin the extension, click its icon, and open **AI keys**. Paste a key for at least one provider and press **Test**.
   - Gemini: key from Google AI Studio. Groq: console.groq.com. OpenRouter: openrouter.ai.
   - Ollama: install it, run `ollama pull llama3.1`, and start it with `OLLAMA_ORIGINS=chrome-extension://* ollama serve` so the extension is allowed to call it.
5. Open **Business** and fill in what the bot may say (services and prices, FAQs, rules). Or open your Page in the tab and use **Page tools → Scan this Page**, then review.
6. Open your inbox at `business.facebook.com/latest/inbox`, open a conversation, and use the floating bar at the bottom right.

**Prefer AI-assisted setup?** Give this repo link to Cursor, Windsurf, Claude or ChatGPT and say *"Set this up for my Facebook Page."* See [AGENTS.md](AGENTS.md).

## How it behaves

| Situation | What happens |
|---|---|
| Question answered by your knowledge base | Draft (co-pilot) or timed send (auto-pilot), short and casual |
| Missing fact (stock, custom discount, policy) | Chat pauses, red alert, desktop notification, holding message |
| Reply contains a price/number not in your knowledge base | Blocked and escalated |
| Customer asks "are you a bot?" / "real person?" | Chat pauses for you. The bot never answers that itself |
| You reply by hand in a paused chat | Bot resumes automatically |

Tune confidence threshold, hourly reply cap, pacing, lowercase style, holding messages and an optional "AI-assisted" disclosure note under **Behavior**.

## Privacy

API keys are stored in `chrome.storage.local` on your machine, used only by the background worker, and sent only to the provider you configured. The extension only reads the Facebook tab you have open; it opens no hidden tabs and crawls nothing. Customer messages are sent to your chosen AI provider; use Ollama to keep them local.

## When Facebook changes its layout

Selectors are in one object at the top of `src/content/adapters/facebook-page.js`. In the popup use **Page tools → Copy DOM diagnostics** and include the output in an issue.

## Develop

```bash
npm test      # unit tests for parsing, humanizer, guardrails, prompts (Node 18+)
```

## Responsible use

Use this on Pages you own or manage, follow Meta's terms and any local rules on disclosing automated replies, and keep a human in the loop for pricing and commitments. Not affiliated with Meta, Fiverr, or Upwork.

## License

MIT
