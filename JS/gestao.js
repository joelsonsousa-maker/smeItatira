const SUPABASE_URL = 'https://hkxvrltwzrrbrdxqhsdn.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhreHZybHR3enJyYnJkeHFoc2RuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIzMjgyNDksImV4cCI6MjA5NzkwNDI0OX0.yvlcNFTVqvU52darxGNqZ7w3vgm6sASz8rHcikNzrPI';
const client = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
const STORAGE_BUCKET = 'fotos-membros';
const TABLE_NAME = 'membros';

const state = {
  editId: null,
  editImageUrl: null,
};

document.addEventListener('DOMContentLoaded', () => {
  initializeGestaoPage();
  loadMembros();
});

function getCurrentUser() {
  try {
    const stored = localStorage.getItem('sme_user');
    return stored ? JSON.parse(stored) : null;
  } catch (err) {
    return null;
  }
}

const currentUser = getCurrentUser();
const isAdmin = Boolean(currentUser && currentUser.isAdmin);

function initializeGestaoPage() {
  const addButton = document.getElementById('open-add-button');
  const modal = document.getElementById('gestao-modal');
  const closeButton = document.getElementById('modal-close');
  const cancelButton = document.getElementById('cancel-button');
  const form = document.getElementById('gestao-form');

  if (!isAdmin) {
    addButton?.classList.add('hidden');
  } else {
    addButton?.addEventListener('click', () => openModal());
  }

  closeButton?.addEventListener('click', closeModal);
  cancelButton?.addEventListener('click', closeModal);
  modal?.addEventListener('click', (event) => {
    if (event.target === modal) {
      closeModal();
    }
  });

  form?.addEventListener('submit', handleFormSubmit);
}

async function loadMembros() {
  renderStatus('Carregando membros...', false);
  const { data, error } = await client
    .from(TABLE_NAME)
    .select('*')
    .order('criado_em', { ascending: true });

  if (error) {
    renderStatus('Falha ao carregar os membros: ' + error.message, true);
    return;
  }

  renderStatus('', false, true);
  renderMembros(data || []);
}

function renderMembros(membros) {
  const list = document.getElementById('membros-list');
  list.innerHTML = '';

  if (!membros.length) {
    list.innerHTML = '<div class="login-message">Nenhum membro encontrado no momento.</div>';
    return;
  }

  membros.forEach((membro) => {
    const card = document.createElement('article');
    card.className = 'membro-card';

    const photo = document.createElement('img');
    photo.className = 'membro-photo';
    photo.alt = membro.nome ? `Foto de ${membro.nome}` : 'Foto de membro';
    photo.src = membro.imagem_url || getPlaceholderUrl(membro.nome);
    photo.onerror = () => {
      photo.src = getPlaceholderUrl(membro.nome);
    };

    const details = document.createElement('div');
    details.className = 'membro-details';

    const title = document.createElement('h3');
    title.textContent = membro.nome || 'Nome indisponível';

    const role = document.createElement('p');
    role.className = 'member-role';
    role.textContent = membro.funcao || 'Função não informada';

    const bio = document.createElement('p');
    bio.className = 'member-bio';
    bio.textContent = membro.informacoes || 'Biografia não informada.';

    details.appendChild(title);
    details.appendChild(role);
    details.appendChild(bio);

    card.appendChild(photo);
    card.appendChild(details);

    if (isAdmin) {
      const actions = document.createElement('div');
      actions.className = 'member-actions';

      const editButton = document.createElement('button');
      editButton.type = 'button';
      editButton.className = 'btn-secondary';
      editButton.innerHTML = '<span class="material-symbols-outlined">edit</span>Editar';
      editButton.addEventListener('click', () => openEditModal(membro));

      const deleteButton = document.createElement('button');
      deleteButton.type = 'button';
      deleteButton.className = 'btn-secondary danger-button';
      deleteButton.innerHTML = '<span class="material-symbols-outlined">delete</span>Excluir';
      deleteButton.addEventListener('click', () => deleteMember(membro));

      actions.appendChild(editButton);
      actions.appendChild(deleteButton);
      details.appendChild(actions);
    }

    list.appendChild(card);
  });
}

function getPlaceholderUrl(name) {
  const initials = String(name || 'SME')
    .trim()
    .split(' ')
    .filter(Boolean)
    .map((part) => part[0].toUpperCase())
    .slice(0, 2)
    .join('');

  const text = initials || 'SM';
  return `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='280' height='280' viewBox='0 0 280 280'%3E%3Crect width='280' height='280' fill='%23003366'/%3E%3Ctext x='50%25' y='55%25' dominant-baseline='middle' text-anchor='middle' font-family='Inter, sans-serif' font-size='72' fill='%23FFFFFF'%3E${encodeURIComponent(text)}%3C/text%3E%3C/svg%3E`;
}

function renderStatus(message, isError = false, hide = false) {
  const status = document.getElementById('gestao-message');
  if (!status) return;
  if (hide) {
    status.hidden = true;
    status.textContent = '';
    return;
  }
  status.textContent = message;
  status.hidden = false;
  status.classList.toggle('error', isError);
  if (isError) {
    status.classList.add('error');
  } else {
    status.classList.remove('error');
  }
}

function openModal() {
  state.editId = null;
  state.editImageUrl = null;
  const modal = document.getElementById('gestao-modal');
  const title = document.getElementById('modal-title');
  const form = document.getElementById('gestao-form');
  const saveButton = document.getElementById('save-member-button');

  title.textContent = 'Adicionar Membro';
  saveButton.textContent = 'Salvar';
  document.getElementById('member-id').value = '';
  document.getElementById('member-name').value = '';
  document.getElementById('member-role').value = '';
  document.getElementById('member-info').value = '';
  document.getElementById('member-image').value = '';

  if (modal) {
    modal.classList.remove('hidden');
  }
  form?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function openEditModal(membro) {
  state.editId = membro.id;
  state.editImageUrl = membro.imagem_url || null;

  const modal = document.getElementById('gestao-modal');
  const title = document.getElementById('modal-title');
  const saveButton = document.getElementById('save-member-button');

  title.textContent = 'Editar Membro';
  saveButton.textContent = 'Atualizar';
  document.getElementById('member-id').value = membro.id || '';
  document.getElementById('member-name').value = membro.nome || '';
  document.getElementById('member-role').value = membro.funcao || '';
  document.getElementById('member-info').value = membro.informacoes || '';
  document.getElementById('member-image').value = '';

  if (modal) {
    modal.classList.remove('hidden');
  }
}

function closeModal() {
  const modal = document.getElementById('gestao-modal');
  if (modal) {
    modal.classList.add('hidden');
  }
}

async function handleFormSubmit(event) {
  event.preventDefault();

  if (!isAdmin) {
    renderStatus('Ação não autorizada para seu perfil.', true);
    return;
  }

  const id = document.getElementById('member-id').value;
  const nome = document.getElementById('member-name').value.trim();
  const funcao = document.getElementById('member-role').value.trim();
  const informacoes = document.getElementById('member-info').value.trim();
  const fileInput = document.getElementById('member-image');
  const file = fileInput.files?.[0] || null;

  if (!nome || !funcao || !informacoes) {
    renderStatus('Preencha todos os campos antes de salvar.', true);
    return;
  }

  renderStatus('Salvando informações...', false);

  try {
    let imagemUrl = state.editImageUrl || null;

    if (file) {
      imagemUrl = await uploadImage(file);
    }

    if (id) {
      const { error } = await client
        .from(TABLE_NAME)
        .update({ nome, funcao, informacoes, imagem_url: imagemUrl })
        .eq('id', id);

      if (error) {
        throw error;
      }

      renderStatus('Membro atualizado com sucesso.', false);
    } else {
      const { error } = await client
        .from(TABLE_NAME)
        .insert({ nome, funcao, informacoes, imagem_url: imagemUrl });

      if (error) {
        throw error;
      }

      renderStatus('Membro adicionado com sucesso.', false);
    }

    closeModal();
    await loadMembros();
  } catch (error) {
    renderStatus('Erro ao salvar membro: ' + (error.message || 'verifique os dados.'), true);
  }
}

async function uploadImage(file) {
  // 1. Gera o nome do arquivo sem criar subpasta extra 'membros/'
  const fileName = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
  
  // 2. Realiza o upload com upsert e o contentType original do arquivo
  const { data, error } = await client.storage
    .from(STORAGE_BUCKET)
    .upload(fileName, file, { 
      cacheControl: '3600',
      contentType: file.type,
      upsert: true 
    });

  if (error) {
    console.error("Erro no upload do Storage:", error);
    throw error;
  }

  // 3. Pega a URL pública do arquivo gerado
  const { data: publicUrlData } = client.storage
    .from(STORAGE_BUCKET)
    .getPublicUrl(fileName);

  return publicUrlData.publicUrl;
}

async function deleteMember(membro) {
  const confirmation = window.confirm(`Deseja realmente excluir ${membro.nome}?`);
  if (!confirmation) {
    return;
  }

  try {
    renderStatus('Excluindo membro...', false);
    const { error } = await client.from(TABLE_NAME).delete().eq('id', membro.id);

    if (error) {
      throw error;
    }

    await deleteStorageImage(membro.imagem_url);
    await loadMembros();
    renderStatus('Membro excluído com sucesso.', false);
  } catch (error) {
    renderStatus('Erro ao excluir membro: ' + (error.message || 'verifique a conexão.'), true);
  }
}

async function deleteStorageImage(imageUrl) {
  if (!imageUrl) return;
  const match = imageUrl.match(/\/fotos-membros\/(.*)$/);
  const path = match ? decodeURIComponent(match[1]) : null;
  if (!path) return;

  await client.storage.from(STORAGE_BUCKET).remove([path]);
}
