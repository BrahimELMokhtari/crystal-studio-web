# Crystal Studio Web

Crystal Studio Web runs an interactive crystal viewer in the browser and uses a small Python API to parse uploaded sources. The frontend uses Vite, Three.js and jsPDF; the API uses FastAPI. Publish the contents of this folder as a separate repository.

The deployed workspace is available at [Crystal Studio Web](https://brahimelmokhtari.github.io/crystal-studio-web/). Its Python API runs on [Render Free](https://crystal-studio-api.onrender.com/health), and the source is hosted in [BrahimELMokhtari/crystal-studio-web](https://github.com/BrahimELMokhtari/crystal-studio-web). The published viewer already includes the API address; uploads use that service automatically.

See [VALIDATION.md](VALIDATION.md) for tested features and export measurements. The supplied archive also includes a production frontend build in `frontend/dist`.

Choose **Save transparent scene** to download the current 3D view without a background. The export preserves rotation, zoom and pan, the visible cell/axes/connections and selected-atom outlines. It omits the element legend and pending mouse connection preview. Resolution and physical dimensions remain adjustable up to 5,000 DPI within device limits. Rectangular outputs preserve proportions with transparent margins. **Export figure** continues to fit a publication figure with its optional ball legend and 1 cm spacing.

**Account** provides optional signup, login, confirmation and password recovery once the owner's Supabase project is configured. **Support this tool** offers optional EUR 1/month and a flexible one-time contribution through configured hosted payment links. All tools stay free without an account or payment. Projects remain local downloads. See [ACCOUNTS_AND_SUPPORT.md](ACCOUNTS_AND_SUPPORT.md) for activation steps; public account and payment services are not active until the owner supplies working configuration.

## Run locally

Use Python 3.12 or later and Node.js 22.12 or later. The app also supports the Python 3.14 installation used on this Windows setup. From the `crystal_studio_web` folder, open two terminals.

Python API, on Windows PowerShell:

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
$env:ALLOWED_ORIGINS = "http://localhost:5174,http://127.0.0.1:5174"
.\.venv\Scripts\python.exe -m uvicorn app:app --reload --host 127.0.0.1 --port 8000
```

On macOS/Linux, use `python3 -m venv .venv`, `.venv/bin/python -m pip install -r requirements.txt`, and `ALLOWED_ORIGINS="http://localhost:5174,http://127.0.0.1:5174" .venv/bin/python -m uvicorn app:app --reload --host 127.0.0.1 --port 8000`.

Browser app, in the second terminal:

```powershell
cd frontend
npm.cmd ci
npm.cmd run dev
```

On Windows, `npm.cmd` avoids the blocked PowerShell `npm.ps1` launcher. On macOS/Linux, use `npm ci`, `npm run dev`, `npm run build` and `npm test`.

Open [http://localhost:5174](http://localhost:5174). Set the API URL in the app settings to `http://127.0.0.1:8000`, or create `frontend/.env.local` before starting Vite:

```dotenv
VITE_API_BASE_URL=http://127.0.0.1:8000
VITE_BASE_PATH=/
```

Check [http://127.0.0.1:8000/health](http://127.0.0.1:8000/health) if the connection is unavailable. Changes to Vite environment variables require restarting the dev server.

## Use the workspace

Load a bundled example or open a CIF or VESTA file, then inspect the structure in the 3D viewer. Choose ball and stick, spheres, space filling or contacts; adjust element colors; inspect the atom table; and select two or three atoms for a distance or angle. The supplied examples are schematic demonstrations: use your own verified crystal data for scientific results.

In **Element colors and sizes**, each element has an independent size slider and numeric multiplier from **0.2 to 3.0**. Changing hydrogen's size leaves oxygen's factor unchanged. The global atom-size control scales all elements together. Per-element factors apply to visible atoms, periodic neighbors, selection outlines, mouse picking and exported figures; they persist in saved projects. **Reset** returns just that element to 1.00. These are display sizes and do not change atomic coordinates or contact calculations. Older projects use 1.00 for every omitted element factor.

The 3D canvas is square on desktop and mobile. Choose **Define structure manually** to enter cell lengths, angles and fractional atomic positions without importing a file or waiting for the Python service. Each line contains `element x y z [occupancy]`; occupancy defaults to 1. Enter every site in the unit cell, since this editor does not infer symmetry operations. It supports all 118 element symbols, rejects invalid or overlapping periodic sites, and explains when radii or colors use display defaults. **Copy current unit cell** fills the editor from the loaded structure.

Select exactly two atoms in the viewer or atom table, then choose **Connect selected atoms** in the Atom connections panel. Choose calculated contacts, manual connections only, or both. Manual links use the selected displayed positions and are included in projects and figure exports. **Calculate contacts** asks the Python service for covalent-radius periodic contacts. Changing supercell dimensions retains connections whose selected atoms remain inside the new cell; links to removed atoms are removed with a status message.

Choose **Connect with mouse** in the viewer toolbar to draw a manual connection directly: drag from one atom to another, or click the first atom and then the second. A preview marks the pending endpoint. Escape, clicking empty space, or turning the mode off cancels an unfinished connection. Duplicate and self connections are prevented. Drag empty space to rotate; right-drag pans and the wheel zooms. Turn the mode off to resume ordinary click selection. The atom table and **Connect selected atoms** remain available for keyboard operation.

Download a project as JSON to keep a portable copy and restore it later. PNG and PDF exports are generated in your browser with the chosen physical size and DPI; PDFs embed a raster figure rather than vector geometry. Project downloads and images remain usable independently of the Python service; keep a downloaded JSON copy of work you need to retain.

The element legend uses large shaded balls and clear element symbols in a vertical list, following your chosen element colors. In PNG and PDF exports, it stays fixed in the upper-left corner, independent of camera rotation and zoom. The horizontal distance from the legend's visible edge to the nearest rendered atom is **1 cm**, rounded to the nearest output pixel at your chosen DPI. Export fits the structure to the available area while retaining the viewing angle and restores the live camera afterward. Longer lists shrink uniformly to fit one vertical column. Turn off the legend in export settings when you want a figure containing only the structure. Axis labels follow the crystal-axes visibility control independently of the legend.

Exports default to **8 × 8 cm at 1,200 DPI**. You can select up to **5,000 DPI**, within the device's graphics limit, 8,192 pixels per side, and a 32-million-pixel budget. For example, a **2.5 cm square at 5,000 DPI produces 4,921 × 4,921 pixels**; a 5 cm square at 2,400 DPI produces 4,724 × 4,724 pixels. If the requested physical size is too large, **Fit size to device** reduces the dimensions without reducing the chosen DPI. The UI reports a supported square size at the selected resolution. Choose **Transparent - no background** for a background-free PNG or PDF. The PDF keeps the alpha mask and requested physical page size; its image remains raster rather than vector geometry. An unfinished mouse-connection preview is excluded from figures.

Uploaded source files are sent to the configured Python service for processing. The application does not persist them on the server or publish them to GitHub. Put private reference documents outside the public repository; the included `.gitignore` excludes common local upload/export folders. The API uses bounded processing, and the 3D rendering stays in the browser rather than requiring server-side VTK.

The Python service accepts files up to **2 MiB**, limits expanded structures to **2,000 atoms** and **20,000 contacts**, and accepts supercell repetitions from **1 to 5** on each axis within the atom limit. The workspace controls offer repetitions from **1 to 4** on each axis. CIF symmetry and non-orthogonal cells are preserved; unsupported VESTA cell transformations are rejected. Warnings identify partial occupancy or mixed sites that need scientific interpretation. Displayed contacts are estimates based on covalent-radius distances, not proof of chemical bonds.

## Publish with GitHub Pages and free Render

Create a **public GitHub repository** such as `crystal-studio-web` and push this folder's contents to its `main` branch. Keep `frontend/package-lock.json` committed; the workflow uses `npm ci`. GitHub Pages is available for public repositories on GitHub Free. [GitHub Pages availability](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages)

1. In Render, create a **Blueprint** from that GitHub repository. The root `render.yaml` defines a Python web service with the **Free** plan, working directory `backend`, Python `3.12.10`, and health path `/health`.
2. When prompted for `ALLOWED_ORIGINS`, enter your Pages **origin**, for example `https://YOUR-USERNAME.github.io`. Do not append the repository name or a trailing slash. For multiple permitted origins, separate them with commas. This is an origin allowlist, not an API key.
3. Wait for the API deployment and copy its HTTPS service URL, for example `https://YOUR-SERVICE.onrender.com`. Open `https://YOUR-SERVICE.onrender.com/health` to check it.
4. In GitHub, open **Settings → Secrets and variables → Actions → Variables**, and add a repository variable named **`PYTHON_API_URL`** containing the API URL, without `/health`. This URL is public configuration.
5. In **Settings → Pages**, choose **GitHub Actions** as the publishing source.
6. Open **Actions → Deploy Crystal Studio Web → Run workflow** on `main`. The published viewer is at `https://YOUR-USERNAME.github.io/YOUR-REPOSITORY/`.

The workflow builds `frontend/dist` with `VITE_BASE_PATH=/<repository-name>/` and `VITE_API_BASE_URL` from `PYTHON_API_URL`, then uploads and deploys the Pages artifact. It uses GitHub's workflow token; you do not need to put account credentials in the application. If the API URL changes, update the repository variable and run the Pages workflow again. You can also select a different API URL in the app settings.

Render's start command is `uvicorn app:app --host 0.0.0.0 --port $PORT`. There is no Docker setup or database to provision. The Free plan is selected explicitly with `plan: free`; review the service summary before creating it. [Render Blueprint fields](https://render.com/docs/blueprint-spec)

## Free-service behavior

Render currently pauses a free API after **15 minutes without traffic**. Its next request can take **about one minute** while the service starts; allow it to wake and retry if necessary. The workspace receives **750 free instance hours per calendar month**, shared across its free services. The local filesystem is ephemeral and cannot be used as permanent project storage. Included bandwidth and build quotas also apply. These limits were checked on **2 October 2026**. [Render free-service limits](https://render.com/docs/free)

The viewer itself stays available on GitHub Pages while the API sleeps. Downloads and browser exports do not require a paid render worker. Use the free service for occasional or personal use; it is not an always-running backend.

## Build

```powershell
cd frontend
npm.cmd ci
npm.cmd run build
```

The output is `frontend/dist`. For a local preview build, use `VITE_BASE_PATH=/`; the Pages workflow sets the repository path automatically.

## Tests

Run the backend tests in a fresh terminal after creating the virtual environment:

```powershell
cd backend
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
.\.venv\Scripts\python.exe -m pytest
```

Run the frontend unit tests from the frontend folder:

```powershell
cd frontend
npm.cmd test
```

For the browser integration check, keep both local servers running on ports 8000 and 5174, install the frontend development dependencies with `npm.cmd ci`, and have Google Chrome installed. Run this command from the `crystal_studio_web` project root:

```powershell
node tests/browser.mjs
```

The browser check uses the real local Python API to exercise structure imports, display controls, project save/load, measurements and image/PDF downloads. If Chrome is installed in a custom location, update the browser executable configuration in `tests/browser.mjs`.

`CRYSTAL_API_URL` and `CRYSTAL_URL` override the browser regression check's API and frontend addresses. The additional `tests/improvements.py` browser check covers manual input, custom connections, square layouts, transparent exports, physical legend spacing, high-resolution PNGs and PDF alpha masks. It requires Python Playwright and installed Chrome; run `python tests/improvements.py --api http://127.0.0.1:8001` when testing an API on port 8001, or omit the argument for that default. Use `--url` to check a built or deployed frontend and `--api` to choose its backend. Browser artifacts are kept in the excluded `artifacts/` directory.

Run `python tests/mouse-and-sizing.py` for actual mouse drags/clicks, canceled connections, ordinary camera interaction, independent element-size persistence and a real 5,000 DPI PNG. It also accepts `--url` for built or deployed frontends and uses installed Chrome with Python Playwright.

## Troubleshooting

- **Viewer loads but imports fail:** check the configured API URL and its `/health` endpoint, then allow for Render's wake-up delay.
- **CORS error:** set Render's `ALLOWED_ORIGINS` to the exact frontend origin, such as `https://YOUR-USERNAME.github.io`, without `/YOUR-REPOSITORY/`, and redeploy the API.
- **Pages assets return 404:** publish this folder at the repository root and use the provided workflow, which sets the Vite base path.
- **Changes to API URL do not appear:** update `PYTHON_API_URL`, rerun the workflow, then check whether the app settings contain a saved override.

The deployment workflow follows [GitHub's custom Pages workflow documentation](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages). Account creation, repository publication and cloud deployment are performed in your GitHub and Render accounts.
