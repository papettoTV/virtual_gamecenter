import { mkdir, writeFile } from "node:fs/promises";
import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";

class NodeFileReader {
  result = null; onloadend = null; onerror = null;
  async readAsArrayBuffer(blob) { try { this.result = await blob.arrayBuffer(); this.onloadend?.(); } catch (error) { this.onerror?.(error); } }
  async readAsDataURL(blob) { try { this.result = `data:${blob.type};base64,${Buffer.from(await blob.arrayBuffer()).toString("base64")}`; this.onloadend?.(); } catch (error) { this.onerror?.(error); } }
}
globalThis.FileReader ??= NodeFileReader;

const outputDirectory = new URL("../public/assets/deep-sea-salvage/models/", import.meta.url);
await mkdir(outputDirectory, { recursive: true });
const mesh = (geometry, material, name) => { const result = new THREE.Mesh(geometry, material); result.name = name; return result; };
const standard = (name, color, roughness = .68, emissive = 0x000000, emissiveIntensity = 0) => new THREE.MeshStandardMaterial({ name, color, roughness, metalness: .015, emissive, emissiveIntensity });
const finMaterial = (color) => new THREE.MeshStandardMaterial({ name: "translucent_fin", color, roughness: .74, metalness: 0, transparent: true, opacity: .68, alphaTest: .025, side: THREE.DoubleSide });

const hashNoise = (x, y, z, seed = 0) => {
  const value = Math.sin(x * 17.17 + y * 41.73 + z * 73.31 + seed * 19.19) * 43758.5453;
  return value - Math.floor(value);
};

function organicSurface(object, baseColor, accentColor, options = {}) {
  const {
    seed = 0,
    textureScale = 4.5,
    variation = .16,
    bump = .012,
    bellyLight = .12,
    dorsalDark = .11,
    stripes = 0,
    spots = 0,
    iridescent = false,
    roughness = null,
    metalness = null,
  } = options;
  const geometry = object.geometry.index ? object.geometry.toNonIndexed() : object.geometry.clone();
  const position = geometry.getAttribute("position");
  const colors = [];
  const base = new THREE.Color(baseColor);
  const accent = new THREE.Color(accentColor);
  const dark = base.clone().multiplyScalar(.55);
  const light = base.clone().lerp(new THREE.Color(0xffffff), .3);
  const vertex = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const color = new THREE.Color();
  geometry.computeVertexNormals();
  const normals = geometry.getAttribute("normal");

  for (let index = 0; index < position.count; index += 1) {
    vertex.fromBufferAttribute(position, index);
    normal.fromBufferAttribute(normals, index);
    const broad = Math.sin(vertex.x * textureScale + Math.sin(vertex.y * 3.1 + seed) * 1.5) * .5 + .5;
    const grain = hashNoise(vertex.x * 5.2, vertex.y * 5.2, vertex.z * 5.2, seed);
    const stripe = stripes > 0 ? Math.pow(Math.max(0, Math.cos(vertex.x * stripes + seed)), 10) : 0;
    const spotField = spots > 0 ? Math.pow(hashNoise(Math.floor(vertex.x * spots), Math.floor(vertex.y * spots), Math.floor(vertex.z * spots), seed), 5) : 0;
    color.copy(base).lerp(accent, broad * variation + stripe * .28 + spotField * .34);
    if (iridescent) {
      color.offsetHSL(Math.sin(vertex.x * 7.2 + vertex.y * 4.1 + seed) * .105, .16, Math.cos(vertex.x * 5.4 + seed) * .045);
      color.lerp(new THREE.Color(0x76fff2), Math.max(0, normal.z) * .13);
    }
    if (vertex.y < 0) color.lerp(light, Math.min(.3, -vertex.y * bellyLight));
    if (vertex.y > 0) color.lerp(dark, Math.min(.28, vertex.y * dorsalDark));
    color.multiplyScalar(.88 + grain * .2);
    colors.push(color.r, color.g, color.b);
    const displacement = (broad * .55 + grain * .45 - .5) * bump;
    position.setXYZ(index, vertex.x + normal.x * displacement, vertex.y + normal.y * displacement, vertex.z + normal.z * displacement);
  }
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  object.geometry.dispose();
  object.geometry = geometry;
  object.material = object.material.clone();
  object.material.color.set(0xffffff);
  object.material.vertexColors = true;
  object.material.roughness = roughness ?? Math.max(.62, object.material.roughness);
  if (metalness !== null) object.material.metalness = metalness;
  object.material.needsUpdate = true;
  return object;
}

function organicBody(material, scale, baseColor, accentColor, options = {}) {
  const lengthSegments = 34; const radialSegments = 28;
  const vertices = []; const indices = [];
  const radiusProfile = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, .2, .18), new THREE.Vector3(.12, .46, .42),
    new THREE.Vector3(.36, .88, .86), new THREE.Vector3(.62, 1, 1),
    new THREE.Vector3(.84, .86, .9), new THREE.Vector3(1, .48, .55),
  ]);
  for (let ring = 0; ring <= lengthSegments; ring += 1) {
    const t = ring / lengthSegments;
    const profile = radiusProfile.getPoint(t);
    const x = THREE.MathUtils.lerp(-.82, .72, t) * scale[0];
    const headFullness = 1 + Math.max(0, (t - .68) / .32) * (options.headFullness ?? .1);
    for (let radial = 0; radial < radialSegments; radial += 1) {
      const angle = radial / radialSegments * Math.PI * 2;
      const asymmetry = 1 + .035 * Math.sin(t * 16 + (options.seed ?? 0));
      vertices.push(
        x,
        Math.cos(angle) * .72 * scale[1] * profile.y * headFullness * asymmetry,
        Math.sin(angle) * .72 * scale[2] * profile.z * headFullness,
      );
    }
  }
  for (let ring = 0; ring < lengthSegments; ring += 1) for (let radial = 0; radial < radialSegments; radial += 1) {
    const next = (radial + 1) % radialSegments;
    const a = ring * radialSegments + radial; const b = ring * radialSegments + next;
    const c = (ring + 1) * radialSegments + radial; const d = (ring + 1) * radialSegments + next;
    indices.push(a, c, b, b, c, d);
  }
  const backCenter = vertices.length / 3; vertices.push(-.82 * scale[0], 0, 0);
  const frontCenter = vertices.length / 3; vertices.push(.72 * scale[0], 0, 0);
  for (let radial = 0; radial < radialSegments; radial += 1) {
    const next = (radial + 1) % radialSegments;
    indices.push(backCenter, next, radial);
    const frontRing = lengthSegments * radialSegments;
    indices.push(frontCenter, frontRing + radial, frontRing + next);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3)); geometry.setIndex(indices); geometry.computeVertexNormals();
  const body = mesh(geometry, material, "body");
  return organicSurface(body, baseColor, accentColor, options);
}

const species = [
  ["sun-sardine", "sardine", 0x78ced7, 0xcafff8, 0xf4da72],
  ["glass-bream", "bream", 0x9bcdb7, 0xe7fff3, 0x6ba998],
  ["ribbon-goby", "goby", 0xd5a96d, 0xffe4a3, 0x8f5539],
  ["blue-puffer", "puffer", 0x668fd2, 0xc4ddff, 0xe8d18b],
  ["coral-ray", "ray", 0xc5779b, 0xffc1dc, 0x864b73],
  ["silver-hatchet", "hatchet", 0x7495aa, 0xc8efff, 0x334f65],
  ["lantern-cod", "cod", 0x536f98, 0x8ffff5, 0x263752],
  ["veil-squid", "squid", 0x9764ad, 0xf0bdff, 0x513069],
  ["saw-shrimp", "shrimp", 0xad604e, 0xffb191, 0x6f3028],
  ["moon-jelly", "jelly", 0x5872bd, 0x8eeaff, 0xd2f5ff],
  ["abyss-eel", "eel", 0x202b55, 0x5ffff0, 0x111730],
  ["black-fang", "viper", 0x302641, 0xff5f91, 0x130f20],
  ["ghost-squid", "squid", 0x4f3c68, 0xbd88ff, 0xbda5d7],
  ["star-mouth", "angler", 0x203746, 0xffe66d, 0x111c28],
  ["deep-ray", "ray", 0x202f40, 0x59aaff, 0x10223a],
  ["prism-fish", "prism", 0xd9e7f2, 0x74fff5, 0xd58dff],
  ["crown-jelly", "crown-jelly", 0xd8a4ed, 0xffde69, 0x7e54a6],
  ["comet-eel", "comet-eel", 0xaec9ed, 0x68a8ff, 0x425eaa],
  ["ruby-angler", "angler", 0x8f2347, 0xff466f, 0x3b0d22],
  ["void-manta", "manta", 0x171c3e, 0xbb73ff, 0x45277c],
];

function palette(id, base, glow, accent) {
  return {
    baseColor: base,
    accentColor: accent,
    skin: standard(`${id}_skin`, base, .76, glow, .08),
    belly: standard(`${id}_belly`, new THREE.Color(base).lerp(new THREE.Color(0xffffff), .34), .78),
    accent: standard(`${id}_accent`, accent, .69, glow, .18),
    fins: finMaterial(new THREE.Color(base).lerp(new THREE.Color(glow), .3)),
    glow: standard(`${id}_photophore`, glow, .24, glow, 3),
    eye: standard("eye", 0xe7f6f4, .16), pupil: standard("pupil", 0x030507, .2), tooth: standard("tooth", 0xf4f1dc, .38),
  };
}

function addEyes(root, materials, x, y, z = .42, size = .105) {
  size *= .78;
  for (const side of [-1, 1]) {
    const socket = mesh(new THREE.TorusGeometry(size * 1.08, size * .2, 8, 20), materials.skin, "eye_socket");
    socket.position.set(x - size * .08, y, side * (z - size * .16)); root.add(socket);
    const eye = mesh(new THREE.SphereGeometry(size, 22, 14), materials.eye, "eye"); eye.scale.z = .38; eye.position.set(x, y, side * (z - size * .18)); root.add(eye);
    const pupil = mesh(new THREE.SphereGeometry(size * .46, 16, 10), materials.pupil, "pupil"); pupil.scale.z = .28; pupil.position.set(x + size * .13, y, side * (z + size * .25)); root.add(pupil);
  }
}

function addForkTail(root, material, x, size = 1, swept = false, skinMaterial = null) {
  if (skinMaterial) {
    const peduncle = mesh(new THREE.CylinderGeometry(.105 * size, .25 * size, .62 * size, 18, 3), skinMaterial, "tail_peduncle");
    peduncle.rotation.z = Math.PI / 2; peduncle.position.x = x - .25 * size; root.add(peduncle);
  }
  const tail = new THREE.Group(); tail.name = "tail"; tail.position.x = x;
  const shape = new THREE.Shape(); shape.moveTo(0, .1 * size); shape.bezierCurveTo(-.34 * size, .27 * size, -.68 * size, .62 * size, -.98 * size, .7 * size); shape.quadraticCurveTo(-.82 * size, .16 * size, -.61 * size, 0); shape.quadraticCurveTo(-.82 * size, -.16 * size, -.98 * size, -.7 * size); shape.bezierCurveTo(-.68 * size, -.62 * size, -.34 * size, -.27 * size, 0, -.1 * size); shape.closePath();
  const tailMesh = mesh(new THREE.ExtrudeGeometry(shape, { depth: .065, bevelEnabled: true, bevelSegments: 2, bevelSize: .025, bevelThickness: .018 }), material, "tail_fin"); tailMesh.position.z = -.033; if (swept) tailMesh.rotation.x = .08; tail.add(tailMesh); root.add(tail);
  return tail;
}

function addFins(root, material, length = 1, height = 1) {
  const dorsalShape = new THREE.Shape(); dorsalShape.moveTo(-.5 * length, .27); dorsalShape.bezierCurveTo(-.3 * length, .48 * height, -.15 * length, .78 * height, .03, .84 * height); dorsalShape.bezierCurveTo(.18 * length, .72 * height, .34 * length, .42 * height, .52 * length, .27); dorsalShape.quadraticCurveTo(0, .2, -.5 * length, .27); dorsalShape.closePath();
  const dorsal = mesh(new THREE.ExtrudeGeometry(dorsalShape, { depth: .045, bevelEnabled: true, bevelSegments: 2, bevelSize: .018, bevelThickness: .012 }), material, "dorsal_fin"); dorsal.position.z = -.022; root.add(dorsal);
  for (const side of [-1, 1]) {
    const finShape = new THREE.Shape(); finShape.moveTo(-.16, .04); finShape.bezierCurveTo(.08, -.02, .52 * length, -.22, .64 * length, -.5); finShape.bezierCurveTo(.25, -.39, -.08, -.2, -.16, .04); finShape.closePath();
    const fin = mesh(new THREE.ExtrudeGeometry(finShape, { depth: .035, bevelEnabled: true, bevelSegments: 2, bevelSize: .012, bevelThickness: .008 }), material, "pectoral_fin");
    fin.position.set(.22, -.08, side * .31); fin.rotation.set(side > 0 ? -.18 : Math.PI + .18, side * .1, side * .12); root.add(fin);
  }
}

function addGillSlits(root, materials, x, height, z) {
  const slitMaterial = materials.accent.clone(); slitMaterial.name = "gill_tissue"; slitMaterial.color.multiplyScalar(.42); slitMaterial.emissive.set(0x000000); slitMaterial.emissiveIntensity = 0;
  for (const side of [-1, 1]) for (let index = 0; index < 2; index += 1) {
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(x - index * .045, height * .45, side * z),
      new THREE.Vector3(x - .045 - index * .045, 0, side * (z + .012)),
      new THREE.Vector3(x - index * .045, -height * .45, side * z),
    ]);
    const slit = mesh(new THREE.TubeGeometry(curve, 8, .006, 5), slitMaterial, "gill_slit"); root.add(slit);
  }
}

function addLateralLine(root, materials, xFrom, xTo, y, z) {
  const lineMaterial = materials.accent.clone(); lineMaterial.name = "lateral_line"; lineMaterial.color.copy(new THREE.Color(materials.baseColor).multiplyScalar(.46)); lineMaterial.emissive.set(0x000000); lineMaterial.emissiveIntensity = 0;
  for (const side of [-1, 1]) {
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(xFrom, y - .01, side * z),
      new THREE.Vector3((xFrom + xTo) / 2, y + .025, side * (z + .008)),
      new THREE.Vector3(xTo, y, side * z),
    ]);
    root.add(mesh(new THREE.TubeGeometry(curve, 18, .009, 5), lineMaterial, "lateral_line"));
  }
}

function addPhotophores(root, materials, count, xFrom, xTo, y = -.25) {
  for (let i = 0; i < count; i += 1) {
    const light = mesh(new THREE.SphereGeometry(.035, 9, 7), materials.glow, "photophore"); light.position.set(THREE.MathUtils.lerp(xFrom, xTo, i / Math.max(1, count - 1)), y + Math.sin(i * 1.7) * .04, .48); root.add(light);
  }
}

function createStandardFish(id, kind, materials) {
  const root = new THREE.Group(); root.name = id;
  const profiles = {
    sardine: [1.55, .48, .4], bream: [1.18, .78, .46], goby: [1.62, .4, .38], cod: [1.42, .61, .46],
    hatchet: [.92, .95, .39], prism: [1.35, .58, .42], viper: [1.48, .44, .42],
  };
  const [sx, sy, sz] = profiles[kind] ?? profiles.sardine;
  const seed = [...id].reduce((sum, character) => sum + character.charCodeAt(0), 0) / 37;
  const body = organicBody(materials.skin, [sx, sy, sz], materials.baseColor, materials.accentColor, {
    seed, bump: kind === "viper" ? .018 : .012, variation: kind === "prism" ? .36 : .19,
    stripes: kind === "cod" || kind === "goby" ? 7 : 0,
    spots: kind === "bream" || kind === "viper" ? 4.5 : 0,
    iridescent: kind === "prism", roughness: kind === "prism" ? .3 : null, metalness: kind === "prism" ? .16 : null,
    headFullness: kind === "hatchet" ? .22 : .1,
    tailTaper: kind === "hatchet" ? .32 : .22,
  }); root.add(body);
  addForkTail(root, materials.fins, -.82 * sx, kind === "goby" ? .72 : .9, kind === "viper");
  addFins(root, materials.fins, kind === "goby" ? .7 : 1, kind === "hatchet" ? 1.3 : .8);
  addEyes(root, materials, .48 * sx, .12 * sy, .72 * sz, kind === "viper" ? .075 : .1);
  addGillSlits(root, materials, .32 * sx, .42 * sy, .72 * sz + .012);
  if (kind === "sardine") addLateralLine(root, materials, -.65, .68, .035, .292);
  if (kind === "goby") { const lowerFin = mesh(new THREE.CapsuleGeometry(.08, .62, 5, 10), materials.accent, "pelvic_fin"); lowerFin.rotation.z = Math.PI / 2; lowerFin.position.set(.05, -.38, .1); root.add(lowerFin); }
  if (kind === "cod") { addPhotophores(root, materials, 6, -.65, .62); const barbel = mesh(new THREE.CylinderGeometry(.018, .012, .4, 7), materials.accent, "chin_barbel"); barbel.position.set(.7, -.43, .05); barbel.rotation.z = -.15; root.add(barbel); }
  if (kind === "hatchet") addPhotophores(root, materials, 5, -.45, .38, -.55);
  if (kind === "viper") for (const y of [-.17, .17]) { const fang = mesh(new THREE.ConeGeometry(.045, .34, 8), materials.tooth, "fang"); fang.position.set(.96, y, .12); fang.rotation.z = y < 0 ? Math.PI : 0; root.add(fang); }
  return root;
}

function createPuffer(id, materials) {
  const root = new THREE.Group(); root.name = id; const body = organicBody(materials.skin, [1.12, 1, .9], materials.baseColor, materials.accentColor, { seed: 11, bump: .022, variation: .22, spots: 6, headFullness: .17, tailTaper: .28 }); root.add(body); addEyes(root, materials, .56, .25, .63, .13); addGillSlits(root, materials, .32, .3, .67); addForkTail(root, materials.fins, -.72, .58, false, materials.skin);
  for (let i = 0; i < 18; i += 1) { const angle = i / 18 * Math.PI * 2; const spike = mesh(new THREE.ConeGeometry(.035, .24, 6), materials.accent, "spine"); const direction = new THREE.Vector3(Math.cos(angle), Math.sin(angle), .15 * Math.sin(i * 2.4)).normalize(); spike.position.copy(direction).multiplyScalar(.73); spike.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction); root.add(spike); } return root;
}

function createRay(id, materials, manta = false) {
  const root = new THREE.Group(); root.name = id; const shape = new THREE.Shape();
  shape.moveTo(1.25, 0); shape.bezierCurveTo(.5, .18, .15, manta ? 1.25 : .95, -.7, manta ? 1.1 : .75); shape.quadraticCurveTo(-.25, .25, -.65, 0); shape.quadraticCurveTo(-.25, -.25, -.7, manta ? -1.1 : -.75); shape.bezierCurveTo(.15, manta ? -1.25 : -.95, .5, -.18, 1.25, 0); shape.closePath();
  const wing = mesh(new THREE.ExtrudeGeometry(shape, { depth: .16, curveSegments: 12, bevelEnabled: true, bevelSegments: 4, bevelSize: .1, bevelThickness: .07 }), materials.skin, "body"); wing.position.z = -.08; organicSurface(wing, materials.baseColor, materials.accentColor, { seed: manta ? 34 : 18, bump: .01, variation: .18, spots: manta ? 3 : 0 }); root.add(wing);
  const tail = new THREE.Group(); tail.name = "tail"; tail.position.x = -.58; const stem = mesh(new THREE.CylinderGeometry(.025, .06, 2.25, 8), materials.accent, "tail_fin"); stem.rotation.z = Math.PI / 2; stem.position.x = -1.05; tail.add(stem); root.add(tail); addEyes(root, materials, .62, .18, .16, .09); addPhotophores(root, materials, manta ? 7 : 4, -.35, .75, 0); return root;
}

function eelRadius(t) {
  return .115 + Math.pow(Math.sin(t * Math.PI), .72) * .185 + t * .075;
}

function createCurvedEelBody(materials, comet) {
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-1.55, -.06, 0), new THREE.Vector3(-1.08, .105, 0),
    new THREE.Vector3(-.48, -.105, 0), new THREE.Vector3(.12, .1, 0),
    new THREE.Vector3(.76, -.075, 0), new THREE.Vector3(1.5, .04, 0),
  ], false, "catmullrom", .34);
  const lengthSegments = 64; const radialSegments = 24; const vertices = []; const indices = [];
  for (let ring = 0; ring <= lengthSegments; ring += 1) {
    const t = ring / lengthSegments; const point = curve.getPoint(t); const tangent = curve.getTangent(t).normalize();
    const normal = new THREE.Vector3(-tangent.y, tangent.x, 0).normalize(); const radius = eelRadius(t);
    for (let radial = 0; radial < radialSegments; radial += 1) {
      const angle = radial / radialSegments * Math.PI * 2;
      vertices.push(point.x + normal.x * Math.cos(angle) * radius, point.y + normal.y * Math.cos(angle) * radius, Math.sin(angle) * radius * .76);
    }
  }
  for (let ring = 0; ring < lengthSegments; ring += 1) for (let radial = 0; radial < radialSegments; radial += 1) {
    const next = (radial + 1) % radialSegments; const a = ring * radialSegments + radial; const b = ring * radialSegments + next; const c = (ring + 1) * radialSegments + radial; const d = (ring + 1) * radialSegments + next;
    indices.push(a, c, b, b, c, d);
  }
  const backCenter = vertices.length / 3; const back = curve.getPoint(0); vertices.push(back.x, back.y, 0);
  const frontCenter = vertices.length / 3; const front = curve.getPoint(1); vertices.push(front.x, front.y, 0);
  for (let radial = 0; radial < radialSegments; radial += 1) {
    const next = (radial + 1) % radialSegments; indices.push(backCenter, next, radial);
    const frontRing = lengthSegments * radialSegments; indices.push(frontCenter, frontRing + radial, frontRing + next);
  }
  const geometry = new THREE.BufferGeometry(); geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3)); geometry.setIndex(indices); geometry.computeVertexNormals();
  const body = mesh(geometry, materials.skin, "body"); organicSurface(body, materials.baseColor, materials.accentColor, { seed: comet ? 44 : 29, bump: .012, variation: .23, stripes: comet ? 0 : 10, iridescent: comet, roughness: comet ? .38 : null, metalness: comet ? .08 : null });
  return { body, curve };
}

function createEelRibbonFin(curve, material, direction, comet) {
  const segments = 48; const vertices = []; const indices = [];
  for (let index = 0; index <= segments; index += 1) {
    const t = index / segments; const point = curve.getPoint(t); const tangent = curve.getTangent(t).normalize(); const normal = new THREE.Vector3(-tangent.y, tangent.x, 0).normalize().multiplyScalar(direction);
    const base = point.clone().addScaledVector(normal, eelRadius(t) * .88); const height = Math.sin(t * Math.PI) * (comet ? .14 : .09) * (direction > 0 ? 1 : .58); const outer = base.clone().addScaledVector(normal, height);
    vertices.push(base.x, base.y, .012, outer.x, outer.y, .012);
    if (index < segments) { const offset = index * 2; indices.push(offset, offset + 2, offset + 1, offset + 1, offset + 2, offset + 3); }
  }
  const geometry = new THREE.BufferGeometry(); geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3)); geometry.setIndex(indices); geometry.computeVertexNormals(); return mesh(geometry, material, direction > 0 ? "dorsal_ribbon_fin" : "anal_ribbon_fin");
}

function createEel(id, materials, comet = false) {
  const root = new THREE.Group(); root.name = id; const { body, curve } = createCurvedEelBody(materials, comet); root.add(body);
  root.add(createEelRibbonFin(curve, comet ? materials.glow : materials.fins, 1, comet)); root.add(createEelRibbonFin(curve, materials.fins, -1, comet));
  const head = curve.getPoint(.92); addEyes(root, materials, head.x, head.y + .06, .225, .082); addGillSlits(root, materials, curve.getPoint(.84).x, .16, .23);
  const tailPoint = curve.getPoint(0); const tailTangent = curve.getTangent(0); const tail = addForkTail(root, comet ? materials.glow : materials.fins, tailPoint.x, comet ? .82 : .58, true); tail.position.y = tailPoint.y; tail.rotation.z = Math.atan2(tailTangent.y, tailTangent.x);
  const count = comet ? 10 : 7; for (let index = 0; index < count; index += 1) { const t = .16 + index / Math.max(1, count - 1) * .68; const point = curve.getPoint(t); const light = mesh(new THREE.SphereGeometry(.033, 9, 7), materials.glow, "photophore"); light.position.set(point.x, point.y - eelRadius(t) * .72, .2); root.add(light); }
  return root;
}

function createSquid(id, materials) {
  const root = new THREE.Group(); root.name = id;
  const mantle = mesh(new THREE.ConeGeometry(.58, 1.65, 40, 12), materials.skin, "body"); mantle.rotation.z = Math.PI / 2; mantle.position.x = -.12; organicSurface(mantle, materials.baseColor, materials.accentColor, { seed: id === "ghost-squid" ? 61 : 53, bump: .009, variation: .24, spots: 5 }); root.add(mantle);
  const head = organicBody(materials.skin, [.64, .46, .5], materials.baseColor, materials.accentColor, { seed: 54, bump: .01, variation: .18, endTaper: 0, tailTaper: .05 }); head.position.x = .8; root.add(head); addEyes(root, materials, 1.02, .22, .36, .105);
  for (const side of [-1, 1]) {
    const finShape = new THREE.Shape(); finShape.moveTo(-.95, side * .13); finShape.bezierCurveTo(-.75, side * .54, -.28, side * .68, .02, side * .38); finShape.quadraticCurveTo(-.45, side * .22, -.95, side * .13); finShape.closePath();
    const mantleFin = mesh(new THREE.ExtrudeGeometry(finShape, { depth: .04, bevelEnabled: true, bevelSize: .014, bevelThickness: .009 }), materials.fins, "mantle_fin"); mantleFin.position.z = -.02; root.add(mantleFin);
  }
  const tail = new THREE.Group(); tail.name = "tail"; tail.position.x = 1.08;
  for (let i = 0; i < 8; i += 1) {
    const offset = i - 3.5; const length = .72 + i % 3 * .18;
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(.02, offset * .055, (i % 2 - .5) * .14),
      new THREE.Vector3(length * .42, offset * .09 + Math.sin(i) * .06, (i % 2 - .5) * .2),
      new THREE.Vector3(length, offset * .12 + Math.cos(i * 1.7) * .12, (i % 2 - .5) * .18),
    ]);
    tail.add(mesh(new THREE.TubeGeometry(curve, 18, .025 + i % 2 * .008, 7), i % 2 ? materials.fins : materials.accent, "tentacle"));
  }
  root.add(tail); addPhotophores(root, materials, 4, -.55, .25, .05); return root;
}

function createJelly(id, materials, crown = false) {
  const root = new THREE.Group(); root.name = id; materials.skin.transparent = true; materials.skin.opacity = .5; materials.skin.depthWrite = false; const bell = mesh(new THREE.SphereGeometry(.82, 40, 24, 0, Math.PI * 2, 0, Math.PI * .56), materials.skin, "body"); bell.scale.set(1.15, .85, .9); organicSurface(bell, materials.baseColor, materials.accentColor, { seed: crown ? 79 : 68, bump: .008, variation: .2, spots: crown ? 6 : 3 }); root.add(bell); const rim = mesh(new THREE.TorusGeometry(.8, .055, 10, 40), materials.glow, "glowing_rim"); rim.rotation.x = Math.PI / 2; rim.position.y = -.1; root.add(rim);
  const tail = new THREE.Group(); tail.name = "tail"; const count = crown ? 10 : 7; for (let i = 0; i < count; i += 1) { const x = (i - (count - 1) / 2) * .13; const length = .72 + i % 3 * .24; const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(x, -.08, (i % 2 - .5) * .18), new THREE.Vector3(x + Math.sin(i * 2.1) * .11, -.38 - length * .3, (i % 2 - .5) * .24), new THREE.Vector3(x + Math.cos(i * 1.4) * .16, -.45 - length, (i % 2 - .5) * .2)]); tail.add(mesh(new THREE.TubeGeometry(curve, 18, .018 + i % 3 * .004, 6), i % 3 ? materials.fins : materials.glow, "tentacle")); } root.add(tail);
  if (crown) for (let i = 0; i < 7; i += 1) { const spike = mesh(new THREE.ConeGeometry(.07, .4, 7), materials.accent, "crown_spike"); spike.position.set(Math.cos(i / 7 * Math.PI * 2) * .5, .68 + Math.sin(i / 7 * Math.PI * 2) * .08, Math.sin(i / 7 * Math.PI * 2) * .45); root.add(spike); } return root;
}

function createShrimp(id, materials) {
  const root = new THREE.Group(); root.name = id; for (let i = 0; i < 7; i += 1) { const segment = mesh(new THREE.SphereGeometry(.34 - i * .018, 24, 16), i % 2 ? materials.skin : materials.accent, "shell_segment"); segment.scale.set(1.28, .82, .72); segment.position.set(.72 - i * .29, Math.sin(i * .35) * .1, 0); organicSurface(segment, materials.baseColor, materials.accentColor, { seed: 82 + i, bump: .009, variation: .14 }); root.add(segment); for (const side of [-1, 1]) { const legCurve = new THREE.CatmullRomCurve3([new THREE.Vector3(segment.position.x, -.2, side * .16), new THREE.Vector3(segment.position.x - .08, -.38, side * .3), new THREE.Vector3(segment.position.x + .12, -.5, side * .38)]); root.add(mesh(new THREE.TubeGeometry(legCurve, 8, .012, 5), materials.accent, "leg")); } } addEyes(root, materials, .95, .25, .25, .11); addForkTail(root, materials.fins, -1.2, .65, false, materials.skin); const saw = mesh(new THREE.ConeGeometry(.055, 1.15, 12), materials.accent, "saw_rostrum"); saw.rotation.z = -Math.PI / 2; saw.position.x = 1.45; root.add(saw); return root;
}

function createAngler(id, materials) {
  const root = new THREE.Group(); root.name = id; const body = organicBody(materials.skin, [1.38, .95, .82], materials.baseColor, materials.accentColor, { seed: id === "ruby-angler" ? 101 : 92, bump: .025, variation: .24, spots: 5, headFullness: .28, tailTaper: .38 }); root.add(body); addEyes(root, materials, .62, .26, .54, .1); addGillSlits(root, materials, .35, .36, .57); addForkTail(root, materials.fins, -.82, .62, false, materials.skin); const mouth = mesh(new THREE.TorusGeometry(.31, .055, 8, 28, Math.PI * 1.45), materials.accent, "star_mouth"); mouth.rotation.y = Math.PI / 2; mouth.position.set(.91, -.08, 0); root.add(mouth); for (let i = 0; i < 7; i += 1) { const tooth = mesh(new THREE.ConeGeometry(.028, .17, 8), materials.tooth, "tooth"); tooth.position.set(1.01, -.29 + i * .09, .05); tooth.rotation.z = i % 2 ? Math.PI / 2 : -Math.PI / 2; root.add(tooth); } const lureStem = new THREE.CatmullRomCurve3([new THREE.Vector3(.15, .5, 0), new THREE.Vector3(.42, 1.05, 0), new THREE.Vector3(.9, 1.18, 0)]); root.add(mesh(new THREE.TubeGeometry(lureStem, 18, .018, 8), materials.accent, "lure_stem")); const lure = mesh(new THREE.SphereGeometry(.12, 18, 12), materials.glow, "lure"); lure.position.set(.9, 1.18, 0); root.add(lure); return root;
}

function createFishModel([id, kind, base, glow, accent]) {
  const materials = palette(id, base, glow, accent);
  let model;
  if (kind === "puffer") model = createPuffer(id, materials);
  else if (kind === "ray" || kind === "manta") model = createRay(id, materials, kind === "manta");
  else if (kind === "eel" || kind === "comet-eel") model = createEel(id, materials, kind === "comet-eel");
  else if (kind === "squid") model = createSquid(id, materials);
  else if (kind === "jelly" || kind === "crown-jelly") model = createJelly(id, materials, kind === "crown-jelly");
  else if (kind === "shrimp") model = createShrimp(id, materials);
  else if (kind === "angler") model = createAngler(id, materials);
  else model = createStandardFish(id, kind, materials);
  if (id === "prism-fish") {
    const gold = new THREE.MeshStandardMaterial({
      name: "prism_gold_fin",
      color: 0xffd96a,
      roughness: .3,
      metalness: .2,
      emissive: 0x8a5200,
      emissiveIntensity: .38,
      side: THREE.DoubleSide,
    });
    model.traverse((object) => {
      if (object.isMesh && (object.name === "dorsal_fin" || object.name === "tail_fin")) object.material = gold;
    });
  }
  return model;
}

function createLeviathan() {
  const root = new THREE.Group(); root.name = "leviathan"; const skin = standard("armored_hide", 0x13273a, .7, 0x071425, .45); const plate = standard("bone_plates", 0x274b5c, .76, 0x0a3040, .7); const glow = standard("ancient_glow", 0xffc951, .2, 0xff8f1f, 4); const teeth = standard("leviathan_teeth", 0xe8dfbd, .42);
  const body = mesh(new THREE.SphereGeometry(1, 44, 26), skin, "body"); body.scale.set(5.2, 1.75, 1.25); root.add(body); const head = mesh(new THREE.SphereGeometry(1, 36, 22), plate, "armored_head"); head.scale.set(1.8, 1.55, 1.35); head.position.x = 4.2; root.add(head);
  const jaw = mesh(new THREE.CapsuleGeometry(.48, 2.1, 8, 20), skin, "lower_jaw"); jaw.rotation.z = Math.PI / 2; jaw.position.set(4.75, -.82, .05); root.add(jaw);
  for (let i = 0; i < 11; i += 1) { const tooth = mesh(new THREE.ConeGeometry(.09, .58, 8), teeth, "tooth"); tooth.position.set(3.9 + i * .18, -.5 + Math.sin(i) * .05, .72); tooth.rotation.z = Math.PI; root.add(tooth); }
  for (let i = 0; i < 8; i += 1) { const dorsal = mesh(new THREE.ConeGeometry(.26 + i * .025, 1.1 + i % 3 * .28, 5), plate, "dorsal_spine"); dorsal.position.set(2.8 - i * .85, 1.45 + Math.sin(i) * .08, 0); dorsal.rotation.z = -.14; root.add(dorsal); }
  const tail = new THREE.Group(); tail.name = "tail"; tail.position.x = -4.55; const tailStem = mesh(new THREE.CapsuleGeometry(.62, 2.2, 8, 18), skin, "tail_stem"); tailStem.rotation.z = Math.PI / 2; tailStem.position.x = -1.05; tail.add(tailStem); const finShape = new THREE.Shape(); finShape.moveTo(-1.8, 0); finShape.lineTo(-3.6, 2.6); finShape.lineTo(-3.0, 0); finShape.lineTo(-3.6, -2.6); finShape.closePath(); const fin = mesh(new THREE.ExtrudeGeometry(finShape, { depth: .28, bevelEnabled: true, bevelSize: .1, bevelThickness: .08 }), plate, "tail_fin"); fin.position.z = -.14; tail.add(fin); root.add(tail);
  for (const side of [-1, 1]) { const eye = mesh(new THREE.SphereGeometry(.28, 18, 12), glow, "monster_eye"); eye.position.set(4.9, .38, side * 1.12); root.add(eye); }
  for (let i = 0; i < 9; i += 1) { const node = mesh(new THREE.SphereGeometry(.09, 10, 8), glow, "lateral_glow"); node.position.set(2.5 - i * .75, -.75 + Math.sin(i * .8) * .18, 1.08); root.add(node); } return root;
}

function createKelp() {
  const root = new THREE.Group(); root.name = "kelp"; const green = finMaterial(0x2f8064); const vein = standard("kelp_vein", 0x174d3d, .78);
  for (let i = 0; i < 7; i += 1) { const x = (i - 3) * .18; const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(x, 0, 0), new THREE.Vector3(x + Math.sin(i) * .18, .8, .02), new THREE.Vector3(x - .12, 1.7, 0), new THREE.Vector3(x + .2, 2.6 + i % 2 * .25, .03)]); root.add(mesh(new THREE.TubeGeometry(curve, 18, .035, 6), vein, "kelp_stem")); for (let j = 1; j < 4; j += 1) { const leaf = mesh(new THREE.SphereGeometry(.25, 12, 7), green, "kelp_leaf"); leaf.scale.set(.25, .95, .08); leaf.position.copy(curve.getPoint(j / 4)); leaf.rotation.z = (j % 2 ? .65 : -.65); root.add(leaf); } } return root;
}

function createVent() {
  const root = new THREE.Group(); root.name = "hydrothermal_vent"; const rock = standard("vent_rock", 0x27363b, .94); const mineral = standard("sulfur_mineral", 0xa96535, .72); const glow = standard("vent_glow", 0xff7b45, .3, 0xff4d23, 2.5);
  for (let i = 0; i < 5; i += 1) { const chimney = mesh(new THREE.CylinderGeometry(.18 + i * .02, .35 + i * .025, .85 + i * .22, 9), i % 2 ? rock : mineral, "chimney"); chimney.position.set((i - 2) * .28, .42 + i * .11, Math.sin(i) * .14); root.add(chimney); const opening = mesh(new THREE.TorusGeometry(.17 + i * .02, .035, 7, 12), glow, "vent_opening"); opening.rotation.x = Math.PI / 2; opening.position.set(chimney.position.x, chimney.position.y + (.85 + i * .22) / 2, chimney.position.z); root.add(opening); } return root;
}

function createCliffDetail() {
  const root = new THREE.Group(); root.name = "cliff_detail"; const dark = standard("basalt", 0x263844, .98); const mineral = standard("mineral_face", 0x405968, .9);
  for (let i = 0; i < 14; i += 1) { const rock = mesh(new THREE.IcosahedronGeometry(.3 + i % 4 * .07, 1), i % 5 ? dark : mineral, "basalt_boulder"); rock.position.set((i % 3 - 1) * .38, (Math.floor(i / 3) - 2) * .5, (i % 2) * .12); rock.scale.set(.8 + i % 2 * .25, 1.1 + i % 3 * .2, .7); rock.rotation.set(i * .31, i * .47, i * .19); root.add(rock); } return root;
}

async function exportGlb(name, model) {
  model.traverse((object) => { if (object.isMesh) { object.castShadow = false; object.receiveShadow = false; } });
  const result = await new GLTFExporter().parseAsync(model, { binary: true, onlyVisible: true, trs: false });
  await writeFile(new URL(name, outputDirectory), Buffer.from(result)); console.log(name);
}

for (const definition of species) await exportGlb(`${definition[0]}.glb`, createFishModel(definition));
await exportGlb("leviathan.glb", createLeviathan());
await exportGlb("kelp.glb", createKelp());
await exportGlb("vent.glb", createVent());
await exportGlb("cliff-detail.glb", createCliffDetail());
