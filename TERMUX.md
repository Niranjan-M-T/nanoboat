# Running NanoBot on Termux (Android)

NanoBot can run completely on your Android device using Termux. 

Since NanoBot uses a local SQLite database (`better-sqlite3`), which is a native C++ module, you must install the necessary build tools on Termux before installing the bot's dependencies.

## Prerequisites

1. Install **Termux** from F-Droid (do not use the Google Play version as it is deprecated).
2. Open Termux and run the following commands to update packages and install dependencies:

```bash
pkg update && pkg upgrade -y
pkg install -y git nodejs python make clang
```
*(Note: `python`, `make`, and `clang` are required to build the `better-sqlite3` database engine).*

## Installation

1. Clone the repository:
```bash
git clone https://github.com/Niranjan-M-T/nanoboat.git
cd nanoboat
```

2. Install Node.js dependencies:
```bash
npm install
```
*(This step might take a few minutes as `better-sqlite3` compiles its native C++ code for your device's architecture).*

3. Set up your environment variables:
```bash
cp .env.example .env
nano .env
```
Fill out `TELEGRAM_BOT_TOKEN`, `GOOGLE_AI_API_KEY`, and other required keys.

**Important for Ollama**: Since you are running the bot on your phone, but your Ollama instance is likely running on your PC, you MUST update the `OLLAMA_URL` in the `.env` file to point to your PC's local network IP (e.g., `192.168.x.x`):
```env
OLLAMA_URL=http://192.168.1.XX:11434/api/chat
```
*(Also ensure your PC's firewall allows inbound connections on port 11434, and Ollama is configured to listen on `0.0.0.0` by setting the environment variable `OLLAMA_HOST=0.0.0.0` on your PC).*

## Running the Bot

To start the bot, simply run:
```bash
npm start
```

### Keeping the Bot Alive in the Background

Android aggressive battery management will kill Termux if it's left in the background. To prevent this:

1. Request a wake lock in Termux (this keeps the CPU running):
```bash
termux-wake-lock
```
*(You should see a permanent notification in your Android shade saying Termux is holding a wake lock).*

2. **Disable Battery Optimization**: Go to your Android Settings -> Apps -> Termux -> Battery, and set it to **Unrestricted** (or disable battery optimization for Termux).

3. To keep the process running even if you close the Termux session artificially, you can use `pm2`:
```bash
npm install -g pm2
pm2 start src/index.js --name "nanobot"
pm2 save
```
