# vendor/

Third-party code vendored verbatim so the app stays no-build and works offline.

## ffmpeg/ and ffmpeg-util/
The **ESM glue** of [ffmpeg.wasm](https://github.com/ffmpegwasm/ffmpeg.wasm):
- `ffmpeg/` — `@ffmpeg/ffmpeg@0.12.10/dist/esm/*` (the `FFmpeg` class + its web worker)
- `ffmpeg-util/` — `@ffmpeg/util@0.12.1/dist/esm/*` (`toBlobURL`, `fetchFile`)

License: **MIT** (© Jerome Wu and contributors).

These few KB are vendored **same-origin on purpose**: ffmpeg.wasm's worker can't be
constructed from a cross-origin URL, and blobbing the ESM worker breaks its relative
imports. Hosting the glue locally lets the worker load natively; only the heavy
~30 MB `@ffmpeg/core` (JS + wasm) is pulled from the CDN at runtime and cached via the
Add-ons manager (`nocap-cdn`). The core is single-threaded, so no COOP/COEP /
cross-origin isolation is required.

To bump versions: re-fetch the `dist/esm` files for the new `@ffmpeg/ffmpeg` and
`@ffmpeg/util`, and update `CORE_BASE` in `src/ffmpeg.js` to the matching `@ffmpeg/core`.
