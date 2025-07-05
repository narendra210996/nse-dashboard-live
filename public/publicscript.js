function switchTab(tabId) {
  document.querySelectorAll('.tab-content').forEach(tab => tab.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(btn => btn.classList.remove('active'));
  document.getElementById(tabId).classList.add('active');
  document.querySelector(`.tab[onclick*="${tabId}"]`).classList.add('active');
}

function downloadExcel() {
  const table = document.querySelector("table");
  let csv = [];
  for (let row of table.rows) {
    let rowData = [];
    for (let cell of row.cells) {
      rowData.push(cell.textContent.trim());
    }
    csv.push(rowData.join(","));
  }
  const blob = new Blob([csv.join("\n")], { type: 'text/csv' });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "stock_dashboard.csv";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

// Load US Stock data
let cachedMetrics = {}, cachedRecos = {};
async function loadStaticData() {
  const [metrics, recos] = await Promise.all([
    fetch('/api/metrics').then(res => res.json()),
    fetch('/api/recommendations').then(res => res.json())
  ]);
  metrics.forEach(m => cachedMetrics[m.symbol] = m);
  recos.forEach(r => cachedRecos[r.symbol] = r);
}

async function fetchLiveQuotes() {
  const quotes = await fetch('/api/quote').then(res => res.json());
  const tbody = document.getElementById('stock-body');
  tbody.innerHTML = '';

  quotes.forEach(stock => {
    const symbol = stock.symbol;
    const metric = cachedMetrics[symbol] || {};
    const reco = cachedRecos[symbol] || {};

    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${symbol}</td>
      <td>${stock.lastPrice?.toFixed(2) ?? '-'}</td>
      <td>${stock.percentChange?.toFixed(2) ?? '-'}%</td>
      <td>${stock.previousClose?.toFixed(2) ?? '-'}</td>
      <td>${metric.weekHigh ?? '-'}</td>
      <td>${metric.weekLow ?? '-'}</td>
      <td>${metric.peRatio?.toFixed(2) ?? '-'}</td>
      <td>🧠 ${reco.strongBuy ?? 0}/${reco.hold ?? 0}/${reco.sell ?? 0}</td>
    `;
    tbody.appendChild(row);
  });

  document.getElementById("loader").style.display = "none";
}

(async () => {
  await loadStaticData();
  await fetchLiveQuotes();
  setInterval(fetchLiveQuotes, 2 * 60 * 1000);
})();

// Crypto WebSocket
const ws = new WebSocket("wss://stream.binance.com:9443/stream?streams=" + getSymbols().map(s => `${s}usdt@ticker`).join("/"));
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  const d = msg.data;
  const symbol = d.s.replace("USDT", "");
  const inr = parseFloat(d.c) * 83;

  const id = `coin-${symbol}`;
  let card = document.getElementById(id);
  if (!card) {
    card = document.createElement("div");
    card.className = "card";
    card.id = id;
    document.getElementById("crypto-feed").appendChild(card);
  }
  card.innerHTML = `<h3>${symbol}</h3><p>₹ ${inr.toFixed(2)}</p>`;
};

function getSymbols() {
  return [
    "btc", "eth", "bnb", "xrp", "sol", "ada", "doge", "avax", "dot", "shib",
    "matic", "trx", "ltc", "link", "bch", "xlm", "atom", "uni", "etc", "ton"
  ];
}
