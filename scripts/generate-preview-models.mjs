/** Original, texture-free demo assets. Run from the repo: node scripts/generate-preview-models.mjs */
import { mkdir, writeFile } from "node:fs/promises";
import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Scene,
  TorusGeometry,
} from "three";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

// GLTFExporter uses just these two browser FileReader methods for buffers.
// The shim is confined to this offline generation script, not the application.
globalThis.FileReader = class {
  async readAsArrayBuffer(blob) {
    this.result = await blob.arrayBuffer();
    this.onloadend?.();
  }
  async readAsDataURL(blob) {
    const bytes = Buffer.from(await blob.arrayBuffer());
    this.result = `data:${blob.type};base64,${bytes.toString("base64")}`;
    this.onloadend?.();
  }
};

function mesh(parent, name, geometry, material, position) {
  const object = new Mesh(geometry, material);
  object.name = name;
  object.position.set(...position);
  parent.add(object);
  return object;
}

function chair() {
  const group = new Group();
  group.name = "Sample lounge chair";
  const fabric = new MeshStandardMaterial({ color: 0xb66c48, roughness: 0.85 });
  const cushion = new MeshStandardMaterial({
    color: 0xd6926c,
    roughness: 0.95,
  });
  const pillow = new MeshStandardMaterial({ color: 0xe8d8b6, roughness: 1 });
  const wood = new MeshStandardMaterial({ color: 0x513b2b, roughness: 0.65 });
  const rounded = (x, y, z, radius = 0.05) =>
    new RoundedBoxGeometry(x, y, z, 1, radius);

  mesh(group, "Seat frame", rounded(1.55, 0.25, 1.35), fabric, [0, 0.55, 0]);
  mesh(
    group,
    "Back frame",
    rounded(1.55, 0.92, 0.25),
    fabric,
    [0, 1.08, -0.58],
  );
  mesh(
    group,
    "Left arm",
    rounded(0.2, 0.58, 1.42),
    fabric,
    [-0.78, 0.85, 0.02],
  );
  mesh(
    group,
    "Right arm",
    rounded(0.2, 0.58, 1.42),
    fabric,
    [0.78, 0.85, 0.02],
  );
  mesh(
    group,
    "Seat cushion",
    rounded(1.31, 0.2, 1.18, 0.07),
    cushion,
    [0, 0.76, 0.04],
  );
  const back = mesh(
    group,
    "Back cushion",
    rounded(1.31, 0.73, 0.19, 0.07),
    cushion,
    [0, 1.16, -0.38],
  );
  back.rotation.x = -0.12;
  const accent = mesh(
    group,
    "Linen pillow",
    rounded(0.46, 0.46, 0.17, 0.07),
    pillow,
    [-0.36, 1.1, -0.2],
  );
  accent.rotation.set(-0.18, 0.1, 0.22);
  const leg = new CylinderGeometry(0.055, 0.08, 0.43, 8);
  for (const x of [-0.61, 0.61]) {
    for (const z of [-0.46, 0.46]) {
      mesh(group, `Wood leg ${x} ${z}`, leg, wood, [x, 0.215, z]);
    }
  }
  return group;
}

function lantern() {
  const group = new Group();
  group.name = "Sample camping lantern";
  const metal = new MeshStandardMaterial({
    color: 0x4b685b,
    metalness: 0.55,
    roughness: 0.38,
  });
  const brass = new MeshStandardMaterial({
    color: 0xb69556,
    metalness: 0.7,
    roughness: 0.3,
  });
  const glass = new MeshStandardMaterial({
    color: 0xffe5b5,
    transparent: true,
    opacity: 0.18,
    roughness: 0.2,
    depthWrite: false,
  });
  const light = new MeshStandardMaterial({
    color: 0xffd17e,
    emissive: 0xff9d32,
    emissiveIntensity: 1.2,
    roughness: 0.5,
  });
  mesh(
    group,
    "Base",
    new CylinderGeometry(0.38, 0.43, 0.16, 16),
    metal,
    [0, 0.08, 0],
  );
  mesh(
    group,
    "Brass rim",
    new CylinderGeometry(0.39, 0.39, 0.04, 16),
    brass,
    [0, 0.18, 0],
  );
  mesh(
    group,
    "Glass enclosure",
    new CylinderGeometry(0.32, 0.32, 0.73, 16),
    glass,
    [0, 0.56, 0],
  );
  mesh(
    group,
    "Warm light",
    new CylinderGeometry(0.12, 0.16, 0.45, 12),
    light,
    [0, 0.48, 0],
  );
  const rail = new BoxGeometry(0.05, 0.8, 0.05);
  for (const x of [-0.235, 0.235]) {
    for (const z of [-0.235, 0.235]) {
      mesh(group, `Frame rail ${x} ${z}`, rail, metal, [x, 0.59, z]);
    }
  }
  mesh(
    group,
    "Top rim",
    new CylinderGeometry(0.39, 0.39, 0.05, 16),
    brass,
    [0, 1, 0],
  );
  mesh(
    group,
    "Cap",
    new CylinderGeometry(0.23, 0.4, 0.18, 16),
    metal,
    [0, 1.1, 0],
  );
  mesh(
    group,
    "Handle",
    new TorusGeometry(0.25, 0.028, 6, 20, Math.PI),
    brass,
    [0, 1.19, 0],
  );
  return group;
}

const directory = new URL("../public/previews/", import.meta.url);
await mkdir(directory, { recursive: true });
for (const [filename, model, binary] of [
  ["cozy-lounge.glb", chair(), true],
  ["camping-lantern.gltf", lantern(), false],
]) {
  const scene = new Scene();
  scene.add(model);
  const output = await new GLTFExporter().parseAsync(scene, {
    binary,
    copyright:
      "devKitCat — original preview demo, not a purchased product file",
  });
  const bytes = binary ? Buffer.from(output) : JSON.stringify(output);
  await writeFile(new URL(filename, directory), bytes);
  console.log(`${filename}: ${Buffer.byteLength(bytes)} bytes`);
}
