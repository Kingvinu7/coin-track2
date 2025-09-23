# Testing Guide for IST Reminder Feature

## 🧪 Testing Optionss

### Option 1: Create Test Bot (Recommended)
1. **Create test bot:**
   - Go to [@BotFather](https://t.me/botfather)
   - Send `/newbot`
   - Name: "YourBot Test" 
   - Get the test token

2. **Deploy to test environment:**
   - Update your environment variables with test bot token
   - Deploy to Vercel or your hosting platform
   - Set webhook URL for test bot

### Option 2: Local Testing with ngrok
```bash
# Install ngrok if not installed
npm install -g ngrok

# Start local server
node test-locally.js

# In another terminal, expose local server
ngrok http 3000

# Use the ngrok URL as webhook for your test bot
```

### Option 3: Unit Testing (Already Done ✅)
```bash
node test-reminder-logic.js
```

## 🔍 Test Cases to Verify

### 1. Time Format Testing
Test these commands in your bot:

```
/remind "test 12hr format" 3pm
/remind "test 12hr with minutes" 9:30am  
/remind "test 24hr format" 15:30
/remind "test 24hr no minutes" 09
/remind "test midnight" 12am
/remind "test noon" 12pm
```

**Expected Results:**
- All should be accepted and scheduled correctly in IST
- Times in the past should be scheduled for tomorrow
- Confirmation message should show IST time

### 2. Invalid Format Testing
```
/remind "should fail" tomorrow
/remind "should fail" 25:00
/remind "should fail" 13pm
/remind missing quotes 3pm
```

**Expected Results:**
- Should show usage instructions
- Should not create reminders

### 3. Mention Testing
1. Set a reminder for 1-2 minutes in the future
2. Wait for it to trigger
3. Verify the reminder message includes `@yourusername`

### 4. IST Timezone Testing
- Set reminder for current time + 5 minutes
- Verify it triggers at correct IST time
- Check that times are displayed in IST format

## 📋 Test Checklist

- [ ] 12-hour format (3pm, 9:30am) works
- [ ] 24-hour format (15:30, 09:15) works  
- [ ] Invalid formats show error messages
- [ ] Times in past are scheduled for tomorrow
- [ ] Confirmation shows correct IST time
- [ ] Reminder triggers at correct time
- [ ] Reminder message includes @mention
- [ ] Help command shows updated format
- [ ] Other bot features still work (alerts, crypto prices)

## 🚀 Quick Test Commands

```bash
# Test the parsing logic
node test-reminder-logic.js

# Test locally (if you have the server setup)
curl -X POST http://localhost:3000/api/webhook \
  -H "Content-Type: application/json" \
  -d '{"message": {"text": "/remind \"test\" 3pm", "from": {"id": 123, "username": "testuser"}, "chat": {"id": 123}}}'
```

## 🔧 Debugging

If something doesn't work:
1. Check server logs for errors
2. Verify environment variables are set
3. Test with `/test` command to ensure bot is responding
4. Check Firebase connection for reminder storage

## 📱 Production Deployment

Once testing is complete:
```bash
git checkout main
git merge feature/ist-reminder-format
git push origin main
# Deploy to production
```
