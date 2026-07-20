const path = require("node:path");
const { app, BrowserWindow, ipcMain, shell } = require("electron");
const { AppStore } = require("./store.cjs");
const { GrizzlySMSClient } = require("./grizzly-client.cjs");

let store;

// Allows automated QA to use an isolated profile without touching real data.
if (process.env.GRIZZLY_SMS_USER_DATA) {
  app.setPath("userData", path.resolve(process.env.GRIZZLY_SMS_USER_DATA));
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1240,
    height: 800,
    minWidth: 980,
    minHeight: 660,
    backgroundColor: "#0b0d10",
    title: "Grizzly SMS Desktop",
    icon: path.join(__dirname, "..", "build", "icon.png"),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else if (!app.isPackaged) {
    win.loadURL("http://127.0.0.1:5173");
  } else {
    win.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://grizzlysms.com")) shell.openExternal(url);
    return { action: "deny" };
  });
}

function asClient(overrides = {}) {
  const apiKey = overrides.apiKey || store.getApiKey();
  const baseUrl = overrides.baseUrl || store.getSettings().baseUrl;
  return new GrizzlySMSClient(apiKey, baseUrl);
}

function activationId(value) {
  const id = String(value || "").trim();
  if (!id || id.length > 128) throw new Error("激活 ID 无效");
  return id;
}

function registerHandlers() {
  ipcMain.handle("settings:get", () => store.getSettings());
  ipcMain.handle("settings:save", (_event, next) => store.setSettings(next || {}));
  ipcMain.handle("settings:clear-api-key", () => store.clearApiKey());

  ipcMain.handle("api:test", async (_event, next) => {
    const balance = await asClient(next || {}).getBalance();
    return { ok: true, balance };
  });
  ipcMain.handle("api:get-balance", () => asClient().getBalance());
  ipcMain.handle("api:get-countries", () => asClient().getCountries());
  ipcMain.handle("api:get-services", () => asClient().getServices());
  ipcMain.handle("api:get-active-activations", () => asClient().getActiveActivations());
  ipcMain.handle("api:get-prices", (_event, params) => asClient().getPrices(params || {}));
  ipcMain.handle("api:request-number", (_event, params) => asClient().getNumber(params || {}));
  ipcMain.handle("api:get-status", (_event, value) => asClient().getStatus(activationId(value)));
  ipcMain.handle("api:get-status-v2", (_event, value) => asClient().getStatusV2(activationId(value)));
  ipcMain.handle("api:set-status", (_event, payload) => {
    const status = Number(payload?.status);
    if (![6, 8].includes(status)) throw new Error("不允许的状态操作");
    return asClient().setStatus(activationId(payload?.activationId), status);
  });

  ipcMain.handle("activations:list", () => store.getActivations());
  ipcMain.handle("activations:save", (_event, activation) => store.upsertActivation(activation));
  ipcMain.handle("activations:merge-many", (_event, activations) => store.mergeActivations(activations));
  ipcMain.handle("activations:remove", (_event, activationId) => store.deleteActivation(String(activationId)));

  ipcMain.handle("app:open-external", (_event, url) => {
    const parsed = new URL(url);
    if (parsed.protocol === "https:" && (parsed.hostname === "grizzlysms.com" || parsed.hostname.endsWith(".grizzlysms.com"))) {
      return shell.openExternal(parsed.toString());
    }
    throw new Error("不允许打开该外部链接");
  });
}

app.whenReady().then(() => {
  store = new AppStore(app.getPath("userData"));
  registerHandlers();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
