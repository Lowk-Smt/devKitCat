import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  Box3,
  BoxGeometry,
  Group,
  InstancedMesh,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Points,
  Scene,
  Skeleton,
  SkinnedMesh,
  Texture,
  Vector3,
} from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { buildGalleryItems } from "../src/lib/gallery.ts";
import { getModelSourceIssue } from "../src/lib/model-preview.ts";
import {
  centerModel,
  getFramingDistance,
} from "../src/components/product/viewer/model-framing.ts";
import {
  createResourceOwner,
  createWireframeControl,
  disposeObjects,
} from "../src/components/product/viewer/model-resources.ts";

const context = { categoryName: "3D Assets", icon: "3d-assets" };
const product = { id: "demo", title: "Demo product", images: [] };

test("missing sources are distinct from unsupported sources", () => {
  for (const source of [undefined, "", " \n "]) {
    assert.equal(getModelSourceIssue(source), "missing");
  }
});

test("GLB/GLTF accept local, relative, and HTTP(S) URLs with query/fragment", () => {
  for (const source of [
    "/previews/demo.glb",
    "previews/demo.gltf",
    " ../demo.GLB ",
    "https://cdn.example.com/demo.gltf?version=2#model",
    "http://example.com/model.glb",
  ])
    assert.equal(getModelSourceIssue(source), null);
});

test("other formats, protocols and invalid paths are rejected before WebGL", () => {
  for (const source of [
    "/demo.obj",
    "/demo.fbx",
    "/demo.stl",
    "/demo.glb/missing",
    "/model",
    "javascript:demo.glb",
    "data:model/gltf-binary;base64,AA",
    "blob:https://example.com/demo.glb",
    "ftp://example.com/demo.glb",
    "https://[invalid]/demo.gltf",
  ])
    assert.equal(getModelSourceIssue(source), "unsupported");
});

test("image-free non-3D products retain the original placeholder", () => {
  assert.deepEqual(buildGalleryItems(product, context), [
    {
      id: "demo-placeholder",
      kind: "placeholder",
      label: "Preview",
      ...context,
    },
  ]);
});

test("image galleries retain sources, order, IDs and text alternatives", () => {
  const items = buildGalleryItems(
    { ...product, images: ["/one.png", "/two.png"] },
    context,
  );
  assert.deepEqual(
    items.map((item) => [item.id, item.kind, item.src]),
    [
      ["demo-image-0", "image", "/one.png"],
      ["demo-image-1", "image", "/two.png"],
    ],
  );
  assert.equal(items[1].alt, "Demo product — preview 2 of 2");
});

test("model media is optional, model-first and supports multiple preview sources", () => {
  const modelPreviews = [
    { src: "/one.glb", label: "Chair", description: "A lounge chair." },
    { src: "/two.gltf", label: "Table", description: "A wooden table." },
  ];
  const items = buildGalleryItems(
    { ...product, modelPreviews, images: ["/still.png"] },
    context,
  );
  assert.deepEqual(
    items.map((item) => item.kind),
    ["model", "model", "image"],
  );
  assert.equal(items[0].title, "Demo product — Chair");
  assert.equal(items[1].src, "/two.gltf");
  assert.equal(items[0].description, "A lounge chair.");
  assert.equal(new Set(items.map((item) => item.id)).size, items.length);
  assert.equal(
    buildGalleryItems({ ...product, id: "another", modelPreviews }, context)[0]
      .id,
    "another-model-0",
  );
});

test("empty optional model lists keep the placeholder fallback", () => {
  assert.equal(
    buildGalleryItems({ ...product, modelPreviews: [] }, context)[0].kind,
    "placeholder",
  );
});

test("centering normalizes model units and offsets without editing authored transforms", () => {
  for (const units of [0.001, 1, 10000]) {
    const mesh = new Mesh(new BoxGeometry(2, 1, 3), new MeshStandardMaterial());
    mesh.position.set(80, -15, 30);
    mesh.rotation.set(0.2, 0.4, -0.1);
    mesh.scale.setScalar(units);
    const original = {
      position: mesh.position.clone(),
      rotation: mesh.rotation.clone(),
      scale: mesh.scale.clone(),
    };
    const { root, radius, groundY } = centerModel(mesh);
    const bounds = new Box3().setFromObject(root);
    assert.ok(bounds.getCenter(new Vector3()).length() < 1e-8);
    const size = bounds.getSize(new Vector3());
    assert.ok(Math.abs(Math.max(size.x, size.y, size.z) - 2) < 1e-8);
    assert.ok(Number.isFinite(radius) && radius > 0);
    assert.ok(groundY < bounds.min.y);
    assert.ok(mesh.position.equals(original.position));
    assert.ok(mesh.rotation.equals(original.rotation));
    assert.ok(mesh.scale.equals(original.scale));
    disposeObjects([root]);
  }
});

test("empty and degenerate models produce an error instead of a blank preview", () => {
  assert.throws(() => centerModel(new Group()), /no visible geometry/);
  const flat = new Mesh(new BoxGeometry(0, 0, 0), new MeshStandardMaterial());
  assert.throws(() => centerModel(flat), /no visible geometry/);
  disposeObjects([flat]);
});

test("automatic framing fits both camera axes at desktop/tablet/mobile aspect ratios", () => {
  for (const aspect of [16 / 10, 4 / 3, 1, 0.5, 3]) {
    const radius = 1.5;
    const camera = new PerspectiveCamera(40, aspect);
    const distance = getFramingDistance(radius, camera.fov, camera.aspect);
    const vertical = (camera.fov * Math.PI) / 180;
    const horizontal = 2 * Math.atan(Math.tan(vertical / 2) * aspect);
    assert.ok(distance * Math.sin(vertical / 2) > radius);
    assert.ok(distance * Math.sin(horizontal / 2) > radius);
  }
  assert.ok(getFramingDistance(1, 40, 0.5) > getFramingDistance(1, 40, 1.6));
});

test("wireframe toggling preserves material identity, texture maps, arrays and original flags", () => {
  const texture = new Texture();
  const material = new MeshStandardMaterial({ map: texture });
  const alreadyWireframe = new MeshStandardMaterial({ wireframe: true });
  const materials = [material, alreadyWireframe];
  const root = new Group();
  const mesh = new Mesh(new BoxGeometry(), materials);
  root.add(mesh, new Mesh(mesh.geometry, material));
  const toggle = createWireframeControl(root);
  toggle.set(true);
  assert.equal(material.wireframe, true);
  assert.equal(mesh.material, materials);
  assert.equal(material.map, texture);
  toggle.set(false);
  assert.equal(material.wireframe, false);
  assert.equal(alreadyWireframe.wireframe, true);
  toggle.set(true);
  toggle.dispose();
  assert.equal(material.wireframe, false);
  assert.equal(alreadyWireframe.wireframe, true);
  disposeObjects([root]);
});

test("resource cleanup deduplicates shared geometry/materials/textures across all scenes", () => {
  const root = new Scene();
  const alternate = new Group();
  const geometry = new BoxGeometry();
  const texture = new Texture();
  const material = new MeshStandardMaterial({
    map: texture,
    normalMap: texture,
  });
  root.add(
    new Mesh(geometry, [material, material]),
    new Points(geometry, material),
  );
  alternate.add(new Mesh(geometry, material));
  const counts = { geometry: 0, material: 0, texture: 0 };
  for (const [name, resource] of [
    ["geometry", geometry],
    ["material", material],
    ["texture", texture],
  ]) {
    resource.addEventListener("dispose", () => counts[name]++);
  }
  disposeObjects([root, alternate]);
  assert.deepEqual(counts, { geometry: 1, material: 1, texture: 1 });
  assert.equal(root.children.length, 0);
  assert.equal(alternate.children.length, 0);
});

test("cleanup also releases skeleton bone textures, instanced meshes and shared ImageBitmaps", () => {
  const OriginalImageBitmap = globalThis.ImageBitmap;
  let closed = 0;
  globalThis.ImageBitmap = class {
    close() {
      closed++;
    }
  };
  try {
    const bitmap = new ImageBitmap();
    const first = new Texture(bitmap);
    const second = new Texture(bitmap);
    const material = new MeshStandardMaterial({
      map: first,
      normalMap: second,
    });
    const geometry = new BoxGeometry();
    const root = new Group();
    const skinned = new SkinnedMesh(geometry, material);
    const skeleton = new Skeleton([]);
    skeleton.boneTexture = new Texture();
    skinned.bind(skeleton);
    const instanced = new InstancedMesh(geometry, material, 1);
    let instancesDisposed = 0;
    let boneTextureDisposed = 0;
    instanced.addEventListener("dispose", () => instancesDisposed++);
    skeleton.boneTexture.addEventListener(
      "dispose",
      () => boneTextureDisposed++,
    );
    root.add(skinned, instanced);
    disposeObjects([root]);
    assert.equal(instancesDisposed, 1);
    assert.equal(boneTextureDisposed, 1);
    assert.equal(closed, 1);
  } finally {
    if (OriginalImageBitmap) globalThis.ImageBitmap = OriginalImageBitmap;
    else delete globalThis.ImageBitmap;
  }
});

test("a cancelled parse releases individual dependencies and late resources immediately", () => {
  const owner = createResourceOwner();
  const early = new MeshStandardMaterial();
  const late = new Mesh(new BoxGeometry(), new MeshStandardMaterial());
  let earlyDisposed = 0;
  let lateGeometryDisposed = 0;
  let lateMaterialDisposed = 0;
  early.addEventListener("dispose", () => earlyDisposed++);
  late.geometry.addEventListener("dispose", () => lateGeometryDisposed++);
  late.material.addEventListener("dispose", () => lateMaterialDisposed++);
  owner.track(early);
  owner.dispose();
  owner.track(late);
  owner.track(early);
  owner.track(late);
  owner.dispose();
  assert.equal(earlyDisposed, 1);
  assert.equal(lateGeometryDisposed, 1);
  assert.equal(lateMaterialDisposed, 1);
});

test("a resource owner deduplicates parser dependencies and the final scene", () => {
  const owner = createResourceOwner();
  const texture = new Texture();
  const material = new MeshStandardMaterial({ map: texture });
  const mesh = new Mesh(new BoxGeometry(), material);
  const root = new Group();
  root.add(mesh);
  let textureDisposed = 0;
  let materialDisposed = 0;
  texture.addEventListener("dispose", () => textureDisposed++);
  material.addEventListener("dispose", () => materialDisposed++);
  owner.track(texture);
  owner.track(material);
  owner.track(mesh);
  disposeObjects([root], owner);
  disposeObjects([root], owner);
  assert.equal(textureDisposed, 1);
  assert.equal(materialDisposed, 1);
});

// Node has fetch but not the browser ProgressEvent used by Three's FileLoader.
globalThis.ProgressEvent ??= class extends Event {
  constructor(type, properties) {
    super(type);
    Object.assign(this, properties);
  }
};

for (const filename of ["cozy-lounge.glb", "camping-lantern.gltf"]) {
  test(`the checked-in ${filename} asset parses with GLTFLoader and can be framed`, async () => {
    const bytes = await readFile(
      new URL(`../public/previews/${filename}`, import.meta.url),
    );
    const input = filename.endsWith(".gltf")
      ? bytes.toString("utf8")
      : bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength,
        );
    const model = await new GLTFLoader().parseAsync(input, "");
    let meshes = 0;
    model.scene.traverse((object) => {
      if (object instanceof Mesh) meshes++;
    });
    assert.ok(meshes >= 10);
    const centered = centerModel(model.scene);
    assert.ok(centered.radius > 0 && Number.isFinite(centered.radius));
    disposeObjects([centered.root, ...model.scenes]);
  });
}
