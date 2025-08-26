import axios from 'axios';
import admin from 'firebase-admin';
import { GoogleGenerativeAI } from "@google/generative-ai";

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
You are a witty roast comedian with a playful attitude.
- Give ONE funny roast (1-2 sentences max)
- Keep it playful, not mean
- End with "Just kidding!" or similar
- Total: 3-4 sentences, under 300 characters`;
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
return "$" + n.toLocaleString(undefined, { maximumFractionDigits: 8 });
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

// --- Build the signature line for DexScreener responses ---
function buildSignature(username, marketCap, priceChange1h, timestamp, chatId, messageId) {
const emoji = priceChange1h > 0 ? '😈' : '😡';
const formattedMC = fmtBig(marketCap);
const telegramLink = `https://t.me/c/${String(chatId).replace(/^-100/, '')}/${messageId}`;
const usernameLink = `[@${username}](${telegramLink})`;
// FIXED: Handle timestamp properly
let timestampDate;
if (timestamp && typeof timestamp.toDate === 'function') {
timestampDate = timestamp.toDate();
} else if (timestamp instanceof Date) {
timestampDate = timestamp;
} else if (typeof timestamp === 'number') {
timestampDate = new Date(timestamp);
} else {
console.warn('⚠️ Invalid timestamp format:', timestamp);
timestampDate = new Date();
}
const timeDifference = Math.floor((new Date() - timestampDate) / 1000);
const formattedTime = formatTimeDuration(timeDifference);
return `\n\n${emoji} ${usernameLink} @ \`$${formattedMC}\` [ \`${formattedTime}\` ]`;
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

🪙 ADDRESS:

\`${token.address}\`

💎 USD: \`${formattedPrice}\` (\`${formattedChange1h}\`)
✨ MARKET CAP: \`$${mc}\`
⚜️ VOLUME: \`$${vol}\`
🌀 LP: \`$${lp}\`
` ;
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
[{ text: '🔄 Refresh', callback_data: `refresh_${callbackData}` }, { text: '🗑️ Delete', callback_data: 'delete_message' }]
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

// --- Send Photo function ---
async function sendPhotoToTopic(botToken, chatId, messageThreadId, photoUrl, caption = '', callbackData = '') {
const baseOptions = {
chat_id: parseInt(chatId),
photo: photoUrl,
caption: caption,
parse_mode: 'Markdown',
reply_markup: {
inline_keyboard: [
[{ text: '🔄 Refresh', callback_data: `refresh_${callbackData}` }, { text: '🗑️ Delete', callback_data: 'delete_message' }]
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

// --- Edit message with topic support and refresh/delete buttons ---
async function editMessageInTopic(botToken, chatId, messageId, messageThreadId, text, photoUrl, callbackData) {
const isPhoto = !!photoUrl;
const baseOptions = {
chat_id: parseInt(chatId),
message_id: parseInt(messageId),
parse_mode: 'Markdown',
reply_markup: {
inline_keyboard: [
[{ text: '🔄 Refresh', callback_data: `refresh_${callbackData}` }, { text: '🗑️ Delete', callback_data: 'delete_message' }]
]
}
};
try {
if (isPhoto) {
let options = { ...baseOptions, photo: photoUrl, caption: text };
if (messageThreadId) {
options.message_thread_id = parseInt(messageThreadId);
}
await axios.post(`https://api.telegram.org/bot${botToken}/editMessageCaption`, options);
} else {
let options = { ...baseOptions, text: text };
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
queries[userId].queries.push({ queryAddress, price, symbol });
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
const messageThreadId = callbackQuery.message.message_thread_id;
const callbackData = callbackQuery.data;
await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`, {
callback_query_id: callbackQuery.id
});
if (callbackData.startsWith('refresh_')) {
const originalCommand = callbackData.substring('refresh_'.length);
let reply = '';
let isPhoto = false;
let photoUrl = '';
if (originalCommand.startsWith('dexscreener_')) {
const address = originalCommand.substring('dexscreener_'.length);
const dexScreenerData = await getCoinFromDexScreener(address);
if (dexScreenerData) {
reply = buildDexScreenerReply(dexScreenerData);
// FIXED: Look up original query in Firestore to get the ORIGINAL timestamp
const originalQuerySnapshot = await db.collection('queries')
.where('query', '==', address)
.orderBy('timestamp', 'desc')
.limit(1)
.get();
if (!originalQuerySnapshot.empty) {
const originalQuery = originalQuerySnapshot.docs[0].data();
// FIXED: Use the ORIGINAL timestamp from the database, not current time
const signature = buildSignature(
originalQuery.username, 
originalQuery.marketCap || dexScreenerData.marketCap, 
dexScreenerData.priceChange?.h1 || 0, 
originalQuery.timestamp, // This is the original timestamp
originalQuery.chatId, 
originalQuery.messageId
);
reply += signature;
}
} else {
reply = '`Could not refresh DexScreener data.`';
}
}
else if (originalCommand.startsWith('chart_')) {
const symbol = originalCommand.substring('chart_'.length);
const coinData = await getCoinDataWithChanges(symbol);
if (coinData) {
const historicalData = await getHistoricalData(coinData.id);
if (historicalData && historicalData.length > 0) {
reply = `*${coinData.name}* Price Chart (30 Days)`;
photoUrl = getChartImageUrl(coinData.name, historicalData);
isPhoto = true;
} else {
reply = `\`Failed to get chart data for ${coinData.name}\``;
}
} else {
reply = `\`Coin "${symbol.toUpperCase()}" not found\``;
}
}
else if (originalCommand === 'gas') {
const ethCoin = await getCoinDataWithChanges('eth');
const ethPrice = ethCoin ? ethCoin.current_price : null;
const gasPrices = await getEthGasPrice();
if (ethPrice && gasPrices) {
reply = buildGasReply(gasPrices, ethPrice);
} else {
reply = '`Failed to retrieve gas data`';
}
}
else if (originalCommand.startsWith('compare_')) {
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
}
else if (originalCommand.startsWith('leaderboard')) {
reply = await buildLeaderboardReply(chatId);
await editMessageInTopic(BOT_TOKEN, chatId, messageId, messageThreadId, reply, '', 'leaderboard');
return res.status(200).json({ ok: true });
}
else {
const coin = await getCoinDataWithChanges(originalCommand);
if (coin) {
reply = buildReply(coin, 1);
} else {
reply = `\`Coin "${originalCommand.toUpperCase()}" not found\``;
}
}
await editMessageInTopic(BOT_TOKEN, chatId, messageId, messageThreadId, reply, photoUrl, originalCommand);
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
return res.status(200).json({ ok: true });
}
const msg = update.message;
if (!msg || !msg.text) {
return res.status(200).json({ ok: true, message: 'No text in message' });
}
const chatId = msg.chat.id;
const messageId = msg.message_id;
const messageThreadId = msg.message_thread_id;
const text = msg.text.trim();
const user = msg.from;
const chatType = msg.chat.type;
// --- Enhanced /que command handler with mobile-friendly responses ---
if (text.startsWith('/que')) {
const prompt = text.substring(4).trim();
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
return res.status(200).json({ ok: true, message: 'Ignoring non-command/calculation/coin message' });
}
if (isAddress) {
const dexScreenerData = await getCoinFromDexScreener(text);
if (dexScreenerData) {
const reply = buildDexScreenerReply(dexScreenerData);
const callbackData = `dexscreener_${text}`;
// Log the messageId along with the other data
await logUserQuery(user, chatId, text, parseFloat(dexScreenerData.priceUsd), dexScreenerData.baseToken.symbol, dexScreenerData.marketCap, messageId);
// FIXED: Use current time for NEW posts (this is correct for new posts)
const signature = buildSignature(user.username, dexScreenerData.marketCap, dexScreenerData.priceChange?.h1 || 0, new Date(), chatId, messageId);
await sendMessageToTopic(BOT_TOKEN, chatId, messageThreadId, reply + signature, callbackData);
} else {
await sendMessageToTopic(BOT_TOKEN, chatId, messageThreadId, '`Could not find a coin for that address.`');
}
}
else if (isCommand) {
const parts = text.substring(1).toLowerCase().split(' ');
const command = parts[0].split('@')[0]; // Fix: Extract just the command name
const symbol = parts[1];
if (command === 'leaderboard') {
const reply = await buildLeaderboardReply(chatId);
await sendMessageToTopic(BOT_TOKEN, chatId, messageThreadId, reply, 'leaderboard');
}
else if (command === 'chart' && symbol) {
const coinData = await getCoinDataWithChanges(symbol);
if (coinData) {
const historicalData = await getHistoricalData(coinData.id);
if (historicalData && historicalData.length > 0) {
const chartImageUrl = getChartImageUrl(coinData.name, historicalData);
await sendPhotoToTopic(BOT_TOKEN, chatId, messageThreadId, chartImageUrl, `*${coinData.name}* Price Chart (30 Days)`, `chart_${symbol}`);
} else {
await sendMessageToTopic(BOT_TOKEN, chatId, messageThreadId, `\`Failed to get chart data for ${coinData.name}\``, `chart_${symbol}`);
}
} else {
await sendMessageToTopic(BOT_TOKEN, chatId, messageThreadId, `\`Coin "${symbol.toUpperCase()}" not found\``, `chart_${symbol}`);
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
}
else if (command === 'compare') {
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
}
else if (command === 'start') {
await sendMessageToTopic(BOT_TOKEN, chatId, messageThreadId,
'`Welcome to Crypto Price Bot! Type /help for commands.`');
}
else if (command === 'help') {
await sendMessageToTopic(BOT_TOKEN, chatId, messageThreadId,
'`Commands:\n/eth - ETH price\n/gas - ETH gas prices\n/chart eth - Price chart\n/compare eth btc - Compare market caps\n/que [question] - Ask AI anything\n2 eth - Calculate value\nMath: 3+5, 100/5\n\nWorks for top 500 coins`');
}
else if (command === 'test') {
await sendMessageToTopic(BOT_TOKEN, chatId, messageThreadId,
`\`Bot Status: OK\nChat: ${msg.chat.type}\nTopic: ${messageThreadId || "None"}\nTime: ${new Date().toISOString()}\``);
}
}
else if (isCalculation) {
const result = evaluateExpression(text);
if (result !== null) {
await sendMessageToTopic(BOT_TOKEN, chatId, messageThreadId, `\`${text} = ${result}\``);
} else {
await sendMessageToTopic(BOT_TOKEN, chatId, messageThreadId, '`Invalid expression`');
}
}
else if (isCoinCheck) {
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
return res.status(200).json({ ok: true });
} catch (error) {
console.error('❌ Webhook error:', error.message);
console.error('Stack:', error.stack);
return res.status(500).json({ error: 'Internal server error', message: error.message });
}
}
