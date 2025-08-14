// api/webhook.js - Fixed and robust version for Vercel
import axios from 'axios';

// --- Helpers ---
function fmtBig(n) {
  if (n == null) return "N/A";
  if (n >= 1e12) return (n / 1e12).toFixed(2) + "T";
  if (n >= 1e9)  return (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6)  return (n / 1e6).toFixed(2) + "M";
  return n.toLocaleString();
}

function fmtPrice(n) {
  if (n == null) return "$0";
  return "$" + n.toLocaleString(undefined, { maximumFractionDigits: 8 });
}

// Strong guarantees for common tickers
const priority = {
  btc: "bitcoin",
  eth: "ethereum",
  usdt: "tether",
  usdc: "usd-coin",
  bnb: "binancecoin",
  xrp: "ripple",
  sol: "solana",
  ton: "the-open-network",
  ada: "cardano",
  doge: "dogecoin",
  trx: "tron",
  avax: "avalanche-2",
  shib: "shiba-inu",
  wbtc: "wrapped-bitcoin",
  link: "chainlink",
  dot: "polkadot",
  bch: "bitcoin-cash",
  near: "near",
  dai: "dai",
  ltc: "litecoin",
  uni: "uniswap",
  matic: "matic-network",
  etc: "ethereum-classic",
  atom: "cosmos",
  hbar: "hedera-hashgraph",
  xlm: "stellar",
  cro: "crypto-com-chain",
  fil: "filecoin",
  vet: "vechain",
};

// --- Load Top 500 coins ---
async function getTop500() {
  try {
    const [p1, p2] = await Promise.all([
      axios.get("https://api.coingecko.com/api/v3/coins/markets", {
        params: {
          vs_currency: "usd",
          order: "market_cap_desc",
          per_page: 250,
          page: 1,
          price_change_percentage: "24h",
        },
        timeout: 15000,
      }),
      axios.get("https://api.coingecko.com/api/v3/coins/markets", {
        params: {
          vs_currency: "usd",
          order: "market_cap_desc",
          per_page: 250,
          page: 2,
          price_change_percentage: "24h",
        },
        timeout: 15000,
      }),
    ]);

    const topMap = {};
    const topById = {};
    const coins = [...p1.data, ...p2.data];

    for (const c of coins) {
      const sym = (c.symbol || "").toLowerCase();
      if (!topMap[sym]) topMap[sym] = c.id;
      topById[c.id] = c;
    }

    // Override with priorities
    for (const [sym, id] of Object.entries(priority)) {
      topMap[sym] = id;
    }

    return { topMap, topById };
  } catch (e) {
    console.error("❌ Top500 failed:", e.message);
    return { topMap: priority, topById: {} }; // Fallback to priority list
  }
}

// --- Fallback search ---
async function fallbackBestBySymbol(symbol) {
  try {
    const q = symbol.toLowerCase();
    const sr = await axios.get("https://api.coingecko.com/api/v3/search", {
      params: { query: q },
      timeout: 15000,
    });

    const candidates = sr.data.coins
      .filter(x => (x.symbol || "").toLowerCase() === q)
      .slice(0, 5);

    const pick = candidates.length ? candidates : sr.data.coins.slice(0, 5);
    if (!pick.length) return null;

    const ids = pick.map(x => x.id).join(",");
    const mr = await axios.get("https://api.coingecko.com/api/v3/coins/markets", {
      params: {
        vs_currency: "usd",
        ids,
        order: "market_cap_desc",
        price_change_percentage: "24h",
      },
      timeout: 15000,
    });

    return mr.data.length ? mr.data[0] : null;
  } catch (e) {
    console.error("Fallback search failed:", e.message);
    return null;
  }
}

// --- Get coin by symbol ---
async function getCoinBySymbol(symbol) {
  const s = symbol.toLowerCase();

  // Priority override first
  if (priority[s]) {
    return await getCoinById(priority[s]);
  }

  try {
    // Get top 500 fresh each time (serverless - no caching)
    const { topMap, topById } = await getTop500();
    
    const id = topMap[s];
    if (id) {
      const row = topById[id];
      if (row) return row;
      return await getCoinById(id);
    }

    // Fallback search
    return await fallbackBestBySymbol(s);
  } catch (error) {
    console.error(`Error getting coin ${s}:`, error.message);
    return null;
  }
}

// --- Get coin by id ---
async function getCoinById(id) {
  try {
    const r = await axios.get("https://api.coingecko.com/api/v3/coins/markets", {
      params: {
        vs_currency: "usd",
        ids: id,
        order: "market_cap_desc",
        price_change_percentage: "24h",
      },
      timeout: 15000,
    });
    return r.data.length ? r.data[0] : null;
  } catch (e) {
    console.error("getCoinById failed:", e.message);
    return null;
  }
}

// --- Build reply ---
function buildReply(coin, amount) {
  const price = coin.current_price ?? 0;
  const total = price * (amount ?? 1);
  const mc = coin.market_cap ?? null;
  const fdv = coin.fully_diluted_valuation ?? null;
  const ath = coin.ath ?? null;

  const lines = [];
  if (amount != null && amount !== 1) {
    lines.push(`💰 ${amount} ${coin.symbol.toUpperCase()} = ${fmtPrice(total)}`);
  }
  lines.push(`Price: ${fmtPrice(price)}`);
  lines.push(`MC: $${fmtBig(mc)}`);
  lines.push(`FDV: $${fmtBig(fdv)}`);
  lines.push(`ATH: ${fmtPrice(ath)}`);

  return `🪙 ${coin.name} (${coin.symbol.toUpperCase()})\n` + lines.join("\n");
}

// --- Send message with topic support ---
async function sendMessageToTopic(botToken, chatId, messageThreadId, text, options = {}) {
  const sendOptions = { 
    chat_id: chatId,
    text: text,
    ...options 
  };
  
  if (messageThreadId) {
    sendOptions.message_thread_id = messageThreadId;
  }
  
  try {
    const response = await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, sendOptions, {
      timeout: 10000
    });
    return response.data;
  } catch (error) {
    console.error('Error sending message:', error.message);
    throw error;
  }
}

// --- Main webhook handler ---
export default async function handler(req, res) {
  // Handle CORS and preflight
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle preflight OPTIONS request
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Handle GET request (for testing)
  if (req.method === 'GET') {
    return res.status(200).json({ 
      status: 'Webhook endpoint is working!', 
      method: 'GET',
      timestamp: new Date().toISOString()
    });
  }

  // Only accept POST requests for webhook
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  // Get bot token
  const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  if (!BOT_TOKEN) {
    console.error('❌ TELEGRAM_BOT_TOKEN not set');
    return res.status(500).json({ error: 'Bot token not configured' });
  }

  try {
    const update = req.body;
    
    // Validate update
    if (!update || !update.message) {
      return res.status(200).json({ ok: true, message: 'No message in update' });
    }

    const msg = update.message;
    if (!msg.text) {
      return res.status(200).json({ ok: true, message: 'No text in message' });
    }

    const chatId = msg.chat.id;
    const messageThreadId = msg.message_thread_id;
    const text = msg.text.trim();
    const username = msg.from.username || msg.from.first_name || 'Unknown';

    console.log(`📱 Message from ${username}: "${text}"`);

    // Handle commands
    if (text.startsWith('/')) {
      const command = text.substring(1).toLowerCase().split('@')[0]; // Remove @botname if present
      
      if (command === 'start') {
        await sendMessageToTopic(BOT_TOKEN, chatId, messageThreadId, 
          '👋 Welcome to the Crypto Price Bot!\n\nType /help to see how to use me.\n\n🚀 Running 24/7');
      }
      else if (command === 'help') {
        await sendMessageToTopic(BOT_TOKEN, chatId, messageThreadId,
          '📌 Usage:\n\n• /eth → ETH price\n• 2 eth → value of 2 ETH\n• eth 0.5 → value of 0.5 ETH\n• Works for top 500 coins by market cap\n\nℹ️ Reply includes:\nPrice\nMC\nFDV\nATH');
      }
      else if (command === 'test') {
        await sendMessageToTopic(BOT_TOKEN, chatId, messageThreadId,
          `✅ Bot is working on Vercel!\nChat Type: ${msg.chat.type}\nTopic ID: ${messageThreadId || "None"}\nTime: ${new Date().toISOString()}`);
      }
      else {
        // Handle /symbol commands
        const coin = await getCoinBySymbol(command);
        if (coin) {
          await sendMessageToTopic(BOT_TOKEN, chatId, messageThreadId, buildReply(coin, 1));
        } else {
          await sendMessageToTopic(BOT_TOKEN, chatId, messageThreadId, `❌ Coin "${command.toUpperCase()}" not found.`);
        }
      }
    } else {
      // Handle "2 eth" or "eth 2" format
      const re = /^(\d*\.?\d+)\s*([a-zA-Z0-9]+)$|^([a-zA-Z0-9]+)\s*(\d*\.?\d+)$/;
      const m = text.toLowerCase().match(re);
      
      if (m) {
        let amount, symbol;
        if (m[1] && m[2]) {
          amount = parseFloat(m[1]);
          symbol = m[2];
        } else if (m[3] && m[4]) {
          symbol = m[3];
          amount = parseFloat(m[4]);
        }
        
        if (amount && symbol) {
          const coin = await getCoinBySymbol(symbol);
          if (coin) {
            await sendMessageToTopic(BOT_TOKEN, chatId, messageThreadId, buildReply(coin, amount));
          } else {
            await sendMessageToTopic(BOT_TOKEN, chatId, messageThreadId, `❌ Coin "${symbol.toUpperCase()}" not found.`);
          }
        }
      }
    }

    return res.status(200).json({ ok: true });
    
  } catch (error) {
    console.error('❌ Webhook error:', error.message);
    console.error('Stack:', error.stack);
    return res.status(500).json({ error: 'Internal server error', message: error.message });
  }
}
