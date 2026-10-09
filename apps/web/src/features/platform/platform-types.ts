import type { PlayAction } from "../../game-sdk/contracts";

export type PolicyKind = "terms" | "privacy";
export type PendingPlayAction = PlayAction;
export type PurchaseUnit = 1 | 3 | 5 | 10;
export type ConsentPurpose = "registration" | "purchase";
export type PurchaseDialog = "select" | "processing" | "complete" | null;
