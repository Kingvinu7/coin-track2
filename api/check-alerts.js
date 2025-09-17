export default async function handler(req, res) {
    console.log('Alert checker endpoint hit:', new Date().toISOString());
    
    res.status(200).json({
        message: "Alert checker is working!",
        timestamp: new Date().toISOString(),
        method: req.method
    });
}
