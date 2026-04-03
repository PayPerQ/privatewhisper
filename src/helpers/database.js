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

      this.db.exec(`
        CREATE TABLE IF NOT EXISTS dictionary (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          term TEXT NOT NULL UNIQUE,
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

  getDictionary() {
    try {
      if (!this.db) {
        throw new Error("Database not initialized");
      }
      const stmt = this.db.prepare(
        "SELECT * FROM dictionary ORDER BY created_at DESC",
      );
      const terms = stmt.all();
      debugLogger.logEvent("database", "dictionary-loaded", {
        resultCount: terms.length,
      });
      return terms;
    } catch (error) {
      debugLogger.error("database", "dictionary-load-failed", {
        error: error.message,
      });
      throw error;
    }
  }

  addDictionaryTerm(term) {
    try {
      if (!this.db) {
        throw new Error("Database not initialized");
      }
      const content = typeof term === "string" ? term.trim() : "";
      if (!content) {
        return { success: false, error: "Empty term" };
      }
      const stmt = this.db.prepare(
        "INSERT OR IGNORE INTO dictionary (term) VALUES (?)",
      );
      const result = stmt.run(content);

      if (result.changes === 0) {
        // Term already exists
        const existing = this.db
          .prepare("SELECT * FROM dictionary WHERE term = ?")
          .get(content);
        return { success: true, term: existing, duplicate: true };
      }

      const inserted = this.db
        .prepare("SELECT * FROM dictionary WHERE id = ?")
        .get(result.lastInsertRowid);

      debugLogger.logEvent("database", "dictionary-term-added", {
        id: result.lastInsertRowid,
        term: content,
      });

      return { success: true, term: inserted };
    } catch (error) {
      debugLogger.error("database", "dictionary-add-failed", {
        error: error.message,
      });
      throw error;
    }
  }

  removeDictionaryTerm(id) {
    try {
      if (!this.db) {
        throw new Error("Database not initialized");
      }
      const stmt = this.db.prepare("DELETE FROM dictionary WHERE id = ?");
      const result = stmt.run(id);
      debugLogger.logEvent("database", "dictionary-term-removed", {
        id,
        affectedRows: result.changes,
      });
      return { success: result.changes > 0, id };
    } catch (error) {
      debugLogger.error("database", "dictionary-remove-failed", {
        id,
        error: error.message,
      });
      throw error;
    }
  }

  addDictionaryTermsBulk(terms) {
    try {
      if (!this.db) {
        throw new Error("Database not initialized");
      }
      const insert = this.db.prepare(
        "INSERT OR IGNORE INTO dictionary (term) VALUES (?)",
      );
      const select = this.db.prepare("SELECT * FROM dictionary WHERE term = ?");
      const transaction = this.db.transaction((wordList) => {
        const added = [];
        let duplicateCount = 0;
        for (const word of wordList) {
          const trimmed = typeof word === "string" ? word.trim() : "";
          if (!trimmed) continue;
          const result = insert.run(trimmed);
          if (result.changes > 0) {
            added.push(select.get(trimmed));
          } else {
            duplicateCount++;
          }
        }
        return { added, duplicateCount };
      });
      const { added, duplicateCount } = transaction(terms);
      debugLogger.logEvent("database", "dictionary-terms-bulk-added", {
        requested: terms.length,
        added: added.length,
        duplicateCount,
      });
      return { success: true, added, duplicateCount };
    } catch (error) {
      debugLogger.error("database", "dictionary-bulk-add-failed", {
        error: error.message,
      });
      throw error;
    }
  }

  removeDictionaryTermsByWord(words) {
    try {
      if (!this.db) {
        throw new Error("Database not initialized");
      }
      const del = this.db.prepare(
        "DELETE FROM dictionary WHERE LOWER(term) = LOWER(?)",
      );
      const transaction = this.db.transaction((wordList) => {
        let removed = 0;
        for (const word of wordList) {
          const trimmed = typeof word === "string" ? word.trim() : "";
          if (!trimmed) continue;
          const result = del.run(trimmed);
          removed += result.changes;
        }
        return removed;
      });
      const removed = transaction(words);
      debugLogger.logEvent("database", "dictionary-terms-bulk-removed", {
        requested: words.length,
        removed,
      });
      return { success: true, removed };
    } catch (error) {
      debugLogger.error("database", "dictionary-bulk-remove-failed", {
        error: error.message,
      });
      throw error;
    }
  }

  clearDictionary() {
    try {
      if (!this.db) {
        throw new Error("Database not initialized");
      }
      const stmt = this.db.prepare("DELETE FROM dictionary");
      const result = stmt.run();
      debugLogger.logEvent("database", "dictionary-cleared", {
        cleared: result.changes,
      });
      return { cleared: result.changes, success: true };
    } catch (error) {
      debugLogger.error("database", "dictionary-clear-failed", {
        error: error.message,
      });
      throw error;
    }
  }
}

module.exports = DatabaseManager;
