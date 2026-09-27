function isResultboard(session) {
  return session?.role === 'resultboard'
    || String(session?.username || '').trim().toLowerCase() === 'resultboard';
}

const allowed = new Set([
  'GET /results-display.html', 'GET /results-display.js', 'GET /branding.js', 'GET /logout.js',
  'GET /api/results/published', 'GET /api/results/updates', 'GET /api/current-event',
  'POST /api/session', 'POST /logout', 'POST /login',
]);

function restrictResultboard(req, res, next) {
  if (!isResultboard(req.session)) return next();
  res.set('Cache-Control', 'no-store');
  if (allowed.has(`${req.method} ${req.path}`)) return next();
  if (req.method === 'GET' && !req.path.toLowerCase().startsWith('/api/')) {
    return res.redirect('/results-display.html');
  }
  return res.status(403).json({ message: 'This account can only access the results board.' });
}

module.exports = { isResultboard, restrictResultboard };
