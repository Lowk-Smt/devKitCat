import {
  ACESFilmicToneMapping,
  DirectionalLight,
  GridHelper,
  HemisphereLight,
  LoadingManager,
  MathUtils,
  PerspectiveCamera,
  PMREMGenerator,
  Scene,
  Spherical,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
  type WebGLRenderTarget,
} from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { GLTFLoader, type GLTF } from "three/addons/loaders/GLTFLoader.js";
import type { ModelPreviewIssue } from "@/lib/model-preview";
import { centerModel, getFramingDistance } from "./model-framing";
import {
  createResourceOwner,
  createWireframeControl,
  disposeObjects,
} from "./model-resources";

export interface ModelViewerHandle {
  rotate: (horizontal: number, vertical?: number) => void;
  zoom: (factor: number) => void;
  reset: () => void;
  setWireframe: (enabled: boolean) => void;
  dispose: () => void;
}

interface ViewerOptions {
  src: string;
  title: string;
  describedBy: string;
  onLoading: () => void;
  onReady: () => void;
  onError: (issue: ModelPreviewIssue) => void;
}

const INITIAL_DIRECTION = new Vector3(1.3, 0.85, 1.8).normalize();

/** One self-contained scene lifetime. No animation loop, global cache or singleton. */
export function createModelViewer(
  container: HTMLDivElement,
  { src, title, describedBy, onLoading, onReady, onError }: ViewerOptions,
): ModelViewerHandle {
  const scene = new Scene();
  const camera = new PerspectiveCamera(40, 1, 0.01, 100);
  const manager = new LoadingManager();
  const request = new AbortController();
  const resources = createResourceOwner();
  const objectUrls = new Set<string>();
  const initialPosition = new Vector3();
  let renderer: WebGLRenderer | undefined;
  let controls: OrbitControls | undefined;
  let environment: WebGLRenderTarget | undefined;
  let observer: ResizeObserver | undefined;
  let asset: GLTF | undefined;
  let wireframe: ReturnType<typeof createWireframeControl> | undefined;
  let frame: number | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let radius = 0;
  let framingDistance = 0;
  let ready = false;
  let disposed = false;
  let released = false;
  let failed = false;
  let dependencyFailed = false;

  // GLTFLoader creates blob URLs for embedded GLB images, but only revokes
  // them on successful decoding. Own those URLs on failure/cancellation too.
  manager.setURLModifier((url) => {
    if (url.startsWith("blob:")) {
      if (disposed || failed) URL.revokeObjectURL(url);
      else objectUrls.add(url);
    }
    return url;
  });

  // A texture failure can otherwise be swallowed by GLTFLoader as a null map.
  manager.onError = () => {
    dependencyFailed = true;
  };

  function releaseResources() {
    if (released) return;
    released = true;
    request.abort();
    manager.abort();
    objectUrls.forEach((url) => URL.revokeObjectURL(url));
    objectUrls.clear();
    clearTimeout(timeout);
    if (frame !== undefined) cancelAnimationFrame(frame);
    frame = undefined;
    observer?.disconnect();
    window.removeEventListener("resize", resize);
    document.removeEventListener("visibilitychange", onVisibilityChange);
    renderer?.domElement.removeEventListener("webglcontextlost", onContextLost);
    controls?.removeEventListener("change", requestRender);
    controls?.dispose();
    wireframe?.dispose();
    scene.environment = null;
    disposeObjects([scene, ...(asset?.scenes ?? [])], resources);
    asset = undefined;
    environment?.dispose();
    renderer?.dispose();
    // Release the context as well as its resources on gallery/route changes.
    renderer?.forceContextLoss();
    renderer?.domElement.remove();
  }

  function fail(issue: ModelPreviewIssue) {
    if (disposed || failed) return;
    failed = true;
    releaseResources();
    queueMicrotask(() => {
      if (!disposed) onError(issue);
    });
  }

  function requestRender() {
    if (disposed || failed || frame !== undefined || document.hidden) return;
    frame = requestAnimationFrame(() => {
      frame = undefined;
      if (disposed || failed || !renderer || !radius) return;
      try {
        renderer.render(scene, camera);
        if (!ready) {
          ready = true;
          onReady();
        }
      } catch {
        fail("webgl");
      }
    });
  }

  function resize() {
    if (disposed || failed || !renderer) return;
    const width = container.clientWidth;
    const height = container.clientHeight;
    if (!width || !height) return;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    if (radius && controls) {
      const nextDistance = getFramingDistance(
        radius,
        camera.fov,
        camera.aspect,
      );
      // Preserve the user's orbit and relative zoom when the viewport changes.
      camera.position
        .sub(controls.target)
        .multiplyScalar(framingDistance ? nextDistance / framingDistance : 1)
        .add(controls.target);
      framingDistance = nextDistance;
      initialPosition.copy(INITIAL_DIRECTION).multiplyScalar(nextDistance);
      controls.minDistance = radius * 1.05;
      controls.maxDistance = nextDistance * 3;
      controls.update();
    }
    requestRender();
  }

  function onVisibilityChange() {
    if (document.hidden && frame !== undefined) {
      cancelAnimationFrame(frame);
      frame = undefined;
    } else if (!document.hidden) {
      requestRender();
    }
  }

  function onContextLost(event: Event) {
    event.preventDefault();
    fail("webgl");
  }

  async function loadModel() {
    try {
      const url = new URL(src, window.location.href);
      // A per-instance fetch avoids Three's global in-flight root-request
      // deduplication race when Strict Mode or fast gallery switches abort.
      const response = await fetch(url, { signal: request.signal });
      if (!response.ok) throw new Error("Model request failed.");
      const bytes = await response.arrayBuffer();
      if (disposed || failed) return;
      const loader = new GLTFLoader(manager);
      // Track public parser dependencies, not just the final scene. Materials
      // and bitmaps resolved during a cancelled/failed parse are released too.
      loader.register((parser) => {
        const getDependency = parser.getDependency.bind(parser);
        parser.getDependency = (type, index) => {
          if (disposed || failed)
            return Promise.reject(new Error("Preview closed."));
          return getDependency(type, index).then((resource: unknown) => {
            resources.track(resource);
            if (disposed || failed) throw new Error("Preview closed.");
            return resource;
          });
        };
        return { name: "devKitCat_preview_resource_lifetime" };
      });
      const resourcePath = new URL(".", response.url || url.href).href;
      const loaded = await loader.parseAsync(bytes, resourcePath);
      // Decoding may finish after abort/unmount; it still owns resources.
      if (disposed || failed) {
        disposeObjects(loaded.scenes, resources);
        return;
      }
      asset = loaded;
      if (dependencyFailed) throw new Error("A model resource could not load.");
      const centered = centerModel(loaded.scene);
      radius = centered.radius;
      scene.add(centered.root);
      wireframe = createWireframeControl(centered.root);

      const grid = new GridHelper(8, 16, 0x394563, 0x242c3c);
      grid.position.y = centered.groundY;
      const gridMaterials = Array.isArray(grid.material)
        ? grid.material
        : [grid.material];
      gridMaterials.forEach((material) => {
        material.transparent = true;
        material.opacity = 0.4;
        material.depthWrite = false;
      });
      scene.add(grid);
      resize();
      camera.position.copy(initialPosition);
      controls!.target.set(0, 0, 0);
      controls!.update();
      clearTimeout(timeout);
      requestRender();
    } catch {
      if (!disposed && !failed) fail("load");
    }
  }

  // Deferring setup also makes Strict Mode's setup/cleanup/setup cycle cheap.
  queueMicrotask(() => {
    if (disposed) return;
    onLoading();
    try {
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("webgl2", {
        antialias: true,
        alpha: true,
      });
      if (!context) {
        fail("webgl");
        return;
      }
      renderer = new WebGLRenderer({
        canvas,
        context,
        antialias: true,
        alpha: true,
      });
      renderer.outputColorSpace = SRGBColorSpace;
      renderer.toneMapping = ACESFilmicToneMapping;
      canvas.tabIndex = 0;
      canvas.setAttribute("role", "img");
      canvas.setAttribute("aria-label", `${title}, interactive 3D model`);
      canvas.setAttribute("aria-describedby", describedBy);
      canvas.addEventListener("webglcontextlost", onContextLost);
      container.append(canvas);

      controls = new OrbitControls(camera, canvas);
      controls.enablePan = false;
      // Direct interaction + demand rendering: no perpetual damping/auto-rotate.
      controls.enableDamping = false;
      controls.rotateSpeed = 0.7;
      controls.zoomSpeed = 0.8;
      controls.minPolarAngle = 0.1;
      controls.maxPolarAngle = Math.PI - 0.1;
      controls.addEventListener("change", requestRender);

      const room = new RoomEnvironment();
      const generator = new PMREMGenerator(renderer);
      try {
        environment = generator.fromScene(room, 0.04, 0.1, 100, { size: 128 });
        scene.environment = environment.texture;
        scene.environmentIntensity = 0.7;
      } finally {
        room.dispose();
        generator.dispose();
      }
      scene.add(new HemisphereLight(0xdce5ff, 0x4a3d30, 0.6));
      const key = new DirectionalLight(0xfff0db, 1.6);
      key.position.set(3, 5, 4);
      scene.add(key);
      const fill = new DirectionalLight(0x9db4ff, 0.7);
      fill.position.set(-3, 2, -2);
      scene.add(fill);

      observer = new ResizeObserver(resize);
      observer.observe(container);
      window.addEventListener("resize", resize);
      document.addEventListener("visibilitychange", onVisibilityChange);
      resize();
      timeout = setTimeout(() => fail("load"), 30_000);
      void loadModel();
    } catch {
      fail("webgl");
    }
  });

  return {
    rotate(horizontal, vertical = 0) {
      if (!ready || disposed || failed || !controls) return;
      const offset = camera.position.clone().sub(controls.target);
      const spherical = new Spherical().setFromVector3(offset);
      spherical.theta += horizontal;
      spherical.phi = MathUtils.clamp(
        spherical.phi + vertical,
        controls.minPolarAngle,
        controls.maxPolarAngle,
      );
      camera.position.setFromSpherical(spherical).add(controls.target);
      controls.update();
    },
    zoom(factor) {
      if (!ready || disposed || failed || !controls) return;
      const offset = camera.position.clone().sub(controls.target);
      offset.setLength(
        MathUtils.clamp(
          offset.length() * factor,
          controls.minDistance,
          controls.maxDistance,
        ),
      );
      camera.position.copy(controls.target).add(offset);
      controls.update();
    },
    reset() {
      if (!ready || disposed || failed || !controls) return;
      camera.position.copy(initialPosition);
      controls.target.set(0, 0, 0);
      camera.zoom = 1;
      camera.updateProjectionMatrix();
      controls.update();
      requestRender();
    },
    setWireframe(enabled) {
      if (!ready || disposed || failed) return;
      wireframe?.set(enabled);
      requestRender();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      releaseResources();
    },
  };
}
