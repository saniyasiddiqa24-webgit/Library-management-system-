// server.js
const express = require('express');
const cors = require('cors');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const bcrypt = require('bcrypt');

const DB_FILE = path.join(__dirname, 'library.db');
const app = express();
app.use(cors());
app.use(express.json());

// Serve frontend from /public
app.use(express.static(path.join(__dirname, 'public')));

app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Initialize DB if not present (and seed admin)
const initDb = () => {
  const exists = fs.existsSync(DB_FILE);
  const db = new sqlite3.Database(DB_FILE);
  db.serialize(async () => {
    if (!exists) {
      // create tables
      db.run(`CREATE TABLE books (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        author TEXT,
        year INTEGER,
        copies INTEGER DEFAULT 1,
        available INTEGER DEFAULT 1
      )`);

      db.run(`CREATE TABLE borrow_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        book_id INTEGER,
        borrower TEXT,
        borrow_date TEXT,
        return_date TEXT,
        returned INTEGER DEFAULT 0,
        FOREIGN KEY(book_id) REFERENCES books(id)
      )`);

      db.run(`CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'user'
      )`);

      // seed admin user
      const adminUsername = 'admin';
      const adminPassword = 'admin123';
      const hash = await bcrypt.hash(adminPassword, 10);
      db.run('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)', [adminUsername, hash, 'admin']);

      // sample books
      const stmt = db.prepare("INSERT INTO books (title, author, year, copies, available) VALUES (?, ?, ?, ?, ?)");
      stmt.run("The Great Gatsby", "F. Scott Fitzgerald", 1925, 3, 3);
      stmt.run("To Kill a Mockingbird", "Harper Lee", 1960, 2, 2);
      stmt.run("Introduction to Algorithms", "Cormen et al.", 2009, 1, 1);
      stmt.finalize();
      console.log('Database created and seeded.');
    }
  });
  return db;
};

const db = initDb();

/* Promisified helpers */
function runAsync(sql, params = []) {
  return new Promise((res, rej) => {
    db.run(sql, params, function (err) {
      if (err) return rej(err);
      res(this);
    });
  });
}
function allAsync(sql, params = []) {
  return new Promise((res, rej) => {
    db.all(sql, params, (err, rows) => {
      if (err) return rej(err);
      res(rows);
    });
  });
}
function getAsync(sql, params = []) {
  return new Promise((res, rej) => {
    db.get(sql, params, (err, row) => {
      if (err) return rej(err);
      res(row);
    });
  });
}

/* API endpoints */
app.get('/api/books', async (req, res) => {
  try {
    const rows = await allAsync("SELECT * FROM books ORDER BY id DESC");
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/books', async (req, res) => {
  try {
    const { title, author = '', year = null, copies = 1 } = req.body;
    if (!title) return res.status(400).json({ error: "title required" });
    const available = copies;
    const result = await runAsync("INSERT INTO books (title, author, year, copies, available) VALUES (?, ?, ?, ?, ?)", [title, author, year, copies, available]);
    const book = await getAsync("SELECT * FROM books WHERE id = ?", [result.lastID]);
    res.json(book);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/books/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const { title, author, year, copies } = req.body;
    const borrowedRow = await getAsync("SELECT COUNT(*) as borrowed FROM borrow_records WHERE book_id = ? AND returned = 0", [id]);
    const borrowed = borrowedRow ? borrowedRow.borrowed : 0;
    const newCopies = typeof copies === 'number' ? copies : undefined;
    const newAvailable = (newCopies !== undefined) ? Math.max(0, newCopies - borrowed) : undefined;

    const updates = [];
    const params = [];
    if (title !== undefined) { updates.push("title = ?"); params.push(title); }
    if (author !== undefined) { updates.push("author = ?"); params.push(author); }
    if (year !== undefined) { updates.push("year = ?"); params.push(year); }
    if (newCopies !== undefined) { updates.push("copies = ?"); params.push(newCopies); }
    if (newAvailable !== undefined) { updates.push("available = ?"); params.push(newAvailable); }
    if (updates.length === 0) return res.status(400).json({ error: "no fields to update" });
    params.push(id);
    const sql = `UPDATE books SET ${updates.join(', ')} WHERE id = ?`;
    await runAsync(sql, params);
    const book = await getAsync("SELECT * FROM books WHERE id = ?", [id]);
    res.json(book);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/books/:id', async (req, res) => {
  try {
    const id = req.params.id;
    await runAsync("DELETE FROM books WHERE id = ?", [id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/books/:id/borrow', async (req, res) => {
  try {
    const id = req.params.id;
    const { borrower } = req.body;
    if (!borrower) return res.status(400).json({ error: "borrower name required" });
    const book = await getAsync("SELECT * FROM books WHERE id = ?", [id]);
    if (!book) return res.status(404).json({ error: "book not found" });
    if (book.available <= 0) return res.status(400).json({ error: "no copies available" });

    await runAsync("INSERT INTO borrow_records (book_id, borrower, borrow_date, returned) VALUES (?, ?, ?, ?)", [id, borrower, new Date().toISOString(), 0]);
    await runAsync("UPDATE books SET available = available - 1 WHERE id = ?", [id]);
    const recs = await allAsync("SELECT * FROM borrow_records WHERE book_id = ? ORDER BY id DESC", [id]);
    res.json({ success: true, book, records: recs });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/books/:id/return', async (req, res) => {
  try {
    const id = req.params.id;
    const { recordId } = req.body;
    let record;
    if (recordId) {
      record = await getAsync("SELECT * FROM borrow_records WHERE id = ? AND book_id = ? AND returned = 0", [recordId, id]);
    } else {
      record = await getAsync("SELECT * FROM borrow_records WHERE book_id = ? AND returned = 0 ORDER BY id DESC LIMIT 1", [id]);
    }
    if (!record) return res.status(404).json({ error: "no unreturned borrow record found for this book" });
    await runAsync("UPDATE borrow_records SET returned = 1, return_date = ? WHERE id = ?", [new Date().toISOString(), record.id]);
    await runAsync("UPDATE books SET available = available + 1 WHERE id = ?", [id]);
    res.json({ success: true, recordId: record.id });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/borrow-records', async (req, res) => {
  try {
    const { book_id } = req.query;
    let rows;
    if (book_id) rows = await allAsync("SELECT * FROM borrow_records WHERE book_id = ? ORDER BY id DESC", [book_id]);
    else rows = await allAsync("SELECT * FROM borrow_records ORDER BY id DESC");
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/search', async (req, res) => {
  try {
    const q = (req.query.q || '').toLowerCase();
    const rows = await allAsync(`SELECT * FROM books WHERE LOWER(title) LIKE ? OR LOWER(author) LIKE ?`, [`%${q}%`, `%${q}%`]);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// login / register
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const user = await getAsync("SELECT * FROM users WHERE username = ?", [username]);
    if (!user) return res.status(400).json({ error: "User not found" });
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) return res.status(400).json({ error: "Incorrect password" });
    res.json({ success: true, role: user.role, username: user.username });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'username and password required' });
    const hash = await bcrypt.hash(password, 10);
    await runAsync("INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)", [username, hash, "user"]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* Fallback - redirect root to login (so login shown first) */
app.get('/', (req, res) => {
  res.redirect('/login');
});

// serve index.html for SPA paths (after login)
app.get('/app', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('*', (req, res) => {
  // if request is for file inside public, express.static already handled it
  // fallback to index for other routes (optional)
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`Library app listening on port ${PORT}`);
});