# Version 1 validation

Checked on 2 October 2026 with Python 3.14.7, Node.js 24.21.0 and installed Google Chrome on Windows. Browser checks run the real WebGL viewer using Chrome's software rendering support and connect to the real local FastAPI service.

- **59 Python tests passed:** CIF and VESTA symmetry, skew cells, occupancies, input bounds, image shifts, supercell rebuilding, API errors, concurrency, request limits and CORS.
- **7 JavaScript tests passed:** lattice geometry, direct distances and angles, portable project validation, physical export dimensions and PNG resolution metadata.
- **Browser integration passed:** rendered crystal scene; layouts at 320, 375, 768 and 1,440 pixels; keyboard focus; atom selection; correctly reversed periodic shifts; saved unit cells and expanded projects; literal display of untrusted names; CIF import; retained structures after invalid imports; supercell/cutoff calculation; and cancellation of an older calculation when restoring the default cutoff.
- **Export artifacts verified independently:** a 5 cm square PNG at 300 DPI is 591 × 591 pixels with measured metadata of 299.9994 DPI; at 1,600 DPI it is 3,150 × 3,150 pixels with measured metadata of 1599.9968 DPI. Both preserve alpha transparency. The small metadata differences are integer pixels-per-metre rounding.
- **PDF page dimensions verified:** the exported 5 × 5 cm figure has a 141.732 × 141.732 point page. Export restores the original viewer background and camera framing.
- **Production build passed:** the built viewer, hashed assets and dynamically loaded PDF export work under `/crystal-studio-web/`, matching GitHub Pages repository hosting.
- **Render dependency availability checked:** the complete production dependency set resolves to downloadable Python 3.12 Linux wheels. This checks package availability; it does not replace a deployed service health check.

Python test output includes deprecation warnings from upstream dependencies. No tests failed. The bundled example structures are synthetic demonstrations and regression cases.

Published on **3 October 2026 (Europe/Paris)**. The [GitHub Pages website](https://brahimelmokhtari.github.io/crystal-studio-web/) returns HTTP 200, and the [Render API health endpoint](https://crystal-studio-api.onrender.com/health) returns HTTP 200 with `status: ok` and `schemaVersion: 1`. The Render service is live on the **Free** plan in Frankfurt. The configured GitHub Pages workflow completed successfully; the source is available in [BrahimELMokhtari/crystal-studio-web](https://github.com/BrahimELMokhtari/crystal-studio-web).

**Live browser verification passed in a clean Chrome session:** repository-path assets and actual WebGL; the embedded API address and exact-origin CORS; a synthetic CIF upload through the public API; correct 0.2 angstrom periodic endpoints and measurements; a doubled supercell and restoration of its original unit cell; PNG resolution metadata and a 5 cm square PDF; and layouts at 320, 375, 768 and 1,440 pixels. No uncaught JavaScript, console or asset errors occurred. The downloadable production build uses the deployed API and a root (`/`) asset path so it can also be served as a standalone static site.

**Top legend update checked on 3 October 2026:** screen and export legends use shaded balls with the selected element colors. The complete top header remains pixel-identical after rotation and zoom while the structure changes. Both PNG pixels and the actual embedded PDF image preserve the legend and alpha transparency. Export restores the viewport, camera and background; turning the legend off uses the full image height. All 24 elements in a synthetic wrapping case fit inside the reserved header. The existing browser regression check and all seven JavaScript tests also pass after this update.

Reproduce the main checks using the commands in README.md. To check the Pages production path, build with `VITE_BASE_PATH=/crystal-studio-web/`, preview that build on port 5175, then run `node tests/pages.mjs`; `PAGES_URL` can override the preview address.

After building `frontend/dist`, run `python scripts/package.py` from this folder to create a verified source archive. It includes the production frontend and excludes dependency folders, environments, local uploads and test artifacts.
