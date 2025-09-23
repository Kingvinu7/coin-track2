// Test the reminder time parsing logic
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

// Test cases
const testCases = [
    "3pm",
    "9:30am", 
    "11:45pm",
    "15:30",
    "09:15",
    "23:45",
    "25:00", // Invalid
    "invalid"
];

console.log("🧪 Testing Reminder Time Parsing:");
console.log("================================");

testCases.forEach(testTime => {
    const result = parseTimeToIST(testTime);
    if (result) {
        const istDate = new Date(result.getTime() + (5.5 * 60 * 60 * 1000));
        const timeStr12 = istDate.toLocaleTimeString('en-IN', { 
            hour: 'numeric', 
            minute: '2-digit',
            hour12: true 
        });
        console.log(`✅ "${testTime}" -> ${timeStr12} IST (${istDate.toLocaleDateString('en-IN')})`);
    } else {
        console.log(`❌ "${testTime}" -> Invalid format`);
    }
});

console.log("\n🔍 Testing Regex Pattern:");
const testMessages = [
    '/remind "check portfolio" 3pm',
    '/remind "buy the dip" 9:30am',
    '/remind "hello world" 15:30',
    '/remind "invalid format" tomorrow',
    '/remind "missing quotes" 3pm'
];

testMessages.forEach(msg => {
    const match = msg.match(/\/remind\s+"([^"]+)"\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/i);
    if (match) {
        console.log(`✅ "${msg}" -> Message: "${match[1]}", Time: "${match[2]}"`);
    } else {
        console.log(`❌ "${msg}" -> No match`);
    }
});