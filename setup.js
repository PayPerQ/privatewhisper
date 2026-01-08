const fs = require("fs");
const path = require("path");

console.log("Setting up PPQ Voice...");

const envTemplate = `# PPQ Voice Environment Variables
# Required: PPQ API key for transcription + clean-up
PPQ_API_KEY=your_ppq_api_key_here

# Optional: Supabase logging (Edge Function)
SUPABASE_URL=your_supabase_url_here
SUPABASE_PUBLISHABLE_KEY=your_supabase_publishable_key_here
SUPABASE_FUNCTIONS_BASE_URL=https://your-project-ref.functions.supabase.co
SUPABASE_LOG_FUNCTION_NAME=voice-logs
SUPABASE_LOG_TABLE=voice_pipeline_logs

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
