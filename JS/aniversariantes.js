const SUPABASE_URL = 'https://hkxvrltwzrrbrdxqhsdn.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhreHZybHR3enJyYnJkeHFoc2RuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIzMjgyNDksImV4cCI6MjA5NzkwNDI0OX0.yvlcNFTVqvU52darxGNqZ7w3vgm6sASz8rHcikNzrPI';
const client = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const monthNames = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
];

const birthdayList = document.getElementById('birthday-list');
const birthdayStatus = document.getElementById('birthday-status');
const birthdayMonthLabel = document.getElementById('birthday-month-label');
const addBirthdayButton = document.getElementById('add-birthday-button');
const deleteBirthdayButton = document.getElementById('delete-birthday-button');
const addModal = document.getElementById('birthday-add-modal');
const deleteModal = document.getElementById('birthday-delete-modal');
const addCloseButton = document.getElementById('birthday-add-close');
const deleteCloseButton = document.getElementById('birthday-delete-close');
const addCancelButton = document.getElementById('birthday-add-cancel');
const deleteCancelButton = document.getElementById('birthday-delete-cancel');
const addForm = document.getElementById('birthday-add-form');
const deleteConfirmButton = document.getElementById('birthday-delete-confirm');
const birthdayDeleteContent = document.getElementById('birthday-delete-content');

const currentMonth = new Date().getMonth() + 1;
const currentMonthName = monthNames[currentMonth - 1];

function setMonthLabel() {
  if (birthdayMonthLabel) {
    birthdayMonthLabel.textContent = currentMonthName;
  }
}

function padNumber(value) {
  const number = Number(value);
  if (Number.isInteger(number) && number > 0 && number < 10) {
    return `0${number}`;
  }
  return String(value ?? '');
}

function openModal(modal) {
  modal?.classList.remove('hidden');
}

function closeModal(modal) {
  modal?.classList.add('hidden');
}

function handleOverlayClick(event, modal) {
  if (event.target === modal) {
    closeModal(modal);
  }
}

function renderBirthdayList(items) {
  if (!birthdayList) return;
  birthdayList.innerHTML = '';

  if (!items.length) {
    birthdayList.innerHTML = '<div class="birthday-empty">Nenhum aniversariante encontrado para este mês.</div>';
    return;
  }

  items.forEach((item) => {
    const row = document.createElement('div');
    row.className = 'birthday-row';
    const day = padNumber(item.dia);
    const month = padNumber(item.mes);
    const date = item.dia && item.mes ? `${day}/${month}` : '';
    row.innerHTML = `
      <span class="birthday-name">${item.nome || ''}</span>
      <span class="birthday-date">${date}</span>
    `;
    birthdayList.appendChild(row);
  });
}

async function loadBirthdays() {
  if (!birthdayStatus) return;
  birthdayStatus.textContent = 'Carregando aniversariantes...';

  const { data, error } = await client
    .from('aniversariantes')
    .select('id,nome,dia,mes')
    .eq('mes', currentMonth)
    .order('dia', { ascending: true });

  if (error) {
    birthdayStatus.textContent = 'Erro ao carregar aniversariantes. Tente novamente mais tarde.';
    console.error('Erro Supabase:', error);
    return;
  }

  birthdayStatus.textContent = '';
  renderBirthdayList(data || []);
}

async function loadDeleteOptions() {
  if (!birthdayDeleteContent) return;
  birthdayDeleteContent.innerHTML = 'Carregando...';

  const { data, error } = await client
    .from('aniversariantes')
    .select('id,nome,dia,mes')
    .eq('mes', currentMonth)
    .order('dia', { ascending: true });

  if (error) {
    birthdayDeleteContent.innerHTML = '<p>Não foi possível carregar opções de exclusão.</p>';
    console.error('Erro Supabase:', error);
    return;
  }

  if (!data.length) {
    birthdayDeleteContent.innerHTML = '<p>Nenhum aniversariante disponível para excluir.</p>';
    return;
  }

  birthdayDeleteContent.innerHTML = '';

  data.forEach((item) => {
    const wrapper = document.createElement('div');
    wrapper.className = 'birthday-delete-item';

    const day = padNumber(item.dia);
    const month = padNumber(item.mes);
    wrapper.innerHTML = `
      <label>
        <input type="radio" name="birthday-delete" value="${item.id}">
        <span>${item.nome} — ${day}/${month}</span>
      </label>
    `;

    birthdayDeleteContent.appendChild(wrapper);
  });
}

function getSelectedDeleteId() {
  const selected = document.querySelector('input[name="birthday-delete"]:checked');
  return selected ? selected.value : null;
}

function validateBirthdayFields(nome, dia, mes) {
  if (!nome.trim()) return 'Digite o nome do aniversariante.';
  if (!dia || dia < 1 || dia > 31) return 'Digite um dia válido (1-31).';
  if (!mes || mes < 1 || mes > 12) return 'Digite um mês válido (1-12).';
  return null;
}

async function addBirthday(values) {
  const { data, error } = await client
    .from('aniversariantes')
    .insert(values)
    .select();

  if (error) {
    console.error('Erro ao adicionar aniversariante:', error);
    return false;
  }

  return Boolean(data?.length);
}

async function deleteBirthday(id) {
  const { error } = await client
    .from('aniversariantes')
    .delete()
    .eq('id', id);

  if (error) {
    console.error('Erro ao excluir aniversariante:', error);
    return false;
  }

  return true;
}

function setStatus(message, isError = false) {
  if (!birthdayStatus) return;
  birthdayStatus.textContent = message;
  birthdayStatus.style.color = isError ? 'var(--color-danger)' : '';
}

function resetAddForm() {
  if (!addForm) return;
  addForm.reset();
  document.getElementById('birthday-month').value = currentMonth;
}

function getCurrentUser() {
  try {
    const raw = localStorage.getItem('sme_user');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function isAdminUser() {
  const user = getCurrentUser();
  return Boolean(user && user.isAdmin);
}

document.addEventListener('DOMContentLoaded', () => {
  const isAdmin = isAdminUser();

  if (!isAdmin) {
    addBirthdayButton?.classList.add('hidden');
    deleteBirthdayButton?.classList.add('hidden');
  }

  setMonthLabel();
  loadBirthdays();

  if (isAdmin) {
    addBirthdayButton?.addEventListener('click', () => {
      resetAddForm();
      openModal(addModal);
    });

    deleteBirthdayButton?.addEventListener('click', async () => {
      await loadDeleteOptions();
      openModal(deleteModal);
    });
  }

  addCloseButton?.addEventListener('click', () => closeModal(addModal));
  deleteCloseButton?.addEventListener('click', () => closeModal(deleteModal));
  addCancelButton?.addEventListener('click', () => closeModal(addModal));
  deleteCancelButton?.addEventListener('click', () => closeModal(deleteModal));

  addModal?.addEventListener('click', (event) => handleOverlayClick(event, addModal));
  deleteModal?.addEventListener('click', (event) => handleOverlayClick(event, deleteModal));

  addForm?.addEventListener('submit', async (event) => {
    event.preventDefault();

    const nome = document.getElementById('birthday-name').value.trim();
    const dia = Number(document.getElementById('birthday-day').value);
    const mes = Number(document.getElementById('birthday-month').value);

    const validation = validateBirthdayFields(nome, dia, mes);
    if (validation) {
      setStatus(validation, true);
      return;
    }

    setStatus('Salvando aniversariante...');
    const success = await addBirthday({ nome, dia, mes });

    if (!success) {
      setStatus('Não foi possível adicionar o aniversariante.', true);
      return;
    }

    setStatus('Aniversariante adicionado com sucesso.');
    closeModal(addModal);
    loadBirthdays();
  });

  deleteConfirmButton?.addEventListener('click', async () => {
    const selectedId = getSelectedDeleteId();
    if (!selectedId) {
      setStatus('Selecione um aniversariante para excluir.', true);
      return;
    }

    setStatus('Excluindo aniversariante...');
    const success = await deleteBirthday(selectedId);

    if (!success) {
      setStatus('Falha ao excluir aniversariante.', true);
      return;
    }

    setStatus('Aniversariante excluído com sucesso.');
    closeModal(deleteModal);
    loadBirthdays();
  });
});
