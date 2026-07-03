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
    // Processa o corpo se ele vier como texto bruto ou stream
    let body = req.body;
    if (typeof body === 'string') {
      body = JSON.parse(body);
    }

    const adminCode = process.env.ADMIN_CODE;

    if (!adminCode) {
      return res.status(500).json({
        valid: false,
        error: 'Variável ADMIN_CODE não configurada no painel da Vercel.'
      });
    }

    const providedCode = String(body?.adminCode || '').trim();
    const valid = providedCode === adminCode;

    return res.status(200).json({ valid: valid });
  } catch (error) {
    return res.status(500).json({ valid: false, error: 'Erro interno ao processar requisição.' });
  }
};