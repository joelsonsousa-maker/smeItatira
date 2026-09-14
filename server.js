require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const jwt = require('jsonwebtoken');

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

const validateAdminRoute = require('./api/validate-admin-code');
const {
  getSupabaseClients,
  syncUserProfile,
  getUserProfile
} = require('./api/supabase');
const path = require('path');
const multer = require('multer');
const fs = require('fs');

const inMemoryMessages = [];

// Middlewares de Rate Limit simplificados
const loginRateLimiter = (req, res, next) => next();
const messageRateLimiter = (req, res, next) => next();

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
  const authHeader = req.headers['authorization'] || req.headers['Authorization'];

  if (!authHeader) {
    return res.status(401).json({ ok: false, error: 'Token não fornecido.' });
  }

  const token = authHeader.startsWith('Bearer ')
    ? authHeader.split(' ')[1]
    : authHeader;

  if (!token) {
    return res.status(401).json({ ok: false, error: 'Formato de token inválido.' });
  }

  // 1. Tenta validar via JWT Local
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
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
          const { data: profile } = await admin
            .from('profiles')
            .select('perfil, nome')
            .eq('id', user.id)
            .maybeSingle();

          if (profile) {
            role = profile.perfil || 'usuario';
            user.user_metadata = { ...user.user_metadata, nome: profile.nome };
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
      console.error('Erro na validação via Supabase:', supabaseErr.message);
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

app.all(['/api/validate-admin-code', '/validate-admin-code'], validateAdminRoute);

app.post(['/api/auth/login', '/auth/login'], loginRateLimiter, async (req, res) => {
  try {
    const { email = '', password = '', adminCode = '' } = req.body || {};

    if (!email || !password) {
      return res.status(400).json({ ok: false, error: 'E-mail e senha são obrigatórios.' });
    }

    const { enabled, client, admin, reason } = getSupabaseClients();
    
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
        return message.conversa_id === (req.user.email || req.user.id);
      });
      return res.status(200).json(visibleMessages);
    }

    let query = dbClient
      .from('messages')
      .select('*')
      .order('created_at', { ascending: true });

    // Se não for admin, filtra pela conversa do próprio usuário
    if (req.user.role !== 'admin') {
      const myId = req.user.email || req.user.id;
      query = query.eq('conversation_id', myId);
    }

    const { data, error } = await query;
    if (error) {
      console.error('Erro na query do Supabase:', error);
      throw error;
    }

    // Mapeamento tolerante para aceitar colunas em inglês ou português do banco
    const mappedMessages = (data || []).map((msg) => ({
      id: msg.id,
      usuario_id: msg.user_id || msg.usuario_id || '',
      usuario_nome: msg.user_name || msg.usuario_nome || 'Usuário',
      conversa_id: msg.conversation_id || msg.conversa_id || '',
      texto: msg.content || msg.texto || '',
      criado_em: msg.created_at || msg.criado_em
    }));

    return res.status(200).json(mappedMessages);
  } catch (error) {
    console.error('Erro ao buscar mensagens:', error);
    return res.status(500).json({ ok: false, error: 'Erro interno ao carregar mensagens.' });
  }
});

// Endpoint para enviar mensagens
app.post(['/api/messages', '/messages'], authenticateUser, messageRateLimiter, async (req, res) => {
  try {
    const text = String(req.body?.text || '').trim();

    let conversationId;
    if (req.user.role === 'admin') {
      conversationId = String(req.body?.conversationId || req.user.email || req.user.id || '').trim();
    } else {
      conversationId = String(req.user.email || req.user.id || '').trim();
    }

    if (!text || !conversationId) {
      return res.status(400).json({ ok: false, error: 'Texto e conversa são obrigatórios.' });
    }

    const { enabled, admin, client } = getSupabaseClients();
    const dbClient = admin || client;

    const payload = {
      user_id: req.user.id || 'admin',
      user_name: req.user.name || (req.user.role === 'admin' ? 'Administrador' : 'Usuário'),
      conversation_id: conversationId,
      content: text,
      created_at: new Date().toISOString()
    };

    if (!enabled || !dbClient) {
      inMemoryMessages.push({
        id: `${Date.now()}`,
        usuario_id: payload.user_id,
        usuario_nome: payload.user_name,
        conversa_id: payload.conversation_id,
        texto: payload.content,
        criado_em: payload.created_at
      });
      return res.status(201).json({ ok: true, message: 'Mensagem enviada com sucesso.' });
    }

    const { error } = await dbClient.from('messages').insert(payload);
    if (error) {
      console.error('Erro ao inserir no Supabase:', error);
      throw error;
    }

    return res.status(201).json({ ok: true, message: 'Mensagem enviada com sucesso.' });
  } catch (error) {
    console.error('Erro ao enviar mensagem:', error);
    return res.status(500).json({ ok: false, error: 'Erro interno ao enviar mensagem.' });
  }
});

// --- Indicadores endpoints (documentos e imagens) ---
// Configuração de upload local temporário via multer (usado quando Supabase Storage não estiver disponível)
const upload = multer({ dest: path.join(__dirname, 'tmp_uploads') });
// Forçar uso de storage local (útil em ambientes sem Supabase configurado)
const FORCE_LOCAL_STORAGE = true;

// GET /api/indicadores -> retorna documentos e imagens
app.get('/api/indicadores', async (req, res) => {
  try {
    const { enabled, admin, client } = getSupabaseClients();
    const db = admin || client;

    if (!enabled || !db) {
      return res.status(200).json({ ok: true, documentos: [], imagens: [] });
    }

    const [{ data: documentos, error: docErr }, { data: imagens, error: imgErr }] = await Promise.all([
      db.from('indicador_documentos').select('*').order('created_at', { ascending: false }),
      db.from('indicador_imagens').select('*').order('display_order', { ascending: true })
    ]);

    if (docErr || imgErr) {
      console.error('Erro ao buscar indicadores:', docErr || imgErr);
      throw docErr || imgErr;
    }

    return res.status(200).json({ ok: true, documentos: documentos || [], imagens: imagens || [] });
  } catch (error) {
    console.error('Erro em GET /api/indicadores:', error.message || error);
    return res.status(500).json({ ok: false, error: 'Erro interno ao carregar indicadores.' });
  }
});

// POST /api/indicadores/documentos -> upload documento (admin)
app.post('/api/indicadores/documentos', authenticateUser, requireAdmin, upload.single('file'), async (req, res) => {
  try {
    const file = req.file;
    const descricao = String(req.body.descricao || '').trim();
    if (!file) return res.status(400).json({ ok: false, error: 'Arquivo é obrigatório.' });

    const allowed = ['.pdf', '.doc', '.docx', '.xls', '.xlsx'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (!allowed.includes(ext)) {
      fs.unlinkSync(file.path);
      return res.status(400).json({ ok: false, error: 'Tipo de arquivo não permitido.' });
    }

    const { enabled, admin } = getSupabaseClients();
    if (FORCE_LOCAL_STORAGE || !enabled || !admin) {
      // fallback: serve file via public path (move to /uploads)
      const uploadsDir = path.join(__dirname, '..', 'uploads');
      if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
      const dest = path.join(uploadsDir, `${Date.now()}_${file.originalname}`);
      fs.renameSync(file.path, dest);
      const url = `/uploads/${path.basename(dest)}`;

      if (admin) {
        try {
          const { data, error } = await admin.from('indicador_documentos').insert({ descricao, url, storage_path: dest, tipo: ext.replace('.', '') });
          if (!error && data && data[0]) return res.status(201).json({ ok: true, documento: data[0] });
          console.warn('Admin insert returned error or no data, falling back to local response:', error);
        } catch (e) {
          console.warn('Admin insert failed, returning local resource:', e.message || e);
        }
      }

      return res.status(201).json({ ok: true, documento: { descricao, url, tipo: ext.replace('.', '') } });
    }

    // Prefer Supabase Storage
    const { admin: supaAdmin } = getSupabaseClients();
    const bucket = process.env.SUPABASE_STORAGE_BUCKET || 'public';
    const storagePath = `indicadores/documentos/${Date.now()}_${file.originalname}`;
    const fileBuffer = fs.readFileSync(file.path);

    const { data: uploadData, error: uploadErr } = await supaAdmin.storage.from(bucket).upload(storagePath, fileBuffer, { upsert: false, contentType: file.mimetype });
    // remove temp file
    fs.unlinkSync(file.path);

    // se falhar no upload (ex: bucket não existe), faz fallback para storage local
    if (uploadErr) {
      console.warn('Supabase upload failed, falling back to local storage:', uploadErr.message || uploadErr);
      const uploadsDir = path.join(__dirname, '..', 'uploads');
      if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
      const dest = path.join(uploadsDir, `${Date.now()}_${file.originalname}`);
      fs.writeFileSync(dest, fileBuffer);
      const url = `/uploads/${path.basename(dest)}`;
      if (supaAdmin) {
        try {
          const { data: inserted, error: insertErr } = await supaAdmin.from('indicador_documentos').insert({ descricao, url, storage_path: dest, tipo: ext.replace('.', '') });
          if (!insertErr && inserted && inserted[0]) return res.status(201).json({ ok: true, documento: inserted[0] });
          console.warn('Supabase insert after fallback returned error or no data, falling back to local response:', insertErr);
        } catch (e) {
          console.warn('Supabase insert after fallback failed, returning local resource:', e.message || e);
        }
      }
      return res.status(201).json({ ok: true, documento: { descricao, url, tipo: ext.replace('.', '') } });
    }

    const publicUrl = supaAdmin.storage.from(bucket).getPublicUrl(uploadData.path).publicURL;
    const { data: inserted, error: insertErr } = await supaAdmin.from('indicador_documentos').insert({ descricao, url: publicUrl, storage_path: uploadData.path, tipo: ext.replace('.', '') });
    if (insertErr) throw insertErr;

    return res.status(201).json({ ok: true, documento: inserted[0] });
  } catch (error) {
    console.error('Erro POST /api/indicadores/documentos:', error.message || error);
    return res.status(500).json({ ok: false, error: 'Erro interno ao enviar documento.' });
  }
});

// DELETE /api/indicadores/documentos/:id -> delete document (admin)
app.delete('/api/indicadores/documentos/:id', authenticateUser, requireAdmin, async (req, res) => {
  try {
    const id = req.params.id;
    const { enabled, admin } = getSupabaseClients();
    if (!enabled || !admin) return res.status(500).json({ ok: false, error: 'Supabase não configurado.' });

    const { data: doc } = await admin.from('indicador_documentos').select('*').eq('id', id).maybeSingle();
    if (!doc) return res.status(404).json({ ok: false, error: 'Documento não encontrado.' });

    // remove from storage if storage_path exists
    if (doc.storage_path) {
      const bucket = process.env.SUPABASE_STORAGE_BUCKET || 'public';
      await admin.storage.from(bucket).remove([doc.storage_path]);
    }

    const { error } = await admin.from('indicador_documentos').delete().eq('id', id);
    if (error) throw error;

    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error('Erro DELETE /api/indicadores/documentos/:id', error.message || error);
    return res.status(500).json({ ok: false, error: 'Erro ao excluir documento.' });
  }
});

// POST imagens
app.post('/api/indicadores/imagens', authenticateUser, requireAdmin, upload.single('image'), async (req, res) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ ok: false, error: 'Imagem é obrigatória.' });

    const allowed = ['.png', '.jpg', '.jpeg', '.webp'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (!allowed.includes(ext)) { fs.unlinkSync(file.path); return res.status(400).json({ ok: false, error: 'Formato de imagem não permitido.' }); }

    const { enabled, admin } = getSupabaseClients();
    if (FORCE_LOCAL_STORAGE || !enabled || !admin) {
      const uploadsDir = path.join(__dirname, '..', 'uploads');
      if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
      const dest = path.join(uploadsDir, `${Date.now()}_${file.originalname}`);
      fs.renameSync(file.path, dest);
      const url = `/uploads/${path.basename(dest)}`;
      if (admin) {
        try {
          const { data, error } = await admin.from('indicador_imagens').insert({ url, storage_path: dest });
          if (!error && data && data[0]) return res.status(201).json({ ok: true, imagem: data[0] });
          console.warn('Admin insert image returned error or no data, falling back to local response:', error);
        } catch (e) {
          console.warn('Admin insert image failed, returning local resource:', e.message || e);
        }
      }
      return res.status(201).json({ ok: true, imagem: { url } });
    }

    // Supabase storage
    const { admin: supaAdmin } = getSupabaseClients();
    const bucket = process.env.SUPABASE_STORAGE_BUCKET || 'public';
    const storagePath = `indicadores/imagens/${Date.now()}_${file.originalname}`;
    const fileBuffer = fs.readFileSync(file.path);
    const { data: uploadData, error: uploadErr } = await supaAdmin.storage.from(bucket).upload(storagePath, fileBuffer, { upsert: false, contentType: file.mimetype });
    fs.unlinkSync(file.path);

    if (uploadErr) {
      console.warn('Supabase image upload failed, falling back to local storage:', uploadErr.message || uploadErr);
      const uploadsDir = path.join(__dirname, '..', 'uploads');
      if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
      const dest = path.join(uploadsDir, `${Date.now()}_${file.originalname}`);
      fs.writeFileSync(dest, fileBuffer);
      const url = `/uploads/${path.basename(dest)}`;
      if (supaAdmin) {
        try {
          const { data: inserted, error: insertErr } = await supaAdmin.from('indicador_imagens').insert({ url, storage_path: dest });
          if (!insertErr && inserted && inserted[0]) return res.status(201).json({ ok: true, imagem: inserted[0] });
          console.warn('Supabase insert image after fallback returned error or no data, falling back to local response:', insertErr);
        } catch (e) {
          console.warn('Supabase insert image after fallback failed, returning local resource:', e.message || e);
        }
      }
      return res.status(201).json({ ok: true, imagem: { url } });
    }

    const publicUrl = supaAdmin.storage.from(bucket).getPublicUrl(uploadData.path).publicURL;
    const { data: inserted, error: insertErr } = await supaAdmin.from('indicador_imagens').insert({ url: publicUrl, storage_path: uploadData.path });
    if (insertErr) throw insertErr;
    return res.status(201).json({ ok: true, imagem: inserted[0] });
  } catch (error) {
    console.error('Erro POST /api/indicadores/imagens', error.message || error);
    return res.status(500).json({ ok: false, error: 'Erro ao enviar imagem.' });
  }
});

// DELETE imagem
app.delete('/api/indicadores/imagens/:id', authenticateUser, requireAdmin, async (req, res) => {
  try {
    const id = req.params.id;
    const { enabled, admin } = getSupabaseClients();
    if (!enabled || !admin) return res.status(500).json({ ok: false, error: 'Supabase não configurado.' });

    const { data: img } = await admin.from('indicador_imagens').select('*').eq('id', id).maybeSingle();
    if (!img) return res.status(404).json({ ok: false, error: 'Imagem não encontrada.' });

    if (img.storage_path) {
      const bucket = process.env.SUPABASE_STORAGE_BUCKET || 'public';
      await admin.storage.from(bucket).remove([img.storage_path]);
    }

    const { error } = await admin.from('indicador_imagens').delete().eq('id', id);
    if (error) throw error;

    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error('Erro DELETE /api/indicadores/imagens/:id', error.message || error);
    return res.status(500).json({ ok: false, error: 'Erro ao excluir imagem.' });
  }
});

if (require.main === module) {
  app.listen(port, () => {
    console.log(`Servidor rodando localmente em http://localhost:${port}`);
  });
}

module.exports = app;