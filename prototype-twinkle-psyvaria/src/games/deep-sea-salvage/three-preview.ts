import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

type Quality = "low" | "high";
type ModelKey = "submarine" | "fish" | "boss" | "cliff" | "kelp" | "vent";
type ModelManifest = { models?: Partial<Record<ModelKey, { url: string; scale?: number }>> };
const query = new URLSearchParams(window.location.search);
const narrowScreen = window.matchMedia("(max-width: 700px)").matches;
const layoutScaleX = narrowScreen ? .48 : 1;
const quality: Quality = query.get("quality") === "low" || (query.get("quality") !== "high" && narrowScreen) ? "low" : "high";

const canvas = document.querySelector<HTMLCanvasElement>("#game")!;
if (!canvas) throw new Error("Deep Sea Salvage preview canvas was not found");

function showPreviewScreen() {
  document.body.classList.add("is-game-screen", "is-three-preview");
  document.querySelector("#arcade-screen")?.classList.add("is-hidden");
  document.querySelector("#cabinet-screen")?.classList.add("is-hidden");
  document.querySelector("#game-screen")?.classList.remove("is-hidden");
  document.querySelector<HTMLElement>("#ranking-submit-panel")?.classList.remove("is-visible");
}
showPreviewScreen();
// Platform initialization also selects a screen; win that initial race for a
// direct preview URL without changing normal cabinet navigation.
requestAnimationFrame(showPreviewScreen);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: "high-performance" });
renderer.setPixelRatio(quality === "low" ? 1 : Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(canvas.width, canvas.height, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = quality === "high";
renderer.shadowMap.type = THREE.PCFShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x021827);
scene.fog = new THREE.FogExp2(0x021827, .047);

const viewHeight = 12;
const camera = new THREE.OrthographicCamera(-viewHeight * .75, viewHeight * .75, viewHeight / 2, -viewHeight / 2, .1, 80);
camera.position.set(0, .2, 18);
camera.lookAt(0, 0, 0);

function resizeRenderer() {
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width)); const height = Math.max(1, Math.round(rect.height));
  renderer.setSize(width, height, false);
  const halfWidth = viewHeight * width / height / 2;
  camera.left = -halfWidth; camera.right = halfWidth; camera.top = viewHeight / 2; camera.bottom = -viewHeight / 2; camera.updateProjectionMatrix();
}
resizeRenderer();
window.addEventListener("resize", resizeRenderer);
new ResizeObserver(resizeRenderer).observe(canvas);

scene.add(new THREE.HemisphereLight(0x78bad2, 0x04090c, 1.8));
const moon = new THREE.DirectionalLight(0x8ec9e3, 2.3);
moon.position.set(-6, 9, 9); moon.castShadow = true; moon.shadow.mapSize.set(1024, 1024);
scene.add(moon);
const fill = new THREE.PointLight(0x117799, 13, 18, 2); fill.position.set(5, -2, 5); scene.add(fill);
const cameraFill = new THREE.PointLight(0x9cd9e5, 18, 24, 2); cameraFill.position.set(-1, 5, 10); scene.add(cameraFill);

const rockMaterial = new THREE.MeshStandardMaterial({ color: 0x263640, roughness: .94, metalness: .03 });
const rockDarkMaterial = new THREE.MeshStandardMaterial({ color: 0x15242c, roughness: 1 });
const kelpMaterial = new THREE.MeshStandardMaterial({ color: 0x28745d, roughness: .72, side: THREE.DoubleSide });
const brass = new THREE.MeshStandardMaterial({ color: 0xc7902d, roughness: .32, metalness: .68 });
const brassDark = new THREE.MeshStandardMaterial({ color: 0x73511f, roughness: .5, metalness: .55 });
const glass = new THREE.MeshPhysicalMaterial({ color: 0x34d9e5, emissive: 0x075b70, emissiveIntensity: 1.25, roughness: .08, metalness: .1, transmission: .22 });

function makeSubmarine() {
  const group = new THREE.Group();
  group.name = "submarine";
  const hull = new THREE.Mesh(new THREE.CapsuleGeometry(.65, 2.7, 10, 28), brass);
  hull.rotation.z = Math.PI / 2; hull.castShadow = true; hull.receiveShadow = true; group.add(hull);

  const nose = new THREE.Mesh(new THREE.SphereGeometry(.67, 24, 16), brass);
  nose.scale.set(.88, 1, 1); nose.position.x = 1.38; nose.castShadow = true; group.add(nose);
  const tower = new THREE.Mesh(new THREE.CapsuleGeometry(.17, .45, 6, 12), brassDark);
  tower.position.set(-.15, .73, 0); tower.castShadow = true; group.add(tower);
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(.035, .045, .55, 8), brassDark);
  mast.position.set(-.12, 1.18, 0); group.add(mast);

  for (const z of [-.59, .59]) {
    const windowFrame = new THREE.Mesh(new THREE.TorusGeometry(.25, .055, 10, 28), brassDark);
    windowFrame.position.set(.57, .03, z); windowFrame.rotation.y = z > 0 ? 0 : Math.PI; group.add(windowFrame);
    const windowGlass = new THREE.Mesh(new THREE.CircleGeometry(.22, 28), glass);
    windowGlass.position.set(.57, .03, z + Math.sign(z) * .013); windowGlass.rotation.y = z > 0 ? 0 : Math.PI; group.add(windowGlass);
  }

  const finGeometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-.4, 0, 0), new THREE.Vector3(-1.25, 0, .88), new THREE.Vector3(.3, 0, .45),
  ]);
  finGeometry.setIndex([0, 1, 2]); finGeometry.computeVertexNormals();
  const finA = new THREE.Mesh(finGeometry, brassDark); finA.position.y = -.1; group.add(finA);
  const finB = finA.clone(); finB.scale.z = -1; group.add(finB);

  const propeller = new THREE.Group(); propeller.name = "propeller"; propeller.position.x = -2.03;
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(.1, .1, .35, 10), brassDark); shaft.rotation.z = Math.PI / 2; propeller.add(shaft);
  for (let i = 0; i < 4; i += 1) {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(.08, .74, .18), brassDark); blade.rotation.x = i * Math.PI / 2; propeller.add(blade);
  }
  group.add(propeller);

  const lamp = new THREE.SpotLight(0xb8ffff, 45, 18, .3, .65, 1.4);
  lamp.position.set(1.5, .15, .25); lamp.target.position.set(10, 0, 0); group.add(lamp, lamp.target);
  group.scale.setScalar(.72); group.position.set(-1.9 * layoutScaleX, .2, 2.1); scene.add(group);
  return group;
}

function makeFish() {
  const group = new THREE.Group(); group.name = "fish";
  const skin = new THREE.MeshStandardMaterial({ color: 0x799fb3, roughness: .43, metalness: .18, emissive: 0x0c2d3b, emissiveIntensity: .45 });
  const body = new THREE.Mesh(new THREE.SphereGeometry(.78, 28, 18), skin); body.scale.set(1.55, .72, .55); body.castShadow = true; group.add(body);
  const tail = new THREE.Group(); tail.name = "tail"; tail.position.x = -1.18;
  const tailShape = new THREE.Shape(); tailShape.moveTo(0, 0); tailShape.lineTo(-.72, .68); tailShape.lineTo(-.54, 0); tailShape.lineTo(-.72, -.68); tailShape.closePath();
  const tailMesh = new THREE.Mesh(new THREE.ShapeGeometry(tailShape), skin); tailMesh.castShadow = true; tail.add(tailMesh); group.add(tail);
  const fin = new THREE.Mesh(new THREE.ConeGeometry(.34, .75, 3), skin); fin.position.set(-.15, .64, 0); fin.rotation.z = -.15; group.add(fin);
  const eyeWhite = new THREE.Mesh(new THREE.SphereGeometry(.13, 16, 10), new THREE.MeshStandardMaterial({ color: 0xdffeff, roughness: .12 })); eyeWhite.position.set(.7, .24, .46); group.add(eyeWhite);
  const pupil = new THREE.Mesh(new THREE.SphereGeometry(.065, 12, 8), new THREE.MeshStandardMaterial({ color: 0x071319 })); pupil.position.set(.75, .25, .55); group.add(pupil);
  group.position.set(2.5 * layoutScaleX, .5, .3); group.scale.setScalar(.82); scene.add(group);
  return group;
}

function makeCliffs() {
  const group = new THREE.Group(); group.name = "cliffs";
  const random = seededRandom(1947);
  for (const side of [-1, 1]) {
    for (let row = 0; row < 10; row += 1) {
      for (let column = 0; column < 3; column += 1) {
        const radius = 1 + random() * .72;
        const rock = new THREE.Mesh(new THREE.IcosahedronGeometry(radius, quality === "high" ? 2 : 1), column === 2 ? rockMaterial : rockDarkMaterial);
        rock.position.set(side * (7.5 + column * .85 - Math.sin(row * 1.7) * .42) * layoutScaleX, -5.5 + row * 1.28, -1.2 - column * .8 + random() * .4);
        rock.scale.set(.9 + random() * .6, .7 + random() * .75, .85 + random() * .8);
        rock.rotation.set(random() * 2, random() * 2, random() * 2); rock.castShadow = true; rock.receiveShadow = true; group.add(rock);
      }
    }
  }
  scene.add(group);
}

function makeKelpAndVent() {
  const kelps: THREE.Mesh[] = [];
  for (let i = 0; i < 7; i += 1) {
    const geometry = new THREE.PlaneGeometry(.23 + i % 2 * .1, 2.2 + i % 3 * .35, 1, 12);
    const kelp = new THREE.Mesh(geometry, kelpMaterial); kelp.position.set((-6.1 + i * .32) * layoutScaleX, -3.7, -.2 + i * .05); kelp.rotation.z = -.08 + i * .02; scene.add(kelp); kelps.push(kelp);
  }
  const ventX = 5.8 * layoutScaleX;
  const vent = new THREE.Mesh(new THREE.CylinderGeometry(.42, .72, 1.25, 9), rockMaterial); vent.position.set(ventX, -4.2, .1); vent.castShadow = true; scene.add(vent);
  const particles = new THREE.BufferGeometry();
  const positions = new Float32Array(75 * 3);
  for (let i = 0; i < 75; i += 1) { positions[i * 3] = (Math.random() - .5) * .45; positions[i * 3 + 1] = Math.random() * 4.5; positions[i * 3 + 2] = (Math.random() - .5) * .45; }
  particles.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const plume = new THREE.Points(particles, new THREE.PointsMaterial({ color: 0x9ceeff, size: .08, transparent: true, opacity: .58, depthWrite: false })); plume.position.set(ventX, -3.55, .1); scene.add(plume);
  return { kelps, plume };
}

function makeWaterParticles() {
  const count = quality === "high" ? 450 : 160;
  const geometry = new THREE.BufferGeometry(); const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) { positions[i * 3] = (Math.random() - .5) * 20; positions[i * 3 + 1] = (Math.random() - .5) * 13; positions[i * 3 + 2] = (Math.random() - .5) * 12; }
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const points = new THREE.Points(geometry, new THREE.PointsMaterial({ color: 0x8ed8e5, size: .025, transparent: true, opacity: .45, depthWrite: false })); scene.add(points); return points;
}

function seededRandom(seed: number) {
  let value = seed >>> 0;
  return () => { value = value * 1664525 + 1013904223 >>> 0; return value / 0x1_0000_0000; };
}

let submarine = makeSubmarine(); let fish = makeFish(); makeCliffs();
const { kelps, plume } = makeKelpAndVent(); const waterParticles = makeWaterParticles();
const keys = new Set<string>(); let yawTarget = 0; let fps = 0; let frames = 0; let fpsStart = performance.now();

const panel = document.createElement("aside"); panel.className = "three-preview-panel";
panel.innerHTML = `<strong>THREE.JS 2.5D VISUAL PROTOTYPE</strong><span>WASD / 矢印: 潜水艦を移動・旋回</span><span>QUALITY ${quality.toUpperCase()}　<a href="?game=deep-sea-salvage&threePreview=1&quality=low">LOW</a> / <a href="?game=deep-sea-salvage&threePreview=1&quality=high">HIGH</a></span><span id="three-preview-assets">PROCEDURAL FALLBACK</span><span id="three-preview-fps">FPS --</span><a href="?game=deep-sea-salvage&surfacePreview=1">現在の2D版へ戻る</a>`;
document.querySelector(".game-frame")?.appendChild(panel);
const fpsLabel = panel.querySelector("#three-preview-fps");
const assetLabel = panel.querySelector("#three-preview-assets");

async function replaceFromManifest() {
  try {
    const response = await fetch("/assets/deep-sea-salvage/models/manifest.json");
    if (!response.ok) return;
    const manifest = await response.json() as ModelManifest;
    const loader = new GLTFLoader(); let loaded = 0;
    const replace = async (key: "submarine" | "fish", fallback: THREE.Group) => {
      const entry = manifest.models?.[key];
      if (!entry?.url) return fallback;
      const gltf = await loader.loadAsync(entry.url); const model = gltf.scene;
      model.name = key; model.position.copy(fallback.position); model.rotation.copy(fallback.rotation); model.scale.copy(fallback.scale).multiplyScalar(entry.scale ?? 1);
      model.traverse((object) => { if (object instanceof THREE.Mesh) { object.castShadow = true; object.receiveShadow = true; } });
      scene.remove(fallback); scene.add(model); loaded += 1; return model;
    };
    submarine = await replace("submarine", submarine);
    fish = await replace("fish", fish);
    if (assetLabel) assetLabel.textContent = loaded ? `GLB ASSETS ${loaded}/2` : "PROCEDURAL FALLBACK";
  } catch {
    if (assetLabel) assetLabel.textContent = "GLB LOAD FAILED / FALLBACK";
  }
}
void replaceFromManifest();

window.addEventListener("keydown", (event) => keys.add(event.code));
window.addEventListener("keyup", (event) => keys.delete(event.code));

let previousFrame = performance.now(); let previewElapsed = 0;
function animate() {
  const frameNow = performance.now(); const dt = Math.min(.05, (frameNow - previousFrame) / 1000); previousFrame = frameNow; previewElapsed += dt; const time = previewElapsed;
  const dx = Number(keys.has("ArrowRight") || keys.has("KeyD")) - Number(keys.has("ArrowLeft") || keys.has("KeyA"));
  const dy = Number(keys.has("ArrowUp") || keys.has("KeyW")) - Number(keys.has("ArrowDown") || keys.has("KeyS"));
  const horizontalLimit = narrowScreen ? 2.5 : 5.4;
  submarine.position.x = THREE.MathUtils.clamp(submarine.position.x + dx * dt * 3.2, -horizontalLimit, horizontalLimit);
  submarine.position.y = THREE.MathUtils.clamp(submarine.position.y + dy * dt * 2.4, -4.4, 4.4);
  if (Math.abs(dx) > .05) yawTarget = dx < 0 ? Math.PI : 0;
  submarine.rotation.y += (yawTarget - submarine.rotation.y) * Math.min(1, dt * 4);
  submarine.rotation.z += ((-dy * .13) - submarine.rotation.z) * Math.min(1, dt * 4);
  const propeller = submarine.getObjectByName("propeller"); if (propeller) propeller.rotation.x += dt * 14;
  fish.position.x = (2.5 + Math.sin(time * .35) * 1.5) * layoutScaleX; fish.position.y = .35 + Math.sin(time * .7) * .55;
  const tail = fish.getObjectByName("tail"); if (tail) tail.rotation.y = Math.sin(time * 5.2) * .38;
  kelps.forEach((kelp, i) => kelp.rotation.z = Math.sin(time * .75 + i * .65) * .09);
  const plumePosition = plume.geometry.getAttribute("position") as THREE.BufferAttribute;
  for (let i = 0; i < plumePosition.count; i += 1) plumePosition.setY(i, (plumePosition.getY(i) + dt * (.55 + i % 5 * .08)) % 4.5);
  plumePosition.needsUpdate = true; waterParticles.rotation.z = time * .006;
  renderer.render(scene, camera);
  frames += 1; const now = performance.now();
  if (now - fpsStart >= 1000) { fps = Math.round(frames * 1000 / (now - fpsStart)); frames = 0; fpsStart = now; if (fpsLabel) fpsLabel.textContent = `FPS ${fps}`; }
  requestAnimationFrame(animate);
}
requestAnimationFrame(animate);

export {};
