import * as THREE from "three";
import { PLAYER_WING_MODEL } from "./player-wing-geometry";

export function createPlayerWingVisual() {
  const root = new THREE.Group();
  root.visible = false;
  root.renderOrder = 3;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(PLAYER_WING_MODEL.vertices.flatMap(([pointX, pointY, pointZ]) => [pointX, -pointY, pointZ]), 3));
  const indices: number[] = [];
  for (const face of PLAYER_WING_MODEL.faces) {
    for (let index = 1; index < face.length - 1; index += 1) indices.push(face[0]!, face[index]!, face[index + 1]!);
  }
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const material = new THREE.MeshPhongMaterial({
    transparent: true, opacity: 0.74, side: THREE.DoubleSide, depthTest: false, depthWrite: false,
    forceSinglePass: true, shininess: 28,
  });
  const surface = new THREE.Mesh(geometry, material);
  surface.renderOrder = 3;
  const edgeMaterial = new THREE.LineBasicMaterial({ transparent: true, depthTest: false, depthWrite: false });
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geometry, 20), edgeMaterial);
  edges.renderOrder = 3.1;
  const seams: number[] = [];
  for (const seam of PLAYER_WING_MODEL.seams) {
    for (let index = 1; index < seam.length; index += 1) {
      for (const pointIndex of [seam[index - 1]!, seam[index]!]) {
        const [pointX, pointY, pointZ] = PLAYER_WING_MODEL.vertices[pointIndex]!;
        seams.push(pointX, -pointY, pointZ);
      }
    }
  }
  const seamGeometry = new THREE.BufferGeometry();
  seamGeometry.setAttribute("position", new THREE.Float32BufferAttribute(seams, 3));
  const seamMaterial = new THREE.LineBasicMaterial({ color: 0xe1ffff, transparent: true, depthTest: false, depthWrite: false });
  const highlights = new THREE.LineSegments(seamGeometry, seamMaterial);
  highlights.renderOrder = 3.2;
  root.add(surface, edges, highlights);
  let previousColor = "";
  return {
    root,
    update(angle: number, color: string, opacity: number) {
      root.rotation.y = angle;
      if (color !== previousColor) {
        material.color.set(color).multiplyScalar(0.3);
        material.emissive.set(color).multiplyScalar(0.08);
        edgeMaterial.color.set(color);
        previousColor = color;
      }
      material.opacity = opacity * 0.74;
      edgeMaterial.opacity = opacity * 0.95;
      seamMaterial.opacity = opacity;
    },
  };
}
