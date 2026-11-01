// Vercel catch-all for /api/* — routes /api/config, /api/state, /api/player,
// /api/admin/*, etc. directly to the GAME handler, so Vercel does not rewrite
// them to /api/index (which loses the original path in req.url).
module.exports = require('../server.js');
