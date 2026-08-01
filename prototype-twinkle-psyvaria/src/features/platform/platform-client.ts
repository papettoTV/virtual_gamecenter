export interface WalletSummary {
  freeBalance: number;
  purchasedBalance: number;
  reservedFree: number;
  reservedPurchased: number;
  availableFree: number;
  availablePurchased: number;
  availableTotal: number;
}

export interface ConsentState {
  accepted: boolean;
  termsVersion: string;
  privacyVersion: string;
}

export interface PlatformBootstrap {
  playerId: string;
  playerName: string;
  accountRegistered: boolean;
  consent: ConsentState;
  wallet: WalletSummary;
  creditCost: number;
}

interface ReservationResponse {
  reservationId: string;
  playSessionId: string;
  wallet: WalletSummary;
}

export interface CreditPurchaseStatus {
  purchaseId: string;
  status: "pending" | "paid" | "cancelled" | "failed";
  creditAmount: number;
  wallet: WalletSummary;
}

export class PlatformApiError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    public readonly wallet?: WalletSummary,
  ) {
    super(code);
  }
}

export async function fetchPlatformBootstrap(): Promise<PlatformBootstrap> {
  return requestJson<PlatformBootstrap>("/api/platform/bootstrap");
}

export async function acceptPolicies(
  termsVersion: string,
  privacyVersion: string,
): Promise<{ consent: ConsentState; wallet: WalletSummary }> {
  return requestJson("/api/platform/consents", {
    method: "POST",
    body: JSON.stringify({ termsVersion, privacyVersion }),
  });
}

export async function reservePlayCredit(
  cabinetId: string,
  purpose: "solo" | "challenge" | "rematch" = "solo",
): Promise<ReservationResponse> {
  return requestJson("/api/platform/credit-reservations", {
    method: "POST",
    body: JSON.stringify({ cabinetId, purpose }),
  });
}

export async function capturePlayCredit(
  reservationId: string,
): Promise<{ status: string; wallet: WalletSummary }> {
  return requestJson(`/api/platform/credit-reservations/${reservationId}/capture`, {
    method: "POST",
  });
}

export async function releasePlayCredit(
  reservationId: string,
): Promise<{ status: string; wallet: WalletSummary }> {
  return requestJson(`/api/platform/credit-reservations/${reservationId}/release`, {
    method: "POST",
  });
}

export async function createCreditCheckout(
  unitCount: 1 | 3 | 5 | 10,
  currency: "jpy" | "usd",
  returnPath: string,
): Promise<{ purchaseId: string; checkoutSessionId: string; checkoutUrl: string }> {
  return requestJson("/api/platform/credit-purchases/checkout", {
    method: "POST",
    body: JSON.stringify({ unitCount, currency, returnPath }),
  });
}

export async function fetchCreditPurchaseStatus(
  checkoutSessionId: string,
): Promise<CreditPurchaseStatus> {
  return requestJson(
    `/api/platform/credit-purchases/status?sessionId=${encodeURIComponent(checkoutSessionId)}`,
  );
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
    ...init,
  });
  const body = await response.json() as T & {
    error?: string;
    wallet?: WalletSummary;
  };
  if (!response.ok) {
    throw new PlatformApiError(
      body.error ?? "platform_request_failed",
      response.status,
      body.wallet,
    );
  }
  return body;
}
