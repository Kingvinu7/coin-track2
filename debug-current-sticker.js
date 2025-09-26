import axios from 'axios';
import fs from 'fs';

async function debugCurrentStickerGeneration() {
    console.log('🔍 Debugging current sticker generation...');
    
    // Test the exact same payload structure that the webhook would create
    const simulatedMessage = {
        text: "Test message for debugging current sticker generation",
        from: {
            id: 123456789,
            first_name: "Test User",
            username: "testuser"
        }
    };
    
    console.log('🔄 Step 1: Simulating profile photo fetch...');
    // Simulate what getUserProfilePhotoUrl would return (likely null for most cases)
    const mainUserPhotoUrl = null; // Most likely scenario
    
    console.log('🔄 Step 2: Building payload with fallback avatar...');
    const payload = {
        messages: [{
            text: simulatedMessage.text,
            from: {
                id: simulatedMessage.from.id,
                name: simulatedMessage.from.first_name || 'Unknown User',
                username: simulatedMessage.from.username || null
            }
        }]
    };
    
    // Add fallback avatar (as the current code would do)
    if (mainUserPhotoUrl) {
        payload.messages[0].from.photo = mainUserPhotoUrl;
        payload.messages[0].from.avatar = mainUserPhotoUrl;
        payload.messages[0].from.avatar_url = mainUserPhotoUrl;
        console.log(`✅ Added real profile photo: ${mainUserPhotoUrl}`);
    } else {
        // Use fallback avatar (current implementation)
        const initial = (simulatedMessage.from.first_name || 'U').charAt(0).toUpperCase();
        const fallbackAvatar = `https://ui-avatars.com/api/?name=${initial}&size=150&background=0066cc&color=ffffff&bold=true`;
        payload.messages[0].from.photo = fallbackAvatar;
        payload.messages[0].from.avatar = fallbackAvatar;
        payload.messages[0].from.avatar_url = fallbackAvatar;
        console.log(`🎭 Using fallback avatar: ${fallbackAvatar}`);
    }
    
    console.log('📤 Final payload:');
    console.log(JSON.stringify(payload, null, 2));
    
    // Test both APIs
    const apiEndpoints = [
        { url: 'https://quotly.vercel.app/generate', name: 'Quotly', responseType: 'json' },
        { url: 'https://bot.lyo.su/quote/generate.webp', name: 'Lyo', responseType: 'arraybuffer' }
    ];
    
    for (const api of apiEndpoints) {
        console.log(`\\n🔄 Testing ${api.name}...`);
        
        try {
            // Format payload for quotly (like the webhook does)
            let apiPayload = payload;
            if (api.url.includes('quotly.vercel.app')) {
                apiPayload = {
                    ...payload,
                    messages: payload.messages.map(msg => {
                        const formattedMsg = {
                            text: msg.text,
                            from: {
                                id: msg.from.id,
                                name: msg.from.name,
                                username: msg.from.username
                            }
                        };
                        
                        // Add photo if available
                        const photoUrl = msg.from.photo || msg.from.avatar || msg.from.avatar_url;
                        if (photoUrl) {
                            formattedMsg.from.photo = photoUrl;
                            console.log(`📸 Added photo to ${api.name} payload: ${photoUrl}`);
                        }
                        
                        return formattedMsg;
                    })
                };
            }
            
            console.log(`📤 ${api.name} payload:`, JSON.stringify(apiPayload, null, 2));
            
            const response = await axios.post(api.url, apiPayload, {
                responseType: api.responseType,
                timeout: 15000,
                headers: {
                    'Content-Type': 'application/json'
                }
            });
            
            let imageBuffer;
            let success = false;
            
            if (api.responseType === 'json') {
                // Handle quotly response
                console.log(`📊 ${api.name} response structure:`, {
                    status: response.data.status,
                    hasData: !!response.data.data,
                    hasImage: !!response.data.data?.image,
                    imageLength: response.data.data?.image?.length
                });
                
                if (response.data.status && response.data.data && response.data.data.image) {
                    imageBuffer = Buffer.from(response.data.data.image, 'base64');
                    success = true;
                    console.log(`✅ ${api.name}: Generated image (${imageBuffer.length} bytes)`);
                } else {
                    console.error(`❌ ${api.name}: Invalid response structure`);
                    console.log('Full response:', response.data);
                }
            } else {
                // Handle binary response
                imageBuffer = Buffer.from(response.data);
                success = true;
                console.log(`✅ ${api.name}: Generated image (${imageBuffer.length} bytes)`);
            }
            
            if (success && imageBuffer) {
                // Validate image buffer
                console.log(`🔍 ${api.name} image validation:`);
                console.log(`- Buffer length: ${imageBuffer.length}`);
                console.log(`- First 16 bytes: ${Array.from(imageBuffer.slice(0, 16)).map(b => b.toString(16).padStart(2, '0')).join(' ')}`);
                
                // Check image format
                const isPNG = imageBuffer.slice(0, 8).toString('hex') === '89504e470d0a1a0a';
                const isWebP = imageBuffer.slice(0, 4).toString() === 'RIFF' && imageBuffer.slice(8, 12).toString() === 'WEBP';
                const isJPEG = imageBuffer.slice(0, 2).toString('hex') === 'ffd8';
                
                console.log(`- Image format: PNG=${isPNG}, WebP=${isWebP}, JPEG=${isJPEG}`);
                
                if (imageBuffer.length < 1000) {
                    console.warn(`⚠️ ${api.name}: Image seems very small, might be an error`);
                }
                
                // Save for inspection
                const filename = `debug_${api.name.toLowerCase()}_${Date.now()}.png`;
                fs.writeFileSync(filename, imageBuffer);
                console.log(`💾 Saved ${api.name} result to ${filename}`);
                
                // Test if this would work as a Telegram sticker
                console.log(`🎯 ${api.name} sticker compatibility:`);
                console.log(`- Size check: ${imageBuffer.length > 100 ? 'PASS' : 'FAIL'}`);
                console.log(`- Format check: ${(isPNG || isWebP || isJPEG) ? 'PASS' : 'FAIL'}`);
            }
            
        } catch (error) {
            console.error(`❌ ${api.name} failed:`, {
                status: error.response?.status,
                statusText: error.response?.statusText,
                data: error.response?.data?.toString?.() || error.response?.data,
                message: error.message
            });
        }
    }
}

// Test with different scenarios
async function testDifferentScenarios() {
    console.log('\\n🧪 Testing different scenarios...');
    
    const scenarios = [
        {
            name: 'Short message',
            text: 'Hi!'
        },
        {
            name: 'Long message',
            text: 'This is a very long message that should still work fine with the sticker generation system. Let me make it even longer to test how it handles extensive text content.'
        },
        {
            name: 'Message with emojis',
            text: 'Hello world! 🚀 🎉 💰 📈 🔥'
        },
        {
            name: 'Message with special characters',
            text: 'Testing @mentions #hashtags $symbols & other chars!'
        }
    ];
    
    for (const scenario of scenarios) {
        console.log(`\\n🔍 Testing scenario: ${scenario.name}`);
        console.log(`Text: "${scenario.text}"`);
        
        const testPayload = {
            messages: [{
                text: scenario.text,
                from: {
                    id: 123456789,
                    name: "Test User",
                    username: "testuser",
                    photo: "https://ui-avatars.com/api/?name=T&size=150&background=0066cc&color=ffffff&bold=true"
                }
            }]
        };
        
        try {
            const response = await axios.post('https://quotly.vercel.app/generate', testPayload, {
                responseType: 'json',
                timeout: 15000,
                headers: {
                    'Content-Type': 'application/json'
                }
            });
            
            if (response.data.status && response.data.data && response.data.data.image) {
                const imageBuffer = Buffer.from(response.data.data.image, 'base64');
                console.log(`✅ ${scenario.name}: Generated ${imageBuffer.length} bytes`);
            } else {
                console.error(`❌ ${scenario.name}: Failed to generate`);
                console.log('Response:', response.data);
            }
            
        } catch (error) {
            console.error(`❌ ${scenario.name}: Error -`, error.response?.status, error.message);
        }
    }
}

console.log('🚀 Starting comprehensive sticker generation debug...');
await debugCurrentStickerGeneration();
await testDifferentScenarios();
console.log('\\n🏁 Debug completed!');