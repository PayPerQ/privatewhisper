const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { app } = require("electron");
const {
  uniqueNamesGenerator,
  adjectives,
  colors,
  animals,
} = require("unique-names-generator");
const debugLogger = require("./debugLogger");

class EnvironmentManager {
  constructor() {
    this.loadEnvironmentVariables();
    this._settingsPath = null;
    this._userIdentity = null;
  }

  /**
   * Returns the path to the persisted settings JSON file in userData.
   * Settings here are readable by the main process at startup (unlike
   * renderer localStorage which isn't available until the window loads).
   */
  getSettingsPath() {
    if (!this._settingsPath) {
      this._settingsPath = path.join(app.getPath("userData"), "settings.json");
    }
    return this._settingsPath;
  }

  /**
   * Read persisted main-process settings (transcriptionProvider, parakeetModel, etc.).
   * Returns an empty object if the file doesn't exist or is corrupt.
   */
  readPersistedSettings() {
    try {
      const raw = fs.readFileSync(this.getSettingsPath(), "utf8");
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }

  /**
   * Merge new key/value pairs into the persisted settings file.
   */
  savePersistedSettings(updates) {
    try {
      const current = this.readPersistedSettings();
      const merged = { ...current, ...updates };
      fs.writeFileSync(this.getSettingsPath(), JSON.stringify(merged, null, 2), "utf8");
      return { success: true };
    } catch (error) {
      debugLogger.error("environment", "save-persisted-settings-failed", {
        error: error.message,
      });
      return { success: false, error: error.message };
    }
  }

  /**
   * Returns a stable, anonymous identity for this installation:
   *   { userUuid, userLabel }
   * - userUuid  : a random UUID — the guaranteed-unique key for joins/grouping.
   * - userLabel : a memorable "adjective-color-animal" petname (e.g.
   *               "barking-red-cat") for human-friendly dashboard reading.
   *
   * Generated once on first use and persisted to settings.json under userData,
   * so it stays stable across restarts and app updates. It is NOT derived from
   * the PPQ API key or any account data — a reinstall (or wiped userData)
   * produces a new identity, and the same person on two machines counts twice.
   */
  getUserIdentity() {
    if (this._userIdentity) {
      return this._userIdentity;
    }

    const persisted = this.readPersistedSettings();
    let { userUuid, userLabel } = persisted;

    const needsUuid = typeof userUuid !== "string" || !userUuid.trim();
    const needsLabel = typeof userLabel !== "string" || !userLabel.trim();

    if (needsUuid) {
      userUuid = crypto.randomUUID();
    }
    if (needsLabel) {
      // Append a short token so collisions between identical petnames are
      // astronomically unlikely while keeping it readable.
      const petname = uniqueNamesGenerator({
        dictionaries: [adjectives, colors, animals],
        separator: "-",
        length: 3,
      });
      const token = userUuid.slice(0, 4);
      userLabel = `${petname}-${token}`;
    }

    if (needsUuid || needsLabel) {
      this.savePersistedSettings({ userUuid, userLabel });
    }

    this._userIdentity = { userUuid, userLabel };
    return this._userIdentity;
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
      let envContent = `# Private Whisper Environment Variables
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
      let envContent = `# Private Whisper Environment Variables
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
