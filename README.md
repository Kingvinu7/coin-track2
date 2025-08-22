# വില പരിശോധകൻ - The Crypto Price Bot miniapp in Farcaster 

വില പരിശോധകൻ (Vila Parisōdhakan), which translates to "Price Inspector" in Malayalam, is a powerful and versatile Telegram bot designed to provide real-time cryptocurrency information, price charts, and general crypto knowledge. Built using Node.js and deployed on Vercel, it leverages multiple APIs to deliver accurate and up-to-date data.

The bot is designed to be efficient, responding only to specific commands  and keep group chats tidy.

## 🚀 Features

* **Real-time Crypto Prices:** Get the current price, market cap, and trading volume for hundreds of cryptocurrencies by simply typing the symbol (e.g., `btc`, `eth`).
* **Token Address Lookup:** Query real-time price and liquidity data for any token on major blockchains (Ethereum, Solana, BSC) by pasting its contract address. The bot uses **DexScreener** for this.
* **Crypto Calculator:** Instantly calculate the value of your holdings (e.g., `2 eth`, `5000 doge`).
* **Interactive Price Charts:** Generate and send 30-day price charts for any coin with a simple command (e.g., `/chart btc`).
* **Ethereum Gas Price:** Get live Ethereum gas prices (Slow, Average, Fast) and their equivalent USD cost with the `/gas` command.
* **Market Cap Comparison:** Compare the theoretical price of one coin if it had the market cap of another (e.g., `/compare shib eth`).
* **Community Leaderboard:** Track the most profitable token addresses searched by users in your group and see who the "Token Lord" is.
* **AI-Powered Knowledge:** Ask general crypto questions using the `/que` command, and the bot will provide a detailed, AI-generated response. The bot's AI persona is set to "വില പരിശോധകൻ."

## ⚙️ How to Deploy

To get your own version of വില പരിശോധകൻ up and running, follow these steps.

### Prerequisites

* A **Telegram Bot Token** (from BotFather).
* A **Vercel** account (free tier is sufficient).
* A **CoinGecko API Key** (or use the free public API).
* A **Firebase Project** for the leaderboard feature.
* A **Google Generative AI API Key** for the `/ask` feature.

### 1. Set Up Your Project

1.  Clone this repository or create a new project on Vercel and import your code.
2.  Set up your Firebase project and download the service account key.
3.  Go to your Vercel project's dashboard and navigate to **Settings > Environment Variables**.

### 2. Configure Environment Variables

You must add the following variables:

| Name                        | Description                                                                                             |
| --------------------------- | ------------------------------------------------------------------------------------------------------- |
| `TELEGRAM_BOT_TOKEN`        | Your unique token from BotFather.                                                                       |
| `FIREBASE_SERVICE_ACCOUNT`  | The JSON content of your Firebase service account key. Paste the entire content as a single line.       |
| `GOOGLE_API_KEY`            | Your API key for the Google Generative AI models.                                                       |
| `ETHERSCAN_API_KEY`         | (Optional) Your API key from Etherscan for the `/gas` command.                                          |

### 3. Deploy and Set Webhook

1.  After adding the variables, deploy your project on Vercel.
2.  Once deployed, copy your Vercel deployment URL (e.g., `https://your-project.vercel.app/`).
3.  Set your Telegram webhook by visiting the following URL in your browser, replacing the placeholders with your actual values:

    `https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook?url=https://<YOUR_VERCEL_URL>/api/handler`

    Example: `https://api.telegram.org/bot12345:ABCDEF/setWebhook?url=https://my-crypto-bot.vercel.app/api/handler`

4.  If successful, you will see a confirmation message from the Telegram API.

You can now invite the bot to your Telegram groups and start using it!

## 🤖 Commands

* `/que [question]` - Ask the bot any general crypto-related question or anything 
* `[symbol]` - Get real-time price info (e.g., `btc`, `sol`, `ton`).
* `[amount] [symbol]` - Calculate the value of a holding (e.g., `2 eth`, `1000 doge`).
* `[contract address]` - Get price and liquidity data for a token from DexScreener.
* `/chart [symbol]` - Generate a 30-day price chart.
* `/gas` - Get the latest Ethereum gas prices.
* `/compare [symbol1] [symbol2]` - See the theoretical price of `symbol1` if it had `symbol2`'s market cap.
* `/leaderboard` - See the top performing token finders in your group.
* `/help` - Displays a list of available commands.
* `/test` - Checks the bot's status and connection.

