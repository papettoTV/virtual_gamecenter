import { FISH_PATTERNS, type SeaLayer } from "./core";

export type Species = {
  id: keyof typeof FISH_PATTERNS; name: string; layer: SeaLayer; rare?: boolean; boss?: boolean;
  color: string; glow: string; speed: number; research: number; score: number; power: number; shape: number;
};

export const SPECIES: Species[] = [
  { id: "sun-sardine", name: "ヒカリイワシ", layer: 1, color: "#73d8e6", glow: "#adffff", speed: 32, research: 2.4, score: 420, power: 2.2, shape: 0 },
  { id: "glass-bream", name: "ガラスダイ", layer: 1, color: "#9fd3bd", glow: "#d9fff0", speed: 27, research: 2.7, score: 460, power: 2.2, shape: 1 },
  { id: "ribbon-goby", name: "リボンハゼ", layer: 1, color: "#e7bd7c", glow: "#ffe5a8", speed: 36, research: 2.8, score: 500, power: 2.4, shape: 2 },
  { id: "blue-puffer", name: "アオフグ", layer: 1, color: "#7ca9ec", glow: "#bcd7ff", speed: 23, research: 3, score: 540, power: 2.5, shape: 3 },
  { id: "coral-ray", name: "サンゴエイ", layer: 1, color: "#d68fad", glow: "#ffc5dc", speed: 30, research: 3.2, score: 580, power: 2.6, shape: 4 },
  { id: "silver-hatchet", name: "ギンオノウオ", layer: 2, color: "#7ea4bd", glow: "#bde7ff", speed: 48, research: 4, score: 760, power: 3, shape: 1 },
  { id: "lantern-cod", name: "ランタンタラ", layer: 2, color: "#6b8bb4", glow: "#8ffff5", speed: 52, research: 4.4, score: 820, power: 3.2, shape: 0 },
  { id: "veil-squid", name: "ベールイカ", layer: 2, color: "#a274be", glow: "#f0bdff", speed: 55, research: 4.8, score: 880, power: 3.3, shape: 5 },
  { id: "saw-shrimp", name: "ノコギリエビ", layer: 2, color: "#bc755e", glow: "#ffb191", speed: 58, research: 5, score: 940, power: 3.5, shape: 2 },
  { id: "moon-jelly", name: "ツキクラゲ", layer: 2, color: "#657fd0", glow: "#8eeaff", speed: 42, research: 5.2, score: 1_000, power: 3.6, shape: 5 },
  { id: "abyss-eel", name: "アビスウナギ", layer: 3, color: "#27345f", glow: "#5ffff0", speed: 78, research: 6, score: 1_180, power: 4, shape: 2 },
  { id: "black-fang", name: "クロキバウオ", layer: 3, color: "#382e4e", glow: "#ff5f91", speed: 88, research: 6.5, score: 1_280, power: 4.2, shape: 0 },
  { id: "ghost-squid", name: "ユウレイイカ", layer: 3, color: "#55446e", glow: "#bd88ff", speed: 82, research: 7, score: 1_380, power: 4.4, shape: 5 },
  { id: "star-mouth", name: "ホシグチ", layer: 3, color: "#253e51", glow: "#ffe66d", speed: 92, research: 7.4, score: 1_480, power: 4.6, shape: 3 },
  { id: "deep-ray", name: "シンカイエイ", layer: 3, color: "#26374a", glow: "#59aaff", speed: 76, research: 7.8, score: 1_580, power: 4.8, shape: 4 },
  { id: "prism-fish", name: "プリズムフィッシュ", layer: 2, rare: true, color: "#e7f4ff", glow: "#74fff5", speed: 105, research: 10, score: 4_200, power: 7, shape: 0 },
  { id: "crown-jelly", name: "オウカンクラゲ", layer: 2, rare: true, color: "#e5b5ff", glow: "#ffde69", speed: 98, research: 11, score: 4_500, power: 7, shape: 5 },
  { id: "comet-eel", name: "スイセイウナギ", layer: 3, rare: true, color: "#c4dbff", glow: "#68a8ff", speed: 125, research: 11.5, score: 4_800, power: 7.5, shape: 2 },
  { id: "ruby-angler", name: "ルビーアンコウ", layer: 3, rare: true, color: "#a32f56", glow: "#ff466f", speed: 118, research: 12, score: 5_100, power: 8, shape: 3 },
  { id: "void-manta", name: "ヴォイドマンタ", layer: 3, rare: true, color: "#1e244b", glow: "#bb73ff", speed: 112, research: 13, score: 5_500, power: 8.5, shape: 4 },
  { id: "leviathan", name: "リヴァイアサン", layer: 3, boss: true, color: "#172842", glow: "#ffce59", speed: 0, research: 100, score: 12_000, power: 0, shape: 6 },
];
export const speciesById = new Map<string, Species>(SPECIES.map((species) => [species.id, species]));
export const regularByLayer = new Map<SeaLayer, Species[]>([1, 2, 3].map((layer) => [layer as SeaLayer, SPECIES.filter((s) => s.layer === layer && !s.rare && !s.boss)]));
export const rareSpecies = SPECIES.filter((species) => species.rare);
