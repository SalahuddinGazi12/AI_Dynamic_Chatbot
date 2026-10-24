# AGENTS.md — configure AI Dynamic Chatbot for a user

You are an AI coding assistant. A user gave you this repo and asked you to set it up for their Facebook Page. Do the following, in order. Be brief and friendly; the user is probably not technical.

## 1. Ask exactly these 4 questions (one message)

1. What is your business or Page name, and what do you sell or do?
2. List your main products/services with prices and currency (a rough list is fine).
3. What are your standard rules: delivery areas and charges, minimum order, returns, payment methods, working hours?
4. What language do your customers write in (English, Bangla, Banglish, mixed), and should replies be casual lowercase?

## 2. Generate `business-config.json`

Copy `business-config.example.json` to `business-config.json` and fill it from the answers:

- `name`, `category`, `language`, `about` (1–2 sentences)
- `services`: one item per line, "Item - price currency"
- `faqs`: "Q: ... / A: ..." pairs you can reasonably derive from the answers
- `rules`: the rules from question 3, one per line
- `style.lowercase`: true only if the user asked for it

**Only use facts the user gave you.** Do not invent prices, policies, or hours. If something is unknown, leave it empty; the extension will then hand those questions to the owner.

## 3. Tell the user how to load it (they do this themselves)

1. Chrome → `chrome://extensions` → enable Developer mode → **Load unpacked** → select this folder.
2. Click the extension icon → **AI keys** → paste a free key (Gemini from Google AI Studio is the easiest) → **Test**.
3. Click **Business** and copy each field from `business-config.json` into the matching box (name, category, language, about, services, FAQs, rules, style samples), then **Save**. Show the user the exact text to paste for each box.
4. Open `business.facebook.com/latest/inbox`, open a chat, and keep the mode on **Co-pilot** until they have approved about 20 drafts.

## Rules for you

- Never ask the user to paste API keys into chat with you; they enter keys only in the extension popup.
- Do not enable or recommend auto-pilot on first setup.
- Do not add code that hides automation from customers or platforms, or that answers "are you a bot?" on the bot's behalf. The extension deliberately hands those chats to the owner.
- If something breaks after a Facebook layout change, run **Page tools → Copy DOM diagnostics**, then adjust the `SELECTORS` object in `src/content/adapters/facebook-page.js`.
- Run `npm test` after any change to `src/shared/` or `src/prompts/`.
