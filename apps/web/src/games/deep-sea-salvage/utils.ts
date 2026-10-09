import type { Species } from "./species";

export function fishRadius(species: Species) { return species.rare ? 25 : 20 + species.shape % 3 * 2; }
export function clamp(value: number, min: number, max: number) { return Math.max(min, Math.min(max, value)); }
export function formatTime(seconds: number) { return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`; }
