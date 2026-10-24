/*
 * facebook-page.js — DOM adapter for Meta Business Suite Inbox (business.facebook.com/latest/inbox)
 * and Facebook Page inbox.
 *
 * IMPORTANT: Meta changes its markup constantly and uses obfuscated class names. This adapter therefore
 * relies on structure and ARIA roles, not class names, and every selector lives in SELECTORS so it can be
 * recalibrated in one place. Use the popup's "Copy DOM diagnostics" button on an open conversation to
 * produce the data needed to fix a selector.
 */
(function (root) {
  'use strict';

  const SELECTORS = {
    // The editable message box. Business Suite uses a contenteditable textbox.
    composer: [
      'div[role="textbox"][contenteditable="true"][aria-label*="essage" i]',
      'div[role="textbox"][contenteditable="true"]',
      'textarea[placeholder*="essage" i]'
    ],
    sendButton: [
      '[role="button"][aria-label="Send" i]',
      'div[aria-label="Press enter to send" i]',
      'button[type="submit"]'
    ],
    // Message "rows" inside the open conversation. We look for text blocks inside the main region.
    conversationRoot: ['div[role="main"]', 'main', 'body'],
    messageText: ['div[dir="auto"]', 'span[dir="auto"]']
  };

  function queryFirst(selectors, scope) {
    for (const s of selectors) {
      const el = (scope || document).querySelector(s);
      if (el) return el;
    }
    return null;
  }

  function isVisible(el) {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  function getComposer() {
    const all = [];
    for (const s of SELECTORS.composer) document.querySelectorAll(s).forEach((e) => all.push(e));
    // The visible, lowest textbox on the page is the reply box.
    const visible = all.filter(isVisible).sort((a, b) => b.getBoundingClientRect().top - a.getBoundingClientRect().top);
    return visible[0] || null;
  }

  function isInbox() {
    return /\/latest\/inbox|\/inbox|\/messages/i.test(location.pathname + location.search) || !!getComposer();
  }

  function getThreadId() {
    const u = new URL(location.href);
    return (
      u.searchParams.get('selected_item_id') ||
      u.searchParams.get('thread_id') ||
      u.searchParams.get('mailbox_id') + ':' + (u.pathname.split('/').pop() || 'thread')
    );
  }

  function getCustomerName() {
    // Business Suite shows the contact name as a heading above the conversation.
    const h = document.querySelector('div[role="main"] h1, div[role="main"] h2, [role="heading"]');
    return h ? h.textContent.trim().slice(0, 60) : '';
  }

  /**
   * Reads the visible messages. Role detection is positional: in Meta's inbox the owner's bubbles are
   * right-aligned and the customer's are left-aligned.
   */
  function getThread() {
    const composer = getComposer();
    if (!composer) return null;
    const rootEl = queryFirst(SELECTORS.conversationRoot) || document.body;
    const rootRect = rootEl.getBoundingClientRect();
    const composerTop = composer.getBoundingClientRect().top;

    const candidates = [];
    for (const sel of SELECTORS.messageText) {
      rootEl.querySelectorAll(sel).forEach((el) => {
        if (!isVisible(el)) return;
        if (composer.contains(el) || el.closest('[role="navigation"], [role="complementary"], [role="banner"]')) return;
        const r = el.getBoundingClientRect();
        if (r.bottom > composerTop) return; // below the composer = not a message
        const text = (el.innerText || '').trim();
        if (!text || text.length > 2000) return;
        // Skip containers that merely wrap other text blocks (keep leaf-ish nodes).
        if (el.querySelector('div[dir="auto"], span[dir="auto"]')) return;
        candidates.push({ el, text, rect: r });
      });
    }

    // Conversation pane = the widest cluster in the right ~65% of the page (inbox list is on the left).
    const paneLeft = rootRect.left + rootRect.width * 0.33;
    const inPane = candidates.filter((c) => c.rect.left >= paneLeft - 40);
    if (!inPane.length) return null;
    const paneCenter = (Math.min(...inPane.map((c) => c.rect.left)) + Math.max(...inPane.map((c) => c.rect.right))) / 2;

    inPane.sort((a, b) => a.rect.top - b.rect.top || a.rect.left - b.rect.left);
    const messages = [];
    let lastTop = -1;
    for (const c of inPane) {
      if (Math.abs(c.rect.top - lastTop) < 2 && messages.length && messages[messages.length - 1].text === c.text) continue;
      const center = (c.rect.left + c.rect.right) / 2;
      messages.push({ role: center > paneCenter ? 'owner' : 'customer', text: c.text });
      lastTop = c.rect.top;
    }
    // Drop obvious UI strings (timestamps, "Seen", "Today" …) that look like single tokens.
    const clean = messages.filter((m) => !/^(seen|delivered|sent|today|yesterday|\d{1,2}:\d{2}\s?(am|pm)?|[a-z]{3},? \d{1,2}.*)$/i.test(m.text));
    return { threadId: getThreadId(), customerName: getCustomerName(), messages: clean.slice(-30) };
  }

  /** Puts text into the React-controlled composer the way a real paste/typing would. */
  function setComposerText(text) {
    const box = getComposer();
    if (!box) return false;
    box.focus();
    document.execCommand('selectAll', false, null);
    document.execCommand('delete', false, null);
    return document.execCommand('insertText', false, text);
  }

  function clickSend() {
    const btn = queryFirst(SELECTORS.sendButton);
    if (btn && isVisible(btn)) {
      btn.click();
      return true;
    }
    const box = getComposer();
    if (!box) return false;
    box.focus();
    const ev = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true };
    box.dispatchEvent(new KeyboardEvent('keydown', ev));
    box.dispatchEvent(new KeyboardEvent('keyup', ev));
    return true;
  }

  function diagnostics() {
    const composer = getComposer();
    const thread = getThread();
    return {
      url: location.href.replace(/\?.*$/, ''),
      composerFound: !!composer,
      composerHtml: composer ? composer.outerHTML.slice(0, 400) : null,
      sendButtonFound: !!queryFirst(SELECTORS.sendButton),
      threadId: thread && thread.threadId,
      customerName: thread && thread.customerName,
      messageCount: thread ? thread.messages.length : 0,
      lastMessages: thread ? thread.messages.slice(-5).map((m) => ({ role: m.role, text: m.text.slice(0, 80) })) : []
    };
  }

  root.ACC = Object.assign(root.ACC || {}, {
    fb: { isInbox, getThread, getThreadId, getCustomerName, setComposerText, clickSend, getComposer, diagnostics, SELECTORS }
  });
})(globalThis);
