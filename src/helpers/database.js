const Database = require("better-sqlite3");
const fs = require("fs");
const debugLogger = require("./debugLogger");
const DbPathManager = require("../utils/DbPathManager");

class DatabaseManager {
  constructor() {
    this.db = null;
    this.initDatabase();
  }

  initDatabase() {
    try {
      const dbPath = DbPathManager.getDbPath();
      const dbFileName = DbPathManager.getDbFileName();

      this.db = new Database(dbPath);

      this.db.exec(`
        CREATE TABLE IF NOT EXISTS transcriptions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          text TEXT NOT NULL,
          timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      debugLogger.logEvent("database", "initialized", {
        dbFile: dbFileName,
        dbPath,
      });

      return true;
    } catch (error) {
      debugLogger.error("database", "init-failed", {
        error: error.message,
      });
      throw error;
    }
  }

  saveTranscription(text) {
    try {
      if (!this.db) {
        throw new Error("Database not initialized");
      }
      const content = typeof text === "string" ? text.trim() : "";
      const stmt = this.db.prepare(
        "INSERT INTO transcriptions (text) VALUES (?)",
      );
      const result = stmt.run(content);
      const inserted = this.db
        .prepare("SELECT * FROM transcriptions WHERE id = ?")
        .get(result.lastInsertRowid);

      debugLogger.logEvent("database", "transcription-saved", {
        id: result.lastInsertRowid,
        textLength: content.length,
      });

      return {
        id: result.lastInsertRowid,
        success: true,
        transcription: inserted,
      };
    } catch (error) {
      debugLogger.error("database", "save-failed", {
        error: error.message,
      });
      throw error;
    }
  }

  getTranscriptions(limit = 50) {
    try {
      if (!this.db) {
        throw new Error("Database not initialized");
      }
      const stmt = this.db.prepare(
        "SELECT * FROM transcriptions ORDER BY timestamp DESC LIMIT ?",
      );
      const transcriptions = stmt.all(limit);
      debugLogger.logEvent("database", "transcriptions-loaded", {
        limit,
        resultCount: transcriptions.length,
      });
      return transcriptions;
    } catch (error) {
      debugLogger.error("database", "load-failed", {
        error: error.message,
      });
      throw error;
    }
  }

  clearTranscriptions() {
    try {
      if (!this.db) {
        throw new Error("Database not initialized");
      }
      const stmt = this.db.prepare("DELETE FROM transcriptions");
      const result = stmt.run();
      debugLogger.logEvent("database", "transcriptions-cleared", {
        cleared: result.changes,
      });
      return { cleared: result.changes, success: true };
    } catch (error) {
      debugLogger.error("database", "clear-failed", {
        error: error.message,
      });
      throw error;
    }
  }

  deleteTranscription(id) {
    try {
      if (!this.db) {
        throw new Error("Database not initialized");
      }
      const stmt = this.db.prepare("DELETE FROM transcriptions WHERE id = ?");
      const result = stmt.run(id);
      debugLogger.logEvent("database", "transcription-deleted", {
        id,
        affectedRows: result.changes,
      });
      return { success: result.changes > 0, id };
    } catch (error) {
      debugLogger.error("database", "delete-failed", {
        id,
        error: error.message,
      });
      throw error;
    }
  }

  close() {
    if (!this.db) {
      return;
    }

    try {
      this.db.close();
    } catch (error) {
      debugLogger.error("database", "close-failed", {
        error: error.message,
      });
    } finally {
      this.db = null;
    }
  }

  deleteDatabaseFiles() {
    const dbPath = DbPathManager.getDbPath();
    const relatedFiles = [
      dbPath,
      `${dbPath}-wal`,
      `${dbPath}-shm`,
      `${dbPath}-journal`,
    ];

    relatedFiles.forEach((filePath) => {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    });

    return dbPath;
  }

  cleanup() {
    debugLogger.logEvent("database", "cleanup-start");
    try {
      this.close();
      const dbPath = this.deleteDatabaseFiles();
      debugLogger.logEvent("database", "cleanup-complete", {
        dbPath,
      });
    } catch (error) {
      debugLogger.error("database", "cleanup-failed", {
        error: error.message,
      });
    }
  }
}

module.exports = DatabaseManager;
