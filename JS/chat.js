// Centralized chat logic: auth, message list, SSE, send
(function () {
  const API_BASE = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' ? 'http://localhost:3000' : '';

  const root = document.getElementById('chat-root');
  let me = null;
  let messages = [];
  let selectedConversation = null;

  function ensureAuth(token) {
    if (!token) { window.location.href = 'login.html'; return false; }
    return true;
  }

  async function loadMessages(conversationId) {
    const token = window.SMEAuth.readToken();
    const url = conversationId && me?.role === 'admin' ? `${API_BASE}/api/messages?conversationId=${encodeURIComponent(conversationId)}` : `${API_BASE}/api/messages`;
    const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!resp.ok) return [];
    const data = await resp.json();
    messages = data || [];
    render();
  }

  async function sendMessage(text) {
    if (!text) return;
    // obter token do helper ou dos storages (compatibilidade)
    const token = window.SMEAuth?.readToken() || localStorage.getItem('token') || localStorage.getItem('sme_session_token') || sessionStorage.getItem('token');
    if (!token) {
      alert('Sessão expirada. Faça login para enviar mensagens.');
      return window.location.href = 'login.html';
    }

    const payload = { text };
    if (me.role === 'admin') {
      payload.conversationId = selectedConversation;
      // if admin knows the target user id, include it
      const first = messages.find(m => m.conversation_id === selectedConversation);
      if (first && first.user_id) payload.userId = first.user_id;
    }

    // Optimistic UI: append local message immediately
    const localMsg = {
      id: `local-${Date.now()}`,
      user_id: payload.userId || payload.user_id || (me.role === 'admin' ? null : me.id),
      user_name: me.name || me.email || (me.id || 'Você'),
      conversation_id: payload.conversationId || (me.email || me.id),
      content: payload.text,
      created_at: new Date().toISOString(),
      sent_by_admin: (me.role === 'admin')
    };
    messages.push(localMsg);
    render();

    try {
      const resp = await fetch(`${API_BASE}/api/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload)
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        alert('Erro ao enviar mensagem: ' + (err.error || resp.statusText));
        // reload authoritative messages
        return loadMessages(selectedConversation);
      }
      // on success, refresh to get server-assigned id/timestamps
      await loadMessages(selectedConversation);
    } catch (err) {
      alert('Erro de conexão ao enviar mensagem.');
      return loadMessages(selectedConversation);
    }
  }

  // Replace SSE with a safe polling fallback to avoid EventSource MIME issues.
  let _chatPollInterval = null;
  function startPolling() {
    try {
      if (_chatPollInterval) clearInterval(_chatPollInterval);
      // immediate load and then periodic polling every 3s
      loadMessages(selectedConversation).catch((e) => console.warn('Initial load failed', e));
      _chatPollInterval = setInterval(() => {
        loadMessages(selectedConversation).catch((e) => console.warn('Polling load failed', e));
      }, 3000);
    } catch (e) {
      console.warn('Polling setup failed', e);
    }
  }

  function normalizeIncoming(incoming) {
    // incoming shape may use legacy keys; normalize to our front-end shape
    return {
      id: incoming.id || incoming.usuario_id || incoming.user_id || (`srv-${Date.now()}`),
      user_id: incoming.user_id || incoming.usuario_id || null,
      user_name: incoming.user_name || incoming.usuario_nome || incoming.user || 'Usuário',
      conversation_id: incoming.conversation_id || incoming.conversa_id || '',
      content: incoming.content || incoming.texto || incoming.text || '',
      created_at: incoming.created_at || incoming.criado_em || new Date().toISOString(),
      sent_by_admin: typeof incoming.sent_by_admin !== 'undefined' ? incoming.sent_by_admin : /admin|administrador/i.test(String(incoming.user_name || incoming.usuario_nome || ''))
    };
  }

  function upsertMessage(msg) {
    const idx = messages.findIndex(m => m.id === msg.id);
    if (idx >= 0) messages[idx] = msg;
    else messages.push(msg);
  }

  function buildLayout() {
    if (!root) return;
    if (root._layoutInitialized) return;
    root.innerHTML = `
      <div class="chat-toolbar">
        <div class="chat-title">Chat SME</div>
        <div class="chat-note" id="chat-note"></div>
      </div>
      <div class="chat-panel">
        <div class="chat-panel-left" id="chat-left"></div>
        <div class="chat-panel-right" id="chat-right">
          <div id="chat-messages" class="chat-list" aria-live="polite"></div>
          <div id="chat-input-area" class="chat-form">
            <textarea id="chat-input" placeholder="Escreva sua mensagem..." aria-label="Mensagem"></textarea>
            <button id="chat-send-btn" class="chat-action">Enviar</button>
          </div>
        </div>
      </div>
    `;
    // wire send button once
    const sendBtn = document.getElementById('chat-send-btn');
    const textarea = document.getElementById('chat-input');
    if (sendBtn && textarea) {
      sendBtn.addEventListener('click', async () => {
        sendBtn.disabled = true;
        const text = textarea.value.trim();
        await sendMessage(text);
        textarea.value = '';
        textarea.focus();
        sendBtn.disabled = false;
      });
      // allow Enter+Ctrl/Meta to send
      textarea.addEventListener('keydown', async (e) => {
        if ((e.key === 'Enter' && (e.ctrlKey || e.metaKey))) {
          e.preventDefault();
          sendBtn.click();
        }
      });
    }
    root._layoutInitialized = true;
  }

  function render() {
    buildLayout();
    document.getElementById('chat-note').textContent = me.role === 'admin' ? 'Painel admin — selecione uma conversa.' : 'Converse com a SME.';

    const left = document.getElementById('chat-left');
    const messagesContainer = document.getElementById('chat-messages');
    const textarea = document.getElementById('chat-input');
    const sendBtn = document.getElementById('chat-send-btn');
    // ensure inputs are enabled and focused
    if (textarea) textarea.disabled = false;
    if (sendBtn) sendBtn.disabled = false;

    // ensure messages are strictly ordered by created_at asc
    const sortedMessages = (messages || []).slice().sort((a, b) => {
      const ta = Date.parse(a.created_at || a.criado_em || 0) || 0;
      const tb = Date.parse(b.created_at || b.criado_em || 0) || 0;
      return ta - tb;
    });

    // build conversations list (unique conversation_id)
    const convMap = new Map();
    sortedMessages.forEach((m) => {
      if (!convMap.has(m.conversation_id)) convMap.set(m.conversation_id, { id: m.conversation_id, last: m });
      else convMap.set(m.conversation_id, { id: m.conversation_id, last: m });
    });

    if (me.role === 'admin') {
      const list = document.createElement('div');
      list.className = 'chat-list';
      if (convMap.size === 0) {
        list.innerHTML = '<div class="chat-empty">Nenhuma conversa ainda.</div>';
      } else {
        Array.from(convMap.values()).forEach((c) => {
          const btn = document.createElement('div');
          btn.className = 'chat-card-user' + (selectedConversation === c.id ? ' active' : '');
          btn.textContent = c.id;
          btn.addEventListener('click', () => { selectedConversation = c.id; loadMessages(selectedConversation); });
          list.appendChild(btn);
        });
      }
      left.innerHTML = '<div class="chat-user-info"><strong>Conversas</strong></div>';
      left.appendChild(list);

      // right side: conversation view
      if (!selectedConversation) {
        // show empty note in messages container
        if (messagesContainer) messagesContainer.innerHTML = '<div class="chat-empty">Selecione uma conversa à esquerda.</div>';
      } else {
        // show header above messages
        const header = document.createElement('div'); header.className = 'chat-user-info'; header.innerHTML = `<strong>Conversa: </strong>${selectedConversation}`;
        // attach header before messages container
        const rightPanel = document.getElementById('chat-right');
        // ensure header is present once
        let existingHeader = rightPanel.querySelector('.chat-user-info');
        if (existingHeader) existingHeader.replaceWith(header); else rightPanel.insertBefore(header, messagesContainer);
        const convMsgs = sortedMessages.filter(m => m.conversation_id === selectedConversation);
        renderMessages(convMsgs, messagesContainer);
      }
    } else {
      // user view
      const myConv = me.email || me.id;
      const convMsgs = sortedMessages.filter(m => m.conversation_id === myConv);
      if (convMsgs.length === 0) {
        if (messagesContainer) messagesContainer.innerHTML = '<div class="chat-empty">Nenhuma mensagem ainda.</div>';
      } else {
        renderMessages(convMsgs, messagesContainer);
      }
    }
  }

  // Render only messages into the messages container. Preserve textarea value and focus.
  function renderMessages(convMsgs, container) {
    if (!container) return;
    // ensure convMsgs is sorted by created_at
    const msgs = (convMsgs || []).slice().sort((a, b) => (Date.parse(a.created_at||0)||0) - (Date.parse(b.created_at||0)||0));
    // quick checks to avoid re-rendering when identical
    const existingCount = container.children.length;
    if (existingCount === msgs.length) {
      // compare last ids quickly
      let identical = true;
      for (let i = 0; i < msgs.length; i++) {
        const el = container.children[i];
        if (!el || el.dataset.id !== String(msgs[i].id)) { identical = false; break; }
      }
      if (identical) return; // no changes
    }

    // if fewer children than msgs, append only new ones; else rebuild
    if (existingCount < msgs.length) {
      // try to keep existing and append new
      let start = 0;
      // find first difference
      while (start < existingCount && container.children[start] && container.children[start].dataset.id === String(msgs[start].id)) start++;
      // if start == existingCount, append remaining
      for (let i = start; i < msgs.length; i++) {
        const m = msgs[i];
        const bubble = document.createElement('div');
        const isSent = isMessageFromCurrentUser(m);
        bubble.className = 'chat-message ' + (isSent ? 'sent' : 'received');
        bubble.dataset.id = String(m.id);
        bubble.innerHTML = `<div class="meta">${m.user_name || 'Usuário'} • ${new Date(m.created_at).toLocaleString()}</div><div>${m.content}</div>`;
        container.appendChild(bubble);
      }
      // scroll to bottom
      container.scrollTop = container.scrollHeight;
      return;
    }

    // rebuild container
    container.innerHTML = '';
    msgs.forEach((m) => {
      const bubble = document.createElement('div');
      const isSent = isMessageFromCurrentUser(m);
      bubble.className = 'chat-message ' + (isSent ? 'sent' : 'received');
      bubble.dataset.id = String(m.id);
      bubble.innerHTML = `<div class="meta">${m.user_name || 'Usuário'} • ${new Date(m.created_at).toLocaleString()}</div><div>${m.content}</div>`;
      container.appendChild(bubble);
    });
    container.scrollTop = container.scrollHeight;
  }

  async function start() {
    const token = window.SMEAuth.readToken();
    if (!ensureAuth(token)) return;
    me = await window.SMEAuth.fetchMe(token);
    if (!me) { window.SMEAuth.clearToken(); return window.location.href = 'login.html'; }
    // load messages but never let failures block UI rendering
    try { await loadMessages(); } catch (e) { console.warn('Initial loadMessages failed', e); render(); }
    // start polling for updates (safe fallback, avoids EventSource MIME issues)
    startPolling();
  }

  function isMessageFromCurrentUser(m) {
    if (!me || !m) return false;
    // If the message was sent by an admin (sent_by_admin === true):
    // - it's sent by the current user only if the current user is an admin
    if (m.sent_by_admin) {
      return me.role === 'admin';
    }
    // If not sent by admin, it's a user message: compare user_id to current user id
    return String(m.user_id) === String(me.id);
  }

  document.addEventListener('DOMContentLoaded', start);
})();
