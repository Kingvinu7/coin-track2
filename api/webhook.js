// api/webhook.js - Vercel serverless function
const TelegramBot = require("node-telegram-bot-api");
const axios = require("axios");

// Get token from environment variable
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

if (!BOT_TOKEN) {
  console.error("❌ TELEGRAM_BOT_TOKEN environment variable is required!");
}

const bot = new TelegramBot(BOT_TOKEN);

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
        timeout: 10000,
      }),
      axios.get("https://api.coingecko.com/api/v3/coins/markets", {
        params: {
          vs_currency: "usd",
          order: "market_cap_desc",
          per_page: 250,
          page: 2,
          price_change_percentage: "24h",
        },
        timeout: 10000,
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
    return { topMap: {}, topById: {} };
  }
}

// --- Fallback search ---
async function fallbackBestBySymbol(symbol) {
  try {
    const q = symbol.toLowerCase();
    const sr = await axios.get("https://api.coingecko.com/api/v3/search", {
      params: { query: q },
      timeout: 10000,
    });

    const candidates = sr.data.coins
      .filter(x => (x.symbol || "").toLowerCase() === q)
      .slice(0, 10);

    const pick = candidates.length ? candidates : sr.data.coins.slice(0, 10);
    if (!pick.length) return null;

    const ids = pick.map(x => x.id).join(",");
    const mr = await axios.get("https://api.coingecko.com/api/v3/coins/markets", {
      params: {
        vs_currency: "usd",
        ids,
        order: "market_cap_desc",
        price_change_percentage: "24h",
      },
      timeout: 10000,
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

  // Priority override
  if (priority[s]) {
    return await getCoinById(priority[s]);
  }

  // Get top 500 fresh each time (serverless)
  const { topMap, topById } = await getTop500();
  
  const id = topMap[s];
  if (id) {
    const row = topById[id];
    if (row) return row;
    return await getCoinById(id);
  }

  // Fallback search
  return await fallbackBestBySymbol(s);
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
      timeout: 10000,
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
function sendMessageToTopic(chatId, messageThreadId, text, options = {}) {
  const sendOptions = { ...options };
  if (messageThreadId) {
    sendOptions.message_thread_id = messageThreadId;
  }
  return bot.sendMessage(chatId, text, sendOptions);
}

// --- Main webhook handler ---
export default async function handler(req, res) {
  // Only accept POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  try {
    const update = req.body;
    const msg = update.message;
    
    if (!msg || !msg.text) {
      return res.status(200).json({ ok: true });
    }

    const chatId = msg.chat.id;
    const messageThreadId = msg.message_thread_id;
    const text = msg.text.trim();
    const username = msg.from.username || msg.from.first_name;

    console.log(`📱 Message from ${username}: "${text}"`);

    // Handle commands
    if (text.startsWith('/')) {
      const command = text.substring(1).toLowerCase();
      
      if (command === 'start') {
        await sendMessageToTopic(chatId, messageThreadId, 
          '👋 Welcome to the Crypto Price Bot!\n\nType /help to see how to use me.\n\n🚀 Running 24/7 on Vercel!');
      }
      else if (command === 'help') {
        await sendMessageToTopic(chatId, messageThreadId,
          '📌 Usage:\n\n• /eth → ETH price\n• 2 eth → value of 2 ETH\n• eth 0.5 → value of 0.5 ETH\n• Works for top 500 coins by market cap\n\nℹ️ Reply includes:\nPrice\nMC\nFDV\nATH');
      }
      else if (command === 'test') {
        await sendMessageToTopic(chatId, messageThreadId,
          `✅ Bot is working on Vercel!\nChat Type: ${msg.chat.type}\nTopic ID: ${messageThreadId || "None"}\nTime: ${new Date().toISOString()}`);
      }
      else {
        // Handle /symbol commands
        const coin = await getCoinBySymbol(command);
        if (coin) {
          await sendMessageToTopic(chatId, messageThreadId, buildReply(coin, 1));
        } else {
          await sendMessageToTopic(chatId, messageThreadId, `❌ Coin "${command.toUpperCase()}" not found.`);
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
            await sendMessageToTopic(chatId, messageThreadId, buildReply(coin, amount));
          } else {
            await sendMessageToTopic(chatId, messageThreadId, `❌ Coin "${symbol.toUpperCase()}" not found.`);
          }
        }
      }
    }

    res.status(200).json({ ok: true });
  } catch (error) {
    console.error('❌ Webhook error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}
