import * as THREE from './assets/three.module.js';
import { createBossModels, getBossRotation } from './assets/boss-geometry.js';

const width = 1280;
const height = 720;
const radius = 125;
const canvas = document.getElementById('boss-canvas');
const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
renderer.setPixelRatio(1);
renderer.setSize(width, height, false);
renderer.setClearColor(0x000000, 0);
renderer.outputColorSpace = THREE.SRGBColorSpace;
canvas.style.cssText = 'position:absolute;inset:0;width:1280px;height:720px;display:block;pointer-events:none';

const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(-width / 2, width / 2, height / 2, -height / 2, 0.1, 2000);
camera.position.z = 1000;
const keyLight = new THREE.DirectionalLight(0xe9fcff, 1.8);
keyLight.position.set(-100, 180, 300);
scene.add(new THREE.AmbientLight(0x8cb5df, 0.65), keyLight);

const models = createBossModels();
const sphere = createVisual(models[0], 0, 330, 375, 0x59daef);
const crystal = createVisual(models[2], 2, 950, 375, 0xc190ff);

function createVisual(model, phaseIndex, centerX, centerY, colorValue) {
  const root = new THREE.Group();
  root.position.set(centerX - width / 2, height / 2 - centerY, 0);
  root.scale.setScalar(radius);
  const rotating = new THREE.Group();
  root.add(rotating);
  scene.add(root);

  const vertices = new Float32Array(model.vertices.length * 3);
  for (let vertexIndex = 0; vertexIndex < model.vertices.length; vertexIndex += 1) {
    vertices.set(model.vertices[vertexIndex], vertexIndex * 3);
  }
  const faceIndices = new Uint32Array(model.faces.flat());
  const edgeIndices = new Uint32Array(model.edges.flat());
  const surfacePositions = new THREE.BufferAttribute(new Float32Array(faceIndices.length * 3), 3);
  const edgePositions = new THREE.BufferAttribute(new Float32Array(edgeIndices.length * 3), 3);
  if (phaseIndex === 2) {
    surfacePositions.setUsage(THREE.DynamicDrawUsage);
    edgePositions.setUsage(THREE.DynamicDrawUsage);
  }
  const surfaceGeometry = new THREE.BufferGeometry();
  surfaceGeometry.setAttribute('position', surfacePositions);
  const edgeGeometry = new THREE.BufferGeometry();
  edgeGeometry.setAttribute('position', edgePositions);
  const color = new THREE.Color(colorValue);
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
  }));
  const lineMaterial = new THREE.LineBasicMaterial({
    color,
    transparent: true,
    opacity: 0.65,
    depthTest: false,
    depthWrite: false,
  });
  const depthRadius = { value: radius };
  lineMaterial.onBeforeCompile = shader => {
    shader.uniforms.bossDepthRadius = depthRadius;
    shader.vertexShader = `varying float vBossDepth;\n${shader.vertexShader}`.replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\nvBossDepth = (modelMatrix * vec4(position, 1.0)).z;',
    );
    shader.fragmentShader = `uniform float bossDepthRadius;\nvarying float vBossDepth;\n${shader.fragmentShader}`.replace(
      '#include <color_fragment>',
      '#include <color_fragment>\ndiffuseColor.a *= mix(0.16, 1.0, smoothstep(-0.45, 0.6, vBossDepth / max(0.001, bossDepthRadius)));',
    );
  };
  const lines = new THREE.LineSegments(edgeGeometry, lineMaterial);
  surface.renderOrder = 0;
  lines.renderOrder = 1;
  surface.frustumCulled = false;
  lines.frustumCulled = false;
  rotating.add(surface, lines);

  const visual = { model, rotating, vertices, faceIndices, edgeIndices, surfaceGeometry, surfacePositions, edgePositions };
  updateBuffers(visual);
  if (phaseIndex === 0) {
    surfaceGeometry.setAttribute('normal', new THREE.BufferAttribute(surfacePositions.array.slice(), 3));
    const rimPositions = new Float32Array(96 * 3);
    for (let segment = 0; segment < 96; segment += 1) {
      const angle = segment * Math.PI * 2 / 96;
      rimPositions[segment * 3] = Math.cos(angle);
      rimPositions[segment * 3 + 1] = Math.sin(angle);
    }
    const rimGeometry = new THREE.BufferGeometry();
    rimGeometry.setAttribute('position', new THREE.BufferAttribute(rimPositions, 3));
    const rim = new THREE.LineLoop(rimGeometry, new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity: 0.9,
      depthTest: false,
      depthWrite: false,
    }));
    rim.renderOrder = 1;
    root.add(rim);
  } else {
    surfaceGeometry.computeVertexNormals();
    surfaceGeometry.getAttribute('normal').setUsage(THREE.DynamicDrawUsage);
  }
  return visual;
}

function copyVertices(vertices, indices, attribute) {
  const target = attribute.array;
  for (let index = 0; index < indices.length; index += 1) {
    const sourceOffset = indices[index] * 3;
    const targetOffset = index * 3;
    target[targetOffset] = vertices[sourceOffset];
    target[targetOffset + 1] = vertices[sourceOffset + 1];
    target[targetOffset + 2] = vertices[sourceOffset + 2];
  }
  attribute.needsUpdate = true;
}

function updateBuffers(visual) {
  copyVertices(visual.vertices, visual.faceIndices, visual.surfacePositions);
  copyVertices(visual.vertices, visual.edgeIndices, visual.edgePositions);
}

function renderBossPreview(time) {
  const sphereRotation = getBossRotation(0, time);
  sphere.rotating.rotation.set(sphereRotation[0], sphereRotation[1], sphereRotation[2], 'ZXY');
  const crystalRotation = getBossRotation(2, time);
  crystal.rotating.rotation.set(crystalRotation[0], crystalRotation[1], crystalRotation[2], 'ZXY');
  const tipLength = 0.81 + 0.19 * Math.cos(time * Math.PI * 2 / 2.4);
  for (let vertexIndex = 8; vertexIndex <= 13; vertexIndex += 1) {
    const original = crystal.model.vertices[vertexIndex];
    const offset = vertexIndex * 3;
    crystal.vertices[offset] = original[0] * tipLength;
    crystal.vertices[offset + 1] = original[1] * tipLength;
    crystal.vertices[offset + 2] = original[2] * tipLength;
  }
  updateBuffers(crystal);
  crystal.surfaceGeometry.computeVertexNormals();
  renderer.render(scene, camera);
}

window.renderBossPreview = renderBossPreview;
window.addEventListener('hf-seek', event => renderBossPreview(event.detail.time));
renderBossPreview(0);
