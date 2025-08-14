// setup-webhook.js - Run this ONCE after deployment
const axios = require('axios');

const BOT_TOKEN = 'YOUR_BOT_TOKEN_HERE';
const WEBHOOK_URL = 'https://your-project-name.vercel.app/api/webhook';

async function setupWebhook() {
  try {
    // Set webhook
    const response = await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/setWebhook`, {
      url: WEBHOOK_URL,
      allowed_updates: ['message']
    });

    if (response.data.ok) {
      console.log('✅ Webhook set successfully!');
      console.log('Webhook URL:', WEBHOOK_URL);
    } else {
      console.error('❌ Failed to set webhook:', response.data);
    }

    // Check webhook status
    const status = await axios.get(`https://api.telegram.org/bot${BOT_TOKEN}/getWebhookInfo`);
    console.log('📋 Webhook info:', status.data.result);

  } catch (error) {
    console.error('❌ Error setting webhook:', error.message);
  }
}

setupWebhook();

// Usage:
// 1. Replace YOUR_BOT_TOKEN_HERE with your actual bot token
// 2. Replace your-project-name with your Vercel project URL
// 3. Run: node setup-webhook.js
