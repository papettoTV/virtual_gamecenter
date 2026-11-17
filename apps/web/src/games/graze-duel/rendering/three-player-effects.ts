import * as THREE from "three";
import {
  createLightningPaths, drawPlayerShield, lightningOpacity, lightningRibbon, shieldAppearance,
  LIGHTNING_LAYERS, LIGHTNING_VERTEX_CAPACITY,
} from "./player-effects";
import type { PlayerRenderState } from "./scene-renderer";

function artwork(width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Unable to create player effect texture");
  return { canvas, context };
}

function material(map: THREE.CanvasTexture) {
  map.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshBasicMaterial({
    map, transparent: true, blending: THREE.NormalBlending, depthTest: false, depthWrite: false,
  });
}

export function createPlayerEffects() {
  const root = new THREE.Group();
  root.renderOrder = 4;
  const { canvas, context } = artwork(256, 256);
  drawPlayerShield(context, 128, 128, 126);
  const shield = new THREE.Mesh(new THREE.PlaneGeometry(256 / 126, 256 / 126), material(new THREE.CanvasTexture(canvas)));
  shield.renderOrder = 4.5;
  shield.visible = false;
  root.add(shield);
  const clipPlanes = [
    new THREE.Plane(new THREE.Vector3(1, 0, 0)),
    new THREE.Plane(new THREE.Vector3(-1, 0, 0)),
    new THREE.Plane(new THREE.Vector3(0, -1, 0)),
    new THREE.Plane(new THREE.Vector3(0, 1, 0)),
  ];
  const lightning = LIGHTNING_LAYERS.map((layer, index) => {
    const positions = new THREE.BufferAttribute(new Float32Array(LIGHTNING_VERTEX_CAPACITY * 3), 3).setUsage(THREE.DynamicDrawUsage);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", positions);
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
      color: layer.color, transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide,
      forceSinglePass: true, clippingPlanes: clipPlanes,
    }));
    mesh.frustumCulled = false;
    mesh.renderOrder = 3.5 + index * 0.1;
    mesh.visible = false;
    root.add(mesh);
    return { mesh, positions, layer };
  });

  return {
    root, shield,
    update(player: PlayerRenderState, elapsed: number, fieldWidth: number, fieldTop: number, fieldBottom: number) {
      const appearance = shieldAppearance(player.barrierRatio, player.levelUpInvincible, elapsed);
      shield.visible = player.levelUpInvincible > 0;
      shield.scale.setScalar(appearance.radius);
      shield.material.opacity = appearance.opacity;
      const visible = player.levelUpFlash > 0;
      for (const { mesh } of lightning) mesh.visible = visible;
      if (!visible) return;
      const bounds = {
        left: player.fieldX - player.x, right: player.fieldX + fieldWidth - player.x,
        top: fieldTop - player.y, bottom: fieldBottom - player.y,
      };
      const paths = createLightningPaths(bounds, player.levelUpFlash, player.lightningPattern ?? 0, player.lightningSeed);
      const { position, scale } = root.parent!;
      clipPlanes[0]!.constant = -position.x - bounds.left * scale.x;
      clipPlanes[1]!.constant = position.x + bounds.right * scale.x;
      clipPlanes[2]!.constant = position.y - bounds.top * scale.y;
      clipPlanes[3]!.constant = -position.y + bounds.bottom * scale.y;
      for (const { mesh, positions, layer } of lightning) {
        let vertex = 0;
        for (const path of paths) {
          const ribbon = lightningRibbon(path, layer.width);
          for (let index = 1; index < ribbon.length; index += 1) {
            const [left, right] = ribbon[index - 1]!;
            const [nextLeft, nextRight] = ribbon[index]!;
            for (const point of [left, right, nextLeft, right, nextRight, nextLeft]) {
              positions.setXYZ(vertex++, point.x, -point.y, 0);
            }
          }
        }
        positions.needsUpdate = true;
        mesh.geometry.setDrawRange(0, vertex);
        mesh.material.opacity = layer.opacity * lightningOpacity(player.levelUpFlash);
      }
    },
    dispose() {
      for (const { mesh } of lightning) {
        mesh.geometry.dispose();
        mesh.material.dispose();
        root.remove(mesh);
      }
      shield.material.map?.dispose();
      shield.material.dispose();
      shield.geometry.dispose();
      root.remove(shield);
    },
  };
}
