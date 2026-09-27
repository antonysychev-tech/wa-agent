const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const express = require('express');
const { parseBusinessExternalId, telegramSendPayload } = require('./business_identity');

const identity = 'biz:["conn:synthetic","123456"]';

test('Business destinations stay separate from ordinary bot chats', () => {
  assert.deepEqual(parseBusinessExternalId(identity), {
    connectionId: 'conn:synthetic', chatId: '123456',
  });
  assert.deepEqual(telegramSendPayload(identity, 'answer'), {
    chat_id: '123456', business_connection_id: 'conn:synthetic', text: 'answer',
  });
  assert.deepEqual(telegramSendPayload('123456', 'answer'), { chat_id: '123456', text: 'answer' });
  assert.equal(parseBusinessExternalId('biz:["conn","-100"]'), null);
  assert.throws(() => telegramSendPayload('biz:invalid', 'answer'));
});

test('only authenticated owner events can pause, record and resume Business chat', async () => {
  const events = [];
  const old = Module._load;
  Module._load = function(request, parent) {
    if (parent?.filename.endsWith('assistant_routes.js')) {
      if (request === './assistant_store') return {
        supabase: {},
        getOrCreateConversation: async args => {
          events.push(['find', args]); return { id: 7, ...args };
        },
        getConversation: async () => ({ id: 7, channel: 'telegram', external_id: identity, operator_mode: true }),
        setOperatorMode: async (...args) => { events.push(['mode', ...args]); },
        saveMessage: async (...args) => { events.push(['message', ...args]); },
      };
      if (request === './service_billing') return { mountBilling: () => {} };
      if (request === './agent') return { VISION_MAX_IMAGES: 4 };
      if (['./assistant_core', './store', './admin_assistant', './kb_collector'].includes(request)) return {};
    }
    return old.apply(this, arguments);
  };
  let create;
  try { create = require('./assistant_routes').createAssistantRouter; }
  finally { Module._load = old; }
  const deliveries = [];
  const app = express();
  app.use(express.json());
  app.use('/assistant', create({ adminKey: 'synthetic-key', sendTelegram: async (...args) => deliveries.push(args) }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (path, body, key) => fetch(base + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(key ? { 'x-admin-key': key } : {}) },
    body: JSON.stringify(body),
  });
  try {
    assert.equal((await post('/assistant/business/operator-message', { external_id: identity, content: 'I take over' })).status, 401);
    assert.equal((await post('/assistant/business/operator-message', { external_id: '123456', content: 'bad' }, 'synthetic-key')).status, 400);
    assert.equal((await post('/assistant/business/operator-message', { external_id: identity, content: 'I take over' }, 'synthetic-key')).status, 200);
    assert.deepEqual(events.slice(0, 3).map(e => e[0]), ['find', 'mode', 'message']);
    assert.deepEqual(events[1], ['mode', 7, true]);
    assert.deepEqual(events[2], ['message', 7, 'operator', 'I take over']);
    assert.equal((await post('/assistant/business/operator-mode', { external_id: identity, on: false }, 'synthetic-key')).status, 200);
    assert.deepEqual(events.at(-1), ['mode', 7, false]);
    assert.equal((await post('/assistant/conversations/7/reply', { content: 'Operator answer' }, 'synthetic-key')).status, 200);
    assert.deepEqual(deliveries, [[identity, 'Operator answer']]);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
