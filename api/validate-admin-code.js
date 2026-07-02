module.exports = (req, res) => {
  // Cabeçalhos CORS para o ambiente Serverless da Vercel
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');

  // Trata a requisição de pré-vôo (CORS)
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Garante que só aceita requisições POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido' });
  }

  // Pega a variável direto do painel da Vercel
  const adminCode = process.env.ADMIN_CODE;

  if (!adminCode) {
    return res.status(500).json({
      valid: false,
      error: 'O código do administrador não foi configurado nas variáveis de ambiente da Vercel.'
    });
  }

  // Validação do código enviado
  const providedCode = String(req.body?.adminCode || '').trim();
  const valid = providedCode === adminCode;

  return res.json({ valid: valid });
};