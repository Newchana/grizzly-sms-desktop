const fs = require("node:fs");
const path = require("node:path");
const { safeStorage } = require("electron");

class AppStore {
  constructor(userDataPath) {
    this.file = path.join(userDataPath, "grizzly-sms-desktop.json");
    this.data = this.defaultData();
    this.load();
  }

  defaultData() {
    return {
      settings: {
        baseUrl: "https://api.grizzlysms.com",
        pollInterval: 5,
        apiKeyEncrypted: ""
      },
      activations: []
    };
  }

  normalize(parsed) {
    const defaults = this.defaultData();
    return {
      settings: { ...defaults.settings, ...(parsed?.settings || {}) },
      activations: Array.isArray(parsed?.activations) ? parsed.activations : []
    };
  }

  readData(file) {
    return this.normalize(JSON.parse(fs.readFileSync(file, "utf8")));
  }

  preserveCorruptFile() {
    if (!fs.existsSync(this.file)) return;
    const suffix = new Date().toISOString().replace(/[:.]/g, "-");
    fs.copyFileSync(this.file, `${this.file}.corrupt-${suffix}`);
  }

  load() {
    const backup = `${this.file}.bak`;
    try {
      this.data = this.readData(this.file);
    } catch {
      try {
        this.data = this.readData(backup);
        this.preserveCorruptFile();
      } catch {
        this.data = this.defaultData();
        this.preserveCorruptFile();
      }
      this.save({ backupExisting: false });
    }
  }

  save({ backupExisting = true } = {}) {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const temp = `${this.file}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(this.data, null, 2), "utf8");
    if (backupExisting && fs.existsSync(this.file)) {
      fs.copyFileSync(this.file, `${this.file}.bak`);
    }
    fs.renameSync(temp, this.file);
  }

  getSettings() {
    return {
      baseUrl: this.data.settings.baseUrl,
      pollInterval: this.data.settings.pollInterval,
      hasApiKey: Boolean(this.data.settings.apiKeyEncrypted)
    };
  }

  getApiKey() {
    const encrypted = this.data.settings.apiKeyEncrypted;
    if (!encrypted) return "";
    try {
      if (!safeStorage.isEncryptionAvailable()) return "";
      return safeStorage.decryptString(Buffer.from(encrypted, "base64"));
    } catch {
      return "";
    }
  }

  setSettings(next) {
    if (typeof next.baseUrl === "string") {
      let parsed;
      try {
        parsed = new URL(next.baseUrl);
      } catch {
        throw new Error("API 地址无效");
      }
      if (parsed.protocol !== "https:" || parsed.hostname !== "api.grizzlysms.com") {
        throw new Error("为保护 API Key，只允许使用 https://api.grizzlysms.com");
      }
      this.data.settings.baseUrl = parsed.origin;
    }
    if (Number.isFinite(next.pollInterval)) {
      this.data.settings.pollInterval = Math.min(60, Math.max(3, Number(next.pollInterval)));
    }
    if (typeof next.apiKey === "string" && next.apiKey.trim()) {
      if (!safeStorage.isEncryptionAvailable()) {
        throw new Error("系统安全存储当前不可用，无法保存 API Key");
      }
      this.data.settings.apiKeyEncrypted = safeStorage.encryptString(next.apiKey.trim()).toString("base64");
    }
    this.save();
    return this.getSettings();
  }

  clearApiKey() {
    this.data.settings.apiKeyEncrypted = "";
    this.save();
    return this.getSettings();
  }

  getActivations() {
    return [...this.data.activations].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }

  upsertActivation(activation) {
    return this.mergeActivations([activation]).find((item) => item.activationId === activation.activationId);
  }

  mergeActivations(activations) {
    const now = new Date().toISOString();
    const merged = new Map(this.data.activations.map((item) => [String(item.activationId), item]));
    for (const activation of Array.isArray(activations) ? activations : []) {
      const activationId = String(activation?.activationId || "").trim();
      if (!activationId) continue;
      const existing = merged.get(activationId) || {};
      merged.set(activationId, {
        ...existing,
        ...activation,
        activationId,
        createdAt: activation.createdAt || existing.createdAt || now,
        updatedAt: activation.updatedAt || now
      });
    }
    this.data.activations = [...merged.values()]
      .sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")))
      .slice(-500);
    this.save();
    return this.getActivations();
  }

  deleteActivation(activationId) {
    this.data.activations = this.data.activations.filter((item) => item.activationId !== activationId);
    this.save();
    return true;
  }
}

module.exports = { AppStore };
