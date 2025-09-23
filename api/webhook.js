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

// --- NEW: Escape Markdown V1 characters for safe Telegram sending ---
function escapeMarkdown(text) {
    if (!text) return '';
    // Only escape the most problematic characters for Telegram Markdown V1
    // Be conservative to avoid breaking existing formatting
    return text
        .replace(/\\/g, '\\\\')
        .replace(/\*/g, '\\*')
        .replace(/_/g, '\\_')
        .replace(/\[/g, '\\[')
        .replace(/\]/g, '\\]');
}

// --- NEW: Escape text for usernames (don't escape underscores in usernames) ---
function escapeUsername(text) {
    if (!text) return '';
    // For usernames, we don't escape underscores as they're valid in Telegram usernames
    return text
        .replace(/\\/g, '\\\\')
        .replace(/\*/g, '\\*')
        .replace(/\[/g, '\\[')
        .replace(/\]/g, '\\]');
}

// --- Simple Social Media Link Detection with Single Best Alternative ---
function getSingleBestAlternative(text) {
    let alternativeUrl = text;
    let hasChanges = false;
    
    // Instagram - use kkinstagram.com as primary choice
    if (text.includes('instagram.com')) {
        alternativeUrl = text.replace(/https?:\/\/(www\.)?instagram\.com/g, 'https://kkinstagram.com');
        hasChanges = true;
    }
    // Twitter/X - use i.fxtwitter.com for instant view
    else if (text.includes('x.com') || text.includes('twitter.com')) {
        alternativeUrl = text.replace(/https?:\/\/(www\.)?(x\.com|twitter\.com)/g, 'https://i.fxtwitter.com');
        hasChanges = true;
    }
    // TikTok
    else if (text.includes('tiktok.com')) {
        alternativeUrl = text.replace(/https?:\/\/(www\.)?tiktok\.com/g, 'https://vxtiktok.com');
        hasChanges = true;
    }
    // Reddit
    else if (text.includes('reddit.com')) {
        alternativeUrl = text.replace(/https?:\/\/(www\.)?reddit\.com/g, 'https://rxddit.com');
        hasChanges = true;
    }
    
    return { alternativeUrl, hasChanges, original: text };
}

// --- Mobile-Friendly Prompt Engineering Functions ---
function analyzeQuestionAndCreatePrompt(userInput) {
    const input = userInput.toLowerCase();
    let systemPrompt = "";

    // Detect FUN/CASUAL/ROAST questions first
    if (input.includes('roast') || input.includes('insult') || input.includes('burn') || input.includes('savage')) {
        systemPrompt = `
Be a merciless, Deadpool-style roast comedian with zero chill.
Deliver ONE savage, cutting roast (1–2 sentences max).
Make it brutally witty, hilariously cruel, and painfully accurate—but still playful.
A little cuss or mild profanity is allowed for extra bite.
Always end with "Just kidding!" or a cheeky equivalent.
Keep it under 350 characters.
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

CRITICAL MOBILE-FRIENDLY REQUIREMENTS:
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

// --- CUSTOM @ALL MENTION CONFIGURATION ---
const MENTION_CONFIG = {
    // Replace this with your specific group chat ID (including the minus sign)
    TARGET_GROUP_ID: -1001354282618, // TODO: Replace with your actual group ID
    
    // Replace these with the 9 specific usernames (without @)
    CHOSEN_MEMBERS: [
        'anything_notslava_bot',     // TODO: Replace with actual username 1
        'Phanesbot',     // TODO: Replace with actual username 2
        'RickBurpBot',     // TODO: Replace with actual username 3
        'username4',     // TODO: Replace with actual username 4
        'username5',     // TODO: Replace with actual username 5
        'username6',     // TODO: Replace with actual username 6
        'username7',     // TODO: Replace with actual username 7
        'username8',     // TODO: Replace with actual username 8
        'username9'      // TODO: Replace with actual username 9
    ]
};

// Function to create mention text for the 9 chosen members using usernames
function createMentionText() {
    return MENTION_CONFIG.CHOSEN_MEMBERS
        .filter(username => username && !username.startsWith('username')) // Filter out placeholder usernames that start with 'username'
        .map(username => `@${escapeUsername(username)}`)
        .join(' ');
}

// Function to check if @all command should work in this chat
function isValidMentionContext(chatId) {
    return parseInt(chatId) === MENTION_CONFIG.TARGET_GROUP_ID;
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

        const result = new Function(`return ${sanitizedExpression}`)() ;
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

        const maxPoints = 50;
        const step = Math.max(1, Math.floor(ohlcData.length / maxPoints));
        const sampledData = ohlcData.filter((_, index) => index % step === 0);

        const labels = sampledData.map(candle => {
            const date = new Date(candle[0]);
            return timeframe === '1D' ?
                `${date.getHours()}:${date.getMinutes().toString().padStart(2, '0')}` :
                `${date.getMonth() + 1}/${date.getDate()}`;
        });

        const prices = sampledData.map(candle => parseFloat(candle[4].toFixed(8)));
        const highs = sampledData.map(candle => parseFloat(candle[2].toFixed(8)));
        const lows = sampledData.map(candle => parseFloat(candle[3].toFixed(8)));

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
                        font: { size: 16 }
                    },
                    legend: { display: true, position: 'bottom' }
                },
                scales: {
                    x: { display: true, title: { display: true, text: 'Time' }},
                    y: { display: true, title: { display: true, text: 'Price (USD)' }, beginAtZero: false }
                },
                interaction: { intersect: false, mode: 'index' }
            }
        };

        const compactConfig = encodeURIComponent(JSON.stringify(chartConfig));
        return `https://quickchart.io/chart?c=${compactConfig}&w=600&h=400&backgroundColor=white`;
    } catch (error) {
        console.error('❌ Candlestick chart URL generation failed:', error.message);
        return getChartImageUrl(coinName, ohlcData.map(candle => [candle[0], candle[4]]));
    }
}

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
                datasets: [{ label: `${coinName} Price`, data: prices, fill: false, borderColor: 'rgb(75, 192, 192)', tension: 0.1, borderWidth: 2, pointRadius: 1 }]
            },
            options: {
                responsive: true,
                title: { display: true, text: `${coinName} - 30 Days`, fontSize: 14 },
                legend: { display: false },
                scales: {
                    xAxes: [{ display: true, scaleLabel: { display: false }}],
                    yAxes: [{ display: true, scaleLabel: { display: false }}]
                }
            }
        };

        const compactConfig = encodeURIComponent(JSON.stringify(chartConfig));
        return `https://quickchart.io/chart?c=${compactConfig}&w=400&h=250&backgroundColor=white`;
    } catch (error) {
        console.error('❌ Chart URL generation failed:', error.message);
        return `https://quickchart.io/chart?c=${encodeURIComponent(JSON.stringify({type:'line',data:{labels:['Error'],datasets:[{data:[0]}]}}))}&w=400&h=250`;
    }
}

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
        lines.push(`H/L: ${fmtPrice(coin.high_24h)}/${fmtPrice(coin.low_24h)}`);
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

function buildSignature(firstPostData, currentPriceChange1h, chatId) {
    const emoji = currentPriceChange1h > 0 ? '😈' : '😡';
    const formattedMC = fmtBig(firstPostData.firstMarketCap);
    const telegramLink = `https://t.me/c/${String(chatId).replace(/^-100/, '')}/${firstPostData.firstMessageId}`;
    
    // For usernames in Markdown links, we need to be more careful about escaping
    // Only escape the most critical characters that would break the link syntax
    const safeUsername = firstPostData.firstUsername
        .replace(/\\/g, '\\\\')
        .replace(/\]/g, '\\]')
        .replace(/\[/g, '\\[');
    
    const usernameLink = `[@${safeUsername}](${telegramLink})`;

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

function buildDexScreenerReply(dexScreenerData) {
    try {
        const token = dexScreenerData.baseToken;
        const pair = dexScreenerData;
        const formattedChain = pair.chainId.toUpperCase();
        const formattedExchange = pair.dexId.toUpperCase();
        const formattedPrice = pair.priceUsd ? fmtPrice(parseFloat(pair.priceUsd)) : 'N/A';
        const change1h = pair.priceChange?.h1;
        const formattedChange1h = change1h ? fmtChange(change1h) : 'N/A';

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

        let reply = `💊 \`${token.name}\` (\`${token.symbol}\`)
🔗 CHAIN: \`#${formattedChain}\`
🔄 DEX PAIR: \`${formattedExchange}\`
💎 USD: \`${formattedPrice}\` (\`${formattedChange1h}\`)
✨ MARKET CAP: \`$${mc}\`
🪙 ADDRESS:
\`${token.address}\`
⚜️ VOLUME: \`$${vol}\`
🌀 LP: \`$${lp}\`
`;

        let links = `\n[DEXScreener](https://dexscreener.com/${pair.chainId}/${token.address})`;

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

// NEW: Alert and Reminder Functions
async function createPriceAlert(userId, chatId, symbol, condition, targetPrice, username) {
    try {
        const docRef = db.collection('price_alerts').doc();
        await docRef.set({
            userId,
            username,
            chatId: String(chatId),
            symbol: symbol.toLowerCase(),
            targetPrice,
            condition,
            isActive: true,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            lastChecked: admin.firestore.FieldValue.serverTimestamp()
        });
        console.log(`✅ Created price alert: ${symbol} ${condition} ${targetPrice} for user ${userId}`);
        return true;
    } catch (error) {
        console.error('❌ Error creating price alert:', error.message);
        return false;
    }
}

async function createTimeReminder(userId, chatId, message, triggerTime, username) {
    try {
        const docRef = db.collection('time_reminders').doc();
        await docRef.set({
            userId,
            username,
            chatId: String(chatId),
            message,
            triggerTime: admin.firestore.Timestamp.fromDate(triggerTime),
            isActive: true,
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        });
        console.log(`✅ Created time reminder: "${message}" for ${triggerTime} for user ${userId}`);
        return true;
    } catch (error) {
        console.error('❌ Error creating time reminder:', error.message);
        return false;
    }
}

async function getUserAlerts(userId, chatId) {
    try {
        const [priceAlertsSnapshot, timeRemindersSnapshot] = await Promise.all([
            db.collection('price_alerts')
                .where('userId', '==', userId)
                .where('chatId', '==', String(chatId))
                .where('isActive', '==', true)
                .orderBy('createdAt', 'desc')
                .get(),
            db.collection('time_reminders')
                .where('userId', '==', userId)
                .where('chatId', '==', String(chatId))
                .where('isActive', '==', true)
                .orderBy('createdAt', 'desc')
                .get()
        ]);

        const priceAlerts = priceAlertsSnapshot.docs.map(doc => ({
            id: doc.id,
            type: 'price',
            ...doc.data()
        }));

        const timeReminders = timeRemindersSnapshot.docs.map(doc => ({
            id: doc.id,
            type: 'time',
            ...doc.data()
        }));

        return { priceAlerts, timeReminders };
    } catch (error) {
        console.error('❌ Error getting user alerts:', error.message);
        return { priceAlerts: [], timeReminders: [] };
    }
}

function buildAlertsReply(alerts) {
    const { priceAlerts, timeReminders } = alerts;
    
    if (priceAlerts.length === 0 && timeReminders.length === 0) {
        return '`No active alerts or reminders found.`';
    }

    let reply = '*Your Active Alerts & Reminders:*\n\n';

    if (priceAlerts.length > 0) {
        reply += '*🚨 Price Alerts:*\n';
        priceAlerts.forEach((alert, index) => {
            reply += `${index + 1}. ${alert.symbol.toUpperCase()} ${alert.condition} $${alert.targetPrice.toLocaleString()}\n`;
        });
        reply += '\n';
    }

    if (timeReminders.length > 0) {
        reply += '*⏰ Time Reminders:*\n';
        timeReminders.forEach((reminder, index) => {
            const triggerDate = reminder.triggerTime.toDate();
            const dateStr = triggerDate.toLocaleDateString();
            const timeStr = triggerDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            reply += `${index + 1}. "${reminder.message}" on ${dateStr} at ${timeStr}\n`;
        });
    }

    return reply;
}

async function cancelAlert(userId, chatId, alertType, alertIndex) {
    try {
        const collectionName = alertType === 'price' ? 'price_alerts' : 'time_reminders';
        const snapshot = await db.collection(collectionName)
            .where('userId', '==', userId)
            .where('chatId', '==', String(chatId))
            .where('isActive', '==', true)
            .orderBy('createdAt', 'desc')
            .get();

        if (alertIndex > 0 && alertIndex <= snapshot.size) {
            const docToUpdate = snapshot.docs[alertIndex - 1];
            await docToUpdate.ref.update({ isActive: false });
            return true;
        }
        return false;
    } catch (error) {
        console.error('❌ Error canceling alert:', error.message);
        return false;
    }
}

async function sendMessageToTopic(botToken, chatId, messageThreadId, text, callbackData = '', options = {}) {
    if (!text || text.trim() === '') {
        console.error('❌ Refusing to send an empty message.');
        return;
    }

    const baseOptions = {
        chat_id: parseInt(chatId),
        text: text,
        parse_mode: 'Markdown',
        ...options
    };

    if (callbackData) {
        baseOptions.reply_markup = {
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

    const trySend = async(opts) => {
        try {
            const response = await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, opts, {
                timeout: 10000,
                headers: { 'Content-Type': 'application/json' }
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

async function sendPhotoToTopic(botToken, chatId, messageThreadId, photoUrl, caption = '', callbackData = '', showTimeframeButtons = false) {
    let replyMarkup;
    if (showTimeframeButtons) {
        replyMarkup = {
            inline_keyboard: [
                [{text: '1D', callback_data: `chart_1d_${callbackData}`}, {text: '7D', callback_data: `chart_7d_${callbackData}`}, 
                 {text: '30D', callback_data: `chart_30d_${callbackData}`}, {text: '90D', callback_data: `chart_90d_${callbackData}`}],
                [{text: '🔄 Refresh', callback_data: `refresh_chart_${callbackData}`}, {text: '🗑️ Delete', callback_data: 'delete_message'}]
            ]
        };
    } else {
        replyMarkup = {
            inline_keyboard: [
                [{text: '🔄 Refresh', callback_data: `refresh_${callbackData}`}, {text: '🗑️ Delete', callback_data: 'delete_message'}]
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
                headers: { 'Content-Type': 'application/json' }
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
            headers: { 'Content-Type': `multipart/form-data; boundary=${formData._boundary}` }
        });
        console.log('✅ Sticker sent successfully:', response.data);
    } catch (error) {
        console.error('❌ Failed to send sticker:', error.response?.data?.description || error.message);
        try {
            await sendMessageToTopic(botToken, chatId, messageThreadId, '`Failed to send sticker. Please try again later.`');
        } catch (fallbackError) {
            console.error('❌ Fallback message also failed:', fallbackError.message);
        }
    }
}

async function editMessageInTopic(botToken, chatId, messageId, messageThreadId, text, photoUrl, callbackData, showTimeframeButtons = false) {
    const isPhoto = !!photoUrl;
    let replyMarkup;

    if (showTimeframeButtons) {
        replyMarkup = {
            inline_keyboard: [
                [{text: '1D', callback_data: `chart_1d_${callbackData}`}, {text: '7D', callback_data: `chart_7d_${callbackData}`}, 
                 {text: '30D', callback_data: `chart_30d_${callbackData}`}, {text: '90D', callback_data: `chart_90d_${callbackData}`}],
                [{text: '🔄 Refresh', callback_data: `refresh_chart_${callbackData}`}, {text: '🗑️ Delete', callback_data: 'delete_message'}]
            ]
        };
    } else {
        replyMarkup = {
            inline_keyboard: [
                [{text: '🔄 Refresh', callback_data: `refresh_${callbackData}`}, {text: '🗑️ Delete', callback_data: 'delete_message'}]
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
            // For photo messages, edit caption
            let options = { ...baseOptions, caption: text };
            if (messageThreadId) {
                options.message_thread_id = parseInt(messageThreadId);
            }

            const response = await axios.post(`https://api.telegram.org/bot${botToken}/editMessageCaption`, options, {
                timeout: 10000,
                headers: { 'Content-Type': 'application/json' }
            });
            console.log('✅ Successfully edited photo caption');
            return response.data;
        } else {
            // For text messages, edit text
            let options = { ...baseOptions, text: text };
            if (messageThreadId) {
                options.message_thread_id = parseInt(messageThreadId);
            }

            const response = await axios.post(`https://api.telegram.org/bot${botToken}/editMessageText`, options, {
                timeout: 10000,
                headers: { 'Content-Type': 'application/json' }
            });
            console.log('✅ Successfully edited message text');
            return response.data;
        }
    } catch (error) {
        if (error.response?.data?.description?.includes('message is not modified')) {
            console.log('✅ Message content is identical, no edit needed.');
        } else if (error.response?.status === 400 && error.response?.data?.description?.includes('message to edit not found')) {
            console.error('❌ Message to edit not found - it may have been deleted');
        } else {
            console.error('❌ Error editing message:', {
                status: error.response?.status,
                statusText: error.response?.statusText,
                data: error.response?.data,
                message: error.message
            });
        }
        return null;
    }
}

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
        const groupStats = `\n*Group Stats:*\nPeriod: All Time\n`;

        const leaderboardEntries = sortedUsers.slice(0, 10).map((user, index) => {
            const rank = index + 1;
            const avgReturn = user.calls > 0 ? (user.totalReturn / user.calls).toFixed(2) : '0.00';
            const hitRate = user.calls > 0 ? ((user.positiveReturns / user.calls) * 100).toFixed(0) : '0';

            return `*#${rank} ${user.username}*\n\`Calls: ${user.calls}\nHit Rate: ${hitRate}%\nReturn: ${avgReturn}%\``;
        }).join('\n');

        return `${mainHeader}\n${groupStats}\n*Top Token Lords*\n${leaderboardEntries}`;
    } catch (error) {
        console.error('❌ Failed to build leaderboard:', error.message);
        return '`Failed to build leaderboard. Please try again later.`';
    }
}

async function getGeminiReply(prompt) {
    try {
        const dynamicPrompt = analyzeQuestionAndCreatePrompt(prompt);

        const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
        const model = genAI.getGenerativeModel({
            model: "gemini-2.5-flash-lite"
        });

        const result = await model.generateContent(dynamicPrompt);
        const response = await result.response;
        let text = response.text();

        if (text.length > 450) {
            text = text.substring(0, 400) + "...";
        }

        return text;
    } catch (e) {
        console.error("❌ Google Generative AI API failed:", e.message);
        return "Sorry, I'm having trouble right now. Please try again!";
    }
}

// FIXED: Precise token detection - only matches "number space symbol" pattern
function isValidCoinPattern(text) {
    // FIXED: Only match "1 eth" format with proper spacing, minimum 2 chars for symbol
    const tokenPattern = /^(\d+(?:\.\d+)?)\s+([a-z]{2,10})$/i;
    const matches = text.trim().match(tokenPattern);
    
    if (!matches) return false;
    
    const amount = parseFloat(matches[1]);
    const symbol = matches[2].toLowerCase();
    
    // Additional validation: reasonable amount and known crypto symbols
    if (amount <= 0 || amount > 999999999) return false;
    if (symbol.length < 2 || symbol.length > 10) return false;
    
    return { amount, symbol };
}

// FIXED: Multi-token detection for sentences like "1 eth 2 btc"
function extractMultipleTokens(text) {
    const tokens = [];
    // Split by spaces and process pairs
    const words = text.trim().split(/\s+/);
    
    for (let i = 0; i < words.length - 1; i++) {
        const amountStr = words[i];
        const symbolStr = words[i + 1];
        
        // Check if this is a valid number followed by a symbol
        if (/^\d+(?:\.\d+)?$/.test(amountStr) && /^[a-z]{2,10}$/i.test(symbolStr)) {
            const amount = parseFloat(amountStr);
            const symbol = symbolStr.toLowerCase();
            
            if (amount > 0 && amount <= 999999999) {
                tokens.push({ amount, symbol });
                i++; // Skip the symbol on next iteration
            }
        }
    }
    
    return tokens.length > 0 ? tokens : null;
}

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

        // ENHANCED: Handle callback queries for timeframe selection and refresh
        if (update.callback_query) {
            const callbackQuery = update.callback_query;
            const chatId = callbackQuery.message.chat.id;
            const messageId = callbackQuery.message.message_id;
            const messageThreadId = callbackQuery.message.message_thread_id;
            const callbackData = callbackQuery.data;

            try {
                await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`, {
                    callback_query_id: callbackQuery.id
                });
            } catch (error) {
                console.error('❌ Error answering callback query:', error.message);
            }

            // Handle timeframe-specific chart requests
            if (callbackData.startsWith('chart_1d_') || callbackData.startsWith('chart_7d_') ||
                callbackData.startsWith('chart_30d_') || callbackData.startsWith('chart_90d_')) {
                const parts = callbackData.split('_');
                const timeframe = parts[1].toUpperCase();
                const symbol = parts.slice(2).join('_');

                const coinData = await getCoinDataWithChanges(symbol);
                if (coinData) {
                    let days;
                    switch (timeframe) {
                        case '1D': days = 1; break;
                        case '7D': days = 7; break;
                        case '30D': days = 30; break;
                        case '90D': days = 90; break;
                        default: days = 30;
                    }

                    const ohlcData = await getOHLCData(coinData.id, days);
                    let chartUrl, caption;

                    if (ohlcData && ohlcData.length > 0) {
                        chartUrl = getCandlestickChartUrl(coinData.name, ohlcData, timeframe);
                        caption = `*${coinData.name}* OHLC Chart (${timeframe})`;
                    } else {
                        const historicalData = await getHistoricalData(coinData.id);
                        if (historicalData && historicalData.length > 0) {
                            chartUrl = getChartImageUrl(coinData.name, historicalData);
                            caption = `*${coinData.name}* Price Chart (${timeframe}) - Line Chart Fallback`;
                        } else {
                            caption = `\`Failed to get chart data for ${coinData.name}\``;
                        }
                    }

                    if (chartUrl) {
                        try {
                            const deleteResponse = await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/deleteMessage`, {
                                chat_id: parseInt(chatId),
                                message_id: parseInt(messageId)
                            }, {
                                timeout: 10000,
                                headers: { 'Content-Type': 'application/json' }
                            });
                            console.log('✅ Successfully deleted old chart message');
                            
                            await sendPhotoToTopic(BOT_TOKEN, chatId, messageThreadId, chartUrl, caption, symbol, true);
                        } catch (deleteError) {
                            console.warn('⚠️ Could not delete message, trying to edit instead:', deleteError.message);
                            await editMessageInTopic(BOT_TOKEN, chatId, messageId, messageThreadId, caption, chartUrl, symbol, true);
                        }
                    } else {
                        await editMessageInTopic(BOT_TOKEN, chatId, messageId, messageThreadId, caption, '', symbol, false);
                    }
                }

                return res.status(200).json({ ok: true });
            }

            // FIXED: Enhanced refresh handler with proper amount preservation
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
                        const ohlcData = await getOHLCData(coinData.id, 30);
                        if (ohlcData && ohlcData.length > 0) {
                            reply = `*${coinData.name}* Candlestick Chart (30D)`;
                            photoUrl = getCandlestickChartUrl(coinData.name, ohlcData, '30D');
                            isPhoto = true;
                            showTimeframeButtons = true;
                        } else {
                            const historicalData = await getHistoricalData(coinData.id);
                            if (historicalData && historicalData.length > 0) {
                                reply = `*${coinData.name}* Price Chart (30D) - Line Chart Fallback`;
                                photoUrl = getChartImageUrl(coinData.name, historicalData);
                                isPhoto = true;
                            } else {
                                reply = `\`Failed to get chart data for ${coinData.name}\``;
                            }
                        }
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
                    }
                } else if (originalCommand.startsWith('leaderboard')) {
                    reply = await buildLeaderboardReply(chatId);
                    await editMessageInTopic(BOT_TOKEN, chatId, messageId, messageThreadId, reply, '', 'leaderboard');
                    return res.status(200).json({ ok: true });
                }
                // FIXED: Multi-token refresh handler with amount preservation
                else if (originalCommand.startsWith('multi_')) {
                    const tokensString = originalCommand.substring('multi_'.length);
                    const tokenPairs = tokensString.split('|');
                    
                    const tokensToFetch = tokenPairs.map(pair => {
                        const [amount, symbol] = pair.split('_');
                        return { amount: parseFloat(amount), symbol: symbol };
                    });
                    
                    console.log(`🔄 Refreshing ${tokensToFetch.length} tokens:`, tokensToFetch);
                    
                    const coinPromises = tokensToFetch.map(async (token) => {
                        try {
                            const coin = await getCoinDataWithChanges(token.symbol);
                            if (coin) {
                                return buildReply(coin, token.amount);
                            } else {
                                console.log(`⚠️ Coin not found during refresh: ${token.symbol}`);
                                return null; // Don't show "not found" messages during refresh
                            }
                        } catch (error) {
                            console.error(`❌ Error refreshing ${token.symbol}:`, error.message);
                            return null;
                        }
                    });
                    
                    const results = await Promise.all(coinPromises);
                    const validResults = results.filter(r => r !== null);
                    
                    if (validResults.length > 0) {
                        reply = validResults.join('\n\n');
                    } else {
                        reply = '`Unable to refresh data. Please try again later.`';
                    }
                    
                    console.log(`✅ Refreshed multi-token reply with ${validResults.length} tokens`);
                }
                // FIXED: Single token refresh with amount preservation
                else {
                    if (originalCommand.includes('_')) {
                        const [amountStr, symbol] = originalCommand.split('_');
                        const amount = parseFloat(amountStr);
                        if (!isNaN(amount) && symbol) {
                            const coin = await getCoinDataWithChanges(symbol);
                            if (coin) {
                                reply = buildReply(coin, amount);
                            } else {
                                console.log(`⚠️ Coin not found during refresh: ${symbol}`);
                                reply = '`Unable to refresh data. Please try again later.`';
                            }
                        } else {
                            const coin = await getCoinDataWithChanges(originalCommand);
                            if (coin) {
                                reply = buildReply(coin, 1);
                            } else {
                                console.log(`⚠️ Coin not found during refresh: ${originalCommand}`);
                                reply = '`Unable to refresh data. Please try again later.`';
                            }
                        }
                    } else {
                        const coin = await getCoinDataWithChanges(originalCommand);
                        if (coin) {
                            reply = buildReply(coin, 1);
                        } else {
                            console.log(`⚠️ Coin not found during refresh: ${originalCommand}`);
                            reply = '`Unable to refresh data. Please try again later.`';
                        }
                    }
                }

                await editMessageInTopic(BOT_TOKEN, chatId, messageId, messageThreadId, reply, photoUrl, originalCommand, showTimeframeButtons);
            } else if (callbackData === 'delete_message') {
                try {
                    const response = await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/deleteMessage`, {
                        chat_id: parseInt(chatId),
                        message_id: parseInt(messageId)
                    }, {
                        timeout: 10000,
                        headers: { 'Content-Type': 'application/json' }
                    });
                    console.log('✅ Successfully deleted message');
                } catch (error) {
                    console.error('❌ Error deleting message:', {
                        status: error.response?.status,
                        statusText: error.response?.statusText,
                        data: error.response?.data,
                        message: error.message
                    });
                }
            }

            return res.status(200).json({ ok: true });
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

        // Social Media Link Preview
        const linkData = getSingleBestAlternative(text);
        if (linkData.hasChanges) {
            console.log('🔄 Detected social media link, sending clean preview');
            
            const senderUsername = user.username || user.first_name || `User${user.id}`;
            const escapedUsername = escapeMarkdown(senderUsername);
            
            const formattedMessage = `[Media Link](${linkData.alternativeUrl})\n\n[Original Link](${linkData.original}) sent by @${escapedUsername}`;
            
            await sendMessageToTopic(
                BOT_TOKEN, 
                chatId, 
                messageThreadId, 
                formattedMessage,
                '', 
                { 
                    reply_to_message_id: messageId, 
                    disable_web_page_preview: false,
                    parse_mode: 'Markdown'
                }
            );
            
            return res.status(200).json({ ok: true, message: 'Clean preview sent' });
        }

        // Enhanced /que command handler
        if (text.startsWith('/que')) {
            let prompt = text.substring(4).trim();

            if (msg.reply_to_message && msg.reply_to_message.text) {
                const repliedText = msg.reply_to_message.text;
                prompt = `(Context: "${repliedText}")\n\n${prompt}`;
            }

            function escapeHtml(str) {
                if (!str || typeof str !== 'string') return 'Empty response';
                return str
                    .replace(/&/g, "&amp;")
                    .replace(/</g, "&lt;")
                    .replace(/>/g, "&gt;")
                    .replace(/"/g, "&quot;")
                    .replace(/'/g, "&#x27;")
                    .replace(/[\u0000-\u001F\u007F-\u009F]/g, '')
                    .trim();
            }

            try {
                let responseText;
                if (prompt.length > 0) {
                    responseText = await getGeminiReply(prompt);
                } else {
                    responseText = "Please provide a query after the /que command.";
                }

                responseText = escapeHtml(responseText);
                const messageParts = splitMessage(responseText, 600);

                for (let i = 0; i < messageParts.length; i++) {
                    const part = messageParts[i];
                    const isLastPart = i === messageParts.length - 1;

                    const partIndicator = messageParts.length > 1 ?
                        `\n\n📱 ${i + 1}/${messageParts.length}` : '';

                    await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
                        chat_id: chatId,
                        text: part + partIndicator,
                        reply_to_message_id: isLastPart ? msg.message_id : undefined,
                        parse_mode: "HTML"
                    });

                    if (i < messageParts.length - 1) {
                        await new Promise(resolve => setTimeout(resolve, 100));
                    }
                }
            } catch (err) {
                console.error("Telegram API error:", err.response?.data || err.message);
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

        // Check for @all mention command first (before other filtering)
        if (text.toLowerCase().trim() === '@all') {
            // Only work in the specific target group
            if (isValidMentionContext(chatId)) {
                const mentionText = createMentionText();
                
                // FIXED: Add validation to ensure we have mentions to send
                if (!mentionText || mentionText.trim() === '') {
                    console.log(`⚠️ No valid usernames to mention in group ${chatId}`);
                    return res.status(200).json({ ok: true, message: 'No valid usernames configured' });
                }
                
                const senderName = user.first_name || user.username || 'Someone';
                // FIXED: Escape the sender name and use proper Markdown V1 syntax
                const escapedSenderName = escapeUsername(senderName);
                const message = `🔔 *Group Mention by ${escapedSenderName}*\n\n${mentionText}`;
                
                // FIXED: Add message length validation
                if (message.length > 4096) {
                    console.error(`❌ Message too long: ${message.length} characters`);
                    await sendMessageToTopic(BOT_TOKEN, chatId, messageThreadId, '`❌ Mention message too long. Please configure fewer usernames.`');
                    return res.status(200).json({ ok: false, error: 'Message too long' });
                }
                
                try {
                    await sendMessageToTopic(BOT_TOKEN, chatId, messageThreadId, message, '', {
                        parse_mode: 'Markdown'
                    });
                    
                    console.log(`✅ @all mention sent in group ${chatId} by user ${user.id}`);
                    return res.status(200).json({ ok: true, message: '@all mention sent' });
                } catch (error) {
                    console.error(`❌ Error sending @all mention:`, error.response?.data || error.message);
                    // Fallback: try sending without Markdown formatting
                    try {
                        const plainMessage = `🔔 Group Mention by ${senderName}\n\n${mentionText}`;
                        await sendMessageToTopic(BOT_TOKEN, chatId, messageThreadId, plainMessage);
                        console.log(`✅ @all mention sent (plain text fallback) in group ${chatId}`);
                        return res.status(200).json({ ok: true, message: '@all mention sent (fallback)' });
                    } catch (fallbackError) {
                        console.error(`❌ Fallback @all mention also failed:`, fallbackError.message);
                        return res.status(500).json({ ok: false, error: 'Failed to send mention' });
                    }
                }
            } else {
                // Silently ignore @all in other groups (no response)
                console.log(`⚠️ @all command ignored in non-target group ${chatId}`);
                return res.status(200).json({ ok: true, message: '@all ignored in wrong group' });
            }
        }

        // FIXED: Updated message filtering logic
        const isCommand = text.startsWith('/') || text.startsWith('.');
        const mathRegex = /^([\d.\s]+(?:[+\-*/][\d.\s]+)+)$/;
        const isCalculation = mathRegex.test(text);
        
        // FIXED: Precise coin detection - only "1 eth" format, not "1eth"
        const singleTokenMatch = isValidCoinPattern(text);
        const multipleTokens = extractMultipleTokens(text);
        const isCoinCheck = singleTokenMatch || multipleTokens;
        
        const isAddress = (text.length === 42 || text.length === 32 || text.length === 44) && /^(0x)?[a-zA-Z0-9]+$/.test(text);

        if (!isCommand && !isCalculation && !isCoinCheck && !isAddress && chatType === 'group') {
            return res.status(200).json({
                ok: true,
                message: 'Ignoring non-command/calculation/coin message'
            });
        }

        // Address handling with first post tracking
        if (isAddress) {
            const dexScreenerData = await getCoinFromDexScreener(text);
            if (dexScreenerData) {
                const reply = buildDexScreenerReply(dexScreenerData);
                const callbackData = `dexscreener_${text}`;

                const firstPostInfo = await getFirstPostInfo(text, chatId);
                if (firstPostInfo) {
                    console.log('🔄 Using existing first post info for signature');
                    const signature = buildSignature(firstPostInfo, dexScreenerData.priceChange?.h1 || 0, chatId);
                    await sendMessageToTopic(BOT_TOKEN, chatId, messageThreadId, reply + signature, callbackData);
                } else {
                    console.log('🆕 First time posting this address, storing first post info');
                    const username = user.username || user.first_name || `User${user.id}`;
                    const currentTimestamp = admin.firestore.FieldValue.serverTimestamp();

                    await storeFirstPostInfo(
                        text,
                        chatId,
                        username,
                        dexScreenerData.marketCap,
                        currentTimestamp,
                        messageId,
                        dexScreenerData.baseToken.symbol
                    );

                    const firstPostData = {
                        firstUsername: username,
                        firstMarketCap: dexScreenerData.marketCap,
                        firstTimestamp: new Date(),
                        firstMessageId: messageId
                    };

                    const signature = buildSignature(firstPostData, dexScreenerData.priceChange?.h1 || 0, chatId);
                    await sendMessageToTopic(BOT_TOKEN, chatId, messageThreadId, reply + signature, callbackData);
                }

                await logUserQuery(user, chatId, text, parseFloat(dexScreenerData.priceUsd), dexScreenerData.baseToken.symbol, dexScreenerData.marketCap, messageId);
            }
            // FIXED: Removed "Could not find coin" message - stays silent
        } else if (isCommand) {
            const parts = text.substring(1).toLowerCase().split(' ');
            const command = parts[0].split('@')[0];
            const symbol = parts[1];

            if (command === 'leaderboard') {
                const reply = await buildLeaderboardReply(chatId);
                await sendMessageToTopic(BOT_TOKEN, chatId, messageThreadId, reply, 'leaderboard');
            }
            else if (command === 'quote' || command === 's') {
                const repliedToMessage = msg.reply_to_message;
                if (repliedToMessage) {
                    const messageToQuote = repliedToMessage;
                    const quoteImageBuffer = await getQuoteImageUrl(messageToQuote, null);
                    if (quoteImageBuffer) {
                        await sendStickerToTopic(BOT_TOKEN, chatId, messageThreadId, quoteImageBuffer);
                    } else {
                        await sendMessageToTopic(BOT_TOKEN, chatId, messageThreadId, '`Failed to generate quote image. Please try again later.`');
                    }
                } else {
                    await sendMessageToTopic(BOT_TOKEN, chatId, messageThreadId, '`Please reply to a message with /quote or /s to create an image.`');
                }
            }
            else if (command === 'chart' && symbol) {
                const coinData = await getCoinDataWithChanges(symbol);
                if (coinData) {
                    const ohlcData = await getOHLCData(coinData.id, 30);
                    if (ohlcData && ohlcData.length > 0) {
                        const chartImageUrl = getCandlestickChartUrl(coinData.name, ohlcData, '30D');
                        await sendPhotoToTopic(BOT_TOKEN, chatId, messageThreadId, chartImageUrl,
                            `*${coinData.name}* Candlestick Chart (30D)`, symbol, true);
                    } else {
                        const historicalData = await getHistoricalData(coinData.id);
                        if (historicalData && historicalData.length > 0) {
                            const chartImageUrl = getChartImageUrl(coinData.name, historicalData);
                            await sendPhotoToTopic(BOT_TOKEN, chatId, messageThreadId, chartImageUrl,
                                `*${coinData.name}* Price Chart (30D) - Line Chart Fallback`, symbol, false);
                        }
                        // FIXED: Removed "Failed to get chart data" message
                    }
                }
                // FIXED: Removed "Coin not found" message
            } else if (command === 'alert') {
                // Usage: /alert btc above 100000
                const [symbol, condition, priceStr] = parts.slice(1);
                
                if (!symbol || !condition || !priceStr) {
                    await sendMessageToTopic(BOT_TOKEN, chatId, messageThreadId, 
                        '`Usage: /alert [symbol] [above/below] [price]\nExample: /alert btc above 100000`');
                    return res.status(200).json({ ok: true });
                }
                
                if (!['above', 'below'].includes(condition.toLowerCase())) {
                    await sendMessageToTopic(BOT_TOKEN, chatId, messageThreadId, 
                        '`Condition must be "above" or "below"\nExample: /alert eth below 3000`');
                    return res.status(200).json({ ok: true });
                }
                
                const targetPrice = parseFloat(priceStr);
                if (isNaN(targetPrice) || targetPrice <= 0) {
                    await sendMessageToTopic(BOT_TOKEN, chatId, messageThreadId, 
                        '`Invalid price. Please enter a valid number\nExample: /alert sol above 150`');
                    return res.status(200).json({ ok: true });
                }

                // Verify the coin exists
                const coinData = await getCoinDataWithChanges(symbol);
                if (!coinData) {
                    await sendMessageToTopic(BOT_TOKEN, chatId, messageThreadId, 
                        `\`Coin "${symbol.toUpperCase()}" not found. Please check the symbol.\``);
                    return res.status(200).json({ ok: true });
                }

                const username = user.username || user.first_name || `User${user.id}`;
                const success = await createPriceAlert(user.id, chatId, symbol, condition.toLowerCase(), targetPrice, username);
                
                if (success) {
                    const currentPrice = coinData.current_price;
                    await sendMessageToTopic(BOT_TOKEN, chatId, messageThreadId, 
                        `✅ *Price Alert Set*

${symbol.toUpperCase()} ${condition} $${targetPrice.toLocaleString()}
Current price: $${currentPrice.toLocaleString()}

You'll be notified when the condition is met.`, 'alert_set');
                } else {
                    await sendMessageToTopic(BOT_TOKEN, chatId, messageThreadId, 
                        '`Failed to create alert. Please try again later.`');
                }
            }

            else if (command === 'remind') {
                // Usage: /remind "check portfolio" 3pm
                const reminderMatch = text.match(/\/remind\s+"([^"]+)"\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/i);
                
                if (!reminderMatch) {
                    await sendMessageToTopic(BOT_TOKEN, chatId, messageThreadId, 
                        `\`Usage: /remind "message" [time]\n\nExamples:\n/remind "check portfolio" 3pm\n/remind "buy the dip" 9:30am\n/remind "hello" 15:30\`\n\nTime format: IST timezone, supports 12hr (3pm) and 24hr (15:30) formats`);
                    return res.status(200).json({ ok: true });
                }
                
                const [, reminderMessage, timeStr] = reminderMatch;
                
                // Parse time and convert to IST
                function parseTimeToIST(timeStr) {
                    const now = new Date();
                    let hours, minutes;
                    
                    // Handle 12-hour format (3pm, 9:30am)
                    const twelveHourMatch = timeStr.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i);
                    if (twelveHourMatch) {
                        hours = parseInt(twelveHourMatch[1]);
                        minutes = parseInt(twelveHourMatch[2] || '0');
                        const period = twelveHourMatch[3].toLowerCase();
                        
                        if (period === 'pm' && hours !== 12) hours += 12;
                        if (period === 'am' && hours === 12) hours = 0;
                    } 
                    // Handle 24-hour format (15:30 or just 15)
                    else {
                        const twentyFourHourMatch = timeStr.match(/(\d{1,2})(?::(\d{2}))?/);
                        if (twentyFourHourMatch) {
                            hours = parseInt(twentyFourHourMatch[1]);
                            minutes = parseInt(twentyFourHourMatch[2] || '0');
                        } else {
                            return null;
                        }
                    }
                    
                    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
                        return null;
                    }
                    
                    // Create IST date for today
                    const istTime = new Date();
                    // Convert to IST (UTC+5:30)
                    istTime.setUTCHours(hours - 5, minutes - 30, 0, 0);
                    
                    // If the time has passed today, set it for tomorrow
                    if (istTime <= now) {
                        istTime.setUTCDate(istTime.getUTCDate() + 1);
                    }
                    
                    return istTime;
                }
                
                const triggerTime = parseTimeToIST(timeStr);
                
                if (!triggerTime) {
                    await sendMessageToTopic(BOT_TOKEN, chatId, messageThreadId, 
                        '`Invalid time format. Use formats like: 3pm, 9:30am, 15:30`');
                    return res.status(200).json({ ok: true });
                }
                
                // Validate date is not too far in future (7 days max for time-only reminders)
                const sevenDaysFromNow = new Date();
                sevenDaysFromNow.setDate(sevenDaysFromNow.getDate() + 7);
                if (triggerTime > sevenDaysFromNow) {
                    await sendMessageToTopic(BOT_TOKEN, chatId, messageThreadId, 
                        '`Time-based reminders are limited to within 7 days.`');
                    return res.status(200).json({ ok: true });
                }

                const username = user.username || user.first_name || `User${user.id}`;
                const success = await createTimeReminder(user.id, chatId, reminderMessage, triggerTime, username);
                
                if (success) {
                    // Display time in IST format
                    const istDate = new Date(triggerTime.getTime() + (5.5 * 60 * 60 * 1000));
                    const dateStr = istDate.toLocaleDateString('en-IN');
                    const timeStr12 = istDate.toLocaleTimeString('en-IN', { 
                        hour: 'numeric', 
                        minute: '2-digit',
                        hour12: true 
                    });
                    
                    await sendMessageToTopic(BOT_TOKEN, chatId, messageThreadId, 
                        `⏰ *Reminder Set*

"${reminderMessage}"

Date: ${dateStr}
Time: ${timeStr12} IST

I'll notify you at the specified time.`, 'reminder_set');
                } else {
                    await sendMessageToTopic(BOT_TOKEN, chatId, messageThreadId, 
                        '`Failed to create reminder. Please try again later.`');
                }
            }

            else if (command === 'alerts' || command === 'reminders') {
                const alerts = await getUserAlerts(user.id, chatId);
                const reply = buildAlertsReply(alerts);
                await sendMessageToTopic(BOT_TOKEN, chatId, messageThreadId, reply, 'user_alerts');
            }

            else if (command === 'cancel') {
                // Usage: /cancel price 1 OR /cancel time 2
                const [alertType, indexStr] = parts.slice(1);
                
                if (!alertType || !indexStr) {
                    await sendMessageToTopic(BOT_TOKEN, chatId, messageThreadId, 
                        '`Usage: /cancel [price/time] [number]\nExample: /cancel price 1\nUse /alerts to see your alerts first.`');
                    return res.status(200).json({ ok: true });
                }
                
                if (!['price', 'time'].includes(alertType.toLowerCase())) {
                    await sendMessageToTopic(BOT_TOKEN, chatId, messageThreadId, 
                        '`Alert type must be "price" or "time"\nExample: /cancel price 1`');
                    return res.status(200).json({ ok: true });
                }
                
                const alertIndex = parseInt(indexStr);
                if (isNaN(alertIndex) || alertIndex <= 0) {
                    await sendMessageToTopic(BOT_TOKEN, chatId, messageThreadId, 
                        '`Invalid alert number. Use /alerts to see your alerts.`');
                    return res.status(200).json({ ok: true });
                }
                
                const success = await cancelAlert(user.id, chatId, alertType.toLowerCase(), alertIndex);
                
                if (success) {
                    await sendMessageToTopic(BOT_TOKEN, chatId, messageThreadId, 
                        `✅ ${alertType.charAt(0).toUpperCase() + alertType.slice(1)} alert #${alertIndex} has been canceled.`);
                } else {
                    await sendMessageToTopic(BOT_TOKEN, chatId, messageThreadId, 
                        '`Alert not found or already inactive. Use /alerts to see your active alerts.`');
                }
            }
            else if (command === 'gas') {
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
                    }
                    // FIXED: Removed "coins not found" message
                } else {
                    await sendMessageToTopic(BOT_TOKEN, chatId, messageThreadId, '`Usage: /compare [symbol1] [symbol2]`', `compare_${symbol1}_${symbol2}`);
                }
            } else if (command === 'start') {
                await sendMessageToTopic(BOT_TOKEN, chatId, messageThreadId,
                    '`hey welcome fren! Type /help to know more about the commands.`');
            } else if (command === 'help') {
                let helpMessage = `*Commands:*
[amount] [symbol] - Get a crypto price, e.g., \`2 eth\`
/gas - Get current Ethereum gas prices
/chart [symbol] - View a candlestick chart with timeframes, e.g., \`/chart eth\`
/compare [symbol1] [symbol2] - Compare market caps, e.g., \`/compare eth btc\`
/que [question] - Ask the AI anything, e.g., \`/que what is defi\`
*/quote* or */s* - Reply to a message with this command to create a quote sticker
/leaderboard - See the top token finders

*NEW: Alerts & Reminders:*
/alert [symbol] [above/below] [price] - Set price alert, e.g., \`/alert btc above 100000\`
/remind "message" [time] - Set time reminder (IST), e.g., \`/remind "hello" 3pm\`
/alerts - View your active alerts and reminders
/cancel [price/time] [number] - Cancel specific alert, e.g., \`/cancel price 1\`
/help - Show this message`;

                // Only show @all command in the target group
                if (isValidMentionContext(chatId)) {
                    helpMessage += `

*Group Mention:*
@all - Mention specific group members (works only in this group)`;
                }

                helpMessage += `

*Other features:*
- Send a token address to get token info
- Use simple math, e.g., \`5 * 10\`
- **Multi-token support**: \`1 eth 2 btc 0.5 doge\`
- **Auto-enhances Twitter/X, Instagram, TikTok, Reddit links for better previews**`;

                await sendMessageToTopic(BOT_TOKEN, chatId, messageThreadId, helpMessage);
    
            } else if (command === 'test') {
                await sendMessageToTopic(BOT_TOKEN, chatId, messageThreadId,
                    `\`Bot Status: OK\nChat: ${msg.chat.type}\nTopic: ${messageThreadId || "None"}\nTime: ${new Date().toISOString()}\``);
            }
        } else if (isCalculation) {
            const result = evaluateExpression(text);
            if (result !== null) {
                await sendMessageToTopic(BOT_TOKEN, chatId, messageThreadId, `\`${text} = ${result}\``);
            } else {
                await sendMessageToTopic(BOT_TOKEN, chatId, messageThreadId, '`Invalid expression`');
            }
        } 
        // FIXED: Enhanced coin check handling with silent failures
        else if (isCoinCheck) {
            let tokensToProcess = [];
            
            if (singleTokenMatch) {
                tokensToProcess = [singleTokenMatch];
            } else if (multipleTokens) {
                tokensToProcess = multipleTokens;
            }
            
            if (tokensToProcess.length > 0) {
                console.log(`🔍 Found ${tokensToProcess.length} tokens to fetch:`, tokensToProcess);
                
                const coinPromises = tokensToProcess.map(async (token) => {
                    try {
                        const coin = await getCoinDataWithChanges(token.symbol);
                        if (coin) {
                            return {
                                success: true,
                                reply: buildReply(coin, token.amount),
                                symbol: token.symbol,
                                amount: token.amount
                            };
                        } else {
                            console.log(`⚠️ Coin not found: ${token.symbol} (staying silent)`);
                            return null; // FIXED: Return null instead of error message
                        }
                    } catch (error) {
                        console.error(`❌ Error fetching ${token.symbol}:`, error.message);
                        return null; // FIXED: Return null instead of error message
                    }
                });
                
                const results = await Promise.all(coinPromises);
                const validResults = results.filter(r => r !== null);
                
                // FIXED: Only send message if we have valid results
                if (validResults.length > 0) {
                    const combinedReply = validResults.map(result => result.reply).join('\n\n');
                    
                    // FIXED: Create callback data that preserves amounts for refresh functionality
                    const symbolsForCallback = tokensToProcess
                        .filter(t => validResults.some(r => r.symbol === t.symbol))
                        .map(t => `${t.amount}_${t.symbol}`)
                        .join('|');
                    
                    const callbackData = validResults.length > 1 ? `multi_${symbolsForCallback}` : symbolsForCallback;
                    
                    await sendMessageToTopic(BOT_TOKEN, chatId, messageThreadId, combinedReply, callbackData);
                    
                    console.log(`✅ Sent reply with ${validResults.length} valid tokens`);
                }
                // FIXED: If no valid results, stay completely silent (no message sent)
            }
        }

        return res.status(200).json({ ok: true });
    } catch (error) {
        console.error('❌ Webhook error:', error.message);
        console.error('Stack:', error.stack);
        return res.status(500).json({
            error: 'Internal server error',
            message: error.message
        });
    }
}
