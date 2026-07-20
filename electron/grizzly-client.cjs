const DEFAULT_BASE_URL = "https://api.grizzlysms.com";

class GrizzlyApiError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = "GrizzlyApiError";
    this.code = code;
  }
}

class GrizzlySMSClient {
  constructor(apiKey, baseUrl = DEFAULT_BASE_URL) {
    if (!apiKey || !apiKey.trim()) {
      throw new GrizzlyApiError("NO_KEY", "API Key 不能为空");
    }
    this.apiKey = apiKey.trim();
    let parsedBaseUrl;
    try {
      parsedBaseUrl = new URL(baseUrl);
    } catch {
      throw new GrizzlyApiError("INVALID_BASE_URL", "API 地址无效");
    }
    if (parsedBaseUrl.protocol !== "https:" || parsedBaseUrl.hostname !== "api.grizzlysms.com") {
      throw new GrizzlyApiError("INVALID_BASE_URL", "为保护 API Key，只允许使用 https://api.grizzlysms.com");
    }
    this.baseUrl = parsedBaseUrl.origin;
  }

  async request(path, params, timeoutMs = 30000) {
    const url = new URL(path, `${this.baseUrl}/`);
    const safeParams = { api_key: this.apiKey, ...params };
    for (const [key, value] of Object.entries(safeParams)) {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, String(value));
      }
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        method: "GET",
        signal: controller.signal,
        headers: { Accept: "application/json, text/plain, */*" }
      });
      const contentType = response.headers.get("content-type") || "";
      const raw = await response.text();
      if (!response.ok) {
        throw new GrizzlyApiError(`HTTP_${response.status}`, `API 请求失败（HTTP ${response.status}）`);
      }

      let data = raw;
      if (contentType.includes("application/json") || raw.trim().startsWith("{") || raw.trim().startsWith("[")) {
        try {
          data = JSON.parse(raw);
        } catch {
          data = raw;
        }
      }
      this.throwIfApiError(data);
      return data;
    } catch (error) {
      if (error instanceof GrizzlyApiError) throw error;
      if (error?.name === "AbortError") {
        throw new GrizzlyApiError("TIMEOUT", "API 请求超时");
      }
      throw new GrizzlyApiError("NETWORK_ERROR", error?.message || "网络请求失败");
    } finally {
      clearTimeout(timer);
    }
  }

  throwIfApiError(data) {
    if (typeof data !== "string") return;
    const value = data.trim();
    const prefixes = [
      "NO_KEY",
      "BAD_",
      "NO_",
      "ERROR_",
      "WRONG_",
      "SERVICE_UNAVAILABLE_REGION",
      "USERS_IP_IS_NOT_ALLOWED"
    ];
    const exactErrors = [
      "EARLY_CANCEL_DENIED",
      "STATUS_ALREADY_CHANGED",
      "ACTION_NOT_AVAILABLE"
    ];
    if (prefixes.some((prefix) => value.startsWith(prefix)) || exactErrors.includes(value)) {
      const friendly = {
        NO_KEY: "API Key 无效或缺失",
        BAD_KEY: "API Key 无效",
        NO_BALANCE: "账户余额不足",
        NO_NUMBERS: "当前条件下暂无可用号码",
        SERVICE_UNAVAILABLE_REGION: "当前地区无法访问服务",
        USERS_IP_IS_NOT_ALLOWED: "当前 IP 不在允许列表中",
        EARLY_CANCEL_DENIED: "取消时间过早，请等待租号满 2 分钟后重试",
        ALREADY_CANCEL: "该激活已在服务器端取消",
        STATUS_ALREADY_CHANGED: "激活状态已在服务器端变更，请刷新后重试",
        ACTION_NOT_AVAILABLE: "当前号码提供商不支持此操作"
      };
      throw new GrizzlyApiError(value.split(":")[0], friendly[value] || friendly[value.split(":")[0]] || value);
    }
  }

  handler(params) {
    return this.request("/stubs/handler_api.php", params);
  }

  async getBalance() {
    const response = await this.handler({ action: "getBalance" });
    if (typeof response === "string" && response.startsWith("ACCESS_BALANCE:")) {
      return { balance: Number(response.split(":")[1]), currency: "USD" };
    }
    if (response && typeof response === "object" && "balance" in response) {
      return { balance: Number(response.balance), currency: response.currency || "USD" };
    }
    throw new GrizzlyApiError("INVALID_RESPONSE", "余额接口返回了无法识别的数据");
  }

  async getCountries() {
    return this.handler({ action: "getCountries" });
  }

  async getServices() {
    return this.handler({ action: "getServicesList" });
  }

  async getActiveActivations() {
    const response = await this.handler({ action: "getActiveActivations" });
    if (Array.isArray(response)) return response;
    if (response && typeof response === "object") {
      if (Array.isArray(response.activations)) return response.activations;
      if (Array.isArray(response.data)) return response.data;
    }
    throw new GrizzlyApiError("INVALID_RESPONSE", "官网活动记录接口返回了无法识别的数据");
  }

  async getPrices({ country, service } = {}) {
    // Grizzly advertises sms-activate compatibility. `getPrices` is the
    // broadly supported utility action; some accounts reject getPricesV2/V3.
    if (!country || country === "*" || country === "any") {
      throw new GrizzlyApiError("COUNTRY_REQUIRED", "请选择具体国家后再查询价格");
    }
    return this.handler({
      action: "getPrices",
      country,
      service
    });
  }

  async getNumber(request) {
    if (!request.country || request.country === "*" || request.country === "any") {
      throw new GrizzlyApiError("COUNTRY_REQUIRED", "请选择具体国家后再租用号码");
    }
    const params = {
      action: "getNumberV2",
      service: request.service,
      country: request.country,
      operator: request.operator,
      maxPrice: request.maxPrice,
      providerIds: request.providerIds,
      exceptProviderIds: request.exceptProviderIds,
      phoneException: request.phoneException,
      activationType: request.activationType
    };
    const response = await this.handler(params);
    if (typeof response === "string" && response.startsWith("ACCESS_NUMBER:")) {
      const [, activationId, phone] = response.split(":");
      return { activationId, phone };
    }
    if (response && typeof response === "object") {
      const activationId = response.activationId || response.act_id || response.id;
      const phone = response.phoneNumber || response.number || response.phone;
      if (activationId && phone) {
        return {
          ...response,
          activationId: String(activationId),
          phone: String(phone)
        };
      }
    }
    throw new GrizzlyApiError("INVALID_RESPONSE", "租号接口返回了无法识别的数据");
  }

  async getStatus(activationId) {
    const response = await this.handler({ action: "getStatus", id: activationId });
    return this.parseStatus(response);
  }

  parseStatus(response) {
    if (typeof response !== "string") return response;
    if (response.startsWith("STATUS_OK")) {
      return { status: "OK", code: response.split(":").slice(1).join(":") };
    }
    if (response.startsWith("STATUS_WAIT_RETRY")) {
      return { status: "WAIT_RETRY", code: response.split(":").slice(1).join(":") || undefined };
    }
    if (response.startsWith("STATUS_WAIT_RESEND")) return { status: "WAIT_RESEND" };
    if (response.startsWith("STATUS_WAIT_CODE")) return { status: "WAIT_CODE" };
    if (response.startsWith("STATUS_CANCEL")) return { status: "CANCEL" };
    return { status: response };
  }

  async getStatusV2(activationId) {
    const response = await this.handler({ action: "getStatusV2", id: activationId });
    if (!response || typeof response !== "object") return this.parseStatus(response);
    const smsList = Array.isArray(response.sms) ? response.sms : response.sms ? [response.sms] : [];
    const sms = smsList.at(-1) || {};
    const code = String(sms.code ?? response.smsCode ?? response.code ?? "").trim() || undefined;
    const rawStatus = String(response.activationStatus ?? response.status ?? "").toUpperCase();
    const statuses = {
      "0": "WAIT_CODE",
      "1": "OK",
      "2": "WAIT_RETRY",
      "3": "COMPLETE",
      "4": "CANCEL",
      "8": "CANCEL",
      STATUS_WAIT_CODE: "WAIT_CODE",
      STATUS_WAIT_RETRY: "WAIT_RETRY",
      STATUS_WAIT_RESEND: "WAIT_RESEND",
      STATUS_OK: "OK",
      STATUS_CANCEL: "CANCEL"
    };
    return {
      status: code ? "OK" : (statuses[rawStatus] || rawStatus || "WAIT_CODE"),
      code,
      smsText: String(sms.text ?? response.smsText ?? "").trim() || undefined,
      receivedAt: String(sms.dateTime ?? response.smsDateTime ?? "").trim() || undefined
    };
  }

  async setStatus(activationId, status) {
    const response = await this.handler({ action: "setStatus", id: activationId, status });
    const raw = String(response).trim();
    const map = {
      ACCESS_READY: "READY",
      ACCESS_RETRY_GET: "RETRY_GET",
      ACCESS_ACTIVATION: "ACTIVATION",
      ACCESS_CANCEL: "CANCEL"
    };
    if (status === 8) {
      if (raw !== "ACCESS_CANCEL" && raw !== "ALREADY_CANCEL") {
        throw new GrizzlyApiError("CANCEL_NOT_CONFIRMED", `服务器未确认取消（返回：${raw}）`);
      }
      return { status: "CANCEL", confirmed: true, serverResponse: raw };
    }
    if (status === 6) {
      if (raw !== "ACCESS_ACTIVATION") {
        throw new GrizzlyApiError("COMPLETE_NOT_CONFIRMED", `服务器未确认完成（返回：${raw}）`);
      }
      return { status: "COMPLETE", confirmed: true, serverResponse: raw };
    }
    return { status: map[raw] || raw, confirmed: true, serverResponse: raw };
  }
}

module.exports = { GrizzlySMSClient, GrizzlyApiError, DEFAULT_BASE_URL };
