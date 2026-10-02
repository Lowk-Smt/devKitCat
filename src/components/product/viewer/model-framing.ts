import { Box3, Group, MathUtils, Sphere, Vector3, type Object3D } from "three";

/** Normalize arbitrary asset units and offsets without changing its hierarchy. */
export function centerModel(model: Object3D) {
  model.updateMatrixWorld(true);
  const bounds = new Box3().setFromObject(model);
  const size = bounds.getSize(new Vector3());
  const extent = Math.max(size.x, size.y, size.z);
  if (bounds.isEmpty() || !Number.isFinite(extent) || extent <= 0) {
    throw new Error("The model has no visible geometry.");
  }

  const root = new Group();
  const scale = 2 / extent;
  root.add(model);
  root.scale.setScalar(scale);
  root.position.copy(bounds.getCenter(new Vector3())).multiplyScalar(-scale);
  root.updateMatrixWorld(true);

  const centeredBounds = new Box3().setFromObject(root);
  return {
    root,
    radius: centeredBounds.getBoundingSphere(new Sphere()).radius,
    groundY: centeredBounds.min.y - 0.01,
  };
}

/** Fit a bounding sphere inside both the horizontal and vertical camera FOV. */
export function getFramingDistance(
  radius: number,
  verticalFov: number,
  aspect: number,
): number {
  const vertical = MathUtils.degToRad(verticalFov);
  const horizontal = 2 * Math.atan(Math.tan(vertical / 2) * aspect);
  return (radius / Math.sin(Math.min(vertical, horizontal) / 2)) * 1.1;
}
