import axios from 'axios';
import admin from 'firebase-admin';
import { GoogleGenerativeAI } from "@google/generative-ai";
import FormData from 'form-data';

// --- Firebase Initialization ---
if (!admin.apps.length) {
    try {
        const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
    } catch (error) {
        console.error("Firebase admin initialization failed:", error);
    }
}
const db = admin.firestore();

// --- Mobile-Friendly Prompt Engineering Functions ---
function analyzeQuestionAndCreatePrompt(userInput) {
    const input = userInput.toLowerCase();
    let systemPrompt = "";
    // Detect FUN/CASUAL/ROAST questions first
    if (input.includes('roast') || input.includes('insult') || input.includes('burn') || input.includes('savage')) {
        systemPrompt = `
Be a merciless, Deadpool-style roast comedian with zero chill.

Deliver Two savage, cutting roast (3,4 sentences max).

Make it brutally witty, hilariously cruel, and painfully accurate—but still playful.

A little cuss or mild profanity is allowed for extra bite.

Always end with “Just kidding!” or a cheeky equivalent.

Keep it under 400 characters.

Push the roast as far as possible while staying funny. `;
    } else if (input.includes('funny') || input.includes('joke') || input.includes('lol') || input.includes('haha') ||
        input.includes('dating') || input.includes('girlfriend') || input.includes('boyfriend') ||
        input.includes('crush') || input.includes('tinder') || input.includes('relationship advice') ||
        input.includes('awkward') || input.includes('embarrassing')) {
        systemPrompt = `
You are a fun friend giving dating advice with humor.
- Start with ONE funny observation
- Give ONE practical tip
- End with encouragement
- Total: 4 sentences max, under 350 characters`;
    } else if (input.includes('help me get') || input.includes('how to impress') || input.includes('what should i say') ||
        input.includes('pick up line') || input.includes('first date') || input.includes('asking out')) {
        systemPrompt = `
You are a confident wingman giving quick advice.
- Give ONE key tip immediately
- Mention ONE thing to avoid
- End with motivation
- Total: 4 sentences max, under 350 characters`;
    } else if (input.includes('how to') || input.includes('how do i') || input.includes('how can i')) {
        systemPrompt = `
Give concise step-by-step instructions:
- List 3 simple steps maximum
- One sentence per step
- Be direct and actionable
- Total: under 400 characters`;
    } else if (input.includes('what is') || input.includes('what are') || input.includes('define')) {
        systemPrompt = `
Explain concepts simply:
- One clear definition sentence
- One example or analogy
- Why it matters (optional)
- Total: 2-3 sentences, under 300 characters`;
    } else if (input.includes('why') || input.includes('reason')) {
        systemPrompt = `
Explain reasoning briefly:
- Start with main reason
- Give 1-2 supporting points
- Keep it simple
- Total: 2-3 sentences, under 350 characters`;
    } else if (input.includes('vs') || input.includes('versus') || input.includes('compare') || input.includes('difference')) {
        systemPrompt = `
Make a quick comparison:
- Key difference in one sentence
- When to choose each (brief)
- Total: 5,6 sentences max, under 350 characters`;
    } else if (input.includes('best') || input.includes('recommend') || input.includes('suggest') || input.includes('should i')) {
        systemPrompt = `
Give concise recommendations:
- Top recommendation with reason
- Brief alternative (optional)
- Total: 4-5 sentences, under 300 characters`;
    } else if (input.includes('problem') || input.includes('error') || input.includes('fix') || input.includes('solve') || input.includes('troubleshoot')) {
        systemPrompt = `
Provide quick troubleshooting:
- Most likely solution first
- One backup option
- Total: 4-5 sentences, under 350 characters`;
    } else {
        systemPrompt = `
Be a helpful, concise assistant:
- Answer directly and clearly
- Keep it brief and useful
- Total: 4-5 sentences max, under 300 characters`;
    }

    systemPrompt += `

CRITICAL MOBILE-FRIE N DLY REQUIREMENTS:
- Maximum 400 characters total (STRICT LIMIT)
- Use 4-5 short sentences maximum
- No markdown formatting (* _ \` [ ] { } etc.)
- Simple, conversational language
- Direct and to-the-point
- If you can't fit everything, prioritize most important info

User's question: ${userInput}`;
    return systemPrompt;
}

// Enhanced message splitting for mobile readability
function splitMessage(text, maxLength = 600) {
    const parts = [];
    while (text.length > maxLength) {
        // Try to break at natural points
        let idx = text.lastIndexOf('\n', maxLength);
        if (idx === -1) {
            idx = text.lastIndexOf('.', maxLength);
            if (idx === -1) {
                idx = text.lastIndexOf('!', maxLength);
                if (idx === -1) {
                    idx = text.lastIndexOf('?', maxLength);
                    if (idx === -1) {
                        idx = text.lastIndexOf(' ', maxLength);
                        if (idx === -1) idx = maxLength;
                    }
                }
            }
        }
        parts.push(text.substring(0, idx).trim());
        text = text.substring(idx).trim();
    }
    if (text.length > 0) parts.push(text);
    return parts;
}

// --- Helpers ---
function fmtBig(n) {
    if (n == null) return "N/A";
    if (n >= 1e12) return (n / 1e12).toFixed(2) + "T";
    if (n >= 1e9) return (n / 1e9).toFixed(2) + "B";
    if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
    if (n >= 1e3) return (n / 1e3).toFixed(2) + "K";
    return n.toLocaleString();
}

function fmtPrice(n) {
    if (n == null) return "$0";
    return "$" + n.toLocaleString(undefined, {
        maximumFractionDigits: 8
    });
}

function fmtChange(n) {
    if (n == null) return "N/A";
    const sign = n >= 0 ? '🟢' : '🔴';
    return `${sign} ${n.toFixed(2)}%`;
}

// --- Format time duration with better display ---
function formatTimeDuration(seconds) {
    if (seconds < 60) {
        return `${seconds}s`;
    } else if (seconds < 3600) {
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = seconds % 60;
        return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
    } else if (seconds < 86400) {
        const hours = Math.floor(seconds / 3600);
        const remainingMinutes = Math.floor((seconds % 3600) / 60);
        return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
    } else {
        const days = Math.floor(seconds / 86400);
        const remainingHours = Math.floor((seconds % 86400) / 3600);
        return remainingHours > 0 ? `${days}d ${remainingHours}h` : `${days}d`;
    }
}

// --- NEW: Generate Quote Image using external API ---
async function getQuoteImageUrl(message, repliedToMessage) {
    try {
        const payload = {
            messages: [{
                text: message.text,
                from: {
                    id: message.from.id,
                    name: message.from.first_name,
                    username: message.from.username
                }
            }]
        };
        // If the message is a reply, add the replied-to message as a quote in the payload
        if (repliedToMessage && repliedToMessage.text) {
            payload.messages[0].reply_message = {
                text: repliedToMessage.text,
                from: {
                    id: repliedToMessage.from.id,
                    name: repliedToMessage.from.first_name,
                    username: repliedToMessage.from.username
                }
            };
        }
        const response = await axios.post('https://bot.lyo.su/quote/generate.webp', payload, {
            responseType: 'arraybuffer', // Request the response as a binary buffer
            timeout: 15000
        });
        // The response.data is the image buffer
        return response.data;
    } catch (error) {
        console.error('❌ Failed to generate quote image:', error.response?.data?.toString() || error.message);
        return null;
    }
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

// --- Get all coin data in a single API call ---
async function getCoinDataWithChanges(symbol) {
    // Add input validation and type conversion
    if (!symbol) {
        console.error('❌ Symbol is required for getCoinDataWithChanges');
        return null;
    }
    // Ensure symbol is a string
    const s = String(symbol).toLowerCase().trim();
    if (!s) {
        console.error('❌ Empty symbol after conversion:', symbol);
        return null;
    }
    let coinId = priority[s];
    try {
        if (!coinId) {
            const searchResponse = await axios.get("https://api.coingecko.com/api/v3/search", {
                params: {
                    query: s
                },
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

// --- ENHANCED: Get OHLC historical data for candlestick charts ---
async function getOHLCData(coinId, days) {
    try {
        const response = await axios.get(`https://api.coingecko.com/api/v3/coins/${coinId}/ohlc`, {
            params: {
                vs_currency: "usd",
                days: days,
            },
            timeout: 15000,
        });
        return response.data;
    } catch (e) {
        console.error("❌ getOHLCData failed:", e.message);
        return null;
    }
}

// --- Get historical data for chart (fallback for line charts) ---
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

// --- Get coin data from DexScreener (address lookup) ---
async function getCoinFromDexScreener(address) {
    try {
        const response = await axios.get(`https://api.dexscreener.com/latest/dex/tokens/${address}`);
        if (response.data && response.data.pairs && response.data.pairs.length > 0) {
            return response.data.pairs[0];
        }
        return null;
    } catch (e) {
        console.error(`❌ getCoinFromDexScreener failed for ${address}:`, e.message);
        return null;
    }
}

// --- Get live price from DexScreener for a specific token (for leaderboard) ---
async function getLivePriceFromDexScreener(address) {
    try {
        const response = await axios.get(`https://api.dexscreener.com/latest/dex/tokens/${address}`);
        if (response.data && response.data.pairs && response.data.pairs.length > 0) {
            return parseFloat(response.data.pairs[0].priceUsd);
        }
        return null;
    } catch (e) {
        console.error(`❌ getLivePriceFromDexScreener failed for ${address}:`, e.message);
        return null;
    }
}

// --- Evaluate a mathematical expression safely ---
function evaluateExpression(expression) {
    try {
        const sanitizedExpression = expression.replace(/[^0-9+\-*/(). ]/g, ' ');
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

// --- ENHANCED: Generate Candlestick Chart URL using Chart.js compatible format ---
function getCandlestickChartUrl(coinName, ohlcData, timeframe) {
    try {
        if (!ohlcData || ohlcData.length === 0) {
            throw new Error('No OHLC data provided');
        }

        // Sample data to avoid too many points
        const maxPoints = 50;
        const step = Math.max(1, Math.floor(ohlcData.length / maxPoints));
        const sampledData = ohlcData.filter((_, index) => index % step === 0);

        // Convert OHLC data to line chart with high/low bands since QuickChart doesn't support candlestick
        const labels = sampledData.map(candle => {
            const date = new Date(candle[0]);
            return timeframe === '1D' ?
                `${date.getHours()}:${date.getMinutes().toString().padStart(2, '0')}` :
                `${date.getMonth() + 1}/${date.getDate()}`;
        });

        const prices = sampledData.map(candle => parseFloat(candle[4].toFixed(8))); // Close prices
        const highs = sampledData.map(candle => parseFloat(candle[2].toFixed(8))); // High prices
        const lows = sampledData.map(candle => parseFloat(candle[3].toFixed(8))); // Low prices

        const chartConfig = {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Close Price',
                    data: prices,
                    borderColor: '#2E86C1',
                    backgroundColor: 'rgba(46, 134, 193, 0.1)',
                    fill: false,
                    borderWidth: 2,
                    pointRadius: 0
                }, {
                    label: 'High',
                    data: highs,
                    borderColor: '#27AE60',
                    backgroundColor: 'rgba(39, 174, 96, 0.05)',
                    fill: '+1',
                    borderWidth: 1,
                    pointRadius: 0
                }, {
                    label: 'Low',
                    data: lows,
                    borderColor: '#E74C3C',
                    backgroundColor: 'rgba(231, 76, 60, 0.05)',
                    fill: '-1',
                    borderWidth: 1,
                    pointRadius: 0
                }]
            },
            options: {
                responsive: true,
                plugins: {
                    title: {
                        display: true,
                        text: `${coinName} - ${timeframe} OHLC Chart`,
                        font: {
                            size: 16
                        }
                    },
                    legend: {
                        display: true,
                        position: 'bottom'
                    }
                },
                scales: {
                    x: {
                        display: true,
                        title: {
                            display: true,
                            text: 'Time'
                        }
                    },
                    y: {
                        display: true,
                        title: {
                            display: true,
                            text: 'Price (USD)'
                        },
                        beginAtZero: false
                    }
                },
                interaction: {
                    intersect: false,
                    mode: 'index'
                }
            }
        };

        const compactConfig = encodeURIComponent(JSON.stringify(chartConfig));
        return `https://quickchart.io/chart?c=${compactConfig}&w=600&h=400&backgroundColor=white`;

    } catch (error) {
        console.error('❌ Candlestick chart URL generation failed:', error.message);
        // Fallback to simple line chart
        return getChartImageUrl(coinName, ohlcData.map(candle => [candle[0], candle[4]]));
    }
}

// --- Generate QuickChart URL (fallback line chart) ---
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
                }, ],
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
            data: {
                labels: ['Error'],
                datasets: [{
                    data: [0]
                }]
            }
        }))}&w=400&h=250`;
    }
}

// --- Build price reply with monospace formatting ---
function buildReply(coin, amount) {
    try {
        const priceUSD = coin.current_price ?? 0;
        const totalUSD = priceUSD * (amount ?? 1);
        const mc = coin.market_cap ?? null;
        const ath = coin.ath ?? null;
        const fdv = (coin.fully_diluted_valuation === 0 || coin.fully_diluted_valuation == null) ? "N/A" : fmtBig(coin.fully_diluted_valuation);
        const price_change_1h = coin.price_change_percentage_1h_in_currency ?? null;
        const price_change_24h = coin.price_change_percentage_24h_in_currency ?? null;
        const price_change_7d = coin.price_change_percentage_7d_in_currency ?? null;
        const price_change_30d = coin.price_change_percentage_30d_in_currency ?? null;
        const lines = [];
        if (amount != null && amount !== 1) {
            lines.push(`${amount} ${coin.symbol.toUpperCase()} = ${fmtPrice(totalUSD)}`);
        }
        lines.push(`Price: ${fmtPrice(priceUSD)}`);
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

// --- NEW: Check if address was posted before and get first post info ---
async function getFirstPostInfo(address, chatId) {
    try {
        const snapshot = await db.collection('first_posts')
            .where('address', '==', address.toLowerCase())
            .where('chatId', '==', String(chatId))
            .limit(1)
            .get();

        if (!snapshot.empty) {
            const firstPostData = snapshot.docs[0].data();
            console.log('✅ Found existing first post:', firstPostData);
            return firstPostData;
        } else {
            console.log('⚠️ No existing first post found for address:', address);
            return null;
        }
    } catch (error) {
        console.error('❌ Error checking first post:', error.message);
        return null;
    }
}

// --- NEW: Store first post information ---
async function storeFirstPostInfo(address, chatId, username, marketCap, timestamp, messageId, symbol) {
    try {
        const docRef = db.collection('first_posts').doc();
        await docRef.set({
            address: address.toLowerCase(),
            chatId: String(chatId),
            firstUsername: username,
            firstMarketCap: marketCap,
            firstTimestamp: timestamp,
            firstMessageId: messageId,
            symbol: symbol,
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        });
        console.log('✅ Stored first post info for address:', address);
        return true;
    } catch (error) {
        console.error('❌ Error storing first post info:', error.message);
        return false;
    }
}

// --- MODIFIED: Build the signature line using FIRST POST information ---
function buildSignature(firstPostData, currentPriceChange1h, chatId) {
    const emoji = currentPriceChange1h > 0 ? '😈' : '😡';
    const formattedMC = fmtBig(firstPostData.firstMarketCap);
    const telegramLink = `https://t.me/c/${String(chatId).replace(/^-100/, '')}/${firstPostData.firstMessageId}`;
    const usernameLink = `[@${firstPostData.firstUsername}](${telegramLink})`;

    // Handle timestamp properly
    let timestampDate;
    if (firstPostData.firstTimestamp && typeof firstPostData.firstTimestamp.toDate === 'function') {
        timestampDate = firstPostData.firstTimestamp.toDate();
    } else if (firstPostData.firstTimestamp instanceof Date) {
        timestampDate = firstPostData.firstTimestamp;
    } else if (typeof firstPostData.firstTimestamp === 'number') {
        timestampDate = new Date(firstPostData.firstTimestamp);
    } else {
        console.warn('⚠️ Invalid first post timestamp format:', firstPostData.firstTimestamp);
        timestampDate = new Date();
    }

    const timeDifference = Math.floor((new Date() - timestampDate) / 1000);
    const formattedTime = formatTimeDuration(timeDifference);

    return `\n\n${emoji} ${usernameLink} @ \`$${formattedMC}\` [ ${formattedTime} ]`;
}

// --- Build DexScreener price reply with monospace formatting and links ---
function buildDexScreenerReply(dexScreenerData) {
    try {
        const token = dexScreenerData.baseToken;
        const pair = dexScreenerData;
        const formattedAddress = `${token.address.substring(0, 3)}...${token.address.substring(token.address.length - 4)}`;
        const formattedChain = pair.chainId.toUpperCase();
        const formattedExchange = pair.dexId.toUpperCase();
        const formattedPrice = pair.priceUsd ? fmtPrice(parseFloat(pair.priceUsd)) : 'N/A';
        const change1h = pair.priceChange?.h1;
        const formattedChange1h = change1h ? fmtChange(change1h) : 'N/A';
        // Use fmtBig to format marketCap, volume, and liquidity
        const mc = pair.marketCap ? fmtBig(pair.marketCap) : 'N/A';
        const vol = pair.volume?.h24 ? fmtBig(pair.volume.h24) : 'N/A';
        const lp = pair.liquidity?.usd ? fmtBig(pair.liquidity.usd) : 'N/A';
        let mexcLink = null;
        if (pair.chainId === 'ethereum' || pair.chainId === 'bsc' || pair.chainId === 'solana') {
            mexcLink = `https://www.mexc.com/exchange/${token.symbol.toUpperCase()}_USDT`;
        }
        let mevxLink = null;
        if (pair.chainId === 'ethereum' || pair.chainId === 'solana') {
            mevxLink = `https://t.me/MevxTradingBot?start=${token.address}-Ld8DMWbaLLlQ`;
        }
        let reply =

            `💊 \`${token.name}\` (\`${token.symbol}\`)

🔗 CHAIN: \`#${formattedChain}\`
🔄 DEX PAIR: \`${formattedExchange}\`

💎 USD: \`${formattedPrice}\` (\`${formattedChange1h}\`)
✨ MARKET CAP: \`$${mc}\`
🪙 ADDRESS:

\`${token.address}\`

⚜️ VOLUME: \`$${vol}\`
🌀 LP: \`$${lp}\`
`;
        let links = `

[DEXScreener](https://dexscreener.com/${pair.chainId}/${token.address})
`;
        if (mexcLink) {
            links += ` | [MEXC](${mexcLink})`;
        }
        if (mevxLink) {
            links += ` | [MEVX](${mevxLink})`;
        }
        reply += `${links}`;
        return reply.trim();
    } catch (error) {
        console.error('❌ buildDexScreenerReply error:', error.message);
        return '`Error formatting DexScreener reply.`';
    }
}

// --- Build comparison reply ---
function buildCompareReply(coin1, coin2, theoreticalPrice) {
    try {
        const formattedPrice = fmtPrice(theoreticalPrice);
        const lines = [];
        lines.push(`If ${coin1.name} (${coin1.symbol.toUpperCase()}) had the market cap of ${coin2.name} (${coin2.symbol.toUpperCase()}),`);
        lines.push(`its price would be approximately ${formattedPrice}.`);
        return `\`${lines.join('\n')}\``;
    } catch (error) {
        console.error('❌ buildCompareReply error:', error.message);
        return '`Error formatting comparison reply`';
    }
}

// --- Build gas price reply ---
function buildGasReply(gasPrices, ethPrice) {
    try {
        if (!gasPrices) {
            return '`Could not retrieve gas prices. Please try again later.`';
        }
        const gasLimit = 21000;
        const calculateCost = (gwei, ethPrice) => (gwei * gasLimit) / 10 ** 9 * ethPrice;
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

// --- Send message with topic support and refresh/delete buttons ---
async function sendMessageToTopic(botToken, chatId, messageThreadId, text, callbackData = '', options = {}) {
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
                [{
                    text: '🔄 Refresh',
                    callback_data: `refresh_${callbackData}`
                }, {
                    text: '🗑️ Delete',
                    callback_data: 'delete_message'
                }]
            ]
        },
        ...options
    };
    const trySend = async(opts) => {
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
        let attemptOptions = { ...baseOptions
        };
        if (messageThreadId && parseInt(messageThreadId) > 0) {
            attemptOptions.message_thread_id = parseInt(messageThreadId);
        }
        return await trySend(attemptOptions);
    } catch (error) {
        if (error.response && error.response.status === 400 && error.response.data.description.includes('message thread not found')) {
            console.warn('⚠️ Thread not found, attempting to send to main chat.');
            try {
                const fallbackOptions = { ...baseOptions
                };
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

// --- Send Photo function with timeframe buttons ---
async function sendPhotoToTopic(botToken, chatId, messageThreadId, photoUrl, caption = '', callbackData = '', showTimeframeButtons = false) {
    let replyMarkup;

    if (showTimeframeButtons) {
        // Add timeframe selection buttons for chart commands
        replyMarkup = {
            inline_keyboard: [
                [{
                    text: '1D',
                    callback_data: `chart_1d_${callbackData}`
                }, {
                    text: '7D',
                    callback_data: `chart_7d_${callbackData}`
                }, {
                    text: '30D',
                    callback_data: `chart_30d_${callbackData}`
                }, {
                    text: '90D',
                    callback_data: `chart_90d_${callbackData}`
                }],
                [{
                    text: '🔄 Refresh',
                    callback_data: `refresh_chart_${callbackData}`
                }, {
                    text: '🗑️ Delete',
                    callback_data: 'delete_message'
                }]
            ]
        };
    } else {
        replyMarkup = {
            inline_keyboard: [
                [{
                    text: '🔄 Refresh',
                    callback_data: `refresh_${callbackData}`
                }, {
                    text: '🗑️ Delete',
                    callback_data: 'delete_message'
                }]
            ]
        };
    }

    const baseOptions = {
        chat_id: parseInt(chatId),
        photo: photoUrl,
        caption: caption,
        parse_mode: 'Markdown',
        reply_markup: replyMarkup
    };

    const trySend = async(opts) => {
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
        let attemptOptions = { ...baseOptions
        };
        if (messageThreadId && parseInt(messageThreadId) > 0) {
            attemptOptions.message_thread_id = parseInt(messageThreadId);
        }
        return await trySend(attemptOptions);
    } catch (error) {
        if (error.response && error.response.status === 400 && error.response.data.description.includes('message thread not found')) {
            console.warn('⚠️ Thread not found for photo, attempting to send to main chat.');
            try {
                const fallbackOptions = { ...baseOptions
                };
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

// --- NEW: Send sticker with a dedicated function ---
async function sendStickerToTopic(botToken, chatId, messageThreadId, stickerBuffer) {
    if (!stickerBuffer) {
        console.error('❌ Refusing to send an empty sticker buffer.');
        return;
    }

    try {
        const formData = new FormData();
        formData.append('sticker', stickerBuffer, {
            filename: 'quote_sticker.webp',
            contentType: 'image/webp'
        });
        formData.append('chat_id', chatId);
        if (messageThreadId && parseInt(messageThreadId) > 0) {
            formData.append('message_thread_id', messageThreadId);
        }

        const response = await axios.post(`https://api.telegram.org/bot${botToken}/sendSticker`, formData, {
            timeout: 15000,
            headers: {
                'Content-Type': `multipart/form-data; boundary=${formData._boundary}`
            },
        });
        console.log('✅ Sticker sent successfully:', response.data);
    } catch (error) {
        console.error('❌ Failed to send sticker:', error.response?.data?.description || error.message);
        // Fallback to text message
        try {
            await sendMessageToTopic(botToken, chatId, messageThreadId, '`Failed to send sticker. Please try again later.`');
        } catch (fallbackError) {
            console.error('❌ Fallback message also failed:', fallbackError.message);
        }
    }
}

// --- Edit message with topic support and refresh/delete buttons ---
async function editMessageInTopic(botToken, chatId, messageId, messageThreadId, text, photoUrl, callbackData, showTimeframeButtons = false) {
    const isPhoto = !!photoUrl;

    let replyMarkup;
    if (showTimeframeButtons) {
        replyMarkup = {
            inline_keyboard: [
                [{
                    text: '1D',
                    callback_data: `chart_1d_${callbackData}`
                }, {
                    text: '7D',
                    callback_data: `chart_7d_${callbackData}`
                }, {
                    text: '30D',
                    callback_data: `chart_30d_${callbackData}`
                }, {
                    text: '90D',
                    callback_data: `chart_90d_${callbackData}`
                }],
                [{
                    text: '🔄 Refresh',
                    callback_data: `refresh_chart_${callbackData}`
                }, {
                    text: '🗑️ Delete',
                    callback_data: 'delete_message'
                }]
            ]
        };
    } else {
        replyMarkup = {
            inline_keyboard: [
                [{
                    text: '🔄 Refresh',
                    callback_data: `refresh_${callbackData}`
                }, {
                    text: '🗑️ Delete',
                    callback_data: 'delete_message'
                }]
            ]
        };
    }

    const baseOptions = {
        chat_id: parseInt(chatId),
        message_id: parseInt(messageId),
        parse_mode: 'Markdown',
        reply_markup: replyMarkup
    };

    try {
        if (isPhoto) {
            let options = { ...baseOptions,
                photo: photoUrl,
                caption: text
            };
            if (messageThreadId) {
                options.message_thread_id = parseInt(messageThreadId);
            }
            await axios.post(`https://api.telegram.org/bot${botToken}/editMessageCaption`, options);
        } else {
            let options = { ...baseOptions,
                text: text
            };
            if (messageThreadId) {
                options.message_thread_id = parseInt(messageThreadId);
            }
            await axios.post(`https://api.telegram.org/bot${botToken}/editMessageText`, options);
        }
    } catch (error) {
        if (error.response?.data?.description?.includes('message is not modified')) {
            console.log('✅ Message content is identical, no edit needed.');
        } else {
            console.error('❌ Error editing message:', error.response?.data || error.message);
        }
    }
}

// --- Log user queries to Firestore ---
async function logUserQuery(user, chatId, query, price, symbol, marketCap, messageId) {
    try {
        const docRef = db.collection('queries').doc();
        await docRef.set({
            userId: user.id,
            username: user.username || user.first_name || `User${user.id}`,
            chatId: String(chatId),
            messageId,
            query,
            symbol,
            priceAtQuery: price,
            marketCap,
            timestamp: admin.firestore.FieldValue.serverTimestamp()
        });
        console.log(`✅ Logged query for user ${user.id} in chat ${chatId}: ${query}`);
    } catch (error) {
        console.error('❌ Failed to log query to Firebase:', error.message);
    }
}

// --- Build the leaderboard reply from Firestore data ---
async function buildLeaderboardReply(chatId) {
    try {
        const snapshot = await db.collection('queries')
            .where('chatId', '==', String(chatId))
            .get();

        if (snapshot.empty) {
            return "`Leaderboard is empty. Be the first to search for a token address!`";
        }

        const queries = {};
        const uniqueAddresses = new Set();

        snapshot.forEach(doc => {
            const data = doc.data();
            const userId = data.userId;
            const queryAddress = data.query;
            const price = data.priceAtQuery;
            const symbol = data.symbol;

            if (!queries[userId]) {
                queries[userId] = {
                    username: data.username,
                    calls: 0,
                    totalReturn: 0,
                    positiveReturns: 0,
                    queries: []
                };
            }

            queries[userId].calls++;
            queries[userId].queries.push({
                queryAddress,
                price,
                symbol
            });
            uniqueAddresses.add(queryAddress);
        });

        const livePrices = {};
        await Promise.all(Array.from(uniqueAddresses).map(async address => {
            livePrices[address] = await getLivePriceFromDexScreener(address);
        }));

        for (const userId in queries) {
            const user = queries[userId];
            user.queries.forEach(q => {
                const livePrice = livePrices[q.queryAddress];
                if (livePrice != null && q.price != null && q.price !== 0) {
                    const returnPct = ((livePrice - q.price) / q.price) * 100;
                    user.totalReturn += returnPct;
                    if (returnPct > 0) {
                        user.positiveReturns++;
                    }
                }
            });
        }

        const sortedUsers = Object.values(queries).sort((a, b) => b.totalReturn - a.totalReturn);

        const mainHeader = `*👑 Token Lord Leaderboard*`;
        const groupStats = `

*Group Stats:*
Period: All Time
`;

        const leaderboardEntries = sortedUsers.slice(0, 10).map((user, index) => {
            const rank = index + 1;
            const avgReturn = user.calls > 0 ? (user.totalReturn / user.calls).toFixed(2) : '0.00';
            const hitRate = user.calls > 0 ? ((user.positiveReturns / user.calls) * 100).toFixed(0) : '0';

            return `*#${rank} ${user.username}*
\`Calls: ${user.calls}
Hit Rate: ${hitRate}%
Return: ${avgReturn}%
\``;
        }).join('\n');

        return `${mainHeader}\n\n${groupStats}\n*Top Token Lords*\n${leaderboardEntries}`;
    } catch (error) {
        console.error('❌ Failed to build leaderboard:', error.message);
        return '`Failed to build leaderboard. Please try again later.`';
    }
}

// --- Enhanced Mobile-Friendly Gemini Reply Function ---
async function getGeminiReply(prompt) {
    try {
        // Create dynamic prompt based on question nature
        const dynamicPrompt = analyzeQuestionAndCreatePrompt(prompt);

        const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
        const model = genAI.getGenerativeModel({
            model: "gemini-2.5-flash-lite"
        });

        const result = await model.generateContent(dynamicPrompt);
        const response = await result.response;
        let text = response.text();

        // Extra safety: If response is still too long, truncate it
        if (text.length > 450) {
            text = text.substring(0, 400) + "...";
        }

        return text;
    } catch (e) {
        console.error("❌ Google Generative AI API failed:", e.message);
        return "Sorry, I'm having trouble right now. Please try again!";
    }
}

// --- Main webhook handler ---
export default async function handler(req, res) {
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
        return res.status(405).json({
            message: 'Method not allowed'
        });
    }

    const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    if (!BOT_TOKEN) {
        console.error('❌ TELEGRAM_BOT_TOKEN not set');
        return res.status(500).json({
            error: 'Bot token not configured'
        });
    }

    try {
        const update = req.body;

        if (!update || (!update.message && !update.callback_query)) {
            return res.status(200).json({
                ok: true,
                message: 'No message or callback in update'
            });
        }

        // --- ENHANCED: Handle callback queries for timeframe selection ---
        if (update.callback_query) {
            const callbackQuery = update.callback_query;
            const chatId = callbackQuery.message.chat.id;
            const messageId = callbackQuery.message.message_id;
            const messageThreadId = callbackQuery.message.message_thread_id;
            const callbackData = callbackQuery.data;

            await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`, {
                callback_query_id: callbackQuery.id
            });

            // --- Handle timeframe-specific chart requests ---
            if (callbackData.startsWith('chart_1d_') || callbackData.startsWith('chart_7d_') ||
                callbackData.startsWith('chart_30d_') || callbackData.startsWith('chart_90d_')) {

                const parts = callbackData.split('_');
                const timeframe = parts[1].toUpperCase(); // 1D, 7D, 30D, 90D
                const symbol = parts.slice(2).join('_'); // Rejoin in case symbol has underscores

                const coinData = await getCoinDataWithChanges(symbol);
                if (coinData) {
                    let days;
                    switch (timeframe) {
                        case '1D':
                            days = 1;
                            break;
                        case '7D':
                            days = 7;
                            break;
                        case '30D':
                            days = 30;
                            break;
                        case '90D':
                            days = 90;
                            break;
                        default:
                            days = 30;
                    }

                    // Try to get OHLC data for candlestick chart
                    const ohlcData = await getOHLCData(coinData.id, days);
                    let chartUrl, caption;

                    if (ohlcData && ohlcData.length > 0) {
                        chartUrl = getCandlestickChartUrl(coinData.name, ohlcData, timeframe);
                        caption = `*${coinData.name}* OHLC Chart (${timeframe})`;
                    } else {
                        // Fallback to line chart if OHLC not available
                        const historicalData = await getHistoricalData(coinData.id);
                        if (historicalData && historicalData.length > 0) {
                            chartUrl = getChartImageUrl(coinData.name, historicalData);
                            caption = `*${coinData.name}* Price Chart (${timeframe}) - Line Chart Fallback`;
                        } else {
                            caption = `\`Failed to get chart data for ${coinData.name}\``;
                        }
                    }

                    if (chartUrl) {
                        // Delete the old message and send a new one to ensure image updates
                        try {
                            await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/deleteMessage`, {
                                chat_id: chatId,
                                message_id: messageId
                            });

                            await sendPhotoToTopic(BOT_TOKEN, chatId, messageThreadId, chartUrl, caption, symbol, true);
                        } catch (deleteError) {
                            console.warn('⚠️ Could not delete message, trying to edit instead');
                            // Fallback to editing if deletion fails
                            await editMessageInTopic(BOT_TOKEN, chatId, messageId, messageThreadId, caption, chartUrl, symbol, true);
                        }
                    } else {
                        await editMessageInTopic(BOT_TOKEN, chatId, messageId, messageThreadId, caption, '', symbol, false);
                    }
                } else {
                    await editMessageInTopic(BOT_TOKEN, chatId, messageId, messageThreadId, `\`Coin "${symbol.toUpperCase()}" not found\``, '', symbol, false);
                }

                return res.status(200).json({
                    ok: true
                });
            }

            if (callbackData.startsWith('refresh_')) {
                const originalCommand = callbackData.substring('refresh_'.length);
                let reply = '';
                let isPhoto = false;
                let photoUrl = '';
                let showTimeframeButtons = false;

                if (originalCommand.startsWith('dexscreener_')) {
                    const address = originalCommand.substring('dexscreener_'.length);
                    const dexScreenerData = await getCoinFromDexScreener(address);
                    if (dexScreenerData) {
                        reply = buildDexScreenerReply(dexScreenerData);

                        // Get first post information for signature
                        const firstPostInfo = await getFirstPostInfo(address, chatId);
                        if (firstPostInfo) {
                            const signature = buildSignature(firstPostInfo, dexScreenerData.priceChange?.h1 || 0, chatId);
                            reply += signature;
                        }
                    } else {
                        reply = '`Could not refresh DexScreener data.`';
                    }
                } else if (originalCommand.startsWith('chart_')) {
                    const symbol = originalCommand.substring('chart_'.length);
                    const coinData = await getCoinDataWithChanges(symbol);
                    if (coinData) {
                        // Default to 30D candlestick chart
                        const ohlcData = await getOHLCData(coinData.id, 30);
                        if (ohlcData && ohlcData.length > 0) {
                            reply = `*${coinData.name}* Candlestick Chart (30D)`;
                            photoUrl = getCandlestickChartUrl(coinData.name, ohlcData, '30D');
                            isPhoto = true;
                            showTimeframeButtons = true;
                        } else {
                            // Fallback to line chart
                            const historicalData = await getHistoricalData(coinData.id);
                            if (historicalData && historicalData.length > 0) {
                                reply = `*${coinData.name}* Price Chart (30D) - Line Chart Fallback`;
                                photoUrl = getChartImageUrl(coinData.name, historicalData);
                                isPhoto = true;
                            } else {
                                reply = `\`Failed to get chart data for ${coinData.name}\``;
                            }
                        }
                    } else {
                        reply = `\`Coin "${symbol.toUpperCase()}" not found\``;
                    }
                } else if (originalCommand === 'gas') {
                    const ethCoin = await getCoinDataWithChanges('eth');
                    const ethPrice = ethCoin ? ethCoin.current_price : null;
                    const gasPrices = await getEthGasPrice();
                    if (ethPrice && gasPrices) {
                        reply = buildGasReply(gasPrices, ethPrice);
                    } else {
                        reply = '`Failed to retrieve gas data`';
                    }
                } else if (originalCommand.startsWith('compare_')) {
                    const parts = originalCommand.substring('compare_'.length).split('_');
                    const [symbol1, symbol2] = parts;
                    const coin1 = await getCoinDataWithChanges(symbol1);
                    const coin2 = await getCoinDataWithChanges(symbol2);
                    if (coin1 && coin2) {
                        const circulatingSupply1 = coin1.circulating_supply;
                        const marketCap2 = coin2.market_cap;
                        let theoreticalPrice = null;
                        if (circulatingSupply1 > 0 && marketCap2 > 0) {
                            theoreticalPrice = marketCap2 / circulatingSupply1;
                        }
                        if (theoreticalPrice) {
                            reply = buildCompareReply(coin1, coin2, theoreticalPrice);
                        } else {
                            reply = '`Could not perform comparison. Missing required data.`';
                        }
                    } else {
                        reply = '`One or both coins were not found.`';
                    }
                } else if (originalCommand.startsWith('leaderboard')) {
                    reply = await buildLeaderboardReply(chatId);
                    await editMessageInTopic(BOT_TOKEN, chatId, messageId, messageThreadId, reply, '', 'leaderboard');
                    return res.status(200).json({
                        ok: true
                    });
                } else {
                    const coin = await getCoinDataWithChanges(originalCommand);
                    if (coin) {
                        reply = buildReply(coin, 1);
                    } else {
                        reply = `\`Coin "${originalCommand.toUpperCase()}" not found\``;
                    }
                }

                await editMessageInTopic(BOT_TOKEN, chatId, messageId, messageThreadId, reply, photoUrl, originalCommand, showTimeframeButtons);

            } else if (callbackData === 'delete_message') {
                try {
                    await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/deleteMessage`, {
                        chat_id: chatId,
                        message_id: messageId
                    });
                } catch (error) {
                    console.error('❌ Error deleting message:', error.message);
                }
            }

            return res.status(200).json({
                ok: true
            });
        }

        const msg = update.message;
        if (!msg || !msg.text) {
            return res.status(200).json({
                ok: true,
                message: 'No text in message'
            });
        }

        const chatId = msg.chat.id;
        const messageId = msg.message_id;
        const messageThreadId = msg.message_thread_id;
        const text = msg.text.trim();
        const user = msg.from;
        const chatType = msg.chat.type;

        // --- Enhanced /que command handler with mobile-friendly responses ---
               // --- Enhanced /que command handler with mobile-friendly responses ---
        if (text.startsWith('/que')) {
            let prompt = text.substring(4).trim();

            // Check if the command is a reply to another message
            if (msg.reply_to_message && msg.reply_to_message.text) {
                const repliedText = msg.reply_to_message.text;
                prompt = `(Context: "${repliedText}")\n\n${prompt}`;
            }

            // Enhanced HTML escaping function
            function escapeHtml(str) {
                if (!str || typeof str !== 'string') return 'Empty response';
                return str
                    .replace(/&/g, "&amp;")
                    .replace(/</g, "&lt;")
                    .replace(/>/g, "&gt;")
                    .replace(/"/g, "&quot;")
                    .replace(/'/g, "&#39;")
                    .replace(/[\u0000-\u001F\u007F-\u009F]/g, '') // Remove control characters
                    .trim();
            }

            try {
                let responseText;
                if (prompt.length > 0) {
                    // Use enhanced Gemini function with mobile-friendly prompting
                    responseText = await getGeminiReply(prompt);
                } else {
                    responseText = "Please provide a query after the /que command.";
                }

                // Escape HTML and handle message length with smaller chunks
                responseText = escapeHtml(responseText);
                const messageParts = splitMessage(responseText, 600); // Smaller chunks for mobile

                // Send each part as a separate message
                for (let i = 0; i < messageParts.length; i++) {
                    const part = messageParts[i];
                    const isLastPart = i === messageParts.length - 1;

                    // Add part indicator for multi-part messages (but with smaller parts, this should be rare)
                    const partIndicator = messageParts.length > 1 ?
                        `\n\n📱 ${i + 1}/${messageParts.length}` : '';

                    await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
                        chat_id: chatId,
                        text: part + partIndicator,
                        reply_to_message_id: isLastPart ? msg.message_id : undefined,
                        parse_mode: "HTML"
                    });

                    // Small delay between messages to maintain order
                    if (i < messageParts.length - 1) {
                        await new Promise(resolve => setTimeout(resolve, 100));
                    }
                }
            } catch (err) {
                console.error("Telegram API error:", err.response?.data || err.message);

                // Fallback error message
                try {
                    await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
                        chat_id: chatId,
                        text: "Sorry, I'm having trouble right now. Please try again!",
                        reply_to_message_id: msg.message_id,
                        parse_mode: "HTML"
                    });
                } catch (fallbackErr) {
                    console.error("Fallback message also failed:", fallbackErr);
                }
            }

            return res.status(200).json({ ok: true });
        }
        

        // --- Original message filtering logic ---
        const isCommand = text.startsWith('/') || text.startsWith('.');
        const mathRegex = /^([\d.\s]+(?:[+\-*/][\d.\s]+)*)$/;
        const isCalculation = mathRegex.test(text);
        const re = /^(\d*\.?\d+)\s+([a-zA-Z]+)$|^([a-zA-Z]+)\s+(\d*\.?\d+)$/;
        const isCoinCheck = re.test(text);
        const isAddress = (text.length === 42 || text.length === 32 || text.length === 44) && /^(0x)?[a-zA-Z0-9]+$/.test(text);

        if (!isCommand && !isCalculation && !isCoinCheck && !isAddress && chatType === 'group') {
            return res.status(200).json({
                ok: true,
                message: 'Ignoring non-command/calculation/coin message'
            });
        }

        // --- MODIFIED: Address handling with first post tracking ---
        if (isAddress) {
            const dexScreenerData = await getCoinFromDexScreener(text);
            if (dexScreenerData) {
                const reply = buildDexScreenerReply(dexScreenerData);
                const callbackData = `dexscreener_${text}`;

                // Check if this address was posted before in this chat
                const firstPostInfo = await getFirstPostInfo(text, chatId);

                if (firstPostInfo) {
                    // Address was posted before - use FIRST post information for signature
                    console.log('🔄 Using existing first post info for signature');
                    const signature = buildSignature(firstPostInfo, dexScreenerData.priceChange?.h1 || 0, chatId);
                    await sendMessageToTopic(BOT_TOKEN, chatId, messageThreadId, reply + signature, callbackData);
                } else {
                    // This is the FIRST time this address is posted in this chat
                    console.log('🆕 First time posting this address, storing first post info');
                    const username = user.username || user.first_name || `User${user.id}`;
                    const currentTimestamp = admin.firestore.FieldValue.serverTimestamp();

                    // Store first post information
                    await storeFirstPostInfo(
                        text,
                        chatId,
                        username,
                        dexScreenerData.marketCap,
                        currentTimestamp,
                        messageId,
                        dexScreenerData.baseToken.symbol
                    );

                    // Create signature with current user as the first poster
                    const firstPostData = {
                        firstUsername: username,
                        firstMarketCap: dexScreenerData.marketCap,
                        firstTimestamp: new Date(), // Use current time for new posts
                        firstMessageId: messageId
                    };

                    const signature = buildSignature(firstPostData, dexScreenerData.priceChange?.h1 || 0, chatId);
                    await sendMessageToTopic(BOT_TOKEN, chatId, messageThreadId, reply + signature, callbackData);
                }

                // Always log to queries collection for leaderboard
                await logUserQuery(user, chatId, text, parseFloat(dexScreenerData.priceUsd), dexScreenerData.baseToken.symbol, dexScreenerData.marketCap, messageId);
            } else {
                await sendMessageToTopic(BOT_TOKEN, chatId, messageThreadId, '`Could not find a coin for that address.`');
            }
        } else if (isCommand) {
            const parts = text.substring(1).toLowerCase().split(' ');
            const command = parts[0].split('@')[0]; // Fix: Extract just the command name
            const symbol = parts[1];

            if (command === 'leaderboard') {
                const reply = await buildLeaderboardReply(chatId);
                await sendMessageToTopic(BOT_TOKEN, chatId, messageThreadId, reply, 'leaderboard');
            }
            // --- NEW: Quote command handler ---
            else if (command === 'quote' || command === 's') {
                const repliedToMessage = msg.reply_to_message;
                if (repliedToMessage) {
                    const messageToQuote = repliedToMessage;
                    const quoteImageBuffer = await getQuoteImageUrl(messageToQuote, null);
                    if (quoteImageBuffer) {
                        // Send the sticker using the new dedicated function
                        await sendStickerToTopic(BOT_TOKEN, chatId, messageThreadId, quoteImageBuffer);
                    } else {
                        await sendMessageToTopic(BOT_TOKEN, chatId, messageThreadId, '`Failed to generate quote image. Please try again later.`');
                    }
                } else {
                    await sendMessageToTopic(BOT_TOKEN, chatId, messageThreadId, '`Please reply to a message with /quote or /s to create an image.`');
                }
            }
            // --- ENHANCED: Chart command with candlestick support ---
            else if (command === 'chart' && symbol) {
                const coinData = await getCoinDataWithChanges(symbol);
                if (coinData) {
                    // Try to get OHLC data for candlestick chart (default 30 days)
                    const ohlcData = await getOHLCData(coinData.id, 30);

                    if (ohlcData && ohlcData.length > 0) {
                        const chartImageUrl = getCandlestickChartUrl(coinData.name, ohlcData, '30D');
                        await sendPhotoToTopic(BOT_TOKEN, chatId, messageThreadId, chartImageUrl,
                            `*${coinData.name}* Candlestick Chart (30D)`, symbol, true);
                    } else {
                        // Fallback to line chart if OHLC data not available
                        const historicalData = await getHistoricalData(coinData.id);
                        if (historicalData && historicalData.length > 0) {
                            const chartImageUrl = getChartImageUrl(coinData.name, historicalData);
                            await sendPhotoToTopic(BOT_TOKEN, chatId, messageThreadId, chartImageUrl,
                                `*${coinData.name}* Price Chart (30D) - Line Chart Fallback`, symbol, false);
                        } else {
                            await sendMessageToTopic(BOT_TOKEN, chatId, messageThreadId,
                                `\`Failed to get chart data for ${coinData.name}\``, `chart_${symbol}`);
                        }
                    }
                } else {
                    await sendMessageToTopic(BOT_TOKEN, chatId, messageThreadId,
                        `\`Coin "${symbol.toUpperCase()}" not found\``, `chart_${symbol}`);
                }
            } else if (command === 'gas') {
                const ethCoin = await getCoinDataWithChanges('eth');
                const ethPrice = ethCoin ? ethCoin.current_price : null;
                const gasPrices = await getEthGasPrice();
                if (ethPrice && gasPrices) {
                    await sendMessageToTopic(BOT_TOKEN, chatId, messageThreadId, buildGasReply(gasPrices, ethPrice), 'gas');
                } else {
                    await sendMessageToTopic(BOT_TOKEN, chatId, messageThreadId, '`Failed to retrieve gas data`', 'gas');
                }
            } else if (command === 'compare') {
                const [symbol1, symbol2] = parts.slice(1);
                if (symbol1 && symbol2) {
                    const coin1 = await getCoinDataWithChanges(symbol1);
                    const coin2 = await getCoinDataWithChanges(symbol2);
                    if (coin1 && coin2) {
                        const circulatingSupply1 = coin1.circulating_supply;
                        const marketCap2 = coin2.market_cap;
                        let theoreticalPrice = null;
                        if (circulatingSupply1 > 0 && marketCap2 > 0) {
                            theoreticalPrice = marketCap2 / circulatingSupply1;
                        }
                        if (theoreticalPrice) {
                            const reply = buildCompareReply(coin1, coin2, theoreticalPrice);
                            await sendMessageToTopic(BOT_TOKEN, chatId, messageThreadId, reply, `compare_${symbol1}_${symbol2}`);
                        } else {
                            const reply = '`Could not perform comparison. Missing required data.`';
                            await sendMessageToTopic(BOT_TOKEN, chatId, messageThreadId, reply, `compare_${symbol1}_${symbol2}`);
                        }
                    } else {
                        const reply = '`One or both coins were not found.`';
                        await sendMessageToTopic(BOT_TOKEN, chatId, messageThreadId, reply, `compare_${symbol1}_${symbol2}`);
                    }
                } else {
                    await sendMessageToTopic(BOT_TOKEN, chatId, messageThreadId, '`Usage: /compare [symbol1] [symbol2]`', `compare_${symbol1}_${symbol2}`);
                }
            } else if (command === 'start') {
                await sendMessageToTopic(BOT_TOKEN, chatId, messageThreadId,
                    '`hey welcome fren! Type /help to know more about the commands.`');
                            } else if (command === 'help') {
                await sendMessageToTopic(BOT_TOKEN, chatId, messageThreadId,
                    `*Commands:*
[amount] [symbol] - Get a crypto price, e.g., \`2 eth\`
/gas - Get current Ethereum gas prices
/chart [symbol] - View a candlestick chart with timeframes, e.g., \`/chart eth\`
/compare [symbol1] [symbol2] - Compare market caps, e.g., \`/compare eth btc\`
/que [question] - Ask the AI anything, e.g., \`/que what is defi\`
*/quote* or */s* - Reply to a message with this command to create a quote sticker
/leaderboard - See the top token finders
/help - Show this message

*Other features:*
- Send a token address to get token info
- Use simple math, e.g., \`5 * 10\``);
                
            }  else if (command === 'test') {
                await sendMessageToTopic(BOT_TOKEN, chatId, messageThreadId,
                    `\`Bot Status: OK\nChat: ${msg.chat.type}\nTopic: ${messageThreadId || "None"}\nTime: ${new Date().toISOString()}\``);
            }
            // Removed automatic coin symbol commands like /btc, /eth, etc.
            // Only specific commands above are handled now
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
                    await sendMessageToTopic(BOT_TOKEN, chatId, messageThreadId, buildReply(coin, amount), symbol);
                } else {
                    await sendMessageToTopic(BOT_TOKEN, chatId, messageThreadId, `\`Coin "${symbol.toUpperCase()}" not found\``, symbol);
                }
            }
        }

        return res.status(200).json({
            ok: true
        });
    } catch (error) {
        console.error('❌ Webhook error:', error.message);
        console.error('Stack:', error.stack);
        return res.status(500).json({
            error: 'Internal server error',
            message: error.message
        });
    }
}
