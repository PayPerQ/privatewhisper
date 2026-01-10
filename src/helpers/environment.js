const path = require("path");
const fs = require("fs");
const { app } = require("electron");
const debugLogger = require("./debugLogger");

class EnvironmentManager {
  constructor() {
    this.loadEnvironmentVariables();
  }

  loadEnvironmentVariables() {
    const dotenv = require("dotenv");

    // In production, try multiple locations for .env file
    const possibleEnvPaths = [
      // Development path (project root)
      path.join(__dirname, "..", "..", ".env"),
      // Production packaged app paths
      path.join(process.resourcesPath, ".env"),
      path.join(process.resourcesPath, "app.asar.unpacked", ".env"),
      // Legacy paths
      path.join(process.resourcesPath, "app", ".env"),
    ];

    // Add user data directory path if app is available
    let userDataEnvPath = null;
    if (app && app.getPath) {
      try {
        userDataEnvPath = path.join(app.getPath("userData"), ".env");
      } catch (error) {
        // App not ready yet, skip user data path
      }
    }

    let envLoaded = false;

    for (const envPath of possibleEnvPaths) {
      try {
        if (fs.existsSync(envPath)) {
          const result = dotenv.config({ path: envPath });
          if (!result.error) {
            envLoaded = true;
            break;
          }
        }
      } catch (error) {
        // Continue to next path
      }
    }

    if (userDataEnvPath) {
      try {
        if (fs.existsSync(userDataEnvPath)) {
          const result = dotenv.config({
            path: userDataEnvPath,
            override: true,
          });
          if (!result.error) {
            envLoaded = true;
          }
        }
      } catch (error) {
        // Continue without user data overrides
      }
    }

    // Re-evaluate debug mode after env vars are loaded
    debugLogger.refreshDebugMode();
  }

  getPPQApiKey() {
    return process.env.PPQ_API_KEY || "";
  }

  getSupabaseConfig() {
    return {
      url: process.env.SUPABASE_URL || "",
      publishableKey: process.env.SUPABASE_PUBLISHABLE_KEY || "",
      logTable: process.env.SUPABASE_LOG_TABLE || "voice_pipeline_logs",
      functionsBaseUrl: process.env.SUPABASE_FUNCTIONS_BASE_URL || "",
      logFunctionName: process.env.SUPABASE_LOG_FUNCTION_NAME || "voice-logs",
    };
  }

  savePPQApiKey(key) {
    // Update the environment variable in memory for immediate use
    process.env.PPQ_API_KEY = key;
    // Persist all keys to file
    this.saveAllKeysToEnvFile();
    return { success: true };
  }

  createProductionEnvFile(apiKey) {
    const envPath = path.join(app.getPath("userData"), ".env");

    const envContent = `# PPQ Voice Environment Variables
# This file was created automatically for production use
PPQ_API_KEY=${apiKey}
${process.env.SUPABASE_URL ? `SUPABASE_URL=${process.env.SUPABASE_URL}\n` : ""}${process.env.SUPABASE_PUBLISHABLE_KEY ? `SUPABASE_PUBLISHABLE_KEY=${process.env.SUPABASE_PUBLISHABLE_KEY}\n` : ""}${process.env.SUPABASE_FUNCTIONS_BASE_URL ? `SUPABASE_FUNCTIONS_BASE_URL=${process.env.SUPABASE_FUNCTIONS_BASE_URL}\n` : ""}${process.env.SUPABASE_LOG_FUNCTION_NAME ? `SUPABASE_LOG_FUNCTION_NAME=${process.env.SUPABASE_LOG_FUNCTION_NAME}\n` : ""}${process.env.SUPABASE_LOG_TABLE ? `SUPABASE_LOG_TABLE=${process.env.SUPABASE_LOG_TABLE}\n` : ""}
`;

    fs.writeFileSync(envPath, envContent, "utf8");

    require("dotenv").config({ path: envPath, override: true });

    return { success: true, path: envPath };
  }

  saveAllKeysToEnvFile() {
    const envPath = path.join(app.getPath("userData"), ".env");

    // Build env content with all current keys
    let envContent = `# PPQ Voice Environment Variables
# This file was created automatically for production use
`;

    if (process.env.PPQ_API_KEY) {
      envContent += `PPQ_API_KEY=${process.env.PPQ_API_KEY}\n`;
    }
    if (process.env.SUPABASE_URL) {
      envContent += `SUPABASE_URL=${process.env.SUPABASE_URL}\n`;
    }
    if (process.env.SUPABASE_PUBLISHABLE_KEY) {
      envContent += `SUPABASE_PUBLISHABLE_KEY=${process.env.SUPABASE_PUBLISHABLE_KEY}\n`;
    }
    if (process.env.SUPABASE_FUNCTIONS_BASE_URL) {
      envContent += `SUPABASE_FUNCTIONS_BASE_URL=${process.env.SUPABASE_FUNCTIONS_BASE_URL}\n`;
    }
    if (process.env.SUPABASE_LOG_FUNCTION_NAME) {
      envContent += `SUPABASE_LOG_FUNCTION_NAME=${process.env.SUPABASE_LOG_FUNCTION_NAME}\n`;
    }
    if (process.env.SUPABASE_LOG_TABLE) {
      envContent += `SUPABASE_LOG_TABLE=${process.env.SUPABASE_LOG_TABLE}\n`;
    }

    fs.writeFileSync(envPath, envContent, "utf8");

    // Reload the env file
    require("dotenv").config({ path: envPath, override: true });

    return { success: true, path: envPath };
  }
}

module.exports = EnvironmentManager;
