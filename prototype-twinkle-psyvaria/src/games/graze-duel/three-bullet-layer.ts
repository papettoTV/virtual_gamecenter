import * as THREE from "three";

const MAX_BULLETS = 12_000;

type BulletShape = "circle" | "diamond" | "triangle" | "square" | "star" | "pill" | "line" | "spinner" | "smallCircle";

type BulletState = {
  x: number;
  y: number;
  radius: number;
  color: string;
  shape?: BulletShape;
  rotation?: number;
  age: number;
};

type PlayerBulletState = {
  bullets: BulletState[];
};

type BulletAttributes = {
  center: THREE.InstancedBufferAttribute;
  size: THREE.InstancedBufferAttribute;
  shape: THREE.InstancedBufferAttribute;
  rotation: THREE.InstancedBufferAttribute;
  color: THREE.InstancedBufferAttribute;
};

export type ThreeBulletLayer = {
  render(player: PlayerBulletState, elapsed: number): HTMLCanvasElement;
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
  const material = createMaterial();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  scene.add(mesh);

  const colorCache = new Map<string, THREE.Color>();

  return {
    render(player, elapsed) {
      const count = Math.min(player.bullets.length, MAX_BULLETS);
      for (let index = 0; index < count; index += 1) {
        const bullet = player.bullets[index]!;
        const dimensions = bulletDimensions(bullet);
        const color = cachedColor(colorCache, bullet.color);
        attributes.center.setXY(index, bullet.x - width / 2, height / 2 - bullet.y);
        attributes.size.setXY(index, dimensions.width, dimensions.height);
        attributes.shape.setX(index, shapeCode(bullet.shape));
        attributes.rotation.setX(index, bulletRotation(bullet, elapsed));
        attributes.color.setXYZ(index, color.r, color.g, color.b);
      }

      geometry.instanceCount = count;
      attributes.center.needsUpdate = true;
      attributes.size.needsUpdate = true;
      attributes.shape.needsUpdate = true;
      attributes.rotation.needsUpdate = true;
      attributes.color.needsUpdate = true;
      renderer.clear();
      renderer.render(scene, camera);
      return canvas;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
      renderer.dispose();
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
  };
  geometry.setAttribute("aCenter", attributes.center);
  geometry.setAttribute("aSize", attributes.size);
  geometry.setAttribute("aShape", attributes.shape);
  geometry.setAttribute("aRotation", attributes.rotation);
  geometry.setAttribute("aColor", attributes.color);
  return { geometry, attributes };
}

function createMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: `
      attribute vec2 aCenter;
      attribute vec2 aSize;
      attribute float aShape;
      attribute float aRotation;
      attribute vec3 aColor;
      varying vec2 vUv;
      varying float vShape;
      varying vec3 vColor;

      void main() {
        vec2 local = position.xy * aSize;
        float sine = sin(aRotation);
        float cosine = cos(aRotation);
        local = mat2(cosine, -sine, sine, cosine) * local;
        vUv = uv;
        vShape = aShape;
        vColor = aColor;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(aCenter + local, 0.0, 1.0);
      }
    `,
    fragmentShader: `
      varying vec2 vUv;
      varying float vShape;
      varying vec3 vColor;

      float starDistance(vec2 point) {
        float angle = atan(point.y, point.x);
        float radius = length(point);
        float edge = mix(0.42, 0.95, 0.5 + 0.5 * cos(angle * 4.0));
        return radius / edge;
      }

      void main() {
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
