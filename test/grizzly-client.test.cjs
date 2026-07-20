const test = require("node:test");
const assert = require("node:assert/strict");
const { GrizzlySMSClient, GrizzlyApiError } = require("../electron/grizzly-client.cjs");

test("只允许 Grizzly 官方 HTTPS API 地址", () => {
  assert.throws(
    () => new GrizzlySMSClient("key", "https://example.com"),
    (error) => error instanceof GrizzlyApiError && error.code === "INVALID_BASE_URL"
  );
});

test("活动记录使用官方 getActiveActivations action", async () => {
  const originalFetch = global.fetch;
  let requestedUrl = "";
  global.fetch = async (url) => {
    requestedUrl = String(url);
    return {
      ok: true,
      headers: { get: () => "application/json" },
      text: async () => JSON.stringify([{ activationId: 42 }])
    };
  };
  try {
    const rows = await new GrizzlySMSClient("key").getActiveActivations();
    assert.equal(rows[0].activationId, 42);
    assert.match(requestedUrl, /action=getActiveActivations/);
  } finally {
    global.fetch = originalFetch;
  }
});

test("任意国家价格查询不发送星号 country 参数", async () => {
  const originalFetch = global.fetch;
  let requestedUrl = "";
  global.fetch = async (url) => {
    requestedUrl = String(url);
    return {
      ok: true,
      headers: { get: () => "application/json" },
      text: async () => JSON.stringify({ "187": { tg: { cost: 1, count: 2 } } })
    };
  };
  try {
    await new GrizzlySMSClient("key").getPrices({ country: "*", service: "tg" });
    const parsed = new URL(requestedUrl);
    assert.equal(parsed.searchParams.get("action"), "getPrices");
    assert.equal(parsed.searchParams.get("service"), "tg");
    assert.equal(parsed.searchParams.has("country"), false);
  } finally {
    global.fetch = originalFetch;
  }
});

test("任意国家租号使用官方 any country 参数", async () => {
  const originalFetch = global.fetch;
  let requestedUrl = "";
  global.fetch = async (url) => {
    requestedUrl = String(url);
    return {
      ok: true,
      headers: { get: () => "text/plain" },
      text: async () => "ACCESS_NUMBER:42:15551234567"
    };
  };
  try {
    await new GrizzlySMSClient("key").getNumber({ country: "*", service: "tg" });
    const parsed = new URL(requestedUrl);
    assert.equal(parsed.searchParams.get("country"), "any");
  } finally {
    global.fetch = originalFetch;
  }
});

test("getStatusV2 提取最近一条短信", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    headers: { get: () => "application/json" },
    text: async () => JSON.stringify({
      activationStatus: 1,
      sms: [
        { code: "1111", text: "old", dateTime: "2026-01-01T00:00:00Z" },
        { code: "987654", text: "Your code is 987654", dateTime: "2026-01-01T00:01:00Z" }
      ]
    })
  });
  try {
    const result = await new GrizzlySMSClient("key").getStatusV2("123");
    assert.deepEqual(result, {
      status: "OK",
      code: "987654",
      smsText: "Your code is 987654",
      receivedAt: "2026-01-01T00:01:00Z"
    });
  } finally {
    global.fetch = originalFetch;
  }
});
