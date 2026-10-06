let me = null;
let currentChatUser = null;
let allUsers = [];
let onlineIds = new Set();
let ws = null;
let reconnectTimer = null;

async function init() {
  try {
    const meRes = await fetch(API_URL + '/api/me', { credentials: 'include' });
    if (!meRes.ok) return window.location.href = '/index.html';
    me = (await meRes.json()).user;

    document.getElementById('myName').textContent = '@' + me.username;
    document.getElementById('myAvatar').textContent = me.username[0].toUpperCase();

    await loadUsers();
    connectWS();
  } catch (err) {
    console.error(err);
    window.location.href = '/index.html';
  }
}

document.getElementById('logoutBtn').onclick = async () => {
  await fetch(API_URL + '/api/logout', { method: 'POST', credentials: 'include' });
  window.location.href = '/index.html';
};

async function loadUsers() {
  const res = await fetch(API_URL + '/api/users', { credentials: 'include' });
  const data = await res.json();
  allUsers = data.users || [];
  renderUsers();
}

function renderUsers() {
  const q = document.getElementById('searchUser').value.toLowerCase();
  const filtered = allUsers.filter(u => u.username.includes(q));
  const list = document.getElementById('userList');
  list.innerHTML = '';

  if (filtered.length === 0) {
    list.innerHTML = '<p style="color:#9ca3af;font-size:12px;padding:10px;">Tidak ada pengguna</p>';
    return;
  }

  filtered.forEach(u => {
    const div = document.createElement('div');
    div.className = 'user-item';
    div.dataset.uid = u.id;
    const online = onlineIds.has(u.id);
    div.innerHTML = `
      <div class="avatar" style="position:relative;">
        ${u.username[0].toUpperCase()}
        ${online ? '<span class="online-dot"></span>' : ''}
      </div>
      <div class="name">@${u.username}</div>
    `;
    div.onclick = () => openChat(u);
    if (currentChatUser && currentChatUser.id === u.id) div.classList.add('active');
    list.appendChild(div);
  });
}

document.getElementById('searchUser').oninput = renderUsers;

async function openChat(user) {
  currentChatUser = user;
  document.querySelectorAll('.user-item').forEach(el => {
    el.classList.toggle('active', Number(el.dataset.uid) === user.id);
  });
  document.getElementById('chatHeader').innerHTML = `<span>💬 @${user.username}</span>`;
  document.getElementById('input').disabled = false;
  document.getElementById('send').disabled = false;
  document.getElementById('input').focus();

  const res = await fetch(API_URL + '/api/messages/' + user.id, { credentials: 'include' });
  const data = await res.json();
  const chatEl = document.getElementById('chat');
  chatEl.innerHTML = '';
  (data.messages || []).forEach(m => renderMessage(m));
  chatEl.scrollTop = chatEl.scrollHeight;
}

function renderMessage(m) {
  const chatEl = document.getElementById('chat');
  if (currentChatUser) {
    const involved = (m.from_id === me.id && m.to_id === currentChatUser.id) ||
                     (m.to_id === me.id && m.from_id === currentChatUser.id);
    if (!involved) return;
  }
  const isMe = m.from_id === me.id;
  const div = document.createElement('div');
  div.className = 'msg ' + (isMe ? 'me' : 'other');
  const t = new Date(m.created_at * 1000);
  const timeStr = t.getHours().toString().padStart(2,'0') + ':' +
                  t.getMinutes().toString().padStart(2,'0');
  div.innerHTML = `${escapeHtml(m.text)}<span class="time">${timeStr}</span>`;
  chatEl.appendChild(div);
  chatEl.scrollTop = chatEl.scrollHeight;
}

async function sendMessage() {
  if (!currentChatUser) return;
  const input = document.getElementById('input');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';

  await fetch(API_URL + '/api/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ to: currentChatUser.id, text })
  });
}

document.getElementById('send').onclick = sendMessage;
document.getElementById('input').addEventListener('keypress', e => {
  if (e.key === 'Enter') sendMessage();
});

function connectWS() {
  const wsUrl = API_URL.replace(/^http/, 'ws') + '/ws';
  ws = new WebSocket(wsUrl);

  ws.onopen = () => console.log('✅ WebSocket connected');
  ws.onerror = (e) => console.error('WS error:', e);

  ws.onmessage = (ev) => {
    const data = JSON.parse(ev.data);
    if (data.type === 'new_message') {
      const m = data.message;
      if (currentChatUser) {
        const involved = (m.from_id === me.id && m.to_id === currentChatUser.id) ||
                         (m.to_id === me.id && m.from_id === currentChatUser.id);
        if (involved) renderMessage(m);
      }
    }
    if (data.type === 'presence') {
      onlineIds = new Set(data.online);
      renderUsers();
    }
  };

  ws.onclose = () => {
    console.log('⚠️ WebSocket closed, reconnect in 3s...');
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connectWS, 3000);
  };
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}

init();