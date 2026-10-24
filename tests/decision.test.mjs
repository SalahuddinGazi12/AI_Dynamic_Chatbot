import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const D = require('../src/shared/decision.js');
const P = require('../src/prompts/system-persona.js');

const settings = D.DEFAULT_SETTINGS;
const business = {
  services: 'Basic T-shirt - 450 BDT\nHoodie - 1200 BDT',
  faqs: 'Delivery outside Dhaka costs 120 BDT and takes 3-5 days.',
  rules: 'Minimum order 1 item.',
  about: '',
  scannedPosts: []
};

const ctx = (over) => Object.assign({ settings, business, lastCustomerText: 'how much is the hoodie', threadText: 'how much is the hoodie', recentReplyCount: 0 }, over);

test('extractJson handles fences and surrounding prose', () => {
  assert.deepEqual(D.extractJson('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(D.extractJson('Sure! {"a":2} hope that helps'), { a: 2 });
  assert.equal(D.extractJson('nope'), null);
});

test('malformed model output becomes an escalation', () => {
  const d = D.parseDecision('this is not json');
  assert.equal(d.action, 'escalate');
});

test('reply with no bubbles is escalated', () => {
  const d = D.parseDecision('{"action":"reply","confidence":0.9,"replies":[]}');
  assert.equal(d.action, 'escalate');
});

test('humanize strips robot openers, markdown, bullets and em dashes', () => {
  const out = D.humanize("Certainly! **Hoodie** is 1200 BDT — ships fast.\n- item one", settings.style);
  assert.ok(!/certainly/i.test(out));
  assert.ok(!out.includes('**'));
  assert.ok(!out.includes('—'));
  assert.ok(!/^\s*-/m.test(out));
});

test('lowercase option', () => {
  assert.equal(D.humanize('Hello THERE', { lowercase: true, stripEmojiLimit: 1 }), 'hello there');
});

test('emoji limit', () => {
  const out = D.humanize('hi 😀😀😀', { lowercase: false, stripEmojiLimit: 1 });
  assert.equal((out.match(/\p{Extended_Pictographic}/gu) || []).length, 1);
});

test('known price in knowledge base passes the gate', () => {
  const dec = D.parseDecision(JSON.stringify({ action: 'reply', confidence: 0.9, replies: ['the hoodie is 1200 BDT'] }));
  const r = D.finalizeDecision(dec, ctx());
  assert.equal(r.action, 'reply');
});

test('invented price is blocked and escalated', () => {
  const dec = D.parseDecision(JSON.stringify({ action: 'reply', confidence: 0.95, replies: ['the hoodie is 999 BDT today'] }));
  const r = D.finalizeDecision(dec, ctx());
  assert.equal(r.action, 'escalate');
  assert.match(r.reason, /999/);
});

test('low confidence escalates', () => {
  const dec = D.parseDecision(JSON.stringify({ action: 'reply', confidence: 0.4, replies: ['maybe'] }));
  assert.equal(D.finalizeDecision(dec, ctx()).action, 'escalate');
});

test('model-requested escalation is respected', () => {
  const dec = D.parseDecision(JSON.stringify({ action: 'escalate', confidence: 0.9, replies: [], reason: 'stock check' }));
  const r = D.finalizeDecision(dec, ctx());
  assert.equal(r.action, 'escalate');
  assert.equal(r.reason, 'stock check');
});

test('customer asking if it is a bot always hands off to the owner', () => {
  for (const q of ['are you a bot?', 'is this a real person', 'am I talking to an AI', 'r u a robot']) {
    assert.ok(D.customerAsksIfBot(q), q);
  }
  assert.ok(!D.customerAsksIfBot('how much is the hoodie'));
  const dec = D.parseDecision(JSON.stringify({ action: 'reply', confidence: 0.99, replies: ['nope, just me'] }));
  const r = D.finalizeDecision(dec, ctx({ lastCustomerText: 'are you a bot?' }));
  assert.equal(r.action, 'escalate');
});

test('rate limit escalates', () => {
  const dec = D.parseDecision(JSON.stringify({ action: 'reply', confidence: 0.9, replies: ['ok'] }));
  assert.equal(D.finalizeDecision(dec, ctx({ recentReplyCount: 99 })).action, 'escalate');
});

test('bubble cap', () => {
  const dec = D.parseDecision(JSON.stringify({ action: 'reply', confidence: 0.9, replies: ['a', 'b', 'c', 'd', 'e'] }));
  assert.equal(D.finalizeDecision(dec, ctx()).replies.length, settings.guardrails.maxBubbles);
});

test('prompt contains knowledge base and JSON contract, and orders conversation', () => {
  const sys = P.buildSystemPrompt(Object.assign({ name: 'Shop' }, business), settings);
  assert.match(sys, /Hoodie - 1200 BDT/);
  assert.match(sys, /"action": "reply" \| "escalate"/);
  const conv = P.buildConversation({ customerName: 'Rahim', messages: [{ role: 'customer', text: 'hi' }, { role: 'owner', text: 'hello' }] });
  assert.match(conv, /CUSTOMER: hi\nOWNER: hello/);
});
