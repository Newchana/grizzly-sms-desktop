export type Settings = {
  baseUrl: string;
  pollInterval: number;
  hasApiKey: boolean;
};

export type Balance = {
  balance: number;
  currency: string;
};

export type ActivationStatus =
  | "WAIT_CODE"
  | "WAIT_RETRY"
  | "WAIT_RESEND"
  | "OK"
  | "CANCEL"
  | "COMPLETE"
  | string;

export type Activation = {
  activationId: string;
  phone: string;
  service: string;
  country?: string;
  status: ActivationStatus;
  code?: string;
  smsText?: string;
  receivedAt?: string;
  cost?: number;
  currency?: string;
  createdAt: string;
  updatedAt?: string;
  source?: "server" | "local";
};

export type RentRequest = {
  service: string;
  country?: string | number;
  operator?: string;
  maxPrice?: number;
  providerIds?: string;
  exceptProviderIds?: string;
};

export type ApiResult = Record<string, unknown>;

declare global {
  interface Window {
    grizzlyDesktop: {
      settings: {
        get(): Promise<Settings>;
        save(settings: Partial<Settings> & { apiKey?: string }): Promise<Settings>;
        clearApiKey(): Promise<Settings>;
      };
      api: {
        test(settings: { apiKey: string; baseUrl: string }): Promise<{ ok: boolean; balance: Balance }>;
        getBalance(): Promise<Balance>;
        getCountries(): Promise<unknown>;
        getServices(): Promise<unknown>;
        getActiveActivations(): Promise<unknown>;
        getPrices(params: Record<string, unknown>): Promise<unknown>;
        requestNumber(params: RentRequest): Promise<Record<string, unknown> & { activationId: string; phone: string }>;
        getStatus(activationId: string): Promise<{ status: string; code?: string }>;
        getStatusV2(activationId: string): Promise<{ status: string; code?: string; smsText?: string; receivedAt?: string }>;
        setStatus(activationId: string, status: number): Promise<{ status: string; confirmed: boolean; serverResponse?: string }>;
      };
      activations: {
        list(): Promise<Activation[]>;
        save(activation: Activation): Promise<Activation>;
        mergeMany(activations: Activation[]): Promise<Activation[]>;
        remove(activationId: string): Promise<boolean>;
      };
      openExternal(url: string): Promise<void>;
    };
  }
}
