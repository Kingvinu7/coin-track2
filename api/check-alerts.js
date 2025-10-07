import admin from 'firebase-admin';
import axios from 'axios';
import { makeRateLimitedAxiosRequest } from './rate-limiter.js';

// Special rate limiting config for alert checker - fail fast on rate limits
const ALERT_CHECKER_RATE_LIMIT_CONFIG = {
    maxRetries: 1, // Only 1 retry for alert checker
    baseDelay: 2000,
    maxDelay: 5000,
    backoffMultiplier: 2,
    useQueue: false // Don't use queue for alert checker to avoid delays
};

// Circuit breaker for alert checker to prevent infinite retries
let lastRateLimitTime = 0;
const RATE_LIMIT_COOLDOWN = 30 * 60 * 1000; // 30 minutes cooldown

// Mention configuration (same as webhook.js)
const MENTION_CONFIG = {
    TARGET_GROUP_ID: -1001354282618,
    CHOSEN_MEMBERS: [
        'KiNGViNU7',
        'Xeron888',
        'RemindMeOfThis',
        'austrianbae250',
        'ferno_x',
        'Ananthu_VB',
        'Oxshahid13',
        'unknownking7',
        'BeastIncarnate7'
    ]
};

// Helper functions for mentions (same as webhook.js)
function escapeUsername(username) {
    if (!username || typeof username !== 'string') return '';
    // For HTML mode (used in alerts), don't escape underscores as they're valid in usernames
    // Only escape characters that would break HTML parsing
    return username
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function createMentionText() {
    const validUsernames = MENTION_CONFIG.CHOSEN_MEMBERS
        .filter(username => {
            return username && 
                   typeof username === 'string' && 
                   username.trim() !== '' &&
                   !username.startsWith('username') &&
                   username.length <= 32 &&
                   /^[a-zA-Z0-9_]+$/.test(username);
        });
    
    if (validUsernames.length === 0) {
        console.warn('⚠️ No valid usernames found in MENTION_CONFIG.CHOSEN_MEMBERS');
        return '';
    }
    
    return validUsernames
        .map(username => `@${username}`) // Don't escape in HTML mode
        .join(' ');
}

function isValidMentionContext(chatId) {
    return parseInt(chatId) === MENTION_CONFIG.TARGET_GROUP_ID;
}

// Initialize Firebase (same as main bot)
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

// Price checking function (reuse from main bot)
async function getCoinDataWithChanges(symbol) {
    const priority = {
        btc: "bitcoin", eth: "ethereum", usdt: "tether", usdc: "usd-coin", 
        bnb: "binancecoin", xrp: "ripple", sol: "solana", doge: "dogecoin"
    };

    if (!symbol) return null;
    const s = String(symbol).toLowerCase().trim();
    if (!s) return null;

    let coinId = priority[s];
    try {
        if (!coinId) {
            const searchResponse = await makeRateLimitedAxiosRequest({
                method: 'get',
                url: "https://api.coingecko.com/api/v3/search",
                params: { query: s },
                timeout: 15000,
            }, ALERT_CHECKER_RATE_LIMIT_CONFIG);
            const bestMatch = searchResponse.data.coins.find(c => c.symbol.toLowerCase() === s);
            if (bestMatch) {
                coinId = bestMatch.id;
            }
        }

        if (!coinId) return null;

        const response = await makeRateLimitedAxiosRequest({
            method: 'get',
            url: "https://api.coingecko.com/api/v3/coins/markets",
            params: {
                vs_currency: "usd",
                ids: coinId,
                price_change_percentage: "1h,24h,7d,30d",
            },
            timeout: 15000,
        }, ALERT_CHECKER_RATE_LIMIT_CONFIG);
        
        return response.data.length > 0 ? response.data[0] : null;
    } catch (e) {
        // For alert checker, if we hit rate limits, record it and fail fast
        if (e.response && e.response.status === 429) {
            lastRateLimitTime = Date.now();
            console.error(`🚫 Rate limit hit for ${s} in alert checker - will skip next 30 minutes`);
        }
        console.error(`❌ getCoinDataWithChanges failed for ${s}:`, e.message);
        return null;
    }
}

async function checkPriceAlerts() {
    console.log('Checking price alerts...');
    
    // Circuit breaker: Skip if we hit rate limits recently
    const now = Date.now();
    if (lastRateLimitTime > 0 && (now - lastRateLimitTime) < RATE_LIMIT_COOLDOWN) {
        const remainingMinutes = Math.ceil((RATE_LIMIT_COOLDOWN - (now - lastRateLimitTime)) / (60 * 1000));
        console.log(`⏸️ Skipping alert check due to recent rate limiting. Resuming in ${remainingMinutes} minutes.`);
        return { checked: 0, triggered: 0, skipped: true };
    }
    
    try {
        const alertsSnapshot = await db.collection('price_alerts')
            .where('isActive', '==', true)
            .get();

        let triggeredCount = 0;
        
        for (const doc of alertsSnapshot.docs) {
            const alert = doc.data();
            
            // Get current price
            const coin = await getCoinDataWithChanges(alert.symbol);
            if (!coin) {
                console.log(`Could not get price for ${alert.symbol}`);
                continue;
            }
            
            const currentPrice = coin.current_price;
            console.log(`${alert.symbol.toUpperCase()}: $${currentPrice} (target: ${alert.condition} $${alert.targetPrice})`);
            
            // Check if condition is met
            let triggered = false;
            if (alert.condition === 'above' && currentPrice >= alert.targetPrice) {
                triggered = true;
            } else if (alert.condition === 'below' && currentPrice <= alert.targetPrice) {
                triggered = true;
            }
            
            if (triggered) {
                console.log(`ALERT TRIGGERED: ${alert.symbol} ${alert.condition} $${alert.targetPrice}`);
                
                // Send notification
                const priceChange1h = coin.price_change_percentage_1h_in_currency || 0;
                const emoji = priceChange1h >= 0 ? '🟢' : '🔴';
                const changeText = priceChange1h >= 0 ? `+${priceChange1h.toFixed(2)}%` : `${priceChange1h.toFixed(2)}%`;
                
                const usernameText = alert.username ? `@${alert.username}` : '';

const message = `🚨 <b>PRICE ALERT TRIGGERED</b>

${alert.symbol.toUpperCase()} is now ${alert.condition} $${alert.targetPrice.toLocaleString()}! ${usernameText}

<code>Current Price: $${currentPrice.toLocaleString()}</code>
<code>1H Change: ${emoji} ${changeText}</code>
<code>Market Cap: $${coin.market_cap ? (coin.market_cap / 1e9).toFixed(2) + 'B' : 'N/A'}</code>

Your alert has been automatically removed.`;

                try {
                    // FIXED: Use HTML instead of Markdown to avoid entity parsing errors
                    await axios.post(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
                        chat_id: parseInt(alert.chatId),
                        text: message,
                        parse_mode: 'HTML'
                    });
                    
                    // Deactivate alert
                    await doc.ref.update({ isActive: false });
                    triggeredCount++;
                    
                } catch (sendError) {
                    console.error('Failed to send alert:', sendError.message);
                }
            }
        }
        
        return { checked: alertsSnapshot.size, triggered: triggeredCount };
        
    } catch (error) {
        console.error('Error checking price alerts:', error.message);
        throw error;
    }
}

async function checkTimeReminders() {
    console.log('Checking time reminders...');
    
    try {
        const now = admin.firestore.Timestamp.now();
        const remindersSnapshot = await db.collection('time_reminders')
            .where('isActive', '==', true)
            .where('triggerTime', '<=', now)
            .get();

        let triggeredCount = 0;
        
        for (const doc of remindersSnapshot.docs) {
            const reminder = doc.data();
            
            console.log(`TIME REMINDER TRIGGERED: ${reminder.message}`);
            
            const usernameText = reminder.username ? `@${reminder.username}` : '';
            
            // ENHANCED: Handle @all mentions in reminder messages
            let processedMessage = reminder.message;
            let additionalMentions = '';
            
            // Check if reminder message contains @all and if we're in the right chat
            if (reminder.message.toLowerCase().includes('@all') && isValidMentionContext(reminder.chatId)) {
                // Use HTML mode since reminders are sent with HTML parse mode
                const mentionText = createMentionText('html');
                if (mentionText && mentionText.trim() !== '') {
                    // Remove @all from the message and add actual mentions
                    processedMessage = reminder.message.replace(/@all/gi, '').trim();
                    additionalMentions = `\n\n${mentionText}`;
                    console.log(`✅ Processing @all mention in reminder for chat ${reminder.chatId}`);
                } else {
                    console.log(`⚠️ No valid usernames for @all mention in reminder`);
                }
            }
            
            const message = `⏰ <b>REMINDER</b> 

${processedMessage}${additionalMentions}

Set By: ${usernameText}

<i>Set on: ${reminder.createdAt.toDate().toLocaleDateString()}</i>`;

            try {
                // FIXED: Use HTML instead of Markdown to avoid entity parsing errors
                await axios.post(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
                    chat_id: parseInt(reminder.chatId),
                    text: message,
                    parse_mode: 'HTML'
                });
                
                // Deactivate reminder
                await doc.ref.update({ isActive: false });
                triggeredCount++;
                
            } catch (sendError) {
                console.error('Failed to send reminder:', sendError.message);
            }
        }
        
        return { checked: remindersSnapshot.size, triggered: triggeredCount };
        
    } catch (error) {
        console.error('Error checking time reminders:', error.message);
        throw error;
    }
}

export default async function handler(req, res) {
    console.log('Alert checker started at:', new Date().toISOString());
    
    // Circuit breaker: Skip if we hit rate limits recently
    const now = Date.now();
    if (lastRateLimitTime > 0 && (now - lastRateLimitTime) < RATE_LIMIT_COOLDOWN) {
        const remainingMinutes = Math.ceil((RATE_LIMIT_COOLDOWN - (now - lastRateLimitTime)) / (60 * 1000));
        console.log(`⏸️ Skipping alert check due to recent rate limiting. Resuming in ${remainingMinutes} minutes.`);
        
        const summary = {
            success: true,
            skipped: true,
            reason: 'Rate limit cooldown',
            remainingMinutes: remainingMinutes,
            timestamp: new Date().toISOString()
        };
        
        res.status(200).json(summary);
        return;
    }
    
    try {
        const priceResults = await checkPriceAlerts();
        const timeResults = await checkTimeReminders();
        
        const summary = {
            success: true,
            timestamp: new Date().toISOString(),
            priceAlerts: priceResults,
            timeReminders: timeResults
        };
        
        console.log('Alert check completed:', summary);
        res.status(200).json(summary);
        
    } catch (error) {
        console.error('Alert checker error:', error.message);
        res.status(500).json({ 
            success: false, 
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
}
