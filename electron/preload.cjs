const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("grizzlyDesktop", {
  settings: {
    get: () => ipcRenderer.invoke("settings:get"),
    save: (settings) => ipcRenderer.invoke("settings:save", settings),
    clearApiKey: () => ipcRenderer.invoke("settings:clear-api-key")
  },
  api: {
    test: (settings) => ipcRenderer.invoke("api:test", settings),
    getBalance: () => ipcRenderer.invoke("api:get-balance"),
    getCountries: () => ipcRenderer.invoke("api:get-countries"),
    getServices: () => ipcRenderer.invoke("api:get-services"),
    getActiveActivations: () => ipcRenderer.invoke("api:get-active-activations"),
    getPrices: (params) => ipcRenderer.invoke("api:get-prices", params),
    requestNumber: (params) => ipcRenderer.invoke("api:request-number", params),
    getStatus: (activationId) => ipcRenderer.invoke("api:get-status", activationId),
    getStatusV2: (activationId) => ipcRenderer.invoke("api:get-status-v2", activationId),
    setStatus: (activationId, status) => ipcRenderer.invoke("api:set-status", { activationId, status })
  },
  activations: {
    list: () => ipcRenderer.invoke("activations:list"),
    save: (activation) => ipcRenderer.invoke("activations:save", activation),
    mergeMany: (activations) => ipcRenderer.invoke("activations:merge-many", activations),
    remove: (activationId) => ipcRenderer.invoke("activations:remove", activationId)
  },
  openExternal: (url) => ipcRenderer.invoke("app:open-external", url)
});
