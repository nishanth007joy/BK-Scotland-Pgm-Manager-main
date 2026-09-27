const { randomUUID } = require('crypto');
// This registry has the same lifetime as express-session's in-memory store.
module.exports = function singleSession(timeoutMs, now = Date.now) {
  const active = new Map();
  function current(account) {
    const entry = active.get(account);
    if (entry && entry.expires > now()) return entry;
    active.delete(account);
    return null;
  }
  return {
    claim(account, token) {
      if (current(account)) return false;
      active.set(account, { token, id: randomUUID(), lastActive: now(), expires: now() + timeoutMs });
      return true;
    },
    touch(account, token) {
      const entry = current(account);
      if (!entry || entry.token !== token) return false;
      entry.lastActive = now();
      entry.expires = now() + timeoutMs;
      return true;
    },
    list() {
      return Array.from(active.keys()).flatMap(account => {
        const entry = current(account);
        return entry ? [{ account, id: entry.id, lastActive: entry.lastActive, expires: entry.expires }] : [];
      });
    },
    revoke(account, id) {
      const entry = current(account);
      if (!entry || entry.id !== id) return false;
      active.delete(account);
      return true;
    },
    release(account, token) {
      if (active.get(account)?.token === token) active.delete(account);
    },
  };
};
