import axios from 'axios';

// --- Helpers ---
function fmtBig(n) {
  if (n == null) return "N/A";
  if (n >= 1e12) return (n / 1e12).toFixed(2) + "T";
  if (n >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
  return n.toLocaleString();
}

function fmtPrice(n) {
  if (n == null) return "$0";
  return "$" + n.toLocaleString(undefined, { maximumFractionDigits: 8 });
}

function fmtChange(n) {
  if (n == null) return "N/A";
  const sign = n >= 0 ? '🟢' : '🔴';
  return `${sign} ${n.toFixed(2)}%`;
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

// --- Get all coin data in a single API call (NEW) ---
async function getCoinDataWithChanges(symbol) {
  const s = symbol.toLowerCase();
  let coinId = priority[s];

  try {
    if (!coinId) {
      // If not in priority list, perform a search to find the ID
      const searchResponse = await axios.get("https://api.coingecko.com/api/v3/search", {
        params: { query: s },
        timeout: 15000,
      });
      const bestMatch = searchResponse.data.coins.find(c => c.symbol.toLowerCase() === s);
      if (bestMatch) {
        coinId = bestMatch.id;
      }
    }

    if (!coinId) {
      console.warn(`⚠️ Could not find a matching ID for symbol: ${s}`);
      return null;
    }

    const response = await axios.get("https://api.coingecko.com/api/v3/coins/markets", {
      params: {
        vs_currency: "usd",
        ids: coinId,
        price_change_percentage: "1h,24h,7d,30d",
        sparkline: "true"
      },
      timeout: 15000,
    });

    if (response.data.length > 0) {
      return response.data[0];
    }
    
    return null;

  } catch (e) {
    console.error(`❌ getCoinDataWithChanges failed for ${s}:`, e.message);
    return null;
  }
}

// --- Get historical data for chart ---
async function getHistoricalData(coinId) {
    try {
        const response = await axios.get(`https://api.coingecko.com/api/v3/coins/${coinId}/market_chart`, {
            params: {
                vs_currency: "usd",
                days: 30,
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
        apikey: process.env.ETHERSCAN_API_KEY,
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
    const sanitizedExpression = expression.replace(/[^0-9+\-*/(). ]/g, '');
    if (!sanitizedExpression || /^[+\-*/.]/.test(sanitizedExpression) || /[+\-*/.]$/.test(sanitizedExpression)) {
      return null;
    }
    const result = new Function(`return ${sanitizedExpression}`)();
    if (typeof result === 'number' && isFinite(result)) {
      return result;
    }
    return null;
  } catch (e) {
    console.error('❌ Calculator evaluation failed:', e.message);
    return null;
  }
}

// --- Generate QuickChart URL ---
function getChartImageUrl(coinName, historicalData) {
  try {
    const maxPoints = 30;
    const step = Math.max(1, Math.floor(historicalData.length / maxPoints));
    const sampledData = historicalData.filter((_, index) => index % step === 0);
    
    const labels = sampledData.map(d => {
      const date = new Date(d[0]);
      return `${date.getMonth() + 1}/${date.getDate()}`;
    });
    const prices = sampledData.map(d => parseFloat(d[1].toFixed(8)));

    const chartConfig = {
      type: 'line',
      data: {
        labels: labels,
        datasets: [{
          label: `${coinName} Price`,
          data: prices,
          fill: false,
          borderColor: 'rgb(75, 192, 192)',
          tension: 0.1,
          borderWidth: 2,
          pointRadius: 1,
        }],
      },
      options: {
        responsive: true,
        title: {
          display: true,
          text: `${coinName} - 30 Days`,
          fontSize: 14,
        },
        legend: {
          display: false
        },
        scales: {
          xAxes: [{
            display: true,
            scaleLabel: {
              display: false
            }
          }],
          yAxes: [{
            display: true,
            scaleLabel: {
              display: false
            }
          }]
        }
      }
    };

    const compactConfig = encodeURIComponent(JSON.stringify(chartConfig));
    return `https://quickchart.io/chart?c=${compactConfig}&w=400&h=250&backgroundColor=white`;
    
  } catch (error) {
    console.error('❌ Chart URL generation failed:', error.message);
    return `https://quickchart.io/chart?c=${encodeURIComponent(JSON.stringify({
      type: 'line',
      data: { labels: ['Error'], datasets: [{ data: [0] }] }
    }))}&w=400&h=250`;
  }
}

// --- Build reply with monospace formatting ---
function buildReply(coin, amount) {
  try {
    const price = coin.current_price ?? 0;
    const total = price * (amount ?? 1);
    const mc = coin.market_cap ?? null;
    const ath = coin.ath ?? null;
    const fdv = (coin.fully_diluted_valuation === 0 || coin.fully_diluted_valuation == null) ? "N/A" : fmtBig(coin.fully_diluted_valuation);
    const price_change_1h = coin.price_change_percentage_1h_in_currency;
    const price_change_24h = coin.price_change_percentage_24h_in_currency;
    const price_change_7d = coin.price_change_percentage_7d_in_currency;
    const price_change_30d = coin.price_change_percentage_30d_in_currency;

    const lines = [];
    if (amount != null && amount !== 1) {
      lines.push(`${amount} ${coin.symbol.toUpperCase()} = ${fmtPrice(total)}`);
    }
    lines.push(`Price: ${fmtPrice(price)}`);
    lines.push(`MC: ${fmtBig(mc)}`);
    lines.push(`FDV: ${fdv}`);
    lines.push(`ATH: ${fmtPrice(ath)}`);
    lines.push(`1H: ${fmtChange(price_change_1h)}`);
    lines.push(`1D: ${fmtChange(price_change_24h)}`);
    lines.push(`7D: ${fmtChange(price_change_7d)}`);
    lines.push(`30D: ${fmtChange(price_change_30d)}`);

    return `\`${coin.name} (${coin.symbol.toUpperCase()})\n${lines.join('\n')}\``;
  } catch (error) {
    console.error('❌ buildReply error:', error.message);
    return `\`Error formatting reply for ${coin?.name || 'unknown coin'}\``;
  }
}

// --- Build gas price reply ---
function buildGasReply(gasPrices, ethPrice) {
  try {
    if (!gasPrices) {
      return '`Could not retrieve gas prices. Please try again later.`';
    }

    const gasLimit = 21000;
    const calculateCost = (gwei, ethPrice) => (gwei * gasLimit) / 10**9 * ethPrice;

    const slowCost = calculateCost(gasPrices.low, ethPrice);
    const averageCost = calculateCost(gasPrices.average, ethPrice);
    const highCost = calculateCost(gasPrices.high, ethPrice);

    const lines = [];
    lines.push('Ethereum Gas Prices');
    lines.push('-------------------');
    lines.push(`Slow: ${gasPrices.low} Gwei (~${fmtPrice(slowCost)})`);
    lines.push(`Avg: ${gasPrices.average} Gwei (~${fmtPrice(averageCost)})`);
    lines.push(`Fast: ${gasPrices.high} Gwei (~${fmtPrice(highCost)})`);
    lines.push(`ETH: ${fmtPrice(ethPrice)}`);

    return `\`${lines.join('\n')}\``;
  } catch (error) {
    console.error('❌ buildGasReply error:', error.message);
    return '`Error formatting gas prices`';
  }
}

// --- Send message with topic support and delete button (FINAL FIX) ---
async function sendMessageToTopic(botToken, chatId, messageThreadId, text, options = {}) {
  if (!text || text.trim() === '') {
    console.error('❌ Refusing to send an empty message.');
    return;
  }
  
  const baseOptions = {
    chat_id: parseInt(chatId),
    text: text,
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [{ text: "🗑️ Delete", callback_data: "delete_message" }]
      ]
    },
    ...options
  };

  const trySend = async (opts) => {
    try {
      const response = await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, opts, {
        timeout: 10000,
        headers: {
          'Content-Type': 'application/json',
        }
      });
      return response.data;
    } catch (error) {
      if (error.response) {
        console.error('Response data:', error.response.data);
        console.error('Response status:', error.response.status);
      }
      throw error;
    }
  };

  try {
    let attemptOptions = { ...baseOptions };
    if (messageThreadId && parseInt(messageThreadId) > 0) {
      attemptOptions.message_thread_id = parseInt(messageThreadId);
    }
    return await trySend(attemptOptions);

  } catch (error) {
    if (error.response && error.response.status === 400 && error.response.data.description.includes('message thread not found')) {
      console.warn('⚠️ Thread not found, attempting to send to main chat.');
      try {
        const fallbackOptions = { ...baseOptions };
        delete fallbackOptions.message_thread_id;
        return await trySend(fallbackOptions);
      } catch (fallbackError) {
        console.error('❌ Fallback to main chat also failed:', fallbackError.message);
        throw fallbackError;
      }
    } else {
      throw error;
    }
  }
}

// --- Send Photo function (FINAL FIX) ---
async function sendPhotoToTopic(botToken, chatId, messageThreadId, photoUrl, caption = '') {
  const baseOptions = {
    chat_id: parseInt(chatId),
    photo: photoUrl,
    caption: caption,
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [{ text: "🗑️ Delete", callback_data: "delete_message" }]
      ]
    }
  };

  const trySend = async (opts) => {
    try {
      const response = await axios.post(`https://api.telegram.org/bot${botToken}/sendPhoto`, opts, {
        timeout: 15000,
        headers: {
          'Content-Type': 'application/json',
        }
      });
      return response.data;
    } catch (error) {
      if (error.response) {
        console.error('Photo response data:', error.response.data);
      }
      throw error;
    }
  };

  try {
    let attemptOptions = { ...baseOptions };
    if (messageThreadId && parseInt(messageThreadId) > 0) {
      attemptOptions.message_thread_id = parseInt(messageThreadId);
    }
    return await trySend(attemptOptions);

  } catch (error) {
    if (error.response && error.response.status === 400 && error.response.data.description.includes('message thread not found')) {
      console.warn('⚠️ Thread not found for photo, attempting to send to main chat.');
      try {
        const fallbackOptions = { ...baseOptions };
        delete fallbackOptions.message_thread_id;
        return await trySend(fallbackOptions);
      } catch (fallbackError) {
        console.error('❌ Fallback photo send also failed:', fallbackError.message);
        throw fallbackError;
      }
    } else {
      throw error;
    }
  }
}

// --- Main webhook handler ---
export default async function handler(req, res) {
  // Handle CORS and preflight
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  if (req.method === 'GET') {
    return res.status(200).json({
      status: 'Webhook endpoint is working!',
      method: 'GET',
      timestamp: new Date().toISOString()
    });
  }
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

    // --- ENHANCED MESSAGE FILTERING LOGIC ---
    const isCommand = text.startsWith('/');
    const isReplyToBot = msg.reply_to_message?.from?.username === "YOUR_BOT_USERNAME"; // <-- REPLACE THIS
    const mathRegex = /^([\d.\s]+(?:[+\-*/][\d.\s]+)*)$/;
    const isCalculation = mathRegex.test(text);
    const re = /^(\d*\.?\d+)\s+([a-zA-Z]+)$|^([a-zA-Z]+)\s+(\d*\.?\d+)$/;
    const isCoinCheck = re.test(text);
    
    if (!isCommand && !isReplyToBot && !isCalculation && !isCoinCheck && chatType === 'group') {
      return res.status(200).json({ ok: true, message: 'Ignoring non-command/calculation/coin message' });
    }
    // --- END OF ENHANCED FILTERING ---

    console.log(`📨 Message from ${username} in ${chatType}: "${text}" (Thread ID: ${messageThreadId})`);
    
    const isAddress = text.length > 20 && text.length < 65 && /^(0x)?[a-fA-F0-9]+$/.test(text);
    if (isAddress) {
      return res.status(200).json({ ok: true, message: 'Ignoring potential address' });
    }

    if (isCommand) {
      const parts = text.substring(1).toLowerCase().split(' ');
      const command = parts[0].split('@')[0];
      const symbol = parts[1];
      
      if (command === 'chart' && symbol) {
        const coinData = await getCoinDataWithChanges(symbol);
        if (coinData) {
          const historicalData = await getHistoricalData(coinData.id);
          if (historicalData && historicalData.length > 0) {
            const chartImageUrl = getChartImageUrl(coinData.name, historicalData);
            await sendPhotoToTopic(BOT_TOKEN, chatId, messageThreadId, chartImageUrl, `*${coinData.name}* Price Chart (30 Days)`);
          } else {
            await sendMessageToTopic(BOT_TOKEN, chatId, messageThreadId, `\`Failed to get chart data for ${coinData.name}\``);
          }
        } else {
          await sendMessageToTopic(BOT_TOKEN, chatId, messageThreadId, `\`Coin "${symbol.toUpperCase()}" not found\``);
        }
      }
      else if (command === 'gas') {
        const ethCoin = await getCoinDataWithChanges('eth');
        const ethPrice = ethCoin ? ethCoin.current_price : null;
        const gasPrices = await getEthGasPrice();
        if (ethPrice && gasPrices) {
          await sendMessageToTopic(BOT_TOKEN, chatId, messageThreadId, buildGasReply(gasPrices, ethPrice));
        } else {
          await sendMessageToTopic(BOT_TOKEN, chatId, messageThreadId, '`Failed to retrieve gas data`');
        }
      }
      else if (command === 'start') {
        await sendMessageToTopic(BOT_TOKEN, chatId, messageThreadId,   
          '`Welcome to Crypto Price Bot! Type /help for commands.`');
      }  
      else if (command === 'help') {
        await sendMessageToTopic(BOT_TOKEN, chatId, messageThreadId,
          '`Commands:\n/eth - ETH price\n/gas - ETH gas prices\n/chart eth - Price chart\n2 eth - Calculate value\nMath: 3+5, 100/5\n\nWorks for top 500 coins`');
      }  
      else if (command === 'test') {
        await sendMessageToTopic(BOT_TOKEN, chatId, messageThreadId,
          `\`Bot Status: OK\nChat: ${msg.chat.type}\nTopic: ${messageThreadId || "None"}\nTime: ${new Date().toISOString()}\``);
      }  
      else {
        const coin = await getCoinDataWithChanges(command);
        if (coin) {
          await sendMessageToTopic(BOT_TOKEN, chatId, messageThreadId, buildReply(coin, 1));
        } else {
          await sendMessageToTopic(BOT_TOKEN, chatId, messageThreadId, `\`Coin "${command.toUpperCase()}" not found\``);
        }
      }  
    } else if (isCalculation) {
        const result = evaluateExpression(text);
        if (result !== null) {
          await sendMessageToTopic(BOT_TOKEN, chatId, messageThreadId, `\`${text} = ${result}\``);
        } else {
          await sendMessageToTopic(BOT_TOKEN, chatId, messageThreadId, '`Invalid expression`');
        }
    } else if (isCoinCheck) {
        const m = text.toLowerCase().match(re);
        let amount, symbol;
        if (m[1] && m[2]) {
          amount = parseFloat(m[1]);
          symbol = m[2];
        } else if (m[3] && m[4]) {
          symbol = m[3];
          amount = parseFloat(m[4]);
        }
        if (amount && symbol) {
          const coin = await getCoinDataWithChanges(symbol);
          if (coin) {
            await sendMessageToTopic(BOT_TOKEN, chatId, messageThreadId, buildReply(coin, amount));
          } else {
            await sendMessageToTopic(BOT_TOKEN, chatId, messageThreadId, `\`Coin "${symbol.toUpperCase()}" not found\``);
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
