import * as THREE from "three";

const MAX_BULLETS = 12_000;

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
  bullets: BulletState[];
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
  render(players: PlayerBulletState[], elapsed: number, options: RenderOptions): void;
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
  scene.add(mesh);

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
    render(players, elapsed, options) {
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
      renderer.clear();
      renderer.render(scene, camera);
    },
    dispose() {
      geometry.dispose();
      material.dispose();
      renderer.dispose();
      canvas.remove();
    },
  };
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
