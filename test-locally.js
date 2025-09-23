import express from 'express';
import webhookHandler from './api/webhook.js';

const app = express();
app.use(express.json());

// Test endpoint
app.post('/api/webhook', webhookHandler);
app.get('/test', (req, res) => {
    res.json({ status: 'Test server running!', timestamp: new Date().toISOString() });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Test server running on port ${PORT}`);
    console.log(`📱 Test endpoint: http://localhost:${PORT}/api/webhook`);
});