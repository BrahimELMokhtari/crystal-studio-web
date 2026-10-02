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

Deployment configurations are ready. A public GitHub repository and a Render service have not been created; publishing requires the owner's GitHub and Render connections. Production server operation will be checked after deployment.

Reproduce the main checks using the commands in README.md. To check the Pages production path, build with `VITE_BASE_PATH=/crystal-studio-web/`, preview that build on port 5175, then run `node tests/pages.mjs`; `PAGES_URL` can override the preview address.

After building `frontend/dist`, run `python scripts/package.py` from this folder to create a verified source archive. It includes the production frontend and excludes dependency folders, environments, local uploads and test artifacts.
