const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const axios = require('axios');
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;
const USERS_FILE = './users.json';

app.use(cors());
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));

// 🔐 Session middleware
app.use(session({
  secret: 'my-secret-key',
  resave: false,
  saveUninitialized: false
}));

// 📁 Load users from users.json
function loadUsers() {
  if (!fs.existsSync(USERS_FILE)) return [];
  return JSON.parse(fs.readFileSync(USERS_FILE));
}

// 💾 Save users to users.json
function saveUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

// 🚪 Home redirect
app.get('/', (req, res) => {
  res.redirect('/login');
});

// ✅ Serve login and register pages
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/register', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'register.html'));
});

// 📝 Registration route with debug logging
app.post('/register', (req, res) => {
  const { username, password } = req.body;
  console.log('Registering user:', username);

  const users = loadUsers();
  const exists = users.some(u => u.username === username);

  if (exists) {
    console.log('User already exists:', username);
    return res.send('User already exists. <a href="/register">Try again</a>');
  }

  const hashedPassword = bcrypt.hashSync(password, 10);
  users.push({ username, password: hashedPassword });
  saveUsers(users);

  console.log('User saved:', username);
  res.send('✅ Registration successful! <a href="/login">Login here</a>');
});

// 🔐 Login route
app.post('/login', (req, res) => {
  const { username, password } = req.body;
  const users = loadUsers();
  const user = users.find(u => u.username === username);

  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.send('Invalid username or password. <a href="/login">Try again</a>');
  }

  req.session.user = username;
  res.redirect('/index.html');
});

// 🔒 Protect index.html (dashboard)
app.get('/index.html', (req, res, next) => {
  if (!req.session.user) {
    return res.redirect('/login');
  }
  next();
});

// 🚪 Logout route
app.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login');
  });
});

// 🔁 NSE Proxy API
app.get('/api/nifty', async (req, res) => {
  try {
    const response = await axios.get(
      'https://www.nseindia.com/api/equity-stockIndices?index=NIFTY 50',
      {
        headers: {
          'User-Agent': 'Mozilla/5.0',
          'Referer': 'https://www.nseindia.com'
        }
      }
    );
    res.json(response.data);
  } catch (err) {
    console.error('NSE fetch error:', err.message);
    res.status(500).json({ error: 'Unable to fetch data from NSE' });
  }
});

// ✅ Start the server
app.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
});
