const fs = require("fs");
const path = require("path");

console.log("Setting up PPQ Voice...");

const envTemplate = `# PPQ Voice Environment Variables
# Required: PPQ API key for transcription + clean-up
PPQ_API_KEY=your_ppq_api_key_here

# Optional: Verbose logging toggle
PPQVOICE_DEBUG=false`;

if (!fs.existsSync(".env")) {
  fs.writeFileSync(".env", envTemplate);
  console.log("✅ Created .env file template");
} else {
  console.log("⚠️  .env file already exists");
}

console.log(`
🎉 Setup complete!

Next steps:
1. Add your PPQ API key to the .env file
2. Install dependencies: npm install
3. Run the app: npm start

Features enabled immediately:
- Global hotkey (default: backtick \`) that you can remap in the Control Panel
- Floating dictation panel you can drag anywhere
- Automatic paste at the cursor the moment text is ready

Just grant microphone + accessibility permissions when prompted and you're good to go.`);
