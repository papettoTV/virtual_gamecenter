import { createPlayerEffects } from "./three-player-effects";
import * as THREE from "three";
import { drawPlayerShip } from "./player-ship";
import { createBossModels, getBossAppearance, getBossRotation, writeBossPositions, type BossModel } from "./boss-geometry";
import type {
  BossRenderState,
  BulletRenderState,
  GameSceneRenderer,
  ParticleRenderState,
  PlayerRenderState,
  RenderOptions,
  SceneRenderFrame,
} from "./scene-renderer";

const MAX_BULLETS = 12_000;
const MAX_PARTICLES = 512;

type BulletAttributes = {
  center: THREE.InstancedBufferAttribute;
  size: THREE.InstancedBufferAttribute;
  shape: THREE.InstancedBufferAttribute;
  rotation: THREE.InstancedBufferAttribute;
  color: THREE.InstancedBufferAttribute;
  fieldBounds: THREE.InstancedBufferAttribute;
  velocity: THREE.InstancedBufferAttribute;
  baseElapsed: THREE.InstancedBufferAttribute;
  bounce: THREE.InstancedBufferAttribute;
  bounceBounds: THREE.InstancedBufferAttribute;
};

export function createThreeGameRenderer(width: number, height: number): GameSceneRenderer {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false, powerPreference: "high-performance" });
  renderer.setPixelRatio(1);
  renderer.setSize(width, height, false);
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.localClippingEnabled = true;

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-width / 2, width / 2, height / 2, -height / 2, 0.1, 2000);
  camera.position.z = 1000;
  const keyLight = new THREE.DirectionalLight(0xe9fcff, 1.8);
  keyLight.position.set(-100, 180, 300);
  scene.add(new THREE.AmbientLight(0x8cb5df, 0.65), keyLight);

  const { geometry, attributes } = createGeometry();
  const { material, elapsedUniform } = createMaterial(width, height);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;
  const playerVisuals = [createPlayerVisual(), createPlayerVisual()];
  const bossModels = createBossModels();
  const bossVisuals = [createBossVisual(bossModels), createBossVisual(bossModels)];
  const particleVisual = createParticleVisual();
  scene.add(mesh, particleVisual.points, ...playerVisuals.map((visual) => visual.root), ...bossVisuals.map((visual) => visual.root));

  const colorCache = new Map<string, THREE.Color>();
  let referenceCanvas: HTMLCanvasElement | null = null;
  let lastGpuReplayKey = "";
  let frameCount = 0;
  let sampleStartedAt = performance.now();
  let metrics = { fps: 0, drawCalls: 0, bulletCount: 0, gpuReplay: false };

  return {
    mount(host, reference) {
      if (!host) return;
      referenceCanvas = reference;
      canvas.dataset.threeGameRenderer = "true";
      canvas.setAttribute("aria-hidden", "true");
      canvas.style.cssText = [
        "position:absolute",
        "inset:0",
        "z-index:1",
        "width:100%",
        "height:100%",
        "border:0",
        "border-radius:20px",
        "background:transparent",
        "box-shadow:none",
        "object-fit:var(--game-canvas-fit, cover)",
        "object-position:center",
        "pointer-events:none",
      ].join(";");
      host.appendChild(canvas);
    },
    render(frame, elapsed, options) {
      const players = frame.players;
      const visiblePlayers = options.compact
        ? players.slice(options.selectedPlayerIndex, options.selectedPlayerIndex + 1)
        : players;
      const transform = createViewTransform(width, height, visiblePlayers[0], referenceCanvas, options);
      const replayKey = `${options.revision}:${options.selectedPlayerIndex}:${referenceCanvas?.clientWidth ?? 0}:${referenceCanvas?.clientHeight ?? 0}`;
      if (!options.gpuReplay || replayKey !== lastGpuReplayKey) {
        let instanceIndex = 0;
        for (const player of visiblePlayers) {
          const playerIndex = players.indexOf(player);
          const field = transformField(player.fieldX, options, transform);
          const benchmarkBullets = frame.benchmarkBulletsByPlayer?.[playerIndex] ?? [];
          for (const bullets of [player.bullets, benchmarkBullets]) {
            for (const bullet of bullets) {
              if (instanceIndex >= MAX_BULLETS) break;
              const dimensions = bulletDimensions(bullet);
              const color = cachedColor(colorCache, bullet.color);
              const baseX = options.gpuReplay ? bullet.spectatorRenderBaseX ?? bullet.x : bullet.x;
              const baseY = options.gpuReplay ? bullet.spectatorRenderBaseY ?? bullet.y : bullet.y;
              const center = transformPoint(baseX, baseY, transform);
              attributes.center.setXY(instanceIndex, center.x - width / 2, height / 2 - center.y);
              attributes.size.setXY(instanceIndex, dimensions.width * transform.scale, dimensions.height * transform.scale);
              attributes.shape.setX(instanceIndex, shapeCode(bullet.shape));
              attributes.rotation.setX(instanceIndex, bulletRotation(bullet, elapsed));
              attributes.color.setXYZ(instanceIndex, color.r, color.g, color.b);
              attributes.fieldBounds.setXYZW(instanceIndex, field.left, field.top, field.right, field.bottom);
              attributes.velocity.setXY(instanceIndex, bullet.vx * transform.scale, -bullet.vy * transform.scale);
              attributes.baseElapsed.setX(instanceIndex, options.gpuReplay ? bullet.spectatorRenderBaseElapsed ?? elapsed : elapsed);
              attributes.bounce.setX(instanceIndex, options.gpuReplay && bullet.type !== "bossAttack" ? 1 : 0);
              attributes.bounceBounds.setXY(instanceIndex, field.left + 20 * transform.scale - width / 2, field.right - 20 * transform.scale - width / 2);
              instanceIndex += 1;
            }
          }
        }

        geometry.instanceCount = instanceIndex;
        attributes.center.needsUpdate = true;
        attributes.size.needsUpdate = true;
        attributes.shape.needsUpdate = true;
        attributes.rotation.needsUpdate = true;
        attributes.color.needsUpdate = true;
        attributes.fieldBounds.needsUpdate = true;
        attributes.velocity.needsUpdate = true;
        attributes.baseElapsed.needsUpdate = true;
        attributes.bounce.needsUpdate = true;
        attributes.bounceBounds.needsUpdate = true;
        lastGpuReplayKey = options.gpuReplay ? replayKey : "";
      }
      elapsedUniform.value = elapsed;
      updatePlayerVisuals(playerVisuals, players, elapsed, transform, options);
      updateBossVisual(bossVisuals[0]!, frame.boss, 0, players[0]?.fieldX ?? 0, elapsed, transform, options, width, height);
      updateBossVisual(bossVisuals[1]!, frame.opponentBoss, 1, players[1]?.fieldX ?? 0, elapsed, transform, options, width, height);
      updateParticleVisual(particleVisual, frame.particles, transform, width, height, colorCache);
      renderer.clear();
      renderer.render(scene, camera);
      frameCount += 1;
      const now = performance.now();
      if (now - sampleStartedAt >= 500) {
        metrics = {
          fps: Math.round(frameCount * 1000 / (now - sampleStartedAt)),
          drawCalls: renderer.info.render.calls,
          bulletCount: geometry.instanceCount,
          gpuReplay: options.gpuReplay,
        };
        frameCount = 0;
        sampleStartedAt = now;
      }
    },
    getMetrics() {
      return metrics;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
      disposeVisuals(playerVisuals, bossVisuals, particleVisual);
      renderer.dispose();
      canvas.remove();
    },
  };
}

type PlayerVisual = {
  root: THREE.Group;
  ship: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  shipColor: string;
  effects: ReturnType<typeof createPlayerEffects>;
  hitMarker: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>;
};

type BossVisual = {
  root: THREE.Group;
  models: Array<{
    root: THREE.Group;
    surface: THREE.Mesh<THREE.BufferGeometry, THREE.MeshPhongMaterial>;
    lines: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>;
    depthRadius: { value: number };
    source: BossModel;
    faceIndices: number[];
    edgeIndices: number[];
  }>;
  rim: THREE.LineLoop<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  clippingPlanes: THREE.Plane[];
};

type ParticleVisual = {
  points: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  positions: THREE.BufferAttribute;
  colors: THREE.BufferAttribute;
};

function createPlayerVisual(): PlayerVisual {
  const root = new THREE.Group();
  root.renderOrder = 4;
  const shipColor = "#69f7ff";
  const ship = new THREE.Mesh(
    new THREE.PlaneGeometry(80, 80),
    new THREE.MeshBasicMaterial({ map: createPlayerShipTexture(shipColor), transparent: true, depthTest: false, depthWrite: false }),
  );
  const effects = createPlayerEffects();
  const hitMarker = new THREE.Mesh(
    new THREE.CircleGeometry(3, 20),
    new THREE.MeshBasicMaterial({ color: 0xff3355, transparent: true, depthTest: false }),
  );
  ship.renderOrder = 4;
  hitMarker.renderOrder = 5;
  root.add(effects.root, ship, hitMarker);
  return { root, ship, shipColor, effects, hitMarker };
}

function createPlayerShipTexture(color: string): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 320;
  canvas.height = 320;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Unable to create player ship texture");
  context.scale(4, 4);
  context.translate(40, 40);
  drawPlayerShip(context, color, 4);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function createBossVisual(models: BossModel[]): BossVisual {
  const root = new THREE.Group();
  const clippingPlanes = [
    new THREE.Plane(new THREE.Vector3(1, 0, 0)),
    new THREE.Plane(new THREE.Vector3(-1, 0, 0)),
    new THREE.Plane(new THREE.Vector3(0, -1, 0)),
    new THREE.Plane(new THREE.Vector3(0, 1, 0)),
  ];
  const modelVisuals = models.map((model, phaseIndex) => {
    const modelRoot = new THREE.Group();
    const appearance = getBossAppearance(phaseIndex);
    const color = new THREE.Color(`rgb(${appearance.color.join(",")})`);
    const positions = model.faces.flatMap(face => face.flatMap(index => [...model.vertices[index]!]));
    const surfaceGeometry = new THREE.BufferGeometry();
    surfaceGeometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    if (phaseIndex === 0) {
      surfaceGeometry.setAttribute("normal", new THREE.Float32BufferAttribute(positions, 3));
    } else surfaceGeometry.computeVertexNormals();
    const surface = new THREE.Mesh(surfaceGeometry, new THREE.MeshPhongMaterial({
      color,
      emissive: color.clone().multiplyScalar(0.12),
      specular: 0xcceeff,
      shininess: 100,
      transparent: true,
      opacity: phaseIndex === 0 ? 0.14 : 0.17,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
      flatShading: phaseIndex !== 0,
      clippingPlanes,
    }));
    const edgePositions = model.edges.flatMap(edge => edge.flatMap(index => [...model.vertices[index]!]));
    const edgeGeometry = new THREE.BufferGeometry();
    edgeGeometry.setAttribute("position", new THREE.Float32BufferAttribute(edgePositions, 3));
    if (phaseIndex === 2) {
      (surfaceGeometry.getAttribute("position") as THREE.BufferAttribute).setUsage(THREE.DynamicDrawUsage);
      (surfaceGeometry.getAttribute("normal") as THREE.BufferAttribute).setUsage(THREE.DynamicDrawUsage);
      (edgeGeometry.getAttribute("position") as THREE.BufferAttribute).setUsage(THREE.DynamicDrawUsage);
    }
    const lines = new THREE.LineSegments(edgeGeometry, new THREE.LineBasicMaterial({
      color: new THREE.Color(`rgb(${appearance.edgeColor.join(",")})`), transparent: true, opacity: 0.95, depthTest: false, depthWrite: false, clippingPlanes,
    }));
    const depthRadius = { value: 1 };
    lines.material.onBeforeCompile = shader => {
      shader.uniforms.bossDepthRadius = depthRadius;
      shader.vertexShader = `varying float vBossDepth;\n${shader.vertexShader}`.replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\nvBossDepth = (modelMatrix * vec4(position, 1.0)).z;",
      );
      shader.fragmentShader = `uniform float bossDepthRadius;\nvarying float vBossDepth;\n${shader.fragmentShader}`.replace(
        "#include <color_fragment>",
        "#include <color_fragment>\ndiffuseColor.a *= mix(0.16, 1.0, smoothstep(-0.45, 0.6, vBossDepth / max(0.001, bossDepthRadius)));",
      );
    };
    surface.renderOrder = 0;
    lines.renderOrder = 1;
    modelRoot.add(surface, lines);
    root.add(modelRoot);
    return { root: modelRoot, surface, lines, depthRadius, source: model, faceIndices: model.faces.flat(), edgeIndices: model.edges.flat() };
  });
  const ringPoints = Array.from({ length: 64 }, (_, index) => {
    const angle = index * Math.PI * 2 / 64;
    return new THREE.Vector3(Math.cos(angle), Math.sin(angle), 0);
  });
  const rim = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints(ringPoints),
    new THREE.LineBasicMaterial({ color: new THREE.Color(`rgb(${getBossAppearance(0).edgeColor.join(",")})`), transparent: true, opacity: 1, depthTest: false, depthWrite: false, clippingPlanes }),
  );
  rim.renderOrder = 1;
  root.add(rim);
  return { root, models: modelVisuals, rim, clippingPlanes };
}

function createParticleVisual(): ParticleVisual {
  const positions = new THREE.BufferAttribute(new Float32Array(MAX_PARTICLES * 3), 3).setUsage(THREE.DynamicDrawUsage);
  const colors = new THREE.BufferAttribute(new Float32Array(MAX_PARTICLES * 3), 3).setUsage(THREE.DynamicDrawUsage);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", positions);
  geometry.setAttribute("color", colors);
  geometry.setDrawRange(0, 0);
  const material = new THREE.PointsMaterial({ size: 6, vertexColors: true, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthTest: false });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.renderOrder = 5;
  return { points, positions, colors };
}

function updatePlayerVisuals(
  visuals: PlayerVisual[],
  players: PlayerRenderState[],
  elapsed: number,
  transform: ViewTransform,
  options: RenderOptions,
) {
  for (let index = 0; index < visuals.length; index += 1) {
    const visual = visuals[index]!;
    const player = players[index];
    const visible = Boolean(player) && (!options.compact || index === options.selectedPlayerIndex);
    visual.root.visible = visible;
    if (!visible || !player) continue;
    const point = transformPoint(player.x, player.y, transform);
    visual.root.position.set(point.x - 480, 320 - point.y, 0);
    visual.root.scale.setScalar(transform.scale);
    visual.ship.scale.x = 1 - Math.min(0.48, Math.abs(player.tilt) * 0.48);
    visual.ship.position.x = player.tilt * 4;
    if (visual.shipColor !== player.color) {
      visual.ship.material.map?.dispose();
      visual.ship.material.map = createPlayerShipTexture(player.color);
      visual.shipColor = player.color;
    }
    const levelInvincible = player.levelUpInvincible > 0;
    const hitInvincible = player.invincible > 0 && !levelInvincible;
    const warning = levelInvincible && player.levelUpInvincible <= 0.5;
    visual.ship.material.opacity = hitInvincible && Math.floor(elapsed * 18) % 2 === 0 ? 0.45 : 1;
    visual.effects.update(player, elapsed);
    visual.hitMarker.material.color.set(levelInvincible ? 0xd9fdff : hitInvincible ? 0xffd166 : 0xff3355);
    visual.hitMarker.material.opacity = warning && Math.floor(elapsed * 18) % 2 === 0 ? 0.25 : 1;
  }
}

function updateBossVisual(
  visual: BossVisual,
  boss: BossRenderState,
  playerIndex: number,
  fieldX: number,
  elapsed: number,
  transform: ViewTransform,
  options: RenderOptions,
  width: number,
  height: number,
) {
  const visible = boss.active && boss.hp > 0 && (!options.compact || playerIndex === options.selectedPlayerIndex);
  visual.root.visible = visible;
  if (!visible) return;
  const point = transformPoint(boss.x, boss.y, transform);
  visual.root.position.set(point.x - width / 2, height / 2 - point.y, 0);
  const entering = boss.encounterState === "entering";
  const progress = entering ? boss.arrivalProgress : 1;
  const appearance = getBossAppearance(boss.phaseIndex);
  const radius = boss.radius * appearance.scale * (0.68 + progress * 0.32);
  visual.root.scale.setScalar(transform.scale * radius);
  const rotation = getBossRotation(boss.phaseIndex, elapsed);
  const fade = 0.08 + progress * 0.92;
  for (let index = 0; index < visual.models.length; index += 1) {
    const model = visual.models[index]!;
    model.root.visible = index === boss.phaseIndex;
    if (!model.root.visible) continue;
    if (index === 2) {
      const surfacePositions = model.surface.geometry.getAttribute("position") as THREE.BufferAttribute;
      const edgePositions = model.lines.geometry.getAttribute("position") as THREE.BufferAttribute;
      writeBossPositions(model.source, model.faceIndices, index, elapsed, surfacePositions.array as Float32Array);
      writeBossPositions(model.source, model.edgeIndices, index, elapsed, edgePositions.array as Float32Array);
      surfacePositions.needsUpdate = true;
      edgePositions.needsUpdate = true;
      model.surface.geometry.computeVertexNormals();
    }
    model.root.rotation.set(rotation[0], rotation[1], rotation[2], "ZXY");
    model.surface.material.opacity = (index === 0 ? 0.14 : 0.17) * fade;
    model.lines.material.opacity = 0.95 * fade;
    model.depthRadius.value = radius * transform.scale;
    model.lines.material.color.set(boss.flash > 0 ? "#f4faff" : `rgb(${appearance.edgeColor.join(",")})`);
  }
  visual.rim.visible = boss.phaseIndex === 0;
  visual.rim.material.opacity = fade;
  visual.rim.material.color.set(boss.flash > 0 ? "#f4faff" : `rgb(${appearance.edgeColor.join(",")})`);
  const field = transformField(fieldX, options, transform);
  visual.clippingPlanes[0]!.constant = width / 2 - field.left;
  visual.clippingPlanes[1]!.constant = field.right - width / 2;
  visual.clippingPlanes[2]!.constant = height / 2 - field.top;
  visual.clippingPlanes[3]!.constant = field.bottom - height / 2;
}

function updateParticleVisual(
  visual: ParticleVisual,
  particles: ParticleRenderState[],
  transform: ViewTransform,
  width: number,
  height: number,
  colorCache: Map<string, THREE.Color>,
) {
  const count = Math.min(MAX_PARTICLES, particles.length);
  for (let index = 0; index < count; index += 1) {
    const particle = particles[index]!;
    const point = transformPoint(particle.x, particle.y, transform);
    const color = cachedColor(colorCache, particle.color);
    visual.positions.setXYZ(index, point.x - width / 2, height / 2 - point.y, 0);
    visual.colors.setXYZ(index, color.r, color.g, color.b);
  }
  visual.points.geometry.setDrawRange(0, count);
  visual.points.material.size = 6 * transform.scale;
  visual.positions.needsUpdate = true;
  visual.colors.needsUpdate = true;
}

function disposeVisuals(playerVisuals: PlayerVisual[], bossVisuals: BossVisual[], particleVisual: ParticleVisual) {
  for (const visual of playerVisuals) {
    visual.ship.material.map?.dispose();
    visual.effects.dispose();
    disposeObject(visual.root);
  }
  for (const visual of bossVisuals) disposeObject(visual.root);
  particleVisual.points.geometry.dispose();
  particleVisual.points.material.dispose();
}

function disposeObject(object: THREE.Object3D) {
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh) && !(child instanceof THREE.Line)) return;
    child.geometry.dispose();
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of materials) material.dispose();
  });
}

function createGeometry(): { geometry: THREE.InstancedBufferGeometry; attributes: BulletAttributes } {
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute([
    -1, -1, 0, 1, -1, 0, 1, 1, 0,
    -1, -1, 0, 1, 1, 0, -1, 1, 0,
  ], 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute([
    0, 0, 1, 0, 1, 1,
    0, 0, 1, 1, 0, 1,
  ], 2));

  const attributes: BulletAttributes = {
    center: new THREE.InstancedBufferAttribute(new Float32Array(MAX_BULLETS * 2), 2).setUsage(THREE.DynamicDrawUsage),
    size: new THREE.InstancedBufferAttribute(new Float32Array(MAX_BULLETS * 2), 2).setUsage(THREE.DynamicDrawUsage),
    shape: new THREE.InstancedBufferAttribute(new Float32Array(MAX_BULLETS), 1).setUsage(THREE.DynamicDrawUsage),
    rotation: new THREE.InstancedBufferAttribute(new Float32Array(MAX_BULLETS), 1).setUsage(THREE.DynamicDrawUsage),
    color: new THREE.InstancedBufferAttribute(new Float32Array(MAX_BULLETS * 3), 3).setUsage(THREE.DynamicDrawUsage),
    fieldBounds: new THREE.InstancedBufferAttribute(new Float32Array(MAX_BULLETS * 4), 4).setUsage(THREE.DynamicDrawUsage),
    velocity: new THREE.InstancedBufferAttribute(new Float32Array(MAX_BULLETS * 2), 2).setUsage(THREE.DynamicDrawUsage),
    baseElapsed: new THREE.InstancedBufferAttribute(new Float32Array(MAX_BULLETS), 1).setUsage(THREE.DynamicDrawUsage),
    bounce: new THREE.InstancedBufferAttribute(new Float32Array(MAX_BULLETS), 1).setUsage(THREE.DynamicDrawUsage),
    bounceBounds: new THREE.InstancedBufferAttribute(new Float32Array(MAX_BULLETS * 2), 2).setUsage(THREE.DynamicDrawUsage),
  };
  geometry.setAttribute("aCenter", attributes.center);
  geometry.setAttribute("aSize", attributes.size);
  geometry.setAttribute("aShape", attributes.shape);
  geometry.setAttribute("aRotation", attributes.rotation);
  geometry.setAttribute("aColor", attributes.color);
  geometry.setAttribute("aFieldBounds", attributes.fieldBounds);
  geometry.setAttribute("aVelocity", attributes.velocity);
  geometry.setAttribute("aBaseElapsed", attributes.baseElapsed);
  geometry.setAttribute("aBounce", attributes.bounce);
  geometry.setAttribute("aBounceBounds", attributes.bounceBounds);
  return { geometry, attributes };
}

function createMaterial(width: number, height: number) {
  const elapsedUniform = { value: 0 };
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uElapsed: elapsedUniform },
    vertexShader: `
      uniform float uElapsed;
      attribute vec2 aCenter;
      attribute vec2 aSize;
      attribute float aShape;
      attribute float aRotation;
      attribute vec3 aColor;
      attribute vec4 aFieldBounds;
      attribute vec2 aVelocity;
      attribute float aBaseElapsed;
      attribute float aBounce;
      attribute vec2 aBounceBounds;
      varying vec2 vUv;
      varying float vShape;
      varying vec3 vColor;
      varying vec2 vScreenPosition;
      varying vec4 vFieldBounds;

      void main() {
        vec2 local = position.xy * aSize;
        float sine = sin(aRotation);
        float cosine = cos(aRotation);
        local = mat2(cosine, -sine, sine, cosine) * local;
        vUv = uv;
        vShape = aShape;
        vColor = aColor;
        float travel = max(0.0, uElapsed - aBaseElapsed);
        vec2 center = aCenter + aVelocity * travel;
        if (aBounce > 0.5) {
          float span = max(1.0, aBounceBounds.y - aBounceBounds.x);
          float cycle = mod(center.x - aBounceBounds.x, span * 2.0);
          if (cycle < 0.0) cycle += span * 2.0;
          center.x = aBounceBounds.x + (cycle <= span ? cycle : span * 2.0 - cycle);
        }
        vScreenPosition = center + local;
        vFieldBounds = aFieldBounds;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(center + local, 0.0, 1.0);
      }
    `,
    fragmentShader: `
      varying vec2 vUv;
      varying float vShape;
      varying vec3 vColor;
      varying vec2 vScreenPosition;
      varying vec4 vFieldBounds;

      float starDistance(vec2 point) {
        float angle = atan(point.y, point.x);
        float radius = length(point);
        float edge = mix(0.42, 0.95, 0.5 + 0.5 * cos(angle * 4.0));
        return radius / edge;
      }

      void main() {
        vec2 screenPosition = vec2(vScreenPosition.x + ${width.toFixed(1)} * 0.5, ${height.toFixed(1)} * 0.5 - vScreenPosition.y);
        if (screenPosition.x < vFieldBounds.x || screenPosition.x > vFieldBounds.z || screenPosition.y < vFieldBounds.y || screenPosition.y > vFieldBounds.w) discard;
        vec2 point = vUv * 2.0 - 1.0;
        float distanceToEdge = length(point);
        if (vShape > 0.5 && vShape < 1.5) distanceToEdge = abs(point.x) + abs(point.y);
        if (vShape > 1.5 && vShape < 2.5) {
          float lowerEdge = point.y + 1.0;
          float sideEdge = 1.0 - abs(point.x) - lowerEdge * 0.5;
          if (lowerEdge < 0.0 || sideEdge < 0.0) discard;
          distanceToEdge = max(1.0 - lowerEdge * 0.5, 1.0 - sideEdge);
        }
        if (vShape > 2.5 && vShape < 3.5) distanceToEdge = max(abs(point.x), abs(point.y));
        if (vShape > 3.5 && vShape < 4.5) distanceToEdge = starDistance(point);
        float alpha = 1.0 - smoothstep(0.76, 1.0, distanceToEdge);
        if (alpha <= 0.01) discard;
        float core = 1.0 - smoothstep(0.0, 0.48, distanceToEdge);
        gl_FragColor = vec4(mix(vColor, vec3(1.0), core * 0.82), alpha * 0.94);
      }
    `,
  });
  return { material, elapsedUniform };
}

type ViewTransform = {
  scale: number;
  offsetX: number;
  offsetY: number;
};

function createViewTransform(
  width: number,
  height: number,
  player: PlayerRenderState | undefined,
  referenceCanvas: HTMLCanvasElement | null,
  options: RenderOptions,
): ViewTransform {
  if (!options.compact || !player || !referenceCanvas) return { scale: 1, offsetX: 0, offsetY: 0 };
  const visibleSourceWidth = height * (referenceCanvas.clientWidth / Math.max(1, referenceCanvas.clientHeight));
  const horizontalScale = visibleSourceWidth / options.fieldWidth;
  const verticalScale = (height - 92) / (options.fieldBottom - options.fieldTop);
  const scale = Math.max(0.82, Math.min(1.05, horizontalScale, verticalScale));
  const focusX = player.fieldX + options.fieldWidth / 2;
  const focusY = options.fieldTop + (options.fieldBottom - options.fieldTop) / 2;
  return {
    scale,
    offsetX: width / 2 - focusX * scale,
    offsetY: height / 2 + 24 - focusY * scale,
  };
}

function transformPoint(x: number, y: number, transform: ViewTransform) {
  return {
    x: x * transform.scale + transform.offsetX,
    y: y * transform.scale + transform.offsetY,
  };
}

function transformField(fieldX: number, options: RenderOptions, transform: ViewTransform) {
  const topLeft = transformPoint(fieldX, options.fieldTop, transform);
  const bottomRight = transformPoint(fieldX + options.fieldWidth, options.fieldBottom, transform);
  return { left: topLeft.x, top: topLeft.y, right: bottomRight.x, bottom: bottomRight.y };
}

function bulletDimensions(bullet: BulletRenderState) {
  const radius = bullet.radius;
  if (bullet.shape === "pill") return { width: radius * 0.75, height: radius * 1.45 };
  if (bullet.shape === "line") return { width: radius * 0.45, height: radius * 1.8 };
  if (bullet.shape === "spinner") return { width: radius * 0.65, height: radius * 1.35 };
  if (bullet.shape === "smallCircle") return { width: radius * 0.82, height: radius * 0.82 };
  if (bullet.shape === "diamond" || bullet.shape === "triangle") return { width: radius * 1.1, height: radius * 1.25 };
  if (bullet.shape === "star") return { width: radius * 1.35, height: radius * 1.35 };
  return { width: radius, height: radius };
}

function shapeCode(shape: BulletRenderState["shape"]) {
  if (shape === "diamond") return 1;
  if (shape === "triangle") return 2;
  if (shape === "square") return 3;
  if (shape === "star") return 4;
  return 0;
}

function bulletRotation(bullet: BulletRenderState, elapsed: number) {
  if (bullet.shape === "spinner") return Math.floor((bullet.age || elapsed) * 24) * 0.35;
  return bullet.rotation ?? 0;
}

function cachedColor(cache: Map<string, THREE.Color>, value: string) {
  const existing = cache.get(value);
  if (existing) return existing;
  const color = new THREE.Color(value);
  cache.set(value, color);
  return color;
}
