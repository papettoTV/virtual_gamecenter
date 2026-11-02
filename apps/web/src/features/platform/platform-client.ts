import type { GameMode } from "../../domain/game";

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
  avatarUrl: string | null;
  developerLoginAvailable: boolean;
  availableGameModes?: readonly GameMode[];
  consent: ConsentState;
  welcomeCreditGranted: boolean;
  wallet: WalletSummary;
  creditCost: number;
  creditPolicy?: CreditPolicy;
}

export interface CreditPolicy {
  purchasesEnabled: boolean;
  dailyRefillTarget: number;
  timeZone: "Asia/Tokyo";
  nextRefillAt: string;
  refilledToday: boolean;
  refilledAmount: number;
}

export function createGoogleRegistrationUrl(returnTo: string): string {
  return `/api/platform/auth/google/start?returnTo=${encodeURIComponent(returnTo)}`;
}

export function createDeveloperLoginUrl(returnTo: string): string {
  return `/api/platform/auth/developer?returnTo=${encodeURIComponent(returnTo)}`;
}

export async function updatePlayerName(playerName: string): Promise<{
  identity: Pick<PlatformBootstrap, "playerId" | "playerName" | "accountRegistered" | "avatarUrl">;
}> {
  return requestJson("/api/platform/profile", {
    method: "PATCH",
    body: JSON.stringify({ playerName }),
  });
}

export async function logoutUser(): Promise<PlatformBootstrap> {
  return requestJson("/api/platform/auth/logout", { method: "POST" });
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

let sessionEstablished = false;
let bootstrapRequest: Promise<PlatformBootstrap> | null = null;
export interface DeletionPreview {
  playerName: string;
  accountRegistered: boolean;
  wallet: { free_balance: number; purchased_balance: number } | null;
  scope: "all" | "public";
  confirmationToken: string;
  reauthRequired: boolean;
}

export interface DeletionReceipt {
  id: string;
  receipt: string;
  scope: "all" | "public";
  status: string;
  dismissed?: boolean;
}

export function previewDataDeletion(scope: "all" | "public"): Promise<DeletionPreview> {
  return requestJson(`/api/platform/data-deletion/preview?scope=${scope}`);
}

export function requestDataDeletion(confirmationToken: string): Promise<DeletionReceipt> {
  return requestJson("/api/platform/data-deletion/request", { method: "POST", body: JSON.stringify({ confirmationToken }) });
}

export function fetchDataDeletionStatus(receipt: DeletionReceipt): Promise<{ status: string }> {
  return requestJson(`/api/platform/data-deletion/${receipt.id}`, { headers: { "X-Deletion-Receipt": receipt.receipt } });
}

export function fetchPlatformBootstrap(): Promise<PlatformBootstrap> {
  // Concurrent consumers must share the first request that establishes the guest cookie.
  bootstrapRequest ??= requestJson<PlatformBootstrap>("/api/platform/bootstrap").then(value => { sessionEstablished = true; return value; }).finally(() => { bootstrapRequest = null; });
  return bootstrapRequest;
}

// Reuse the initial guest bootstrap; reconnects do not need another wallet fetch.
export async function ensurePlatformSession(): Promise<void> {
  if (!sessionEstablished) await fetchPlatformBootstrap();
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

export async function claimWelcomeCredit(): Promise<{
  welcomeCreditGranted: boolean;
  wallet: WalletSummary;
}> {
  return requestJson("/api/platform/welcome-credit", { method: "POST" });
}

export async function reservePlayCredit(
  cabinetId: string,
  gameId: string,
  purpose: "solo" | "challenge" | "rematch" = "solo",
): Promise<ReservationResponse> {
  return requestJson("/api/platform/credit-reservations", {
    method: "POST",
    body: JSON.stringify({ cabinetId, gameId, purpose }),
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
