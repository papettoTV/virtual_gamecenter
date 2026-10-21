import * as THREE from "three";
import {
  drawLevelUpLightning, drawPlayerShield, lightningFrame, shieldAppearance,
  LEVEL_UP_FLASH_DURATION, LIGHTNING_COLUMNS, LIGHTNING_FRAME_COUNT, LIGHTNING_FRAME_SIZE,
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
  shield.renderOrder = 3;
  shield.visible = false;
  root.add(shield);
  let lightning: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> | null = null;
  let lightningColor = "";

  function clearLightning() {
    if (!lightning) return;
    root.remove(lightning);
    lightning.material.map?.dispose();
    lightning.material.dispose();
    lightning.geometry.dispose();
    lightning = null;
  }

  return {
    root, shield,
    update(player: PlayerRenderState, elapsed: number) {
      const appearance = shieldAppearance(player.barrierRatio, player.levelUpInvincible, elapsed);
      shield.visible = player.levelUpInvincible > 0;
      shield.scale.setScalar(appearance.radius);
      shield.material.opacity = appearance.opacity;
      if (!(player.levelUpFlash > 0)) {
        clearLightning();
        return;
      }
      if (lightning && lightningColor !== player.color) clearLightning();
      if (!lightning) {
        const rows = Math.ceil(LIGHTNING_FRAME_COUNT / LIGHTNING_COLUMNS);
        const { canvas: atlas, context: brush } = artwork(LIGHTNING_FRAME_SIZE * LIGHTNING_COLUMNS, LIGHTNING_FRAME_SIZE * rows);
        for (let frame = 0; frame < LIGHTNING_FRAME_COUNT; frame += 1) {
          brush.save();
          brush.translate(frame % LIGHTNING_COLUMNS * LIGHTNING_FRAME_SIZE, Math.floor(frame / LIGHTNING_COLUMNS) * LIGHTNING_FRAME_SIZE);
          // Clip glow to its own cell so adjacent frames cannot bleed into it.
          brush.beginPath();
          brush.rect(0, 0, LIGHTNING_FRAME_SIZE, LIGHTNING_FRAME_SIZE);
          brush.clip();
          drawLevelUpLightning(brush, 128, 128, player.color, LEVEL_UP_FLASH_DURATION * (1 - (frame + 0.25) / LIGHTNING_FRAME_COUNT));
          brush.restore();
        }
        const texture = new THREE.CanvasTexture(atlas);
        texture.generateMipmaps = false;
        texture.minFilter = THREE.LinearFilter;
        texture.repeat.set(1 / LIGHTNING_COLUMNS, 1 / rows);
        lightning = new THREE.Mesh(new THREE.PlaneGeometry(256, 256), material(texture));
        lightning.renderOrder = 3.5;
        root.add(lightning);
        lightningColor = player.color;
      }
      const frame = lightningFrame(player.levelUpFlash);
      const rows = Math.ceil(LIGHTNING_FRAME_COUNT / LIGHTNING_COLUMNS);
      lightning.material.map!.offset.set(frame % LIGHTNING_COLUMNS / LIGHTNING_COLUMNS, 1 - (Math.floor(frame / LIGHTNING_COLUMNS) + 1) / rows);
    },
    dispose() {
      clearLightning();
      shield.material.map?.dispose();
      shield.material.dispose();
      shield.geometry.dispose();
      root.remove(shield);
    },
  };
}
