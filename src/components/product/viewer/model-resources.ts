import {
  BufferGeometry,
  InstancedMesh,
  Material,
  Mesh,
  Object3D,
  Skeleton,
  SkinnedMesh,
  Texture,
} from "three";

type Disposable =
  BufferGeometry | Material | Texture | Skeleton | InstancedMesh;

/**
 * Own one model lifetime, including partially parsed and late GLTF dependencies.
 * Weak sets prevent double disposal without retaining already released resources.
 */
export function createResourceOwner() {
  const resources = new Set<Disposable>();
  const disposed = new WeakSet<Disposable>();
  const closedBitmaps = new WeakSet<ImageBitmap>();
  let released = false;

  function release(resource: Disposable) {
    if (disposed.has(resource)) return;
    disposed.add(resource);
    resource.dispose();
    if (resource instanceof Texture) {
      const images = Array.isArray(resource.source.data)
        ? resource.source.data
        : [resource.source.data];
      for (const image of images) {
        if (
          typeof ImageBitmap !== "undefined" &&
          image instanceof ImageBitmap &&
          !closedBitmaps.has(image)
        ) {
          closedBitmaps.add(image);
          image.close();
        }
      }
    }
  }

  function retain(resource: Disposable) {
    if (disposed.has(resource) || resources.has(resource)) return;
    if (resource instanceof Material) {
      // GLTF's standard, physical and unlit material texture slots.
      for (const value of Object.values(resource)) {
        if (value instanceof Texture) retain(value);
      }
    }
    if (released) release(resource);
    else resources.add(resource);
  }

  function track(resource: unknown) {
    if (resource instanceof Object3D) {
      resource.traverse((object) => {
        // Also covers line/point geometry, e.g. the viewer's ground grid.
        const renderable = object as Object3D & {
          geometry?: BufferGeometry;
          material?: Material | Material[];
        };
        if (renderable.geometry) retain(renderable.geometry);
        if (renderable.material) {
          const list = Array.isArray(renderable.material)
            ? renderable.material
            : [renderable.material];
          list.forEach(retain);
        }
        if (object instanceof SkinnedMesh) retain(object.skeleton);
        if (object instanceof InstancedMesh) retain(object);
      });
    } else if (
      resource instanceof BufferGeometry ||
      resource instanceof Material ||
      resource instanceof Texture ||
      resource instanceof Skeleton
    ) {
      retain(resource);
    }
  }

  return {
    track,
    dispose() {
      released = true;
      resources.forEach(release);
      resources.clear();
    },
  };
}

/** Dispose once per shared resource, including alternate scenes in a GLTF. */
export function disposeObjects(
  roots: Object3D[],
  owner = createResourceOwner(),
): void {
  roots.forEach(owner.track);
  owner.dispose();
  roots.forEach((root) => {
    root.removeFromParent();
    root.clear();
  });
}

type WireframeMaterial = Material & { wireframe: boolean };

/** Preserve material objects, textures, arrays, and original wireframe flags. */
export function createWireframeControl(root: Object3D) {
  const originals = new Map<WireframeMaterial, boolean>();
  root.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    const materials = Array.isArray(object.material)
      ? object.material
      : [object.material];
    for (const material of materials) {
      if ("wireframe" in material && typeof material.wireframe === "boolean") {
        const meshMaterial = material as WireframeMaterial;
        if (!originals.has(meshMaterial)) {
          originals.set(meshMaterial, meshMaterial.wireframe);
        }
      }
    }
  });

  function set(enabled: boolean) {
    for (const [material, original] of originals) {
      const next = enabled || original;
      if (material.wireframe !== next) {
        material.wireframe = next;
        material.needsUpdate = true;
      }
    }
  }

  return {
    set,
    dispose() {
      set(false);
      originals.clear();
    },
  };
}
