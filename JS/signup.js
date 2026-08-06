const signupForm = document.getElementById('signup-form');
const signupMessage = document.getElementById('signup-message');
const emailInput = document.getElementById('email');
const passwordInput = document.getElementById('password');
const confirmInput = document.getElementById('confirm-password');
const emailError = document.getElementById('email-error');
const confirmError = document.getElementById('confirm-error');
const API_BASE = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  ? 'http://localhost:3000'
  : '';

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function updateSignupMessage(text, status) {
  signupMessage.textContent = text;
  signupMessage.className = `login-message ${status || ''}`.trim();
}

function validateEmail() {
  const value = emailInput.value.trim();
  if (!value || !isValidEmail(value)) {
    emailError.textContent = 'Digite um e-mail válido.';
    emailInput.classList.add('input-invalid');
    return false;
  }
  emailError.textContent = '';
  emailInput.classList.remove('input-invalid');
  return true;
}

function validatePasswords() {
  const password = passwordInput.value;
  const confirm = confirmInput.value;
  if (password.length < 8) {
    confirmError.textContent = 'A senha deve ter pelo menos 8 caracteres.';
    passwordInput.classList.add('input-invalid');
    return false;
  }
  if (password !== confirm) {
    confirmError.textContent = 'As senhas não conferem.';
    confirmInput.classList.add('input-invalid');
    return false;
  }

  confirmError.textContent = '';
  passwordInput.classList.remove('input-invalid');
  confirmInput.classList.remove('input-invalid');
  return true;
}

async function registerUser(payload) {
  const response = await fetch(`${API_BASE}/api/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const data = await response.json();
  if (!response.ok || !data.ok) {
    throw new Error(data.error || 'Erro ao criar conta.');
  }

  return data;
}

signupForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  const nome = document.getElementById('name').value.trim();
  const email = emailInput.value.trim();
  const password = passwordInput.value;
  const confirmPassword = confirmInput.value;

  if (!nome) {
    updateSignupMessage('Digite seu nome completo.', 'error');
    return;
  }

  if (!validateEmail() || !validatePasswords()) {
    updateSignupMessage('Revise os campos marcados e tente novamente.', 'error');
    return;
  }

  updateSignupMessage('Criando sua conta...', '');
  signupForm.querySelector('button[type="submit"]').disabled = true;

  try {
    await registerUser({ nome, email, password, confirmPassword });
    updateSignupMessage('Conta criada com sucesso! Redirecionando para o login...', 'success');
    setTimeout(() => {
      window.location.href = 'login.html?registered=1';
    }, 1500);
  } catch (error) {
    updateSignupMessage(error.message || 'Não foi possível criar a conta.', 'error');
  } finally {
    signupForm.querySelector('button[type="submit"]').disabled = false;
  }
});

emailInput.addEventListener('input', validateEmail);
confirmInput.addEventListener('input', validatePasswords);
passwordInput.addEventListener('input', validatePasswords);
