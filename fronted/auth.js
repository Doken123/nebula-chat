let mode = 'login';
const tabLogin = document.getElementById('tabLogin');
const tabRegister = document.getElementById('tabRegister');
const submitBtn = document.getElementById('submitBtn');
const errorMsg = document.getElementById('errorMsg');
const form = document.getElementById('authForm');

tabLogin.onclick = () => {
  mode = 'login';
  tabLogin.classList.add('active');
  tabRegister.classList.remove('active');
  submitBtn.textContent = 'Masuk';
  errorMsg.textContent = '';
};

tabRegister.onclick = () => {
  mode = 'register';
  tabRegister.classList.add('active');
  tabLogin.classList.remove('active');
  submitBtn.textContent = 'Daftar';
  errorMsg.textContent = '';
};

form.onsubmit = async (e) => {
  e.preventDefault();
  errorMsg.textContent = '';
  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value;

  try {
    const res = await fetch(API_URL + '/api/' + mode, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Gagal');
    window.location.href = '/chat.html';
  } catch (err) {
    errorMsg.textContent = err.message;
  }
};

// Cek session
fetch(API_URL + '/api/me', { credentials: 'include' })
  .then(r => { if (r.ok) window.location.href = '/chat.html'; })
  .catch(() => {});