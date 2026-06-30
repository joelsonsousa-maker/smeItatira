require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');
const app = express();
const port = process.env.PORT || 3000;
const adminCode = process.env.ADMIN_CODE;

app.use(cors());
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
});

app.use(express.json());
app.use(express.static(path.join(__dirname)));

app.post('/api/validate-admin-code', (req, res) => {
  if (!adminCode) {
    return res.status(500).json({
      valid: false,
      error: 'O código do administrador não foi configurado.'
    });
  }

  const providedCode = String(req.body?.adminCode || '').trim();
  const valid = providedCode === adminCode;

  return res.json({ valid: valid });
});

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(port, () => {
  console.log(`Servidor rodando em http://localhost:${port}`);
});
