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
const FINNHUB_TOKEN = 'd1e3gshr01qlt46scn30d1e3gshr01qlt46scn3g';

const US_STOCKS = ['AAPL', 'MSFT', 'TSLA', 'GOOGL', 'AMZN'];

app.use(cors());
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(session({
  secret: 'my-secret-key',
  resave: false,
  saveUninitialized: false
}));

function loadUsers() {
  if (!fs.existsSync(USERS_FILE)) return [];
  return JSON.parse(fs.readFileSync(USERS_FILE));
}
function saveUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

app.get('/', (req, res) => res.redirect('/login'));

app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/register', (req, res) => res.sendFile(path.join(__dirname, 'public', 'register.html')));

app.post('/register', (req, res) => {
  const { username, password } = req.body;
  const users = loadUsers();
  if (users.some(u => u.username === username)) {
    return res.send('User already exists. <a href="/register">Try again</a>');
  }
  const hashedPassword = bcrypt.hashSync(password, 10);
  users.push({ username, password: hashedPassword });
  saveUsers(users);
  res.send('✅ Registration successful! <a href="/login">Login here</a>');
});

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

app.get('/index.html', (req, res, next) => {
  if (!req.session.user) return res.redirect('/login');
  next();
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

// === Market Timing Logic (US EST) ===
function isUSMarketOpen() {
  const now = new Date();
  const estNow = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const day = estNow.getDay(); // 0 (Sun) to 6 (Sat)
  const hour = estNow.getHours();
  const minute = estNow.getMinutes();
  const totalMinutes = hour * 60 + minute;
  return day >= 1 && day <= 5 && totalMinutes >= 570 && totalMinutes <= 960;
}

// === Cache ===
let cachedMetrics = {};
let cachedRecos = {};
let cachedQuotes = {};
let lastMetricRefresh = null;
let lastRecoRefresh = null;

function retryLater(fn, label) {
  console.log(`⏳ Will retry ${label} in 10 mins...`);
  setTimeout(() => fn().catch(() => retryLater(fn, label)), 10 * 60 * 1000);
}

async function refreshMetrics() {
  if (lastMetricRefresh && new Date().toDateString() === lastMetricRefresh.toDateString()) return;
  console.log('📊 Refreshing /stock/metric...');
  try {
    for (const symbol of US_STOCKS) {
      const res = await axios.get('https://finnhub.io/api/v1/stock/metric', {
        params: { symbol, metric: 'all', token: FINNHUB_TOKEN }
      });
      const m = res.data.metric || {};
      cachedMetrics[symbol] = {
        symbol,
        weekHigh: m['52WeekHigh'],
        weekLow: m['52WeekLow'],
        peRatio: m['peNormalizedAnnual']
      };
    }
    lastMetricRefresh = new Date();
    console.log('✅ Metrics updated');
  } catch (err) {
    console.error('❌ Metric error:', err.message);
    retryLater(refreshMetrics, 'metrics');
  }
}

async function refreshRecommendations() {
  if (lastRecoRefresh && new Date().toDateString() === lastRecoRefresh.toDateString()) return;
  console.log('📈 Refreshing /stock/recommendation...');
  try {
    for (const symbol of US_STOCKS) {
      const res = await axios.get('https://finnhub.io/api/v1/stock/recommendation', {
        params: { symbol, token: FINNHUB_TOKEN }
      });
      const r = res.data[0] || {};
      cachedRecos[symbol] = {
        symbol,
        strongBuy: r.strongBuy || 0,
        buy: r.buy || 0,
        hold: r.hold || 0,
        sell: r.sell || 0
      };
    }
    lastRecoRefresh = new Date();
    console.log('✅ Recommendations updated');
  } catch (err) {
    console.error('❌ Recommendation error:', err.message);
    retryLater(refreshRecommendations, 'recommendations');
  }
}

app.get('/api/metrics', async (req, res) => {
  await refreshMetrics();
  res.json(Object.values(cachedMetrics));
});

app.get('/api/recommendations', async (req, res) => {
  await refreshRecommendations();
  res.json(Object.values(cachedRecos));
});

app.get('/api/quote', async (req, res) => {
  const isMarket = isUSMarketOpen();
  const quotes = [];

  for (const symbol of US_STOCKS) {
    let quote = null;

    if (isMarket || !cachedQuotes[symbol]) {
      try {
        const res = await axios.get('https://finnhub.io/api/v1/quote', {
          params: { symbol, token: FINNHUB_TOKEN }
        });
        quote = res.data;
        if (!isMarket) cachedQuotes[symbol] = quote;
      } catch (err) {
        console.error(`⚠️ Quote error for ${symbol}:`, err.message);
        quote = cachedQuotes[symbol] || {};
      }
    } else {
      quote = cachedQuotes[symbol];
    }

    quotes.push({
      symbol,
      lastPrice: quote.c,
      change: quote.d,
      percentChange: quote.dp,
      previousClose: quote.pc
    });
  }

  res.json(quotes);
});

app.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
});
