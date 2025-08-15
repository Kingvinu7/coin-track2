// api/webhook.js - Fully Fixed Version for Vercel

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

    return mr.data.length ? mr.data : null;

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
    const fallbackResults = await fallbackBestBySymbol(s);  
    return fallbackResults && fallbackResults.length > 0 ? fallbackResults[0] : null;

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

// --- Get historical data for chart ---
async function getHistoricalData(coinId) {
    try {
        const response = await axios.get(`https://api.coingecko.com/api/v3/coins/${coinId}/market_chart`, {
            params: {
                vs_currency: "usd",
                days: 30, // Default to 30 days of data
            },
            timeout: 15000,
        });
        return response.data.prices;
    } catch (e) {
        console.error("❌ getHistoricalData failed:", e.message);
        return null;
    }
}

// --- Get Ethereum Gas Price ---
async function getEthGasPrice() {
  try {
    const response = await axios.get("https://api.etherscan.io/api", {
      params: {
        module: "gastracker",
        action: "gasoracle",
        apikey: process.env.ETHERSCAN_API_KEY, // You will need to set this environment variable
      },
      timeout: 15000,
    });

    if (response.data.status === "1") {
      const result = response.data.result;
      return {
        low: result.SafeGasPrice,
        average: result.ProposeGasPrice,
        high: result.FastGasPrice,
      };
    } else {
      console.error("❌ Etherscan API error:", response.data.result);
      return null;
    }
  } catch (e) {
    console.error("❌ Etherscan API failed:", e.message);
    return null;
  }
}

// --- Evaluate a mathematical expression safely ---
function evaluateExpression(expression) {
  try {
    // Basic regex to ensure it only contains numbers, +, -, *, /, and parentheses
    const sanitizedExpression = expression.replace(/[^0-9+\-*/(). ]/g, '');
    
    // Check for empty or invalid expressions
    if (!sanitizedExpression || /^[+\-*/.]/.test(sanitizedExpression) || /[+\-*/.]$/.test(sanitizedExpression)) {
      return null;
    }

    // Use a sandboxed Function constructor to evaluate
    const result = new Function(`return ${sanitizedExpression}`)();
    
    // Check if the result is a valid number
    if (typeof result === 'number' && isFinite(result)) {
      return result;
    }
    
    return null;
  } catch (e) {
    console.error('❌ Calculator evaluation failed:', e.message);
    return null;
  }
}

// --- Generate QuickChart URL (new) ---
function getChartImageUrl(coinName, historicalData) {
  const labels = historicalData.map(d => new Date(d[0]).toLocaleDateString());
  const prices = historicalData.map(d => d[1]);

  const chartConfig = {
    type: 'line',
    data: {
      labels: labels,
      datasets: [{
        label: `${coinName} Price (USD)`,
        data: prices,
        fill: false,
        borderColor: 'rgb(75, 192, 192)',
        tension: 0.1,
        borderWidth: 2,
        pointRadius: 0,
      }],
    },
    options: {
      title: {
        display: true,
        text: `${coinName} Price Chart (30 Days)`,
        fontSize: 16,
      },
      scales: {
        xAxes: [{
          type: 'time',
          time: {
            unit: 'day'
          },
          display: true,
          scaleLabel: {
            display: true,
            labelString: 'Date'
          }
        }],
        yAxes: [{
          display: true,
          scaleLabel: {
            display: true,
            labelString: 'Price (USD)'
          }
        }]
      }
    }
  };

  const encodedConfig = encodeURIComponent(JSON.stringify(chartConfig));
  return `https://quickchart.io/chart?c=${encodedConfig}&w=500&h=300`;
}


// --- Build reply with monospace formatting ---
function buildReply(coin, amount) {
  const price = coin.current_price ?? 0;
  const total = price * (amount ?? 1);
  const mc = coin.market_cap ?? null;
  const fdv = coin.fully_diluted_valuation ?? null;
  const ath = coin.ath ?? null;

  const lines = [];
  if (amount != null && amount !== 1) {
    lines.push(`${amount} ${coin.symbol.toUpperCase()} = ${fmtPrice(total)}`);
  }
  lines.push(`Price: ${fmtPrice(price)}`);
  lines.push(`MC: ${fmtBig(mc)}`);
  lines.push(`FDV: ${fmtBig(fdv)}`);
  lines.push(`ATH: ${fmtPrice(ath)}`);

  return `\`\`\`\n${coin.name} (${coin.symbol.toUpperCase()})\n${lines.join('\n')}\n\`\`\``;
}

// --- Build gas price reply
function buildGasReply(gasPrices, ethPrice) {
  if (!gasPrices) {
    return '`Could not retrieve gas prices. Please try again later.`';
  }

  // A standard ETH transfer costs 21,000 gas units
  const gasLimit = 21000;

  const calculateCost = (gwei, ethPrice) => {
    const ethCost = (gwei * gasLimit) / 10**9;
    return ethCost * ethPrice;
  };

  const slowCost = calculateCost(gasPrices.low, ethPrice);
  const averageCost = calculateCost(gasPrices.average, ethPrice);
  const highCost = calculateCost(gasPrices.high, ethPrice);

  const lines = [];
  lines.push('Current Ethereum Gas Prices');
  lines.push('-----------------------------');
  lines.push(`Slow:    ${gasPrices.low} Gwei (~${fmtPrice(slowCost)})`);
  lines.push(`Average: ${gasPrices.average} Gwei (~${fmtPrice(averageCost)})`);
  lines.push(`Fast:    ${gasPrices.high} Gwei (~${fmtPrice(highCost)})`);
  lines.push('-----------------------------');
  lines.push(`ETH Price: ${fmtPrice(ethPrice)}`);

  return `\`\`\`\n${lines.join('\n')}\n\`\`\``;
}

// --- Send message with topic support and delete button ---
async function sendMessageToTopic(botToken, chatId, messageThreadId, text, options = {}) {
  const sendOptions = {
    chat_id: chatId,
    text: text,
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: "Delete",
            callback_data: "delete_message"
          }
        ]
      ]
    },
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

// --- Send Photo function (new) ---
async function sendPhotoToTopic(botToken, chatId, messageThreadId, photoUrl, caption = '') {
  const sendOptions = {
    chat_id: chatId,
    photo: photoUrl,
    caption: caption,
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: "Delete",
            callback_data: "delete_message"
          }
        ]
      ]
    }
  };

  if (messageThreadId) {
    sendOptions.message_thread_id = messageThreadId;
  }

  try {
    const response = await axios.post(`https://api.telegram.org/bot${botToken}/sendPhoto`, sendOptions, {
      timeout: 10000
    });
    return response.data;
  } catch (error) {
    console.error('Error sending photo:', error.message);
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

  const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  if (!BOT_TOKEN) {
    console.error('❌ TELEGRAM_BOT_TOKEN not set');
    return res.status(500).json({ error: 'Bot token not configured' });
  }

  try {
    const update = req.body;
    if (!update || (!update.message && !update.callback_query)) {
      return res.status(200).json({ ok: true, message: 'No message or callback in update' });
    }

    if (update.callback_query) {
      const callbackQuery = update.callback_query;
      const chatId = callbackQuery.message.chat.id;
      const messageId = callbackQuery.message.message_id;
      
      if (callbackQuery.data === 'delete_message') {
        try {
          await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/deleteMessage`, {
            chat_id: chatId,
            message_id: messageId
          });
          await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`, {
            callback_query_id: callbackQuery.id
          });
        } catch (error) {
          console.error('❌ Error deleting message:', error.message);
          await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`, {
            callback_query_id: callbackQuery.id,
            text: "Cannot delete this message"
          });
        }
      }
      return res.status(200).json({ ok: true });
    }

    const msg = update.message;
    if (!msg || !msg.text) {
      return res.status(200).json({ ok: true, message: 'No text in message' });
    }

    const chatId = msg.chat.id;
    const messageThreadId = msg.message_thread_id;
    const text = msg.text.trim();
    const username = msg.from.username || msg.from.first_name || 'Unknown';
    const chatType = msg.chat.type;
    
    const isAddress = text.length > 20 && text.length < 65 && /^(0x)?[a-fA-F0-9]+$/.test(text);
    if (isAddress) {
      return res.status(200).json({ ok: true, message: 'Ignoring potential address' });
    }

    if (text.startsWith('/')) {
      const parts = text.substring(1).toLowerCase().split(' ');
      const command = parts[0].split('@')[0];
      const symbol = parts[1]; // Get symbol from command, e.g. /chart eth

      if (command === 'chart' && symbol) {
        const coin = await getCoinBySymbol(symbol);
        if (coin) {
          const historicalData = await getHistoricalData(coin.id);
          if (historicalData) {
            const chartImageUrl = getChartImageUrl(coin.name, historicalData);
            await sendPhotoToTopic(BOT_TOKEN, chatId, messageThreadId, chartImageUrl, `*${coin.name}* Price Chart (30 Days)`);
          } else {
            await sendMessageToTopic(BOT_TOKEN, chatId, messageThreadId, `\`Failed to retrieve historical data for ${coin.name}\``);
          }
        } else {
          await sendMessageToTopic(BOT_TOKEN, chatId, messageThreadId, `\`Coin "${symbol.toUpperCase()}" not found\``);
        }
      }
      else if (command === 'gas') {
        const ethCoin = await getCoinBySymbol('eth');
        const ethPrice = ethCoin ? ethCoin.current_price : null;
        const gasPrices = await getEthGasPrice();
        
        if (ethPrice && gasPrices) {
          await sendMessageToTopic(BOT_TOKEN, chatId, messageThreadId, buildGasReply(gasPrices, ethPrice));
        } else {
          await sendMessageToTopic(BOT_TOKEN, chatId, messageThreadId, '`Failed to retrieve ETH gas or price data. Please try again.`');
        }
      }
      else if (command === 'start') {
        await sendMessageToTopic(BOT_TOKEN, chatId, messageThreadId,   
          '`Welcome to the Crypto Price Bot!`\n\n`Type /help to see how to use me.`\n\n`Running 24/7 on Vercel`');
      }  
      else if (command === 'help') {
        await sendMessageToTopic(BOT_TOKEN, chatId, messageThreadId,
          '```\nUsage:\n\n/eth → ETH price\n/gas → ETH gas price\n/chart eth → ETH price chart\n2 eth → value of 2 ETH\neth 0.5 → value of 0.5 ETH\n3+5 → 8\n100/5 → 20\nWorks for top 500 coins by market cap\n\nReply includes:\nPrice\nMC\nFDV\nATH\n```');
      }  
      else if (command === 'test') {
        await sendMessageToTopic(BOT_TOKEN, chatId, messageThreadId,
          `\`\`\`\nBot Status: Working on Vercel\nChat Type: ${msg.chat.type}\nTopic ID: ${messageThreadId || "None"}\nTime: ${new Date().toISOString()}\n\`\`\``);
      }  
      else {
        const coin = await getCoinBySymbol(command);
        if (coin) {
          await sendMessageToTopic(BOT_TOKEN, chatId, messageThreadId, buildReply(coin, 1));
        } else {
          await sendMessageToTopic(BOT_TOKEN, chatId, messageThreadId, `\`Coin "${command.toUpperCase()}" not found\``);
        }
      }  
    } else {
      // Regular expression to match a simple mathematical expression
      const mathRegex = /^([\d.\s]+(?:[+\-*/][\d.\s]+)*)$/;
      
      if (mathRegex.test(text)) {
        const result = evaluateExpression(text);
        if (result !== null) {
          await sendMessageToTopic(BOT_TOKEN, chatId, messageThreadId, `\`Result: ${result}\``);
        } else {
          await sendMessageToTopic(BOT_TOKEN, chatId, messageThreadId, '`Invalid mathematical expression.`');
        }
        return res.status(200).json({ ok: true });
      }

      // Handle "2 eth" or "eth 2" format
      const re = /^(\d*\.?\d+)\s+([a-zA-Z]+)$|^([a-zA-Z]+)\s+(\d*\.?\d+)$/;
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
            await sendMessageToTopic(BOT_TOKEN, chatId, messageThreadId, `\`Coin "${symbol.toUpperCase()}" not found\``);
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
