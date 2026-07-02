require('dotenv').config();
const express = require('express');
const cors = require('cors');
const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Importa a lógica da pasta api para o ambiente local
const validateAdminRoute = require('./api/validate-admin-code');
app.all('/api/validate-admin-code', validateAdminRoute);

app.listen(port, () => {
  console.log(`Servidor rodando localmente em http://localhost:${port}`);
});