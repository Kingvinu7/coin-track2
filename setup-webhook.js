// setup-webhook.js - Fixed version
import axios from 'axios';


// Get token and URL from command line arguments (SECURE METHOD)
const BOT_TOKEN = process.argv[2];
const VERCEL_URL = process.argv[3];

if (!BOT_TOKEN || !VERCEL_URL) {
  console.log('❌ Usage: node setup-webhook.js <BOT_TOKEN> <VERCEL_URL>');
  console.log('📝 Example: node setup-webhook.js "1234:ABC..." "https://coin-track-lilac.vercel.app"');
  process.exit(1);
}

const WEBHOOK_URL = `${VERCEL_URL}/api/webhook`;

async function setupWebhook() {
  try {
    console.log('🔗 Setting webhook to:', WEBHOOK_URL);
    
    // First, test if the webhook endpoint exists
    console.log('🧪 Testing webhook endpoint...');
    try {
      await axios.get(WEBHOOK_URL);
      console.log('✅ Webhook endpoint is accessible');
    } catch (testError) {
      console.log('⚠️ Webhook endpoint test failed - but continuing anyway');
      console.log('   This might be normal if your endpoint only accepts POST requests');
    }
    
    // Set webhook
    const response = await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/setWebhook`, {
      url: WEBHOOK_URL,
      allowed_updates: ['message']
    });

    if (response.data.ok) {
      console.log('✅ Webhook set successfully!');
      console.log('🎉 Your bot is now live 24/7!');
    } else {
      console.error('❌ Failed to set webhook:', response.data);
    }

    // Check webhook status
    const status = await axios.get(`https://api.telegram.org/bot${BOT_TOKEN}/getWebhookInfo`);
    console.log('📋 Webhook info:', status.data.result);

  } catch (error) {
    console.error('❌ Error setting webhook:', error.message);
    if (error.response) {
      console.error('Response data:', error.response.data);
      console.error('Response status:', error.response.status);
    }
  }
}

setupWebhook();
