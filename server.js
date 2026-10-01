require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const jwt = require('jsonwebtoken');
const path = require('path');
const multer = require('multer');

const app = express();
const port = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'seusegredomuitoespecial123';

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net", "https://translate.google.com", "https://translate.googleapis.com"],
        scriptSrcElem: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net", "https://translate.google.com", "https://translate.googleapis.com"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://www.gstatic.com", "https://translate.googleapis.com"],
        styleSrcElem: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://www.gstatic.com", "https://translate.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com", "https://www.gstatic.com"],
        imgSrc: ["'self'", "data:", "blob:", "https://*.supabase.co", "https://www.gstatic.com", "https://translate.googleapis.com"],
        frameSrc: ["'self'", "https://www.google.com", "https://maps.google.com"],
        connectSrc: ["'self'", "https://*.supabase.co", "https://translate.googleapis.com"]
      }
    }
  })
);
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

const {
  getSupabaseClients,
  syncUserProfile,
  getUserProfile
} = require('./api/supabase');

const inMemoryMessages = [];
const messageSseClients = new Set();

function broadcastChatMessage(message) {
  const payload = `data: ${JSON.stringify({ type: 'message', message })}\n\n`;
  for (const client of messageSseClients) {
    try {
      client.res.write(payload);
    } catch (error) {
      messageSseClients.delete(client);
    }
  }
}

// Middlewares de Rate Limit simplificados
const loginRateLimiter = (req, res, next) => next();
const messageRateLimiter = (req, res, next) => next();

// Configuração do Multer em Memória (Evita erro EROFS / Escrita em Disco na Vercel)
const upload = multer({ storage: multer.memoryStorage() });

// Funções de Autenticação Locais e Supabase
function createSession(user) {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role
    },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

async function authenticateUser(req, res, next) {
  // Allow token in Authorization header, query param `token`, or body.token
  const authHeader = req.headers['authorization'] || req.headers['Authorization'];
  const queryToken = (req.query && req.query.token) ? String(req.query.token) : null;
  const bodyToken = (req.body && req.body.token) ? String(req.body.token) : null;

  if (!authHeader && !queryToken && !bodyToken) {
    return res.status(401).json({ ok: false, error: 'Token não fornecido.' });
  }

  const token = queryToken || bodyToken || (authHeader && (authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : authHeader));

  if (!token) {
    return res.status(401).json({ ok: false, error: 'Formato de token inválido.' });
  }

  // 1. Tenta validar via JWT Local
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    // ensure basic shape
    req.user = {
      id: decoded.id || decoded.sub || null,
      email: decoded.email || null,
      name: decoded.name || decoded.email?.split('@')[0] || 'Usuário',
      role: decoded.role || (decoded.perfil || 'usuario')
    };
    return next();
  } catch (err) {
    // Se não for token local, avança para o Supabase
  }

  // 2. Tenta validar via Supabase Auth
  const { enabled, client, admin } = getSupabaseClients();
  if (enabled && client) {
    try {
      const { data: { user }, error } = await client.auth.getUser(token);

      if (!error && user) {
        let role = 'usuario';

        if (admin) {
          try {
            const { data: profile } = await admin
              .from('profiles')
              .select('perfil, nome')
              .eq('id', user.id)
              .maybeSingle();
            if (profile) {
              role = profile.perfil || 'usuario';
            }
          } catch (profileErr) {
            console.error('Erro ao buscar profile no Supabase (profiles):', profileErr);
          }
        }

        req.user = {
          id: user.id,
          email: user.email,
          name: user.user_metadata?.nome || user.email?.split('@')[0] || 'Usuário',
          role: role
        };

        return next();
      }
    } catch (supabaseErr) {
      console.error('Erro na validação via Supabase:', supabaseErr);
    }
  }

  return res.status(401).json({ ok: false, error: 'Sessão inválida ou expirada. Faça login novamente.' });
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ ok: false, error: 'Acesso negado. Apenas administradores.' });
  }
  next();
}

// Rota de Login Atualizada - Validação de Admin por e-mail no Supabase
app.post(['/api/auth/login', '/auth/login'], loginRateLimiter, async (req, res) => {
  try {
    const { email = '', password = '' } = req.body || {};
    const trimmedEmail = String(email || '').trim().toLowerCase();

    if (!trimmedEmail || !password) {
      return res.status(400).json({ ok: false, error: 'E-mail e senha são obrigatórios.' });
    }

    const { enabled, client, admin, reason } = getSupabaseClients();
    
    let userRole = 'usuario';
    let authUser = null;
    let accessToken = null;
    let displayName = null;

    if (enabled && client) {
      // Authenticate directly with Supabase
      const { data, error } = await client.auth.signInWithPassword({ email: trimmedEmail, password });
      if (error) {
        return res.status(401).json({ ok: false, error: 'Credenciais inválidas.' });
      }

      authUser = data.user;
      accessToken = data.session?.access_token || null;

      // Consult Profile to determine Role
      const profile = await getUserProfile({ admin, userId: authUser.id });
      if (profile) {
        displayName = profile.nome || authUser.email?.split('@')[0] || 'Usuário';
        if (profile.perfil === 'admin') {
          userRole = 'admin';
        }
      }

      await syncUserProfile({
        admin,
        userId: authUser.id,
        email: authUser.email,
        nome: displayName || authUser.email?.split('@')[0] || 'Usuário',
        perfil: userRole
      });
    } else {
      console.warn('Supabase não configurado.', reason);
      return res.status(500).json({ ok: false, error: 'Banco de dados não configurado.' });
    }

    const user = {
      id: authUser?.id || `user-${trimmedEmail}`,
      name: displayName || trimmedEmail.split('@')[0],
      email: trimmedEmail,
      role: userRole
    };

    const token = accessToken || createSession(user);

    return res.status(200).json({ ok: true, user, token });
  } catch (error) {
    console.error('Erro ao processar login:', error);
    return res.status(500).json({ ok: false, error: 'Erro interno no login.' });
  }
});

app.post(['/api/auth/signup', '/auth/signup'], loginRateLimiter, async (req, res) => {
  try {
    const { nome = '', email = '', password = '', confirmPassword = '' } = req.body || {};
    const trimmedEmail = String(email || '').trim().toLowerCase();

    if (!nome.trim() || !trimmedEmail || !password || !confirmPassword) {
      return res.status(400).json({ ok: false, error: 'Nome, e-mail, senha e confirmação são obrigatórios.' });
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      return res.status(400).json({ ok: false, error: 'Digite um e-mail válido.' });
    }

    if (password.length < 8) {
      return res.status(400).json({ ok: false, error: 'A senha deve ter pelo menos 8 caracteres.' });
    }

    if (password !== confirmPassword) {
      return res.status(400).json({ ok: false, error: 'As senhas não conferem.' });
    }

    const { enabled, admin, reason } = getSupabaseClients();
    if (!enabled || !admin) {
      console.error('Supabase não configurado para cadastro de usuário.', reason);
      return res.status(500).json({ ok: false, error: 'Problema de configuração do servidor.' });
    }

    const { data: existingProfile } = await admin.from('profiles').select('id').eq('email', trimmedEmail).maybeSingle();
    if (existingProfile) {
      return res.status(409).json({ ok: false, error: 'Este e-mail já está cadastrado.' });
    }

    const { data: signUpData, error: signUpError } = await admin.auth.admin.createUser({
      email: trimmedEmail,
      password,
      email_confirm: true,
      user_metadata: { nome: nome.trim() }
    });

    if (signUpError) {
      console.error('Erro ao criar usuário no Supabase Auth:', signUpError.message);
      return res.status(409).json({ ok: false, error: 'Não foi possível criar o cadastro.' });
    }

    const authUser = signUpData.user;
    const profilePayload = {
      id: authUser.id,
      nome: nome.trim(),
      email: trimmedEmail,
      perfil: 'usuario'
    };

    await admin.from('profiles').insert(profilePayload);

    const user = {
      id: authUser.id,
      name: nome.trim(),
      email: trimmedEmail,
      role: 'usuario'
    };
    const token = createSession(user);

    return res.status(201).json({ ok: true, user, token });
  } catch (error) {
    console.error('Erro ao processar cadastro:', error);
    return res.status(500).json({ ok: false, error: 'Erro interno no cadastro.' });
  }
});

app.get(['/api/auth/me', '/auth/me'], authenticateUser, (req, res) => {
  return res.status(200).json({ ok: true, user: req.user });
});

app.get(['/api/admin/overview', '/admin/overview'], authenticateUser, requireAdmin, (req, res) => {
  return res.status(200).json({ ok: true, admin: true, user: req.user });
});

// Endpoint para buscar mensagens
app.get(['/api/messages', '/messages'], authenticateUser, async (req, res) => {
  try {
    const { enabled, admin, client } = getSupabaseClients();
    const dbClient = admin || client;

    if (!enabled || !dbClient) {
      const visibleMessages = inMemoryMessages.filter((message) => {
        if (req.user.role === 'admin') return true;
        return message.conversation_id === (req.user.email || req.user.id);
      });
      return res.status(200).json(visibleMessages.map((message) => ({
        id: message.id,
        user_id: message.user_id || message.usuario_id || null,
        user_name: message.user_name || message.usuario_nome || 'Usuário',
        conversation_id: message.conversation_id || message.conversa_id || '',
        content: message.content || message.texto || '',
        created_at: message.created_at || message.criado_em,
        sent_by_admin: typeof message.sent_by_admin !== 'undefined' ? message.sent_by_admin : /admin|administrador/i.test(String(message.user_name || ''))
      })));
    }

    // Allow admin to fetch all messages, or optionally filter by conversationId
    const conversationFilter = (req.query && req.query.conversationId) || null;

    let query = dbClient.from('messages').select('*').order('created_at', { ascending: true });

    if (req.user.role !== 'admin') {
      const myConversation = req.user.email || req.user.id;
      query = query.eq('conversation_id', myConversation);
    } else if (conversationFilter) {
      query = query.eq('conversation_id', String(conversationFilter));
    }

    const { data, error } = await query;
    if (error) throw error;

    const mappedMessages = (data || []).map((msg) => ({
      id: msg.id,
      user_id: msg.user_id || null,
      user_name: msg.user_name || 'Usuário',
      conversation_id: msg.conversation_id || '',
      content: msg.content || '',
      created_at: msg.created_at
    }));

    // Attempt to determine whether each message was sent by admin.
    // Strategy: fetch profiles for involved user_ids and compare stored user_name with profile name.
    try {
      const userIds = Array.from(new Set(mappedMessages.map(m => m.user_id).filter(Boolean)));
      const profileMap = {};
      if (userIds.length > 0 && admin) {
        const { data: profiles } = await admin.from('profiles').select('id,nome').in('id', userIds);
        (profiles || []).forEach(p => { if (p && p.id) profileMap[p.id] = p.nome; });
      }

      mappedMessages.forEach(m => {
        const ownerName = profileMap[m.user_id] || null;
        if (ownerName) {
          m.sent_by_admin = (m.user_name !== ownerName);
        } else {
          // fallback: if username contains 'Admin' or 'Administrador' mark as admin
          m.sent_by_admin = /admin|administrador/i.test(String(m.user_name || ''));
        }
      });
    } catch (err) {
      console.error('Erro ao inferir sender dos messages:', err);
      mappedMessages.forEach(m => { m.sent_by_admin = /admin|administrador/i.test(String(m.user_name || '')); });
    }

    return res.status(200).json(mappedMessages);
  } catch (error) {
    console.error('Erro ao buscar mensagens:', error);
    return res.status(500).json({ ok: false, error: 'Erro interno ao carregar mensagens.' });
  }
});

app.post(['/api/messages', '/messages'], authenticateUser, messageRateLimiter, async (req, res) => {
  try {
    // Accept multiple possible field names from front-end: text, content, message
    const text = String(req.body?.text || req.body?.content || req.body?.message || '').trim();

    // Determine conversation and user/admin linkage
    let conversationId = '';
    let payloadUserId = null;
    let payloadAdminId = null;

    if (req.user && req.user.role === 'admin') {
      // Admin must provide target user's conversation id (email or id) or userId
      conversationId = String(req.body?.conversationId || req.body?.userEmail || req.body?.user_id || req.body?.userId || '').trim();
      payloadAdminId = req.user.id || null;
      payloadUserId = req.body?.userId || req.body?.user_id || null;
    } else {
      conversationId = String(req.user?.email || req.user?.id || '').trim();
      payloadUserId = req.user?.id || null;
      payloadAdminId = req.body?.adminId || req.body?.admin_id || null;
    }

    if (!text) {
      return res.status(400).json({ ok: false, error: 'Texto da mensagem é obrigatório.' });
    }

    if (!conversationId) {
      return res.status(400).json({ ok: false, error: 'ID da conversa (conversationId/userId/userEmail) é obrigatório.' });
    }

    const { enabled, admin, client } = getSupabaseClients();
    const dbClient = admin || client;

    const payload = {
      // Only use user_id column as requested. For messages sent by admins, user_id must be the target client's id.
      user_id: payloadUserId,
      user_name: req.user?.name || (req.user?.role === 'admin' ? 'Administrador' : 'Usuário'),
      conversation_id: conversationId,
      content: text,
      created_at: new Date().toISOString()
    };

    if (!enabled || !dbClient) {
      const stored = {
        id: `${Date.now()}`,
        user_id: payload.user_id,
        user_name: payload.user_name,
        conversation_id: payload.conversation_id,
        content: payload.content,
        created_at: payload.created_at,
        sent_by_admin: (req.user && req.user.role === 'admin')
      };
      inMemoryMessages.push(stored);
      broadcastChatMessage(stored);
      return res.status(201).json({ ok: true, message: 'Mensagem enviada com sucesso.' });
    }

    const { data: inserted, error } = await dbClient.from('messages').insert(payload).select();
    if (error) throw error;

    const savedMessage = (inserted && inserted[0]) || payload;
    const mappedMessage = {
      id: savedMessage.id,
      // normalized fields used by front-end
      user_id: savedMessage.user_id,
      user_name: savedMessage.user_name,
      conversation_id: savedMessage.conversation_id,
      content: savedMessage.content,
      created_at: savedMessage.created_at,
      // legacy keys for backward compatibility
      usuario_id: savedMessage.user_id,
      usuario_nome: savedMessage.user_name,
      conversa_id: savedMessage.conversation_id,
      texto: savedMessage.content,
      criado_em: savedMessage.created_at,
      // mark as sent by admin if current requester is admin
      sent_by_admin: (req.user && req.user.role === 'admin')
    };

    broadcastChatMessage(mappedMessage);
    return res.status(201).json({ ok: true, message: 'Mensagem enviada com sucesso.', data: mappedMessage });
  } catch (error) {
    console.error('Erro ao enviar mensagem:', error && (error.stack || error.message || error));
    return res.status(500).json({ ok: false, error: 'Erro interno ao enviar mensagem.' });
  }
});

// Server-Sent Events para mensagens
app.get(['/api/messages/stream', '/messages/stream'], async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders && res.flushHeaders();

  const token = (req.query && req.query.token) || (req.headers['authorization'] ? req.headers['authorization'].replace('Bearer ', '') : null);
  let user = null;

  if (!token) {
    res.write(': no token\n\n');
    return res.end();
  }

  try {
    user = jwt.verify(token, JWT_SECRET);
  } catch (err) {
    const { enabled, client, admin } = getSupabaseClients();
    if (enabled && client) {
      try {
        const { data: { user: authUser }, error } = await client.auth.getUser(token);
        if (!error && authUser) {
          let role = 'usuario';
          if (admin) {
            const { data: profile } = await admin.from('profiles').select('perfil, nome').eq('id', authUser.id).maybeSingle();
            if (profile) role = profile.perfil || 'usuario';
          }
          user = { id: authUser.id, email: authUser.email, name: authUser.user_metadata?.nome || authUser.email?.split('@')[0], role };
        }
      } catch (e) {}
    }
  }

  if (!user) {
    res.write(': invalid token\n\n');
    return res.end();
  }

  const clientObj = { res, user };
  messageSseClients.add(clientObj);
  res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);

  req.on('close', () => {
    messageSseClients.delete(clientObj);
  });
});

// GET /api/indicadores
app.get('/api/indicadores', async (req, res) => {
  try {
    const { enabled, admin, client } = getSupabaseClients();
    const db = admin || client;

    if (!enabled || !db) {
      return res.status(200).json({ ok: true, documentos: [], imagens: [] });
    }

    const [{ data: documentos }, { data: imagens }] = await Promise.all([
      db.from('indicador_documentos').select('*').order('created_at', { ascending: false }),
      db.from('indicador_imagens').select('*').order('display_order', { ascending: true })
    ]);

    return res.status(200).json({ ok: true, documentos: documentos || [], imagens: imagens || [] });
  } catch (error) {
    console.error('Erro em GET /api/indicadores:', error);
    return res.status(500).json({ ok: false, error: 'Erro interno ao carregar indicadores.' });
  }
});

// Inicialização do servidor (apenas fora de ambiente serverless)
if (process.env.NODE_ENV !== 'production') {
  app.listen(port, () => {
    console.log(`Servidor rodando na porta ${port}`);
  });
}

module.exports = app;