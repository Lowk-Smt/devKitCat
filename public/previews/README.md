# Local preview demos

These are small, original devKitCat demonstration assets, not the complete
marketplace packs or downloadable purchase files. They have no external asset
or hosting dependency and use named meshes with simple PBR materials.

- `cozy-lounge.glb`: a lounge chair, one self-contained binary GLB (~81 KiB).
- `camping-lantern.gltf`: a camping lantern, JSON with an embedded buffer
  (~45 KiB). Includes a translucent enclosure and an emissive light material.
- `cozy-lounge.png`: a still of the lounge chair, captured from the viewer to
  exercise the existing image gallery alongside the interactive preview.

Regenerate the models with:

```sh
node scripts/generate-preview-models.mjs
```

The generator uses the existing Three.js dependency; it is not part of the
browser bundle. The still can be recaptured from the canvas at the default
view. The product data and visible captions explicitly identify these as
samples. No uploads, storage API, secure downloads, or purchased files are
implemented.
