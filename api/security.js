const { randomUUID } = require('crypto');

const loginAttempts = new Map();
const messageCooldowns = new Map();
const sessions = new Map();

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (Array.isArray(forwarded)) {
    return forwarded[0] || req.socket.remoteAddress || 'unknown';
  }

  if (typeof forwarded === 'string') {
    return forwarded.split(',')[0].trim();
  }

  return req.ip || req.socket.remoteAddress || 'unknown';
}

function getWindowState(store, key) {
  const entry = store.get(key);
  if (!entry) {
    const freshState = { attempts: [], blockedUntil: 0 };
    store.set(key, freshState);
    return freshState;
  }

  return entry;
}

function pruneAttempts(attempts, windowMs, now) {
  return attempts.filter((timestamp) => now - timestamp <= windowMs);
}

function createRateLimiter({
  name,
  windowMs,
  maxAttempts,
  blockMs,
  message
}) {
  return function rateLimiter(req, res, next) {
    const now = Date.now();
    const ip = getClientIp(req);
    const userIdentifier = req.body?.email || req.body?.userEmail || req.user?.email || 'anonymous';
    const keys = [
      `${name}:ip:${ip}`,
      `${name}:user:${String(userIdentifier).toLowerCase()}`
    ];

    for (const key of keys) {
      const state = getWindowState(name === 'login' ? loginAttempts : messageCooldowns, key);
      if (state.blockedUntil > now) {
        return res.status(429).json({
          ok: false,
          error: message,
          retryAfterSeconds: Math.ceil((state.blockedUntil - now) / 1000)
        });
      }

      state.attempts = pruneAttempts(state.attempts, windowMs, now);
      state.attempts.push(now);

      if (state.attempts.length > maxAttempts) {
        state.blockedUntil = now + blockMs;
        state.attempts = [];
        return res.status(429).json({
          ok: false,
          error: message,
          retryAfterSeconds: Math.ceil(blockMs / 1000)
        });
      }
    }

    next();
  };
}

const loginRateLimiter = createRateLimiter({
  name: 'login',
  windowMs: Number(process.env.LOGIN_WINDOW_MS || 15 * 60 * 1000),
  maxAttempts: Number(process.env.LOGIN_MAX_ATTEMPTS || 5),
  blockMs: Number(process.env.LOGIN_BLOCK_MS || 10 * 60 * 1000),
  message: 'Muitas tentativas de login foram realizadas. Aguarde alguns minutos antes de tentar novamente.'
});

const messageRateLimiter = createRateLimiter({
  name: 'message',
  windowMs: Number(process.env.MESSAGE_WINDOW_MS || 15 * 1000),
  maxAttempts: Number(process.env.MESSAGE_MAX_ATTEMPTS || 10),
  blockMs: Number(process.env.MESSAGE_COOLDOWN_MS || 60 * 1000),
  message: 'Você enviou muitas mensagens seguidas. Aguarde 1 minuto para continuar.'
});

function createSession(user) {
  const token = randomUUID();
  sessions.set(token, {
    user,
    createdAt: Date.now()
  });
  return token;
}

function getSession(token) {
  return sessions.get(token) || null;
}

function destroySession(token) {
  sessions.delete(token);
}

async function authenticateUser(req, res, next) {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '') || req.body?.token;

  if (!token) {
    return res.status(401).json({ ok: false, error: 'Autenticação necessária.' });
  }

  const session = getSession(token);
  if (session) {
    req.user = session.user;
    return next();
  }

  return res.status(401).json({ ok: false, error: 'Sessão inválida ou expirada.' });
}

function requireAdmin(req, res, next) {
  if (req.user?.role === 'admin') {
    return next();
  }

  return res.status(403).json({ ok: false, error: 'Acesso negado.' });
}

module.exports = {
  loginRateLimiter,
  messageRateLimiter,
  createSession,
  getSession,
  destroySession,
  authenticateUser,
  requireAdmin
};
