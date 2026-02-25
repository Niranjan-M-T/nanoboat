# How to Run Nanobot on Android via Termux

You can easily run the Nanobot backend directly on your Android phone using Termux! This allows the bot to run 24/7 in your pocket without needing your laptop turned on.

## Prerequisites
1. Download **Termux** from F-Droid (Do *not* download from the Google Play Store, the Play Store version is outdated and broken).
2. Ensure you have at least 1GB of free storage on your phone.

## Step 1: Install Dependencies
Open Termux and run the following commands to update the package list and install Node.js, Git, and SQLite:

```bash
pkg update && pkg upgrade -y
pkg install nodejs git sqlite build-essential python -y
```

## Step 2: Clone Your Repository 
Clone your Nanobot project directory into Termux. (If your code is on GitHub, use `git clone`). Otherwise, you can transfer your project folder from your PC to your phone's storage.

```bash
# Allow Termux to read your phone's storage
termux-setup-storage

# Navigate to where you copied the project folder
cd ~/storage/downloads/nanobot
# Or clone it from github: git clone https://github.com/your-username/nanobot.git
```

## Step 3: Configure Puppeteer for Android
The `whatsapp-web.js` library uses Puppeteer (a headless browser). By default, it tries to download a desktop version of Chromium which will fail on Android. 
You must install the Termux version of Chromium and tell Puppeteer to use it.

```bash
pkg install chromium -y

# Tell Puppeteer to skip downloading desktop Chromium
export PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
export PUPPETEER_EXECUTABLE_PATH=$(which chromium)
```
*(Tip: Add those two `export` lines to your `~/.bashrc` so you don't have to type them every time you open Termux).*

## Step 4: Install Project Packages
Now run the standard NPM install command.
```bash
npm install
```

## Step 5: Transfer your Database and Data (Crucial)
To avoid having to scan the WhatsApp QR code again or losing your whitelists:
1. Copy the `data/` folder from your PC to the `data/` folder in Termux.
2. Ensure `nanobot.db`, `whatsapp-session/`, `whitelist.json`, and `relations.json` are properly copied over.

## Step 6: Run the Bot!
Finally, start the bot exactly like you do on your PC:
```bash
npm start
```

## Keeping it Running in the Background
Android will try to kill Termux if you put it in the background to save battery:
1. Pull down your notification shade.
2. Tap the Termux notification and select **"Acquire wakelock"**.
3. Go to your Android Settings -> Apps -> Termux -> Battery, and set it to **"Unrestricted"**.
