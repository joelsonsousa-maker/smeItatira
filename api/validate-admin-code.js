const { getSupabaseClients } = require('./supabase');

module.exports = async (req, res) => {
  // Configuração manual de cabeçalhos CORS obrigatórios para requisições externas
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');

  // Trata a requisição de pré-vôo (CORS)
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Garante o método correto
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido' });
  }

  try {
    // Processa o corpo da requisição se vier como string
    let body = req.body;
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch (e) {
        body = {};
      }
    }

    const email = String(body?.email || '').trim().toLowerCase();

    if (!email) {
      return res.status(400).json({
        valid: false,
        error: 'E-mail não fornecido para verificação.'
      });
    }

    const { enabled, admin, client, reason } = getSupabaseClients();
    const dbClient = admin || client;

    if (!enabled || !dbClient) {
      return res.status(500).json({
        valid: false,
        error: reason || 'Não foi possível conectar ao banco de dados.'
      });
    }

    // Consulta a tabela profiles no Supabase pelo e-mail
    const { data: profile, error } = await dbClient
      .from('profiles')
      .select('perfil')
      .eq('email', email)
      .maybeSingle();

    if (error) {
      console.error('Erro ao consultar perfil no Supabase:', error.message);
      return res.status(500).json({
        valid: false,
        error: 'Erro ao validar perfil de administrador.'
      });
    }

    // Retorna valid: true se o perfil cadastrado no Supabase for 'admin'
    const isAdmin = profile && profile.perfil === 'admin';

    return res.status(200).json({ valid: isAdmin });

  } catch (error) {
    console.error('Erro na validação de admin:', error);
    return res.status(500).json({
      valid: false,
      error: 'Erro interno ao processar requisição.'
    });
  }
};