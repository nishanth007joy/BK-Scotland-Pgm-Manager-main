const { randomUUID } = require('node:crypto');

module.exports = function publishedResultUpdates(app, authMiddleware) {
  let revision = randomUUID();
  const waiting = new Set();
  app.get('/api/results/updates', authMiddleware, (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (req.query.since !== revision) return res.json({ revision });
    const finish = () => {
      cleanup();
      res.json({ revision });
    };
    const timer = setTimeout(finish, 20000);
    const cleanup = () => {
      clearTimeout(timer);
      waiting.delete(finish);
      res.off('close', cleanup);
    };
    waiting.add(finish);
    res.on('close', cleanup);
  });
  return () => {
    revision = randomUUID();
    for (const finish of [...waiting]) finish();
  };
};
