require('dotenv').config();

module.exports = (req, res) => {
  // Configuração manual de cabeçalhos CORS para ambiente Serverless
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido' });
  }

  const adminCode = process.env.ADMIN_CODE;

  if (!adminCode) {
    return res.status(500).json({
      valid: false,
      error: 'O código do administrador não foi configurado no servidor.'
    });
  }

  const providedCode = String(req.body?.adminCode || '').trim();
  const valid = providedCode === adminCode;

  return res.json({ valid: valid });
};
