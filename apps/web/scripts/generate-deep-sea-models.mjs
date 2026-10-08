import { mkdir, writeFile } from "node:fs/promises";
import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";

class NodeFileReader {
  result = null;
  onloadend = null;
  onerror = null;
  async readAsArrayBuffer(blob) {
    try { this.result = await blob.arrayBuffer(); this.onloadend?.(); }
    catch (error) { this.onerror?.(error); }
  }
  async readAsDataURL(blob) {
    try {
      const bytes = Buffer.from(await blob.arrayBuffer());
      this.result = `data:${blob.type || "application/octet-stream"};base64,${bytes.toString("base64")}`;
      this.onloadend?.();
    } catch (error) { this.onerror?.(error); }
  }
}
globalThis.FileReader ??= NodeFileReader;

const outputDirectory = new URL("../public/assets/deep-sea-salvage/models/", import.meta.url);
await mkdir(outputDirectory, { recursive: true });

const standard = (name, color, roughness, metalness = 0, emissive = 0x000000) => {
  const material = new THREE.MeshStandardMaterial({ name, color, roughness, metalness, emissive, emissiveIntensity: emissive ? .8 : 0 });
  return material;
};
const mesh = (geometry, material, name) => { const object = new THREE.Mesh(geometry, material); object.name = name; return object; };

function createSubmarine() {
  const root = new THREE.Group(); root.name = "submarine";
  const hullPaint = standard("aged_yellow_hull", 0xb88724, .38, .62);
  const lowerHull = hullPaint;
  const darkMetal = standard("dark_bronze_fittings", 0x3b3528, .35, .78);
  const propellerBronze = standard("exposed_propeller_bronze", 0xb96f2d, .3, .68, 0x2b1203);
  const rubber = standard("window_seal", 0x10191b, .66, .15);
  const glass = new THREE.MeshPhysicalMaterial({ name: "thick_viewport_glass", color: 0x50ddeb, roughness: .08, metalness: .08, transmission: .25, thickness: .2, emissive: 0x063e50, emissiveIntensity: 1.1 });
  const lampGlass = new THREE.MeshStandardMaterial({ name: "lamp_glass", color: 0xeaffdb, emissive: 0xb9fff0, emissiveIntensity: 3.5, roughness: .12 });

  const hull = mesh(new THREE.CapsuleGeometry(.64, 2.55, 12, 36), hullPaint, "main_pressure_hull");
  hull.rotation.z = Math.PI / 2; root.add(hull);
  const belly = mesh(new THREE.CapsuleGeometry(.57, 2.38, 8, 28), lowerHull, "lower_pressure_hull");
  belly.rotation.z = Math.PI / 2; belly.position.y = -.17; belly.scale.y = .78; root.add(belly);
  const nose = mesh(new THREE.SphereGeometry(.655, 32, 20), hullPaint, "reinforced_bow");
  nose.position.x = 1.33; nose.scale.x = .92; root.add(nose);

  const tower = mesh(new THREE.CapsuleGeometry(.18, .42, 8, 18), hullPaint, "conning_tower");
  tower.position.set(-.2, .7, 0); root.add(tower);
  const towerBase = mesh(new THREE.CylinderGeometry(.34, .44, .17, 24), darkMetal, "tower_base");
  towerBase.position.set(-.2, .56, 0); root.add(towerBase);
  const mast = mesh(new THREE.CylinderGeometry(.035, .045, .62, 10), darkMetal, "periscope_mast"); mast.position.set(-.2, 1.17, 0); root.add(mast);
  const periscope = mesh(new THREE.TorusGeometry(.12, .035, 8, 16, Math.PI / 2), darkMetal, "periscope_head");
  periscope.rotation.set(0, Math.PI / 2, Math.PI / 2); periscope.position.set(-.08, 1.47, 0); root.add(periscope);

  for (const z of [-.602, .602]) {
    const side = Math.sign(z);
    const seal = mesh(new THREE.TorusGeometry(.255, .065, 12, 32), rubber, `viewport_seal_${side > 0 ? "starboard" : "port"}`);
    seal.position.set(.62, .03, z); seal.rotation.y = side > 0 ? 0 : Math.PI; root.add(seal);
    const frame = mesh(new THREE.TorusGeometry(.247, .025, 10, 32), darkMetal, `viewport_frame_${side > 0 ? "starboard" : "port"}`);
    frame.position.set(.62, .03, z + side * .018); frame.rotation.y = side > 0 ? 0 : Math.PI; root.add(frame);
    const pane = mesh(new THREE.CircleGeometry(.218, 32), glass, `viewport_glass_${side > 0 ? "starboard" : "port"}`);
    pane.position.set(.62, .03, z + side * .025); pane.rotation.y = side > 0 ? 0 : Math.PI; root.add(pane);
    for (let bolt = 0; bolt < 8; bolt += 1) {
      const angle = bolt / 8 * Math.PI * 2;
      const rivet = mesh(new THREE.SphereGeometry(.018, 8, 6), darkMetal, "viewport_bolt");
      rivet.position.set(.62 + Math.cos(angle) * .31, .03 + Math.sin(angle) * .31, z + side * .032); root.add(rivet);
    }
  }

  const finShape = new THREE.Shape(); finShape.moveTo(.55, 0); finShape.lineTo(-.72, .67); finShape.lineTo(-.96, .52); finShape.lineTo(-.48, 0); finShape.closePath();
  const finGeometry = new THREE.ExtrudeGeometry(finShape, { depth: .055, bevelEnabled: true, bevelSize: .025, bevelThickness: .025, bevelSegments: 2 });
  for (const z of [-.26, .2]) { const fin = mesh(finGeometry, hullPaint, "dive_plane"); fin.rotation.x = Math.PI / 2; fin.position.set(-.2, -.03, z); fin.scale.set(.8, .8, .8); root.add(fin); }
  const tailFin = mesh(new THREE.ConeGeometry(.48, 1.05, 3), hullPaint, "vertical_tail_fin"); tailFin.position.set(-1.5, .57, 0); tailFin.rotation.z = -.1; root.add(tailFin);

  const propeller = new THREE.Group(); propeller.name = "propeller"; propeller.position.x = -2.02;
  const shaft = mesh(new THREE.CylinderGeometry(.09, .11, .48, 14), darkMetal, "propeller_shaft"); shaft.rotation.z = Math.PI / 2; propeller.add(shaft);
  for (let i = 0; i < 4; i += 1) {
    const blade = mesh(new THREE.CapsuleGeometry(.095, .64, 7, 12), propellerBronze, "propeller_blade"); blade.rotation.x = i * Math.PI / 2; blade.rotation.z = .14; blade.position.x = -.3; propeller.add(blade);
  }
  root.add(propeller);

  for (const y of [-.31, .31]) {
    const seam = mesh(new THREE.TorusGeometry(.645, .012, 7, 40), darkMetal, "hull_weld_seam"); seam.rotation.y = Math.PI / 2; seam.position.x = y; root.add(seam);
  }
  for (const y of [-.28, .28]) {
    const lampHousing = mesh(new THREE.CylinderGeometry(.105, .16, .25, 18), darkMetal, "bow_lamp_housing"); lampHousing.rotation.z = -Math.PI / 2; lampHousing.position.set(1.68, y, .25); root.add(lampHousing);
    const lamp = mesh(new THREE.CircleGeometry(.09, 18), lampGlass, "bow_lamp"); lamp.rotation.y = Math.PI / 2; lamp.position.set(1.815, y, .25); root.add(lamp);
  }
  return root;
}

function createFish() {
  const root = new THREE.Group(); root.name = "fish";
  const skin = standard("silver_blue_scales", 0x6d9eac, .42, .18, 0x071b24);
  const belly = standard("pale_belly", 0xaac5c5, .58, .05);
  const finMaterial = new THREE.MeshStandardMaterial({ name: "translucent_fins", color: 0x527d8c, roughness: .5, transparent: true, opacity: .88, side: THREE.DoubleSide });
  const eyeWhite = standard("eye_cornea", 0xd8eef0, .1, .05);
  const eyeDark = standard("eye_pupil", 0x04080a, .18, .1);

  const body = mesh(new THREE.SphereGeometry(.76, 40, 24), skin, "body"); body.scale.set(1.52, .73, .58); root.add(body);
  const bellyMesh = mesh(new THREE.SphereGeometry(.745, 32, 18, 0, Math.PI * 2, Math.PI * .46, Math.PI * .5), belly, "belly"); bellyMesh.scale.set(1.49, .73, .575); root.add(bellyMesh);

  const tail = new THREE.Group(); tail.name = "tail"; tail.position.x = -1.1;
  const tailShape = new THREE.Shape(); tailShape.moveTo(0, .12); tailShape.bezierCurveTo(-.3, .35, -.67, .75, -.93, .75); tailShape.lineTo(-.7, 0); tailShape.lineTo(-.93, -.75); tailShape.bezierCurveTo(-.62, -.72, -.28, -.32, 0, -.12); tailShape.closePath();
  const tailMesh = mesh(new THREE.ExtrudeGeometry(tailShape, { depth: .07, bevelEnabled: true, bevelSize: .025, bevelThickness: .02, bevelSegments: 2 }), finMaterial, "tail_fin"); tailMesh.position.z = -.035; tail.add(tailMesh); root.add(tail);
  const topFinShape = new THREE.Shape(); topFinShape.moveTo(-.5, .48); topFinShape.quadraticCurveTo(-.18, 1.1, .35, .48); topFinShape.closePath();
  const topFin = mesh(new THREE.ShapeGeometry(topFinShape), finMaterial, "dorsal_fin"); topFin.position.z = .02; root.add(topFin);
  const sideFin = mesh(new THREE.ConeGeometry(.18, .72, 3), finMaterial, "pectoral_fin"); sideFin.position.set(-.05, -.28, .49); sideFin.rotation.set(Math.PI / 2, 0, -.25); root.add(sideFin);

  for (const z of [-.5, .5]) {
    const side = Math.sign(z);
    const eye = mesh(new THREE.SphereGeometry(.135, 20, 12), eyeWhite, "eye"); eye.position.set(.69, .22, z); root.add(eye);
    const pupil = mesh(new THREE.SphereGeometry(.068, 16, 10), eyeDark, "pupil"); pupil.position.set(.735, .23, z + side * .085); root.add(pupil);
  }
  for (let i = 0; i < 5; i += 1) {
    const stripe = mesh(new THREE.TorusGeometry(.54 - i * .025, .018, 8, 32), finMaterial, "scale_band");
    stripe.rotation.y = Math.PI / 2; stripe.position.x = -.55 + i * .22; stripe.scale.y = 1.05; root.add(stripe);
  }
  return root;
}

async function exportGlb(name, model) {
  model.traverse((object) => { if (object.isMesh) { object.castShadow = true; object.receiveShadow = true; } });
  const exporter = new GLTFExporter();
  const result = await exporter.parseAsync(model, { binary: true, onlyVisible: true, trs: false });
  await writeFile(new URL(name, outputDirectory), Buffer.from(result));
}

await exportGlb("submarine.glb", createSubmarine());
await exportGlb("fish.glb", createFish());
console.log("Generated submarine.glb and fish.glb");
