const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { AppStore } = require("../electron/store.cjs");

function tempStore() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "grizzly-store-test-"));
}

test("主数据损坏时从备份恢复并保留损坏副本", () => {
  const directory = tempStore();
  const file = path.join(directory, "grizzly-sms-desktop.json");
  fs.writeFileSync(file, "{broken", "utf8");
  fs.writeFileSync(`${file}.bak`, JSON.stringify({
    settings: { baseUrl: "https://api.grizzlysms.com", pollInterval: 5, apiKeyEncrypted: "" },
    activations: [{ activationId: "saved", phone: "1555", service: "tg", status: "OK", createdAt: "2026-01-01T00:00:00Z" }]
  }), "utf8");

  const store = new AppStore(directory);
  assert.equal(store.getActivations()[0].activationId, "saved");
  assert.equal(fs.readdirSync(directory).some((name) => name.includes(".corrupt-")), true);
  fs.rmSync(directory, { recursive: true, force: true });
});

test("批量合并只保留一份相同 activationId", () => {
  const directory = tempStore();
  const store = new AppStore(directory);
  const rows = store.mergeActivations([
    { activationId: "1", phone: "100", service: "tg", status: "WAIT_CODE", createdAt: "2026-01-01T00:00:00Z" },
    { activationId: "1", phone: "100", service: "tg", status: "OK", code: "1234", createdAt: "" },
    { activationId: "2", phone: "200", service: "wa", status: "WAIT_CODE", createdAt: "2026-01-02T00:00:00Z" }
  ]);

  assert.equal(rows.length, 2);
  assert.equal(rows.find((row) => row.activationId === "1").status, "OK");
  assert.equal(rows.find((row) => row.activationId === "1").createdAt, "2026-01-01T00:00:00Z");
  fs.rmSync(directory, { recursive: true, force: true });
});
