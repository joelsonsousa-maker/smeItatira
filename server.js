require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet'); // Adicionado para segurança de headers

const app = express();
const port = process.env.PORT || 3000;

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

const validateAdminRoute = require('./api/validate-admin-code');
const {
  getSupabaseClients,
  syncUserProfile,
  getUserProfile
} = require('./api/supabase');
const {
  loginRateLimiter,
  messageRateLimiter,
  createSession,
  authenticateUser,
  requireAdmin
} = require('./api/security');

const inMemoryMessages = [];

app.all('/validate-admin-code', validateAdminRoute);

app.post('/auth/login', loginRateLimiter, async (req, res) => {
  try {
    const { email = '', password = '', adminCode = '' } = req.body || {};

    if (!email || !password) {
      return res.status(400).json({ ok: false, error: 'E-mail e senha são obrigatórios.' });
    }

    const { enabled, client, admin, reason } = getSupabaseClients();
    
    // Validação segura do ADMIN_CODE
    const adminCodeMatches = Boolean(process.env.ADMIN_CODE) && 
      String(adminCode || '').trim() === String(process.env.ADMIN_CODE).trim();

    let userRole = adminCodeMatches ? 'admin' : 'usuario';
    let authUser = null;
    let accessToken = null;
    let displayName = null;

    if (enabled && client) {
      const { data, error } = await client.auth.signInWithPassword({ email, password });
      if (error) {
        return res.status(401).json({ ok: false, error: 'Credenciais inválidas.' });
      }

      authUser = data.user;
      accessToken = data.session?.access_token || null;

      const profile = await getUserProfile({ admin, userId: authUser.id });
      if (profile) {
        displayName = profile.nome || authUser.email?.split('@')[0] || 'Usuário';
        if (profile.perfil === 'admin' || adminCodeMatches) {
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
      console.warn('Supabase não configurado, usando sessão local para desenvolvimento.', reason);
    }

    const user = {
      id: authUser?.id || `local-${email}`,
      name: displayName || email.split('@')[0],
      email,
      role: userRole
    };

    const token = accessToken || createSession(user);

    return res.status(200).json({ ok: true, user, token });
  } catch (error) {
    console.error('Erro ao processar login:', error);
    return res.status(500).json({ ok: false, error: 'Erro interno no login.' });
  }
});

app.post('/auth/signup', loginRateLimiter, async (req, res) => {
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
      return res.status(500).json({ ok: false, error: 'Problema de configuração do servidor. Tente novamente mais tarde.' });
    }

    const { data: existingProfile, error: existingProfileError } = await admin.from('profiles').select('id').eq('email', trimmedEmail).maybeSingle();
    if (existingProfileError) {
      console.error('Erro ao verificar e-mail existente:', existingProfileError.message);
      return res.status(500).json({ ok: false, error: 'Erro interno ao verificar e-mail.' });
    }

    if (existingProfile) {
      return res.status(409).json({ ok: false, error: 'Este e-mail já está cadastrado.' });
    }

    let existingAuth = null;
    try {
      const { data: users, error: listError } = await admin.auth.admin.listUsers({ query: trimmedEmail, limit: 1 });
      if (listError) {
        console.warn('Falha ao listar usuários para pré-validação:', listError.message);
      } else if (users?.users?.length) {
        existingAuth = users.users.find((user) => user.email?.toLowerCase() === trimmedEmail);
      }
    } catch (error) {
      console.warn('Erro ao consultar auth.users:', error.message);
    }

    if (existingAuth) {
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
      const duplicateMessage = /already exists|duplicate/i.test(signUpError.message) ? 'Este e-mail já está cadastrado.' : 'Não foi possível criar o cadastro.';
      return res.status(409).json({ ok: false, error: duplicateMessage });
    }

    const authUser = signUpData.user;
    if (!authUser?.id) {
      return res.status(500).json({ ok: false, error: 'Falha ao criar o usuário.' });
    }

    const profilePayload = {
      id: authUser.id,
      nome: nome.trim(),
      email: trimmedEmail,
      perfil: 'usuario'
    };

    const { error: profileInsertError } = await admin.from('profiles').insert(profilePayload);
    if (profileInsertError) {
      console.error('Erro ao gravar perfil de usuário:', profileInsertError.message);
      await admin.auth.admin.deleteUser(authUser.id).catch(() => null);
      return res.status(500).json({ ok: false, error: 'Não foi possível salvar o perfil do usuário.' });
    }

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

app.get('/api/auth/me', authenticateUser, (req, res) => {
  return res.status(200).json({ ok: true, user: req.user });
});

app.get('/api/admin/overview', authenticateUser, requireAdmin, (req, res) => {
  return res.status(200).json({ ok: true, admin: true, user: req.user });
});

app.get('/api/messages', authenticateUser, async (req, res) => {
  try {
    const { enabled, admin } = getSupabaseClients();

    if (!enabled || !admin) {
      const visibleMessages = inMemoryMessages.filter((message) => {
        if (req.user.role === 'admin') {
          return true;
        }
        return message.conversa_id === (req.user.email || req.user.id);
      });
      return res.status(200).json(visibleMessages);
    }

    let query = admin.from('messages').select('*').order('created_at', { ascending: true });
    if (req.user.role !== 'admin') {
      query = query.eq('conversation_id', req.user.email || req.user.id);
    }

    const { data, error } = await query;
    if (error) {
      throw error;
    }

    const mappedMessages = (data || []).map((message) => ({
      id: message.id,
      usuario_id: message.user_id,
      usuario_nome: message.user_name,
      conversa_id: message.conversation_id,
      texto: message.content,
      criado_em: message.created_at
    }));

    return res.status(200).json(mappedMessages);
  } catch (error) {
    console.error('Erro ao buscar mensagens:', error);
    return res.status(500).json({ ok: false, error: 'Erro interno ao carregar mensagens.' });
  }
});

app.post('/messages', authenticateUser, messageRateLimiter, async (req, res) => {
  try {
    const text = String(req.body?.text || '').trim();
    
    // Impede que usuários comuns alterem o conversationId para personificar outros usuários
    let conversationId;
    if (req.user.role === 'admin') {
      conversationId = String(req.body?.conversationId || req.user.email || req.user.id || '').trim();
    } else {
      conversationId = String(req.user.email || req.user.id || '').trim();
    }

    if (!text || !conversationId) {
      return res.status(400).json({ ok: false, error: 'Texto e conversa são obrigatórios.' });
    }

    const { enabled, admin } = getSupabaseClients();
    const payload = {
      user_id: req.user.id,
      user_name: req.user.name,
      conversation_id: conversationId,
      content: text,
      created_at: new Date().toISOString()
    };

    if (!enabled || !admin) {
      inMemoryMessages.push({
        id: `${Date.now()}`,
        usuario_id: req.user.id,
        usuario_nome: req.user.name,
        conversa_id: conversationId,
        texto: text,
        criado_em: payload.created_at
      });
      return res.status(201).json({ ok: true, message: 'Mensagem enviada com sucesso.' });
    }

    const { error } = await admin.from('messages').insert(payload);
    if (error) {
      throw error;
    }

    return res.status(201).json({ ok: true, message: 'Mensagem enviada com sucesso.' });
  } catch (error) {
    console.error('Erro ao enviar mensagem:', error);
    return res.status(500).json({ ok: false, error: 'Erro interno ao enviar mensagem.' });
  }
});

// Executa o app.listen apenas quando executado diretamente
if (require.main === module) {
  app.listen(port, () => {
    console.log(`Servidor rodando localmente em http://localhost:${port}`);
  });
}

module.exports = app;