// script.js
const api = '/api';
const el = (id) => document.getElementById(id);

function showMessage(txt, err=false) {
  const m = el('message');
  if (!m) return;
  m.textContent = txt;
  m.style.background = err ? '#ffd6d6' : '#e6fff2';
  m.style.color = err ? '#8b0000' : '#0a5d2a';
  m.classList.remove('hidden');
  setTimeout(()=> m.classList.add('hidden'), 3500);
}

function escapeHtml(s){
  if (!s) return '';
  return String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
}

async function fetchBooks() {
  const res = await fetch(`${api}/books`);
  const books = await res.json();
  const tbody = document.querySelector('#books-table tbody');
  tbody.innerHTML = '';
  books.forEach(b => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${b.id}</td>
      <td>${escapeHtml(b.title)}</td>
      <td>${escapeHtml(b.author||'')}</td>
      <td>${b.year||''}</td>
      <td>${b.copies}</td>
      <td>${b.available}</td>
      <td class="actions">
        ${isAdmin() ? `<button data-id="${b.id}" class="edit">Edit</button>
        <button data-id="${b.id}" class="delete">Delete</button>` : ''}
        <button data-id="${b.id}" class="borrow">Borrow</button>
        <button data-id="${b.id}" class="return">Return</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

async function loadRecords(){
  const r = await fetch(`${api}/borrow-records`);
  const recs = await r.json();
  const container = el('records');
  if (!recs.length) { container.innerHTML = '<p>No records yet.</p>'; return; }
  const rows = recs.slice(0,20).map(rr => {
    return `<div style="padding:8px;border-bottom:1px solid #eee;">
      <strong>Record #${rr.id}</strong> — Book ID: ${rr.book_id}, Borrower: ${escapeHtml(rr.borrower)}, Borrowed: ${new Date(rr.borrow_date).toLocaleString()}, Returned: ${rr.returned ? new Date(rr.return_date).toLocaleString() : 'No'}
    </div>`;
  }).join('');
  container.innerHTML = rows;
}

function clearForm(){
  el('book-id').value = '';
  el('title').value = '';
  el('author').value = '';
  el('year').value = '';
  el('copies').value = 1;
}

function getCurrentUser() {
  try { return JSON.parse(localStorage.getItem('user') || 'null'); }
  catch (e) { return null; }
}
function isAdmin() {
  const u = getCurrentUser(); return u && u.role === 'admin';
}
function requireLogin() {
  const u = getCurrentUser();
  if (!u) {
    // not logged in — go to login page
    window.location.href = '/login';
    return false;
  }
  return true;
}

async function init() {
  if (!requireLogin()) return;

  const u = getCurrentUser();
  el('current-user').textContent = `${u.username} (${u.role})`;

  if (!isAdmin()) {
    // hide save/clear buttons from non-admin
    el('save-btn').style.display = 'none';
    el('clear-btn').style.display = 'none';
  }

  await fetchBooks();
  loadRecords();

  el('logout-btn').addEventListener('click', () => {
    localStorage.removeItem('user');
    window.location.href = '/login';
  });

  document.getElementById('book-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!isAdmin()) return showMessage('Only admin can add/edit books', true);
    const id = el('book-id').value;
    const payload = {
      title: el('title').value.trim(),
      author: el('author').value.trim(),
      year: el('year').value ? Number(el('year').value) : null,
      copies: el('copies').value ? Number(el('copies').value) : 1
    };
    try {
      let res;
      if (id) {
        res = await fetch(`${api}/books/${id}`, {
          method: 'PUT',
          headers:{ 'Content-Type':'application/json' },
          body: JSON.stringify(payload)
        });
      } else {
        res = await fetch(`${api}/books`, {
          method: 'POST',
          headers:{ 'Content-Type':'application/json' },
          body: JSON.stringify(payload)
        });
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error saving book');
      showMessage('Saved.');
      clearForm();
      await fetchBooks();
    } catch (err) { showMessage(err.message, true); }
  });

  el('clear-btn').addEventListener('click', clearForm);

  document.querySelector('#books-table tbody').addEventListener('click', async (e) => {
    if (!e.target.matches('button')) return;
    const id = e.target.dataset.id;
    if (e.target.classList.contains('edit')) {
      const r = await fetch(`${api}/books`);
      const books = await r.json();
      const b = books.find(x=>String(x.id) === String(id));
      if (b) {
        el('book-id').value = b.id;
        el('title').value = b.title;
        el('author').value = b.author;
        el('year').value = b.year || '';
        el('copies').value = b.copies;
      }
    } else if (e.target.classList.contains('delete')) {
      if (!isAdmin()) return showMessage('Only admin can delete', true);
      if (!confirm('Delete this book?')) return;
      const r = await fetch(`${api}/books/${id}`, { method: 'DELETE' });
      if (r.ok) { showMessage('Deleted.'); fetchBooks(); }
      else { const d = await r.json(); showMessage(d.error || 'Delete failed', true); }
    } else if (e.target.classList.contains('borrow')) {
      const borrower = prompt('Borrower name:');
      if (!borrower) return;
      const r = await fetch(`${api}/books/${id}/borrow`, {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ borrower })
      });
      const d = await r.json();
      if (!r.ok) { showMessage(d.error||'Borrow failed', true); }
      else { showMessage('Borrowed.'); fetchBooks(); loadRecords(); }
    } else if (e.target.classList.contains('return')) {
      const confirmReturn = confirm('Return most recent borrow record for this book?');
      if (!confirmReturn) return;
      const r = await fetch(`${api}/books/${id}/return`, {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({})
      });
      const d = await r.json();
      if (!r.ok) { showMessage(d.error||'Return failed', true); }
      else { showMessage('Returned.'); fetchBooks(); loadRecords(); }
    }
  });

  document.getElementById('borrow-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const bid = el('borrow-book-id').value;
    const borrower = el('borrower').value.trim();
    if (!bid || !borrower) return showMessage('book id and borrower required', true);
    const r = await fetch(`${api}/books/${bid}/borrow`, {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ borrower })
    });
    const d = await r.json();
    if (!r.ok) showMessage(d.error||'Borrow failed', true);
    else { showMessage('Borrowed.'); fetchBooks(); loadRecords(); }
  });

  document.getElementById('return-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const bid = el('return-book-id').value;
    if (!bid) return showMessage('book id required', true);
    const r = await fetch(`${api}/books/${bid}/return`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({}) });
    const d = await r.json();
    if (!r.ok) showMessage(d.error||'Return failed', true);
    else { showMessage('Returned'); fetchBooks(); loadRecords(); }
  });

  document.getElementById("search-btn").onclick = async () => {
    const query = document.getElementById("search-input").value.trim();
    if (!query) { fetchBooks(); return; }
    const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
    const books = await res.json();
    const tbody = document.querySelector("#books-table tbody");
    tbody.innerHTML = "";
    books.forEach(b => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
          <td>${b.id}</td>
          <td>${escapeHtml(b.title)}</td>
          <td>${escapeHtml(b.author)}</td>
          <td>${b.year||''}</td>
          <td>${b.copies}</td>
          <td>${b.available}</td>
          <td>
              ${isAdmin() ? `<button data-id="${b.id}" class="edit">Edit</button>
              <button data-id="${b.id}" class="delete">Delete</button>` : ''}
              <button data-id="${b.id}" class="borrow">Borrow</button>
              <button data-id="${b.id}" class="return">Return</button>
          </td>
      `;
      tbody.appendChild(tr);
    });
  };

  document.getElementById("clear-search-btn").onclick = () => {
    document.getElementById("search-input").value = "";
    fetchBooks();
  };

  // refresh every 30s
  setInterval(() => { fetchBooks(); loadRecords(); }, 30000);
}

window.addEventListener('DOMContentLoaded', init);