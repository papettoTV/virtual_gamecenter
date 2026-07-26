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
  consent: ConsentState;
  wallet: WalletSummary;
  creditCost: number;
}

interface ReservationResponse {
  reservationId: string;
  playSessionId: string;
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

export async function reservePlayCredit(cabinetId: string): Promise<ReservationResponse> {
  return requestJson("/api/platform/credit-reservations", {
    method: "POST",
    body: JSON.stringify({ cabinetId }),
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
