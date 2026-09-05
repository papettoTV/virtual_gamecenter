import * as THREE from "three";

const MAX_BULLETS = 12_000;
const MAX_PARTICLES = 512;

type BulletShape = "circle" | "diamond" | "triangle" | "square" | "star" | "pill" | "line" | "spinner" | "smallCircle";

type BulletState = {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  color: string;
  shape?: BulletShape;
  rotation?: number;
  age: number;
  type: string;
  spectatorRenderBaseX?: number;
  spectatorRenderBaseY?: number;
  spectatorRenderBaseElapsed?: number;
};

type PlayerBulletState = {
  fieldX: number;
  x: number;
  y: number;
  color: string;
  tilt: number;
  invincible: number;
  levelUpInvincible: number;
  barrierRatio: number;
  levelUpFlash: number;
  bullets: BulletState[];
};

type BossState = {
  active: boolean;
  phaseIndex: number;
  x: number;
  y: number;
  radius: number;
  hp: number;
  flash: number;
  encounterState: string;
  arrivalProgress: number;
};

type ParticleState = {
  x: number;
  y: number;
  color: string;
  life: number;
  size?: number;
};

type RenderFrame = {
  players: PlayerBulletState[];
  boss: BossState;
  opponentBoss: BossState;
  particles: ParticleState[];
};

type RenderOptions = {
  compact: boolean;
  selectedPlayerIndex: number;
  fieldTop: number;
  fieldBottom: number;
  fieldWidth: number;
  gpuReplay: boolean;
  revision: number;
};

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

export type ThreeBulletLayer = {
  mount(host: Element | null, referenceCanvas: HTMLCanvasElement): void;
  render(frame: RenderFrame, elapsed: number, options: RenderOptions): void;
  dispose(): void;
};

export function createThreeBulletLayer(width: number, height: number): ThreeBulletLayer {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false, powerPreference: "high-performance" });
  renderer.setPixelRatio(1);
  renderer.setSize(width, height, false);
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-width / 2, width / 2, height / 2, -height / 2, 0.1, 10);
  camera.position.z = 2;

  const { geometry, attributes } = createGeometry();
  const { material, elapsedUniform } = createMaterial(width, height);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;
  const playerVisuals = [createPlayerVisual(), createPlayerVisual()];
  const bossVisuals = [createBossVisual(), createBossVisual()];
  const particleVisual = createParticleVisual();
  scene.add(mesh, particleVisual.points, ...playerVisuals.map((visual) => visual.root), ...bossVisuals.map((visual) => visual.root));

  const colorCache = new Map<string, THREE.Color>();
  let referenceCanvas: HTMLCanvasElement | null = null;
  let lastGpuReplayKey = "";

  return {
    mount(host, reference) {
      if (!host) return;
      referenceCanvas = reference;
      canvas.dataset.threeBulletLayer = "true";
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
        "object-fit:cover",
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
          const field = transformField(player.fieldX, options, transform);
          for (const bullet of player.bullets) {
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
      updateBossVisual(bossVisuals[0]!, frame.boss, 0, elapsed, transform, options, width, height);
      updateBossVisual(bossVisuals[1]!, frame.opponentBoss, 1, elapsed, transform, options, width, height);
      updateParticleVisual(particleVisual, frame.particles, transform, width, height, colorCache);
      renderer.clear();
      renderer.render(scene, camera);
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
  shield: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>;
  hitMarker: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>;
};

type BossVisual = {
  root: THREE.Group;
  shapes: Array<THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>>;
  aura: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>;
  eye: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>;
  pupil: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>;
};

type ParticleVisual = {
  points: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  positions: THREE.BufferAttribute;
  colors: THREE.BufferAttribute;
};

function createPlayerVisual(): PlayerVisual {
  const root = new THREE.Group();
  root.renderOrder = 4;
  const ship = new THREE.Mesh(
    new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute([
      0, 18, 0, -5, 8, 0, -17, -10, 0,
      0, 18, 0, -17, -10, 0, -7, -6, 0,
      0, 18, 0, -7, -6, 0, 0, -10, 0,
      0, 18, 0, 0, -10, 0, 7, -6, 0,
      0, 18, 0, 7, -6, 0, 17, -10, 0,
    ], 3)),
    new THREE.MeshBasicMaterial({ color: 0x69f7ff, transparent: true }),
  );
  const shield = new THREE.Mesh(
    new THREE.CircleGeometry(1, 48),
    new THREE.MeshBasicMaterial({ color: 0x69f7ff, transparent: true, opacity: 0.36, blending: THREE.AdditiveBlending, depthTest: false }),
  );
  const hitMarker = new THREE.Mesh(
    new THREE.CircleGeometry(3, 20),
    new THREE.MeshBasicMaterial({ color: 0xff3355, transparent: true, depthTest: false }),
  );
  shield.renderOrder = 3;
  ship.renderOrder = 4;
  hitMarker.renderOrder = 5;
  root.add(shield, ship, hitMarker);
  return { root, ship, shield, hitMarker };
}

function createBossVisual(): BossVisual {
  const root = new THREE.Group();
  const material = () => new THREE.MeshBasicMaterial({ color: 0x18051f, transparent: true, depthTest: false });
  const shapes = [
    new THREE.Mesh(new THREE.CircleGeometry(1, 64), material()),
    new THREE.Mesh(createPolygonGeometry(3, Math.PI / 2), material()),
    new THREE.Mesh(createStarGeometry(5, 0.46), material()),
  ];
  const aura = new THREE.Mesh(
    new THREE.CircleGeometry(1, 64),
    new THREE.MeshBasicMaterial({ color: 0xff3355, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthTest: false }),
  );
  const eye = new THREE.Mesh(
    new THREE.CircleGeometry(1, 32),
    new THREE.MeshBasicMaterial({ color: 0xfff4f6, transparent: true, depthTest: false }),
  );
  const pupil = new THREE.Mesh(
    new THREE.CircleGeometry(1, 24),
    new THREE.MeshBasicMaterial({ color: 0x180008, transparent: true, depthTest: false }),
  );
  aura.renderOrder = 0;
  shapes.forEach((shape) => { shape.renderOrder = 1; root.add(shape); });
  eye.renderOrder = 3;
  pupil.renderOrder = 4;
  root.add(aura, eye, pupil);
  return { root, shapes, aura, eye, pupil };
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
  players: PlayerBulletState[],
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
    visual.ship.material.color.set(player.color);
    const levelInvincible = player.levelUpInvincible > 0;
    const hitInvincible = player.invincible > 0 && !levelInvincible;
    const warning = levelInvincible && player.levelUpInvincible <= 0.5;
    visual.ship.material.opacity = hitInvincible && Math.floor(elapsed * 18) % 2 === 0 ? 0.45 : 1;
    visual.shield.visible = levelInvincible;
    const shieldRadius = 18 + player.barrierRatio * 28 + (0.55 + Math.sin(elapsed * 18) * 0.22) * 5;
    visual.shield.scale.setScalar(shieldRadius);
    visual.shield.material.opacity = warning && Math.floor(elapsed * 18) % 2 === 0 ? 0.1 : 0.42;
    visual.hitMarker.material.color.set(levelInvincible ? 0xd9fdff : hitInvincible ? 0xffd166 : 0xff3355);
    visual.hitMarker.material.opacity = warning && Math.floor(elapsed * 18) % 2 === 0 ? 0.25 : 1;
  }
}

function updateBossVisual(
  visual: BossVisual,
  boss: BossState,
  playerIndex: number,
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
  const radius = boss.radius * (0.68 + progress * 0.32) + (0.5 + Math.sin(elapsed * 3.2) * 0.16) * 5;
  visual.root.scale.setScalar(transform.scale);
  visual.root.rotation.z = boss.phaseIndex === 2 ? elapsed * 0.08 : 0;
  visual.root.children.forEach((child) => { child.visible = true; });
  visual.shapes.forEach((shape, index) => { shape.visible = index === Math.min(2, boss.phaseIndex); });
  const body = visual.shapes[Math.min(2, boss.phaseIndex)]!;
  body.scale.setScalar(radius);
  body.material.color.set(boss.flash > 0 ? 0xffffff : [0x18051f, 0x071722, 0x1c0628][boss.phaseIndex] ?? 0x18051f);
  body.material.opacity = entering ? 0.08 + progress * 0.92 : 1;
  visual.aura.scale.setScalar(radius * (1.35 + Math.sin(elapsed * 4) * 0.08));
  visual.aura.material.opacity = entering ? progress * 0.12 : 0.2;
  visual.eye.scale.set(radius * 0.34, radius * 0.09, 1);
  visual.pupil.scale.set(radius * 0.07, radius * 0.1, 1);
}

function updateParticleVisual(
  visual: ParticleVisual,
  particles: ParticleState[],
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

function createPolygonGeometry(sides: number, rotation: number) {
  const shape = new THREE.Shape();
  for (let index = 0; index < sides; index += 1) {
    const angle = rotation + Math.PI * 2 * index / sides;
    const x = Math.cos(angle);
    const y = Math.sin(angle);
    if (index === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.closePath();
  return new THREE.ShapeGeometry(shape);
}

function createStarGeometry(points: number, innerRadius: number) {
  const shape = new THREE.Shape();
  for (let index = 0; index < points * 2; index += 1) {
    const angle = Math.PI / 2 + Math.PI * index / points;
    const radius = index % 2 === 0 ? 1 : innerRadius;
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    if (index === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.closePath();
  return new THREE.ShapeGeometry(shape);
}

function disposeVisuals(playerVisuals: PlayerVisual[], bossVisuals: BossVisual[], particleVisual: ParticleVisual) {
  for (const visual of playerVisuals) disposeObject(visual.root);
  for (const visual of bossVisuals) disposeObject(visual.root);
  particleVisual.points.geometry.dispose();
  particleVisual.points.material.dispose();
}

function disposeObject(object: THREE.Object3D) {
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    child.geometry.dispose();
    child.material.dispose();
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
  player: PlayerBulletState | undefined,
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

function bulletDimensions(bullet: BulletState) {
  const radius = bullet.radius;
  if (bullet.shape === "pill") return { width: radius * 0.75, height: radius * 1.45 };
  if (bullet.shape === "line") return { width: radius * 0.45, height: radius * 1.8 };
  if (bullet.shape === "spinner") return { width: radius * 0.65, height: radius * 1.35 };
  if (bullet.shape === "smallCircle") return { width: radius * 0.82, height: radius * 0.82 };
  if (bullet.shape === "diamond" || bullet.shape === "triangle") return { width: radius * 1.1, height: radius * 1.25 };
  if (bullet.shape === "star") return { width: radius * 1.35, height: radius * 1.35 };
  return { width: radius, height: radius };
}

function shapeCode(shape: BulletShape | undefined) {
  if (shape === "diamond") return 1;
  if (shape === "triangle") return 2;
  if (shape === "square") return 3;
  if (shape === "star") return 4;
  return 0;
}

function bulletRotation(bullet: BulletState, elapsed: number) {
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
