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
    // Validate the key before saving
    if (!this.isValidApiKey(key)) {
      return { success: false, error: "Invalid API key" };
    }

    // Update the environment variable in memory for immediate use
    process.env.PPQ_API_KEY = key;

    // Persist all keys to file
    const result = this.saveAllKeysToEnvFile();
    if (!result.success) {
      return result;
    }

    return { success: true };
  }

  /**
   * Validates that a key is non-empty and doesn't contain placeholder values.
   */
  isValidApiKey(key) {
    if (typeof key !== "string") return false;
    const trimmed = key.trim();
    if (trimmed === "") return false;
    if (trimmed === "your_ppq_api_key_here") return false;
    return true;
  }

  /**
   * Escapes a value for safe inclusion in a .env file.
   * Handles special characters that could break parsing.
   */
  escapeEnvValue(value) {
    if (typeof value !== "string") return "";
    // If value contains special chars, wrap in double quotes and escape internal quotes
    if (/[\s"'`$\\=]/.test(value) || value.includes("\n")) {
      return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`;
    }
    return value;
  }

  createProductionEnvFile(apiKey) {
    try {
      const envPath = path.join(app.getPath("userData"), ".env");

      // Build env content with escaped values for safety
      let envContent = `# PPQ Voice Environment Variables
# This file was created automatically for production use
PPQ_API_KEY=${this.escapeEnvValue(apiKey)}
`;
      if (process.env.SUPABASE_URL) {
        envContent += `SUPABASE_URL=${this.escapeEnvValue(process.env.SUPABASE_URL)}\n`;
      }
      if (process.env.SUPABASE_PUBLISHABLE_KEY) {
        envContent += `SUPABASE_PUBLISHABLE_KEY=${this.escapeEnvValue(process.env.SUPABASE_PUBLISHABLE_KEY)}\n`;
      }
      if (process.env.SUPABASE_FUNCTIONS_BASE_URL) {
        envContent += `SUPABASE_FUNCTIONS_BASE_URL=${this.escapeEnvValue(process.env.SUPABASE_FUNCTIONS_BASE_URL)}\n`;
      }
      if (process.env.SUPABASE_LOG_FUNCTION_NAME) {
        envContent += `SUPABASE_LOG_FUNCTION_NAME=${this.escapeEnvValue(process.env.SUPABASE_LOG_FUNCTION_NAME)}\n`;
      }
      if (process.env.SUPABASE_LOG_TABLE) {
        envContent += `SUPABASE_LOG_TABLE=${this.escapeEnvValue(process.env.SUPABASE_LOG_TABLE)}\n`;
      }

      fs.writeFileSync(envPath, envContent, "utf8");

      require("dotenv").config({ path: envPath, override: true });

      return { success: true, path: envPath };
    } catch (error) {
      debugLogger.error("environment", "create-env-file-failed", {
        error: error.message,
        stack: error.stack,
      });
      return { success: false, error: error.message };
    }
  }

  saveAllKeysToEnvFile() {
    try {
      const envPath = path.join(app.getPath("userData"), ".env");

      // Build env content with all current keys (escaped for safety)
      let envContent = `# PPQ Voice Environment Variables
# This file was created automatically for production use
`;

      if (process.env.PPQ_API_KEY) {
        envContent += `PPQ_API_KEY=${this.escapeEnvValue(process.env.PPQ_API_KEY)}\n`;
      }
      if (process.env.SUPABASE_URL) {
        envContent += `SUPABASE_URL=${this.escapeEnvValue(process.env.SUPABASE_URL)}\n`;
      }
      if (process.env.SUPABASE_PUBLISHABLE_KEY) {
        envContent += `SUPABASE_PUBLISHABLE_KEY=${this.escapeEnvValue(process.env.SUPABASE_PUBLISHABLE_KEY)}\n`;
      }
      if (process.env.SUPABASE_FUNCTIONS_BASE_URL) {
        envContent += `SUPABASE_FUNCTIONS_BASE_URL=${this.escapeEnvValue(process.env.SUPABASE_FUNCTIONS_BASE_URL)}\n`;
      }
      if (process.env.SUPABASE_LOG_FUNCTION_NAME) {
        envContent += `SUPABASE_LOG_FUNCTION_NAME=${this.escapeEnvValue(process.env.SUPABASE_LOG_FUNCTION_NAME)}\n`;
      }
      if (process.env.SUPABASE_LOG_TABLE) {
        envContent += `SUPABASE_LOG_TABLE=${this.escapeEnvValue(process.env.SUPABASE_LOG_TABLE)}\n`;
      }

      fs.writeFileSync(envPath, envContent, "utf8");

      // Reload the env file
      require("dotenv").config({ path: envPath, override: true });

      return { success: true, path: envPath };
    } catch (error) {
      debugLogger.error("environment", "save-env-file-failed", {
        error: error.message,
        stack: error.stack,
      });
      return { success: false, error: error.message };
    }
  }
}

module.exports = EnvironmentManager;
