import admin from 'firebase-admin';
import axios from 'axios';

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
            const searchResponse = await axios.get("https://api.coingecko.com/api/v3/search", {
                params: { query: s },
                timeout: 15000,
            });
            const bestMatch = searchResponse.data.coins.find(c => c.symbol.toLowerCase() === s);
            if (bestMatch) {
                coinId = bestMatch.id;
            }
        }

        if (!coinId) return null;

        const response = await axios.get("https://api.coingecko.com/api/v3/coins/markets", {
            params: {
                vs_currency: "usd",
                ids: coinId,
                price_change_percentage: "1h,24h,7d,30d",
            },
            timeout: 15000,
        });
        
        return response.data.length > 0 ? response.data[0] : null;
    } catch (e) {
        console.error(`Failed to get coin data for ${s}:`, e.message);
        return null;
    }
}

async function checkPriceAlerts() {
    console.log('Checking price alerts...');
    
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
                
                const message = `🚨 **PRICE ALERT TRIGGERED**

${alert.symbol.toUpperCase()} is now ${alert.condition} $${alert.targetPrice.toLocaleString()}!

\`Current Price: $${currentPrice.toLocaleString()}\`
\`1H Change: ${emoji} ${changeText}\`
\`Market Cap: $${coin.market_cap ? (coin.market_cap / 1e9).toFixed(2) + 'B' : 'N/A'}\`

Your alert has been automatically removed.`;

                try {
                    await axios.post(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
                        chat_id: parseInt(alert.chatId),
                        text: message,
                        parse_mode: 'Markdown'
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
            
            const message = `⏰ **REMINDER**

${reminder.message}

*Set on: ${reminder.createdAt.toDate().toLocaleDateString()}*`;

            try {
                await axios.post(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
                    chat_id: parseInt(reminder.chatId),
                    text: message,
                    parse_mode: 'Markdown'
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
