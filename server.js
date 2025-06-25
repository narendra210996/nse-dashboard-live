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

app.get('/', (req, res) => {
  res.redirect('/login');
});

app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/register', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'register.html'));
});

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
  if (!req.session.user) {
    return res.redirect('/login');
  }
  next();
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login');
  });
});

// ✅ Enhanced /api/nifty route with smart caching, retry logic, and market-time handling
const FINNHUB_TOKEN = 'd1e1il1r01qlt46s1gn0d1e1il1r01qlt46s1gng';
const NIFTY_STOCKS = [
  "RELIANCE.NS", "TCS.NS", "INFY.NS", "HDFCBANK.NS", "ICICIBANK.NS",
  "KOTAKBANK.NS", "SBIN.NS", "LT.NS", "ITC.NS", "AXISBANK.NS"
];

let cachedMetrics = {};           // 52W high/low, PE, etc.
let cachedRecommendations = {};   // Analyst data
let cachedQuotes = {};            // Last quote outside hours

let lastMetricRefresh = null;
let lastRecoRefresh = null;
let lastQuoteRefresh = null;

function isMarketOpen() {
  const now = new Date();
  const istOffset = 5.5 * 60 * 60000;
  const istNow = new Date(now.getTime() + istOffset);
  const day = istNow.getUTCDay();
  const hour = istNow.getUTCHours();
  const minute = istNow.getUTCMinutes();
  const totalMinutes = hour * 60 + minute;
  return day >= 1 && day <= 5 && totalMinutes >= 540 && totalMinutes <= 930;
}

function retryLater(fn, label) {
  console.log(`⏳ Will retry ${label} in 10 minutes...`);
  setTimeout(() => fn().catch(() => retryLater(fn, label)), 10 * 60 * 1000);
}

async function refreshMetrics() {
  if (lastMetricRefresh && new Date().toDateString() === lastMetricRefresh.toDateString()) return;
  console.log("📊 Refreshing /stock/metric...");
  try {
    for (const symbol of NIFTY_STOCKS) {
      const res = await axios.get("https://finnhub.io/api/v1/stock/metric", {
        params: { symbol, metric: "all", token: FINNHUB_TOKEN }
      });
      const m = res.data.metric || {};
      cachedMetrics[symbol] = {
        weekHigh: m['52WeekHigh'],
        weekLow: m['52WeekLow'],
        peRatio: m['peNormalizedAnnual']
      };
    }
    lastMetricRefresh = new Date();
    console.log("✅ Metrics refreshed.");
  } catch (err) {
    console.error("❌ Metrics fetch failed:", err.message);
    retryLater(refreshMetrics, "metrics");
  }
}

async function refreshRecommendations() {
  if (lastRecoRefresh && new Date().toDateString() === lastRecoRefresh.toDateString()) return;
  console.log("🧠 Refreshing /stock/recommendation...");
  try {
    for (const symbol of NIFTY_STOCKS) {
      const res = await axios.get("https://finnhub.io/api/v1/stock/recommendation", {
        params: { symbol, token: FINNHUB_TOKEN }
      });
      const r = res.data[0] || {};
      cachedRecommendations[symbol] = {
        strongBuy: r.strongBuy || 0,
        buy: r.buy || 0,
        hold: r.hold || 0,
        sell: r.sell || 0
      };
    }
    lastRecoRefresh = new Date();
    console.log("✅ Recommendations refreshed.");
  } catch (err) {
    console.error("❌ Recommendation fetch failed:", err.message);
    retryLater(refreshRecommendations, "recommendations");
  }
}

app.get('/api/nifty', async (req, res) => {
  await refreshMetrics();
  await refreshRecommendations();

  const isMarket = isMarketOpen();
  const stocks = [];

  for (const symbol of NIFTY_STOCKS) {
    let quote = null;
    if (isMarket || !cachedQuotes[symbol]) {
      try {
        const qRes = await axios.get("https://finnhub.io/api/v1/quote", {
          params: { symbol, token: FINNHUB_TOKEN }
        });
        quote = qRes.data;
        if (!isMarket) cachedQuotes[symbol] = quote;
      } catch (err) {
        console.error(`⚠️ Quote error for ${symbol}:`, err.message);
        quote = cachedQuotes[symbol] || {}; // fallback if exists
      }
    } else {
      quote = cachedQuotes[symbol];
    }

    stocks.push({
      symbol,
      lastPrice: quote.c,
      change: quote.d,
      percentChange: quote.dp,
      previousClose: quote.pc,
      weekHigh: cachedMetrics[symbol]?.weekHigh,
      weekLow: cachedMetrics[symbol]?.weekLow,
      peRatio: cachedMetrics[symbol]?.peRatio,
      recommendation: cachedRecommendations[symbol] || {}
    });
  }

  res.json(stocks);
});

app.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
});
