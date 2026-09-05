import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import "./three-bullet-lab.css";

const WORLD_WIDTH = 960;
const WORLD_HEIGHT = 640;
const MAX_BULLETS = 6000;
const PLAYER_X = 0;
const PLAYER_Y = -235;

type LabMode = "player" | "spectator";

type LabMetrics = {
  fps: number;
  drawCalls: number;
  checks: number;
  grazes: number;
};

type BulletDescriptor = {
  startX: Float32Array;
  speedX: Float32Array;
  speedY: Float32Array;
  phase: Float32Array;
  cycle: Float32Array;
  sizeX: Float32Array;
  sizeY: Float32Array;
  shape: Float32Array;
  color: Float32Array;
};

export function ThreeBulletLab() {
  const mountRef = useRef<HTMLDivElement>(null);
  const [bulletCount, setBulletCount] = useState(2000);
  const [mode, setMode] = useState<LabMode>("spectator");
  const [paused, setPaused] = useState(false);
  const [metrics, setMetrics] = useState<LabMetrics>({ fps: 0, drawCalls: 0, checks: 0, grazes: 0 });
  const modeRef = useRef(mode);
  const pausedRef = useRef(paused);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x030714);
    const camera = new THREE.OrthographicCamera(
      -WORLD_WIDTH / 2,
      WORLD_WIDTH / 2,
      WORLD_HEIGHT / 2,
      -WORLD_HEIGHT / 2,
      0.1,
      10,
    );
    camera.position.z = 2;

    const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.setSize(mount.clientWidth, mount.clientHeight, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    mount.appendChild(renderer.domElement);

    const descriptors = createBulletDescriptors(bulletCount);
    const { material: bulletMaterial, timeUniform } = createBulletMaterial();
    const bulletGeometry = createBulletGeometry(descriptors, bulletCount);
    const bullets = new THREE.Mesh(bulletGeometry, bulletMaterial);
    bullets.frustumCulled = false;
    scene.add(bullets);

    const player = createPlayerMesh();
    player.position.set(PLAYER_X, PLAYER_Y, 0.2);
    scene.add(player);

    const shield = new THREE.Mesh(
      new THREE.RingGeometry(31, 36, 48),
      new THREE.MeshBasicMaterial({ color: 0x69f7ff, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending }),
    );
    shield.position.set(PLAYER_X, PLAYER_Y, 0.1);
    scene.add(shield);

    const field = createFieldOutline();
    scene.add(field);

    const clock = new THREE.Clock();
    let animationFrame = 0;
    let simulationTime = 0;
    let frameCount = 0;
    let sampleStartedAt = performance.now();
    let latestGrazes = 0;

    const resize = () => {
      if (!mount.clientWidth || !mount.clientHeight) return;
      const viewAspect = mount.clientWidth / mount.clientHeight;
      const worldAspect = WORLD_WIDTH / WORLD_HEIGHT;
      if (viewAspect < worldAspect) {
        const visibleHeight = WORLD_WIDTH / viewAspect;
        camera.left = -WORLD_WIDTH / 2;
        camera.right = WORLD_WIDTH / 2;
        camera.top = visibleHeight / 2;
        camera.bottom = -visibleHeight / 2;
      } else {
        const visibleWidth = WORLD_HEIGHT * viewAspect;
        camera.left = -visibleWidth / 2;
        camera.right = visibleWidth / 2;
        camera.top = WORLD_HEIGHT / 2;
        camera.bottom = -WORLD_HEIGHT / 2;
      }
      camera.updateProjectionMatrix();
      renderer.setSize(mount.clientWidth, mount.clientHeight, false);
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(mount);

    const render = () => {
      const delta = Math.min(clock.getDelta(), 0.05);
      if (!pausedRef.current) simulationTime += delta;
      timeUniform.value = simulationTime;
      player.rotation.z = Math.sin(simulationTime * 1.8) * 0.045;
      shield.scale.setScalar(1 + Math.sin(simulationTime * 4) * 0.08);
      (shield.material as THREE.MeshBasicMaterial).opacity = 0.36 + Math.sin(simulationTime * 5) * 0.16;

      let checks = 0;
      if (!pausedRef.current && modeRef.current === "player") {
        const collisionResult = runPlayerCollisionSample(descriptors, bulletCount, simulationTime);
        checks = collisionResult.checks;
        latestGrazes += collisionResult.grazes;
      }

      renderer.render(scene, camera);
      frameCount += 1;
      const now = performance.now();
      if (now - sampleStartedAt >= 500) {
        setMetrics({
          fps: Math.round((frameCount * 1000) / (now - sampleStartedAt)),
          drawCalls: renderer.info.render.calls,
          checks: modeRef.current === "player" ? checks : 0,
          grazes: latestGrazes,
        });
        frameCount = 0;
        sampleStartedAt = now;
      }
      animationFrame = requestAnimationFrame(render);
    };
    render();

    return () => {
      cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      disposeObject(scene);
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [bulletCount]);

  return (
    <main className="three-lab-shell">
      <header className="three-lab-header">
        <div>
          <p className="three-lab-eyebrow">BUZZ BARRIER / RENDERING LAB</p>
          <h1>Three.js 大量弾・観戦描画検証</h1>
          <p>既存ゲームを変更せず、GPUインスタンシングと観戦専用描画を比較する画面です。</p>
        </div>
        <button type="button" onClick={() => window.location.assign("/")}>ゲームセンターに戻る</button>
      </header>

      <section className="three-lab-controls" aria-label="検証設定">
        <label>
          <span>弾数</span>
          <select value={bulletCount} onChange={(event) => setBulletCount(Number(event.target.value))}>
            <option value={500}>500</option>
            <option value={1000}>1,000</option>
            <option value={2000}>2,000</option>
            <option value={4000}>4,000</option>
            <option value={6000}>6,000</option>
          </select>
        </label>
        <div className="three-lab-mode" role="group" aria-label="実行モード">
          <button className={mode === "player" ? "is-active" : ""} type="button" onClick={() => setMode("player")}>プレイヤー側</button>
          <button className={mode === "spectator" ? "is-active" : ""} type="button" onClick={() => setMode("spectator")}>観戦側</button>
        </div>
        <button type="button" onClick={() => setPaused((current) => !current)}>{paused ? "再開" : "一時停止"}</button>
      </section>

      <section className="three-lab-stage-card">
        <div className="three-lab-stage" ref={mountRef} aria-label="Three.js弾幕描画" />
        <aside className="three-lab-metrics" aria-live="polite">
          <Metric label="FPS" value={metrics.fps} />
          <Metric label="BULLETS" value={bulletCount.toLocaleString("ja-JP")} />
          <Metric label="DRAW CALLS" value={metrics.drawCalls} />
          <Metric label="COLLISION CHECK" value={mode === "player" ? metrics.checks.toLocaleString("ja-JP") : "OFF"} />
          <Metric label="GRAZE SAMPLE" value={mode === "player" ? metrics.grazes : "OFF"} />
        </aside>
      </section>

      <section className="three-lab-notes">
        <article>
          <strong>共通描画</strong>
          <p>全弾を1つのインスタンス描画へまとめ、毎フレームは時刻uniformだけ更新します。</p>
        </article>
        <article className={mode === "player" ? "is-selected" : ""}>
          <strong>プレイヤー側</strong>
          <p>ゲーム進行と当たり・かすり判定を実行し、Three.jsは描画のみ担当します。</p>
        </article>
        <article className={mode === "spectator" ? "is-selected" : ""}>
          <strong>観戦側</strong>
          <p>seedと弾幕パラメータからGPUで位置を再現し、当たり判定を完全に省略します。</p>
        </article>
      </section>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return <div><span>{label}</span><strong>{value}</strong></div>;
}

function createBulletDescriptors(count: number): BulletDescriptor {
  const descriptor: BulletDescriptor = {
    startX: new Float32Array(count),
    speedX: new Float32Array(count),
    speedY: new Float32Array(count),
    phase: new Float32Array(count),
    cycle: new Float32Array(count),
    sizeX: new Float32Array(count),
    sizeY: new Float32Array(count),
    shape: new Float32Array(count),
    color: new Float32Array(count * 3),
  };
  const palette = [new THREE.Color(0xff4e8a), new THREE.Color(0x9d72ff), new THREE.Color(0xffd166)];
  const random = seededRandom(0x42555a5a);

  for (let index = 0; index < count; index += 1) {
    const speedY = -(80 + random() * 130);
    const cycle = (WORLD_HEIGHT + 80) / Math.abs(speedY);
    const color = palette[index % palette.length] ?? palette[0]!;
    descriptor.startX[index] = -WORLD_WIDTH / 2 + 32 + random() * (WORLD_WIDTH - 64);
    descriptor.speedX[index] = (random() - 0.5) * 82;
    descriptor.speedY[index] = speedY;
    descriptor.phase[index] = random() * cycle;
    descriptor.cycle[index] = cycle;
    descriptor.sizeX[index] = index % 3 === 1 ? 5 : 8 + random() * 3;
    descriptor.sizeY[index] = index % 3 === 1 ? 18 : 8 + random() * 3;
    descriptor.shape[index] = index % 3;
    descriptor.color[index * 3] = color.r;
    descriptor.color[index * 3 + 1] = color.g;
    descriptor.color[index * 3 + 2] = color.b;
  }
  return descriptor;
}

function createBulletGeometry(descriptor: BulletDescriptor, count: number) {
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute([
    -1, -1, 0, 1, -1, 0, 1, 1, 0,
    -1, -1, 0, 1, 1, 0, -1, 1, 0,
  ], 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute([
    0, 0, 1, 0, 1, 1,
    0, 0, 1, 1, 0, 1,
  ], 2));
  geometry.setAttribute("aStartX", new THREE.InstancedBufferAttribute(descriptor.startX, 1));
  geometry.setAttribute("aSpeedX", new THREE.InstancedBufferAttribute(descriptor.speedX, 1));
  geometry.setAttribute("aSpeedY", new THREE.InstancedBufferAttribute(descriptor.speedY, 1));
  geometry.setAttribute("aPhase", new THREE.InstancedBufferAttribute(descriptor.phase, 1));
  geometry.setAttribute("aCycle", new THREE.InstancedBufferAttribute(descriptor.cycle, 1));
  geometry.setAttribute("aSizeX", new THREE.InstancedBufferAttribute(descriptor.sizeX, 1));
  geometry.setAttribute("aSizeY", new THREE.InstancedBufferAttribute(descriptor.sizeY, 1));
  geometry.setAttribute("aShape", new THREE.InstancedBufferAttribute(descriptor.shape, 1));
  geometry.setAttribute("aColor", new THREE.InstancedBufferAttribute(descriptor.color, 3));
  geometry.instanceCount = Math.min(count, MAX_BULLETS);
  return geometry;
}

function createBulletMaterial() {
  const timeUniform = { value: 0 };
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: timeUniform,
      uWorldSize: { value: new THREE.Vector2(WORLD_WIDTH, WORLD_HEIGHT) },
    },
    vertexShader: `
      uniform float uTime;
      uniform vec2 uWorldSize;
      attribute float aStartX;
      attribute float aSpeedX;
      attribute float aSpeedY;
      attribute float aPhase;
      attribute float aCycle;
      attribute float aSizeX;
      attribute float aSizeY;
      attribute float aShape;
      attribute vec3 aColor;
      varying vec2 vUv;
      varying float vShape;
      varying vec3 vColor;

      void main() {
        float travel = mod(uTime + aPhase, aCycle);
        float x = mod(aStartX + aSpeedX * travel + uWorldSize.x * 0.5, uWorldSize.x) - uWorldSize.x * 0.5;
        float y = uWorldSize.y * 0.5 + 28.0 + aSpeedY * travel;
        vec3 transformed = position;
        transformed.xy *= vec2(aSizeX, aSizeY);
        transformed.xy += vec2(x, y);
        vUv = uv;
        vShape = aShape;
        vColor = aColor;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(transformed, 1.0);
      }
    `,
    fragmentShader: `
      varying vec2 vUv;
      varying float vShape;
      varying vec3 vColor;

      void main() {
        vec2 point = vUv * 2.0 - 1.0;
        float distanceToEdge;
        if (vShape < 0.5) {
          distanceToEdge = length(point);
        } else if (vShape < 1.5) {
          distanceToEdge = length(vec2(point.x * 1.25, point.y));
        } else {
          distanceToEdge = abs(point.x) + abs(point.y);
        }
        float alpha = 1.0 - smoothstep(0.72, 1.0, distanceToEdge);
        if (alpha <= 0.01) discard;
        float core = 1.0 - smoothstep(0.0, 0.48, distanceToEdge);
        vec3 color = mix(vColor, vec3(1.0), core * 0.82);
        gl_FragColor = vec4(color, alpha * 0.9);
      }
    `,
  });
  return { material, timeUniform };
}

function createPlayerMesh() {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute([
    0, 24, 0, -20, -18, 0, -6, -10, 0,
    0, 24, 0, -6, -10, 0, 0, -4, 0,
    0, 24, 0, 0, -4, 0, 6, -10, 0,
    0, 24, 0, 6, -10, 0, 20, -18, 0,
  ], 3));
  const material = new THREE.MeshBasicMaterial({ color: 0x69f7ff, side: THREE.DoubleSide });
  return new THREE.Mesh(geometry, material);
}

function createFieldOutline() {
  const halfWidth = WORLD_WIDTH / 2 - 18;
  const halfHeight = WORLD_HEIGHT / 2 - 18;
  const points = [
    -halfWidth, -halfHeight, 0, halfWidth, -halfHeight, 0,
    halfWidth, -halfHeight, 0, halfWidth, halfHeight, 0,
    halfWidth, halfHeight, 0, -halfWidth, halfHeight, 0,
    -halfWidth, halfHeight, 0, -halfWidth, -halfHeight, 0,
  ];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(points, 3));
  return new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: 0x21395c, transparent: true, opacity: 0.8 }));
}

function runPlayerCollisionSample(descriptor: BulletDescriptor, count: number, time: number) {
  let checks = 0;
  let grazes = 0;
  for (let index = 0; index < count; index += 1) {
    const travel = (time + descriptor.phase[index]!) % descriptor.cycle[index]!;
    const rawX = descriptor.startX[index]! + descriptor.speedX[index]! * travel + WORLD_WIDTH / 2;
    const x = ((rawX % WORLD_WIDTH) + WORLD_WIDTH) % WORLD_WIDTH - WORLD_WIDTH / 2;
    const y = WORLD_HEIGHT / 2 + 28 + descriptor.speedY[index]! * travel;
    if (Math.abs(y - PLAYER_Y) > 34 || Math.abs(x - PLAYER_X) > 34) continue;
    checks += 1;
    const distance = Math.hypot(x - PLAYER_X, y - PLAYER_Y);
    if (distance > 9 && distance < 26) grazes += 1;
  }
  return { checks, grazes };
}

function seededRandom(seed: number) {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 0x100000000;
  };
}

function disposeObject(object: THREE.Object3D) {
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh || child instanceof THREE.LineSegments)) return;
    child.geometry.dispose();
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    materials.forEach((material) => material.dispose());
  });
}
