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
const FINNHUB_TOKEN = 'd1e1il1r01qlt46s1gn0d1e1il1r01qlt46s1gng'; // your key

const NIFTY_STOCKS = [
  "ADANIENT.NS", "ADANIPORTS.NS", "APOLLOHOSP.NS", "ASIANPAINT.NS", "AXISBANK.NS",
  "BAJAJ-AUTO.NS", "BAJFINANCE.NS", "BAJAJFINSV.NS", "BPCL.NS", "BHARTIARTL.NS",
  "BRITANNIA.NS", "CIPLA.NS", "COALINDIA.NS", "DIVISLAB.NS", "DRREDDY.NS",
  "EICHERMOT.NS", "GRASIM.NS", "HCLTECH.NS", "HDFCBANK.NS", "HDFCLIFE.NS",
  "HEROMOTOCO.NS", "HINDALCO.NS", "HINDUNILVR.NS", "ICICIBANK.NS", "ITC.NS",
  "INDUSINDBK.NS", "INFY.NS", "JSWSTEEL.NS", "KOTAKBANK.NS", "LTIM.NS",
  "LT.NS", "MARUTI.NS", "M&M.NS", "NTPC.NS", "NESTLEIND.NS",
  "ONGC.NS", "POWERGRID.NS", "RELIANCE.NS", "SBILIFE.NS", "SBIN.NS",
  "SUNPHARMA.NS", "TCS.NS", "TATACONSUM.NS", "TATAMOTORS.NS", "TATASTEEL.NS",
  "TECHM.NS", "TITAN.NS", "UPL.NS", "ULTRACEMCO.NS", "WIPRO.NS"
];

let cachedMetrics = {};
let cachedRecommendations = {};
let cachedQuotes = {};
let lastMetricRefresh = null;
let lastRecoRefresh = null;

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

app.get('/', (req, res) => res.redirect('/login'));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/register', (req, res) => res.sendFile(path.join(__dirname, 'public', 'register.html')));

app.post('/register', (req, res) => {
  const { username, password } = req.body;
  const users = loadUsers();
  if (users.find(u => u.username === username)) {
    return res.send('User already exists. <a href="/register">Try again</a>');
  }
  const hash = bcrypt.hashSync(password, 10);
  users.push({ username, password: hash });
  saveUsers(users);
  res.send('✅ Registered! <a href="/login">Login here</a>');
});

app.post('/login', (req, res) => {
  const { username, password } = req.body;
  const users = loadUsers();
  const user = users.find(u => u.username === username);
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.send('Invalid credentials. <a href="/login">Try again</a>');
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

function isMarketOpen() {
  const now = new Date();
  const ist = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
  const hour = ist.getHours();
  const minutes = ist.getMinutes();
  const day = ist.getDay();
  const total = hour * 60 + minutes;
  return day >= 1 && day <= 5 && total >= 540 && total <= 930;
}

function retryLater(fn, label) {
  console.log(`⏳ Retry ${label} in 10 min...`);
  setTimeout(() => fn().catch(() => retryLater(fn, label)), 10 * 60 * 1000);
}

async function refreshMetrics() {
  if (lastMetricRefresh && new Date().toDateString() === lastMetricRefresh.toDateString()) return;
  console.log("📊 Refreshing metrics...");
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
    console.log("✅ Metrics cached.");
  } catch (err) {
    console.error("❌ Metric error:", err.message);
    retryLater(refreshMetrics, "metrics");
  }
}

async function refreshRecommendations() {
  if (lastRecoRefresh && new Date().toDateString() === lastRecoRefresh.toDateString()) return;
  console.log("🧠 Refreshing recommendations...");
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
    console.log("✅ Recommendations cached.");
  } catch (err) {
    console.error("❌ Recommendation error:", err.message);
    retryLater(refreshRecommendations, "recommendations");
  }
}

app.get('/api/metrics', async (req, res) => {
  await refreshMetrics();
  res.json(NIFTY_STOCKS.map(symbol => ({
    symbol,
    ...cachedMetrics[symbol]
  })));
});

app.get('/api/recommendations', async (req, res) => {
  await refreshRecommendations();
  res.json(NIFTY_STOCKS.map(symbol => ({
    symbol,
    ...cachedRecommendations[symbol]
  })));
});

app.get('/api/quote', async (req, res) => {
  const live = isMarketOpen();
  const result = [];

  for (const symbol of NIFTY_STOCKS) {
    let quote = null;
    try {
      if (live || !cachedQuotes[symbol]) {
        const q = await axios.get("https://finnhub.io/api/v1/quote", {
          params: { symbol, token: FINNHUB_TOKEN }
        });
        quote = q.data;
        if (!live) cachedQuotes[symbol] = quote;
      } else {
        quote = cachedQuotes[symbol];
      }
    } catch (err) {
      console.error(`⚠️ Quote error for ${symbol}:`, err.message);
      quote = cachedQuotes[symbol] || {};
    }

    result.push({
      symbol,
      lastPrice: quote.c,
      change: quote.d,
      percentChange: quote.dp,
      previousClose: quote.pc
    });
  }

  res.json(result);
});

app.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
});
