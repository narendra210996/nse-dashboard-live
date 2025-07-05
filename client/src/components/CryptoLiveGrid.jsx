import { useEffect, useState } from "react";

const SYMBOLS = [
  "btcusdt", "ethusdt", "bnbusdt", "solusdt", "xrpusdt", "dogeusdt",
  "adausdt", "avaxusdt", "dotusdt", "linkusdt", "trxusdt", "maticusdt",
  "ltcusdt", "bchusdt", "xlmusdt", "ftmusdt", "zecusdt", "wavesusdt",
  "axsusdt", "manausdt", "maskusdt", "pepeusdt", "galausdt", "renderusdt",
  "imxusdt", "thetausdt", "egldusdt", "api3usdt", "compusdt"
];

export default function CryptoLiveGrid() {
  const [prices, setPrices] = useState({});
  const [prevPrices, setPrevPrices] = useState({});
  const [usdInr, setUsdInr] = useState(83.0); // fallback INR rate

  useEffect(() => {
    fetch("https://api.exchangerate.host/latest?base=USD&symbols=INR")
      .then(res => res.json())
      .then(data => {
        if (data?.rates?.INR) setUsdInr(data.rates.INR);
      })
      .catch(() => console.warn("INR rate fetch failed"));
  }, []);

  useEffect(() => {
    const ws = new WebSocket(
      `wss://stream.binance.com:9443/stream?streams=${SYMBOLS.map(s => `${s}@trade`).join("/")}`
    );
    ws.onmessage = (e) => {
      const { data } = JSON.parse(e.data);
      const symbol = data.s.toLowerCase();
      const price = parseFloat(data.p);
      setPrevPrices(prev => ({ ...prev, [symbol]: prices[symbol] }));
      setPrices(prev => ({ ...prev, [symbol]: price }));
    };
    return () => ws.close();
  }, [prices]);

  const getColor = (symbol) => {
    const prev = prevPrices[symbol];
    const curr = prices[symbol];
    if (!prev) return "gray";
    return curr > prev ? "green" : curr < prev ? "red" : "gray";
  };

  const formatINR = (num) =>
    new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      maximumFractionDigits: 2,
    }).format(num);

  return (
    <div style={{ padding: "2rem", backgroundColor: "#0d1117", minHeight: "100vh" }}>
      <h2 style={{ color: "#fff", fontSize: "2rem", marginBottom: "1.5rem" }}>
        🪙 Live Crypto Prices (INR)
      </h2>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
          gap: "1rem",
        }}
      >
        {SYMBOLS.map(sym => {
          const price = prices[sym];
          const inr = price ? price * usdInr : null;
          const color = getColor(sym);

          return (
            <div
              key={sym}
              style={{
                backgroundColor: "#161b22",
                color: "#f0f6fc",
                padding: "1rem",
                borderRadius: "12px",
                boxShadow: "0 2px 8px rgba(0,0,0,0.2)",
                fontFamily: "Segoe UI, sans-serif",
              }}
            >
              <div style={{ fontSize: "1rem", fontWeight: 600 }}>
                {sym.replace("usdt", "").toUpperCase()}
              </div>
              <div style={{ fontSize: "1.1rem", color }}>
                {inr ? formatINR(inr) : "Loading..."}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
