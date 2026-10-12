import type { SharedResult } from "../../domain/shared-result";

export type ResultImageRenderer = (context: CanvasRenderingContext2D, result: SharedResult) => void | Promise<void>;

const renderers: Readonly<Record<string, () => Promise<ResultImageRenderer>>> = {
  "deep-sea-salvage": () => import("../../games/deep-sea-salvage/sharing-image").then(module => module.drawSalvageResultImage),
};

export function getResultImageRenderer(gameId: string): Promise<ResultImageRenderer | null> {
  return renderers[gameId]?.() ?? Promise.resolve(null);
}
