// Business chats share the existing `telegram` database channel, but must not
// collide with ordinary bot chats. The same format is produced by bot.py.
function parseBusinessExternalId(value) {
  if (typeof value !== 'string' || !(value.startsWith('biz:') || value.startsWith('bizp:'))) return null;
  try {
    const pair = JSON.parse(value.slice(value.indexOf(':') + 1));
    if (!Array.isArray(pair) || pair.length !== 2) return null;
    const [connectionId, chatId] = pair;
    if (typeof connectionId !== 'string' || !connectionId ||
        typeof chatId !== 'string' || !/^[1-9]\d{0,15}$/.test(chatId)) return null;
    return { connectionId, chatId };
  } catch {
    return null;
  }
}

function telegramSendPayload(externalId, text) {
  const business = parseBusinessExternalId(externalId);
  if (business) {
    return { chat_id: business.chatId, business_connection_id: business.connectionId, text };
  }
  if (typeof externalId === 'string' && /^bizp?:/.test(externalId)) {
    throw new Error('Invalid Telegram Business destination');
  }
  return { chat_id: externalId, text };
}

module.exports = { parseBusinessExternalId, telegramSendPayload };
