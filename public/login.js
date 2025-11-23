// login.js
document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('login-form');
  const msg = document.getElementById('login-message');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    msg.classList.add('hidden');
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value;

    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ username, password })
      });
      const data = await res.json();
      if (!res.ok) {
        msg.textContent = data.error || 'Login failed';
        msg.classList.remove('hidden');
        return;
      }
      // store user locally (simple) so index.js can check role
      localStorage.setItem('libraryUser', JSON.stringify({
        username: data.username,
        role: data.role
      }));
      // redirect to index
      window.location.href = '/index.html';
    } catch (err) {
      msg.textContent = err.message;
      msg.classList.remove('hidden');
    }
  });
});