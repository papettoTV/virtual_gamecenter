import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { OutlinePass } from "three/examples/jsm/postprocessing/OutlinePass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { terrainWallLocalPolygon } from "./terrain";

export type ThreeFishState = {
  id: number; speciesId: string; x: number; y: number; radius: number; direction: 1 | -1;
  color: string; glow: string; known: boolean; completed: boolean; rare: boolean;
  outlineAlpha: number; outlineWarning: boolean;
};
export type ThreeHazardState = {
  id: number; kind: "rock" | "kelp" | "vent"; x: number; y: number; width: number; height: number;
  topWidth?: number; bottomWidth?: number; side?: -1 | 1; active?: boolean;
};
export type ThreeBossState = { active: boolean; x: number; y: number; direction: 1 | -1; flash: number; revealed: boolean };
export type ThreeFrame = {
  elapsed: number;
  submarine: { x: number; y: number; heading: number; pitch: number; alpha: number; hull: number; breaking: boolean; breakProgress: number; lightLevel: number };
  fishes: ThreeFishState[];
  hazards: ThreeHazardState[];
  boss: ThreeBossState;
};

type ModelEntry = { url: string; scale?: number };
type ModelManifest = {
  models?: Partial<Record<"submarine" | "fish" | "leviathan" | "kelp" | "vent" | "cliffDetail", ModelEntry>>;
  fishSpecies?: Record<string, ModelEntry>;
};
const WORLD_SCALE = 53;
const worldX = (x: number) => (x - 480) / WORLD_SCALE;
const worldY = (y: number) => (320 - y) / WORLD_SCALE;

export class DeepSeaThreeLayer {
  readonly canvas = document.createElement("canvas");
  private readonly renderer: THREE.WebGLRenderer;
  private readonly composer: EffectComposer;
  private readonly cautionOutline: OutlinePass;
  private readonly dangerOutline: OutlinePass;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-480 / WORLD_SCALE, 480 / WORLD_SCALE, 320 / WORLD_SCALE, -320 / WORLD_SCALE, .1, 50);
  private readonly fishRoot = new THREE.Group();
  private readonly hazardRoot = new THREE.Group();
  private readonly bossRoot = new THREE.Group();
  private submarine = new THREE.Group();
  private fishTemplate = new THREE.Group();
  private fishTemplates = new Map<string, THREE.Group>();
  private kelpTemplate: THREE.Group | null = null;
  private ventTemplate: THREE.Group | null = null;
  private cliffTemplate: THREE.Group | null = null;
  private fishMeshes = new Map<number, THREE.Group>();
  private hazardMeshes = new Map<number, THREE.Object3D>();
  private readonly cracks = new THREE.Group();
  private readonly rockMaterial = new THREE.MeshStandardMaterial({
    color: 0x78939f, roughness: .98, metalness: .02,
    emissive: 0x4a626d, emissiveIntensity: .72,
  });
  private readonly rockEdgeMaterial = new THREE.LineBasicMaterial({ color: 0x9bb4bf, transparent: true, opacity: .9 });
  private readonly kelpMaterial = new THREE.MeshStandardMaterial({ color: 0x28775e, roughness: .75, side: THREE.DoubleSide });
  private readonly shallowHullColor = new THREE.Color(0xffd45c);
  private readonly lowPower = matchMedia("(pointer: coarse)").matches || Math.min(innerWidth, innerHeight) < 700;

  private constructor() {
    this.canvas.width = 960; this.canvas.height = 640;
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, alpha: true, antialias: !this.lowPower, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(960, 640, false);
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.18;
    this.camera.position.set(0, 0, 18); this.camera.lookAt(0, 0, 0);
    this.scene.add(this.fishRoot, this.hazardRoot, this.bossRoot);
    this.scene.add(new THREE.HemisphereLight(0x9bd8e8, 0x071018, 2.1));
    const key = new THREE.DirectionalLight(0xb6e9f3, 2.7); key.position.set(-6, 8, 12); this.scene.add(key);
    const fill = new THREE.PointLight(0x39b9d0, 18, 22, 2); fill.position.set(4, -1, 8); this.scene.add(fill);
    this.composer = new EffectComposer(this.renderer);
    this.composer.setSize(960, 640);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.cautionOutline = this.makeOutlinePass(0xd92f3a, 2.2, .12);
    this.dangerOutline = this.makeOutlinePass(0xff202b, 3.5, .35);
    this.composer.addPass(this.cautionOutline);
    this.composer.addPass(this.dangerOutline);
  }

  static async create() {
    const layer = new DeepSeaThreeLayer();
    await layer.loadModels();
    return layer;
  }

  render(frame: ThreeFrame) {
    this.updateSubmarine(frame);
    this.updateFishes(frame.fishes, frame.elapsed);
    this.updateHazards(frame.hazards, frame.elapsed);
    this.updateBoss(frame.boss);
    this.composer.render();
    return this.canvas;
  }

  private makeOutlinePass(color: number, strength: number, glow: number) {
    const pass = new OutlinePass(new THREE.Vector2(960, 640), this.scene, this.camera);
    pass.visibleEdgeColor.set(color);
    pass.hiddenEdgeColor.set(0x260307);
    pass.edgeStrength = strength;
    pass.edgeGlow = glow;
    pass.edgeThickness = 1.15;
    pass.pulsePeriod = 0;
    return pass;
  }

  private async loadModels() {
    const manifest = await fetch("/assets/deep-sea-salvage/models/manifest.json").then((response) => response.json()) as ModelManifest;
    const loader = new GLTFLoader();
    const loadEntry = async (entry: ModelEntry) => {
      const root = (await loader.loadAsync(entry.url)).scene;
      root.scale.multiplyScalar(entry.scale ?? 1);
      root.traverse((object) => { if (object instanceof THREE.Mesh) { object.castShadow = false; object.receiveShadow = false; } });
      return root;
    };
    const load = async (key: keyof NonNullable<ModelManifest["models"]>) => {
      const entry = manifest.models?.[key];
      if (!entry) throw new Error(`missing_3d_model:${key}`);
      return loadEntry(entry);
    };
    this.submarine = await load("submarine"); this.submarine.name = "game_submarine"; this.submarine.scale.multiplyScalar(.34);
    this.submarine.traverse((object) => {
      if (!(object instanceof THREE.Mesh) || !(object.material instanceof THREE.MeshStandardMaterial)) return;
      object.userData.baseColor = object.material.color.clone();
      object.userData.baseEmissive = object.material.emissive.clone();
      object.userData.baseEmissiveIntensity = object.material.emissiveIntensity;
    });
    this.createDamageCracks(); this.submarine.add(this.cracks); this.scene.add(this.submarine);
    this.fishTemplate = await load("fish"); this.fishTemplate.visible = false; this.scene.add(this.fishTemplate);
    const speciesEntries = Object.entries(manifest.fishSpecies ?? {});
    await Promise.all(speciesEntries.map(async ([id, entry]) => {
      const model = await loadEntry(entry); model.visible = false; this.fishTemplates.set(id, model); this.scene.add(model);
    }));
    if (manifest.models?.leviathan) this.bossRoot.add(await load("leviathan")); else this.createBoss();
    if (manifest.models?.kelp) { this.kelpTemplate = await load("kelp"); this.kelpTemplate.visible = false; this.scene.add(this.kelpTemplate); }
    if (manifest.models?.vent) { this.ventTemplate = await load("vent"); this.ventTemplate.visible = false; this.scene.add(this.ventTemplate); }
    if (manifest.models?.cliffDetail) {
      this.cliffTemplate = await load("cliffDetail");
      this.cliffTemplate.traverse((object) => {
        if (!(object instanceof THREE.Mesh) || !(object.material instanceof THREE.MeshStandardMaterial)) return;
        object.material = object.material.clone();
        object.material.color.offsetHSL(0, -.05, .24);
        object.material.emissive.copy(object.material.color).multiplyScalar(.52);
        object.material.emissiveIntensity = .78;
      });
      this.cliffTemplate.visible = false; this.scene.add(this.cliffTemplate);
    }
  }

  private updateSubmarine(frame: ThreeFrame) {
    const state = frame.submarine;
    const shake = state.breaking ? 1 - state.breakProgress : 0;
    this.submarine.position.set(
      worldX(state.x) + Math.sin(frame.elapsed * 62) * .075 * shake,
      worldY(state.y) + Math.cos(frame.elapsed * 49) * .06 * shake,
      2.4,
    );
    this.submarine.rotation.set(0, state.heading, -state.pitch);
    this.submarine.visible = state.alpha > .02;
    this.submarine.traverse((object) => {
      if (!(object instanceof THREE.Mesh) || !(object.material instanceof THREE.MeshStandardMaterial)) return;
      object.material.transparent = state.alpha < 1; object.material.opacity = state.alpha;
      const baseColor = object.userData.baseColor as THREE.Color | undefined;
      const baseEmissive = object.userData.baseEmissive as THREE.Color | undefined;
      const baseIntensity = Number(object.userData.baseEmissiveIntensity ?? 0);
      const materialName = object.material.name;
      const isUpperHull = materialName === "aged_yellow_hull";
      if (baseColor) {
        object.material.color.copy(baseColor);
        if (isUpperHull) object.material.color.lerp(this.shallowHullColor, state.lightLevel * .92);
      }
      if (baseEmissive) {
        object.material.emissive.copy(baseEmissive);
        if (isUpperHull) object.material.emissive.lerp(this.shallowHullColor, state.lightLevel * .78);
      }
      object.material.emissiveIntensity = isUpperHull
        ? Math.max(baseIntensity, state.lightLevel * .9)
        : baseIntensity;
    });
    const propeller = this.submarine.getObjectByName("propeller"); if (propeller) propeller.rotation.x = frame.elapsed * 14;
    const damage = Math.max(0, 3 - state.hull);
    this.cracks.visible = damage > 0;
    for (const line of this.cracks.children) line.visible = damage >= Number(line.userData.damageLevel ?? 1);
  }

  private createDamageCracks() {
    const haloMaterial = new THREE.MeshBasicMaterial({ color: 0x421015, transparent: true, opacity: .98, depthTest: true });
    const coreMaterial = new THREE.MeshBasicMaterial({ color: 0xffb08a, transparent: true, opacity: .96, depthTest: true });
    const paths: Array<{ level: number; points: Array<[number, number]> }> = [
      { level: 1, points: [[-.62, .18], [-.42, .03], [-.17, -.03], [.02, -.26], [-.02, -.43]] },
      { level: 1, points: [[-.42, .03], [-.52, -.2], [-.39, -.34]] },
      { level: 1, points: [[-.17, -.03], [.14, .06], [.38, -.06]] },
      { level: 2, points: [[-.62, .18], [-.82, .03], [-.78, -.22]] },
      { level: 2, points: [[.14, .06], [.34, .29], [.61, .37]] },
      { level: 2, points: [[.38, -.06], [.68, -.25], [.83, -.17]] },
      { level: 2, points: [[-.17, -.03], [-.2, .28], [-.43, .46]] },
    ];
    for (const side of [-1, 1]) for (const path of paths) {
      const points = path.points.map(([x, y]) => new THREE.Vector3(x, y, side * .625));
      const curve = new THREE.CurvePath<THREE.Vector3>();
      for (let index = 1; index < points.length; index += 1) curve.add(new THREE.LineCurve3(points[index - 1]!, points[index]!));
      // The submarine root is scaled to .34 in-game. These radii leave a slim
      // one-pixel luminous fracture with a dark two-pixel edge after projection.
      const halo = new THREE.Mesh(new THREE.TubeGeometry(curve, Math.max(2, points.length * 2), .055, 4, false), haloMaterial);
      const core = new THREE.Mesh(new THREE.TubeGeometry(curve, Math.max(2, points.length * 2), .018, 4, false), coreMaterial);
      halo.userData.damageLevel = path.level; core.userData.damageLevel = path.level;
      halo.renderOrder = 4; core.renderOrder = 5; this.cracks.add(halo, core);
    }
    this.cracks.visible = false;
  }

  private updateFishes(states: ThreeFishState[], elapsed: number) {
    const visibleIds = new Set(states.map((state) => state.id));
    for (const [id, fish] of this.fishMeshes) if (!visibleIds.has(id)) {
      fish.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) material.dispose();
      });
      this.fishRoot.remove(fish); this.fishMeshes.delete(id);
    }
    for (const state of states) {
      let fish = this.fishMeshes.get(state.id);
      if (!fish) {
        fish = (this.fishTemplates.get(state.speciesId) ?? this.fishTemplate).clone(true); fish.visible = true;
        fish.traverse((object) => {
          if (!(object instanceof THREE.Mesh)) return;
          object.material = (object.material as THREE.Material).clone();
          if (object.material instanceof THREE.MeshStandardMaterial) {
            object.userData.baseColor = object.material.color.clone();
            object.userData.baseEmissive = object.material.emissive.clone();
            object.userData.baseEmissiveIntensity = object.material.emissiveIntensity;
          }
        });
        this.fishMeshes.set(state.id, fish); this.fishRoot.add(fish);
      }
      fish.position.set(worldX(state.x), worldY(state.y), state.rare ? 1.35 : 1.1);
      const baseScale = state.radius / 25; fish.scale.set(.42 * baseScale, .42 * baseScale, .42 * baseScale);
      fish.rotation.y = state.direction < 0 ? Math.PI : 0;
      fish.traverse((object) => {
        if (!(object instanceof THREE.Mesh) || !(object.material instanceof THREE.MeshStandardMaterial)) return;
        if (object.name.includes("eye") || object.name.includes("pupil")) return;
        if (state.known) {
          object.material.color.copy(object.userData.baseColor as THREE.Color);
          object.material.emissive.copy(object.userData.baseEmissive as THREE.Color);
          object.material.emissiveIntensity = state.completed ? Math.min(.18, Number(object.userData.baseEmissiveIntensity)) : Number(object.userData.baseEmissiveIntensity);
        } else {
          object.material.color.set("#17242b"); object.material.emissive.set("#02080c"); object.material.emissiveIntensity = .03;
        }
      });
      const tail = fish.getObjectByName("tail"); if (tail) tail.rotation.y = Math.sin(elapsed * 5.2 + state.id) * .34;
    }
    const outlined = states.filter((state) => state.outlineAlpha > .08);
    const cautionStates = outlined.filter((state) => !state.outlineWarning);
    const dangerStates = outlined.filter((state) => state.outlineWarning);
    this.cautionOutline.selectedObjects = cautionStates.map((state) => this.fishMeshes.get(state.id)!).filter(Boolean);
    this.dangerOutline.selectedObjects = dangerStates.map((state) => this.fishMeshes.get(state.id)!).filter(Boolean);
    this.cautionOutline.edgeStrength = 1.2 + Math.max(0, ...cautionStates.map((state) => state.outlineAlpha)) * 1.8;
    this.dangerOutline.edgeStrength = 2.2 + Math.max(0, ...dangerStates.map((state) => state.outlineAlpha)) * 2.1;
  }

  private updateHazards(states: ThreeHazardState[], elapsed: number) {
    const visibleIds = new Set(states.map((state) => state.id));
    for (const [id, hazard] of this.hazardMeshes) if (!visibleIds.has(id)) { this.hazardRoot.remove(hazard); this.hazardMeshes.delete(id); }
    for (const state of states) {
      let object = this.hazardMeshes.get(state.id);
      if (!object) {
        if (state.kind === "rock") object = this.makeRock(state);
        else if (state.kind === "kelp") object = this.makeKelp(state);
        else object = this.makeVent(state);
        this.hazardMeshes.set(state.id, object); this.hazardRoot.add(object);
      }
      object.position.set(worldX(state.x), worldY(state.y), state.kind === "rock" ? -.2 : .45);
      object.visible = state.y > -state.height - 90 && state.y < 640 + state.height + 90;
      if (!object.visible) continue;
      if (state.kind === "kelp") object.rotation.z = Math.sin(elapsed * .9 + state.id) * .08;
      if (state.kind === "vent") {
        const plume = object.getObjectByName("plume"); if (plume) { plume.visible = Boolean(state.active); plume.scale.y = .75 + Math.sin(elapsed * 5) * .12; }
      }
    }
  }

  private makeRock(state: ThreeHazardState) {
    const group = new THREE.Group();
    const side = state.side === 1 ? "right" : "left";
    const [outerTop, innerTop, innerBottom, outerBottom] = terrainWallLocalPolygon(
      side, state.width, state.height, state.topWidth ?? state.width, state.bottomWidth ?? state.width,
    ).map(({ x, y }) => ({ x: x / WORLD_SCALE, y: y / WORLD_SCALE }));
    const shape = new THREE.Shape();
    shape.moveTo(outerTop!.x, outerTop!.y); shape.lineTo(innerTop!.x, innerTop!.y);
    shape.lineTo(innerBottom!.x, innerBottom!.y); shape.lineTo(outerBottom!.x, outerBottom!.y); shape.closePath();
    const wall = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 1.35, bevelEnabled: false }), this.rockMaterial);
    wall.position.z = -.72; group.add(wall);
    const edgePoints = [new THREE.Vector3(innerTop!.x, innerTop!.y, .66), new THREE.Vector3(innerBottom!.x, innerBottom!.y, .66)];
    group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(edgePoints), this.rockEdgeMaterial));
    if (this.cliffTemplate) {
      const detail = this.cliffTemplate.clone(true); detail.visible = true;
      detail.position.set((outerTop!.x * 2 + innerTop!.x + innerBottom!.x) / 4, 0, .18);
      detail.scale.set(Math.max(.5, state.width / WORLD_SCALE / 2.2), Math.max(.75, state.height / WORLD_SCALE / 2.7), .75);
      group.add(detail);
    }
    return group;
  }

  private makeKelp(state: ThreeHazardState) {
    if (this.kelpTemplate) {
      const model = this.kelpTemplate.clone(true); model.visible = true;
      const targetHeight = state.height / WORLD_SCALE; model.scale.setScalar(targetHeight / 2.9); return model;
    }
    const group = new THREE.Group();
    for (let i = 0; i < 5; i += 1) {
      const blade = new THREE.Mesh(new THREE.PlaneGeometry(.12, state.height / WORLD_SCALE * (.65 + i * .07), 1, this.lowPower ? 3 : 7), this.kelpMaterial);
      blade.position.x = (i - 2) * .14; blade.position.y = state.height / WORLD_SCALE * .35; blade.rotation.z = (i - 2) * .035; group.add(blade);
    }
    return group;
  }

  private makeVent(state: ThreeHazardState) {
    if (this.ventTemplate) {
      const model = this.ventTemplate.clone(true); model.visible = true; model.scale.setScalar(state.height / WORLD_SCALE / 2.2);
      const plume = new THREE.Group(); plume.name = "plume"; model.add(plume); return model;
    }
    const group = new THREE.Group();
    const vent = new THREE.Mesh(new THREE.CylinderGeometry(.28, .46, .9, 9), new THREE.MeshStandardMaterial({ color: 0x28363a, roughness: .94 })); group.add(vent);
    const particleCount = this.lowPower ? 16 : 32;
    const geometry = new THREE.BufferGeometry(); const points = new Float32Array(particleCount * 3);
    for (let i = 0; i < particleCount; i += 1) { points[i * 3] = (Math.random() - .5) * .35; points[i * 3 + 1] = Math.random() * state.height / WORLD_SCALE; points[i * 3 + 2] = (Math.random() - .5) * .35; }
    geometry.setAttribute("position", new THREE.BufferAttribute(points, 3));
    const plume = new THREE.Points(geometry, new THREE.PointsMaterial({ color: 0xb6f4ff, size: .07, transparent: true, opacity: .7 })); plume.name = "plume"; plume.position.y = .45; group.add(plume); return group;
  }

  private createBoss() {
    const material = new THREE.MeshStandardMaterial({ color: 0x172842, roughness: .6, emissive: 0x06101c, emissiveIntensity: .6 });
    const body = new THREE.Mesh(new THREE.SphereGeometry(1, this.lowPower ? 24 : 40, this.lowPower ? 14 : 24), material); body.scale.set(6.2, 2.2, 1.35); this.bossRoot.add(body);
    const tailShape = new THREE.Shape(); tailShape.moveTo(-5.3, 0); tailShape.lineTo(-8.8, 2.8); tailShape.lineTo(-7.7, 0); tailShape.lineTo(-8.8, -2.8); tailShape.closePath();
    const tail = new THREE.Mesh(new THREE.ShapeGeometry(tailShape), material); tail.position.z = -.15; this.bossRoot.add(tail);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(.32, 18, 12), new THREE.MeshStandardMaterial({ color: 0xffd45d, emissive: 0xffa51f, emissiveIntensity: 3 })); eye.position.set(3.2, .35, 1.2); this.bossRoot.add(eye);
  }

  private updateBoss(state: ThreeBossState) {
    this.bossRoot.visible = state.active;
    if (!state.active) return;
    this.bossRoot.position.set(worldX(state.x), worldY(state.y), .15); this.bossRoot.rotation.y = state.direction < 0 ? Math.PI : 0;
    const tail = this.bossRoot.getObjectByName("tail"); if (tail) tail.rotation.y = Math.sin(performance.now() * .0024) * .13;
    this.bossRoot.traverse((object) => {
      if (!(object instanceof THREE.Mesh) || !(object.material instanceof THREE.MeshStandardMaterial)) return;
      object.material.emissiveIntensity = state.revealed ? .8 : state.flash > 0 ? 1.2 : .35;
    });
  }
}
