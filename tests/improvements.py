"""Real browser checks for manual structures, connections and publication exports.

Requires Python Playwright and Chrome. Run with a local Vite app and API:
  python tests/improvements.py --api http://127.0.0.1:8001
An optional --url checks the deployed frontend instead.
"""
from __future__ import annotations

import argparse
import base64
import json
import math
import os
from pathlib import Path
import re
import struct

from playwright.sync_api import sync_playwright, expect


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://127.0.0.1:5174")
    parser.add_argument("--api", default="http://127.0.0.1:8001")
    args = parser.parse_args()
    output = Path(__file__).resolve().parents[1] / "artifacts" / "improvements"
    output.mkdir(parents=True, exist_ok=True)
    checks: list[str] = []
    errors: list[str] = []

    def passed(message: str) -> None:
        checks.append(message)
        print("PASS " + message, flush=True)

    with sync_playwright() as p:
        launch = {"headless": True, "args": ["--enable-unsafe-swiftshader"]}
        if os.environ.get("CHROME_PATH"):
            launch["executable_path"] = os.environ["CHROME_PATH"]
        else:
            launch["channel"] = "chrome"
        browser = p.chromium.launch(**launch)
        try:
            context = browser.new_context(viewport={"width": 1440, "height": 1000}, accept_downloads=True, reduced_motion="reduce")
            context.add_init_script("localStorage.setItem('crystal-studio-api-url', " + json.dumps(args.api) + ");")
            page = context.new_page()
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.goto(args.url, wait_until="networkidle")
            expect(page.locator("#status")).to_contain_text("Ready")
            for width in [320, 375, 768, 1440]:
                page.set_viewport_size({"width": width, "height": 1000})
                page.evaluate("() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))")
                box = page.locator('#viewport > canvas[role="img"]').bounding_box()
                assert box and abs(box["width"] - box["height"]) < 1.1 and box["width"] > 240, box
                assert page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1")
            page.set_viewport_size({"width": 1440, "height": 1000})
            passed("Square 3D canvas and no horizontal overflow at four screen sizes")

            def project(name: str) -> dict:
                with page.expect_download() as event:
                    page.locator("#save-project").click()
                path = output / (name + ".json")
                event.value.save_as(path)
                return json.loads(path.read_text(encoding="utf-8"))

            # Creating a structure remains local even with a configured API.
            requests: list[str] = []
            page.on("request", lambda request: requests.append(request.url) if "/api/" in request.url else None)
            original_title = page.locator("#structure-title").inner_text()
            page.locator("#open-manual").click()
            page.locator("#manual-name").fill("Manual skewed hydrogen")
            for key, value in [("a", "10"), ("b", "8"), ("c", "12"), ("alpha", "90"), ("beta", "90"), ("gamma", "60")]:
                page.locator("#manual-" + key).fill(value)
            page.locator("#manual-atoms").fill("H 0.4 0.5 0.5\nH 0.4 0.5 0.5")
            page.locator("#manual-submit").click()
            expect(page.locator("#manual-error")).to_contain_text("same periodic site")
            expect(page.locator("#structure-title")).to_have_text(original_title)
            page.locator("#manual-atoms").fill("H 0.45 0.5 0.5\nH 0.51 0.5 0.5 0.75\nO 0.2 0.2 0.2")
            page.locator("#manual-submit").click()
            expect(page.locator("#manual-dialog")).not_to_be_visible()
            expect(page.locator("#structure-title")).to_have_text("Manual skewed hydrogen")
            expect(page.locator("#connection-mode")).to_have_value("manual")
            assert not requests, requests
            manual = project("manual-unit")
            assert manual["unit"]["source"]["format"] == "manual"
            assert math.isclose(manual["unit"]["cell"]["volume"], 10 * 8 * 12 * math.sin(math.pi / 3), rel_tol=1e-12)
            assert manual["unit"]["atoms"][1]["occupancy"] == 0.75
            passed("Offline manual triclinic structure, occupancy, and error retention")

            page.get_by_role("tab", name="Atoms", exact=True).click()
            for name in ["Select H atom 1", "Select H atom 2"]:
                page.get_by_role("button", name=name, exact=True).click()
            expect(page.locator("#connect-selected")).to_be_enabled()
            page.locator("#connect-selected").click()
            expect(page.locator("#manual-connections")).to_contain_text("H 1 ↔ H 2")
            expect(page.locator("#connect-selected")).to_be_disabled()
            saved = project("manual-connected")
            assert saved["settings"]["customBonds"] == [{"i": 0, "j": 1, "shift": [0, 0, 0]}]
            page.locator("#example-select").select_option("nacl")
            page.locator("#project-file").set_input_files(output / "manual-connected.json")
            expect(page.locator("#status")).to_contain_text("Project restored")
            expect(page.locator("#manual-connections")).to_contain_text("H 1 ↔ H 2")
            malformed = {**saved, "settings": {**saved["settings"], "customBonds": None}}
            page.locator("#project-file").set_input_files({"name": "invalid-project.json", "mimeType": "application/json", "buffer": json.dumps(malformed).encode("utf-8")})
            expect(page.locator("#status")).to_contain_text("Unable to load project")
            expect(page.locator("#structure-title")).to_have_text("Manual skewed hydrogen")
            expect(page.locator("#manual-connections")).to_contain_text("H 1 ↔ H 2")
            passed("Selected atoms connect once and manual connections survive project save/load")

            page.locator("#calculate-contacts").click()
            expect(page.locator("#status")).to_contain_text("Structure updated", timeout=120000)
            rebuilt = project("manual-calculated")
            assert rebuilt["view"]["contactsCalculated"] is True
            assert rebuilt["settings"]["customBonds"] == saved["settings"]["customBonds"]
            assert rebuilt["view"]["bonds"], "Python calculated real hydrogen contacts"
            assert not any("have not been calculated" in item for item in rebuilt["view"]["warnings"])
            page.locator(".panel").filter(has=page.locator("#repeat-a")).locator("summary").click()
            page.locator("#repeat-b").fill("2")
            page.locator("#apply-supercell").click()
            expect(page.locator("#structure-meta")).to_contain_text("6 atoms", timeout=120000)
            expanded = project("manual-expanded")
            assert expanded["settings"]["customBonds"] == saved["settings"]["customBonds"]
            page.locator("#project-file").set_input_files(output / "manual-connected.json")
            expect(page.locator("#status")).to_contain_text("Project restored")
            passed("Real API calculates manual contacts and retains connections across supercells")

            # Isolate the actual atom/legend image bounds without cell or axis pixels.
            page.locator("#show-cell").uncheck()
            page.locator("#show-axes").uncheck()
            page.locator("#show-periodic").uncheck()
            page.locator("#clear-selection").click()
            page.locator("#background").select_option("dark")
            for symbol in ["H", "O"]:
                page.get_by_label(symbol + " color", exact=True).evaluate("input => {input.value='#e83e6b'; input.dispatchEvent(new Event('input',{bubbles:true}));}")
            camera_before = project("before-exports")["camera"]

            def export(name: str, dpi: int, *, size: float = 8, transparent: bool = True, legend: bool = True, format: str = "png") -> Path:
                page.locator("#open-export").click()
                page.locator("#export-width").fill(str(size))
                page.locator("#export-height").fill(str(size))
                page.locator("#export-dpi").fill(str(dpi))
                page.locator("#export-background").select_option("transparent" if transparent else "white")
                page.locator("#export-legend").set_checked(legend)
                page.locator("#export-format").select_option(format)
                with page.expect_download(timeout=120000) as event:
                    page.locator("#export-submit").click()
                path = output / (name + "." + format)
                event.value.save_as(path)
                return path

            def image_bounds(path: Path) -> dict:
                encoded = base64.b64encode(path.read_bytes()).decode("ascii")
                return page.evaluate("""async encoded => {
                    const image=new Image();image.src='data:image/png;base64,'+encoded;await image.decode();
                    const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
                    const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);const d=ctx.getImageData(0,0,canvas.width,canvas.height).data;
                    const ink=new Uint8Array(canvas.width);let opaque=0,clear=0;
                    for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++) {const i=(y*canvas.width+x)*4;if(d[i+3]>0)ink[x]=1;if(d[i+3]===255)opaque++;if(d[i+3]===0)clear++;}
                    const gaps=[];let start=-1;for(let x=0;x<=canvas.width;x++){if(x<canvas.width&&!ink[x]){if(start<0)start=x;}else if(start>=0){if(start>0&&x<canvas.width)gaps.push({start,end:x-1,pixels:x-start});start=-1;}}
                    return {width:canvas.width,height:canvas.height,gaps,opaque,clear,cornerAlpha:d[3]};
                }""", encoded)

            transparent = export("transparent-300", 300)
            bounds = image_bounds(transparent)
            expected_gap = round(300 / 2.54)
            assert any(abs(gap["pixels"] - expected_gap) <= 1 for gap in bounds["gaps"]), bounds
            assert bounds["cornerAlpha"] == 0 and bounds["clear"] > bounds["width"] * bounds["height"] / 2
            png = transparent.read_bytes()
            offset = 8
            while offset < len(png):
                length = struct.unpack_from(">I", png, offset)[0]
                if png[offset + 4:offset + 8] == b"pHYs":
                    assert struct.unpack_from(">I", png, offset + 8)[0] == round(300 / 0.0254)
                    break
                offset += length + 12
            else:
                raise AssertionError("Missing physical PNG resolution")
            white = image_bounds(export("white", 300, transparent=False))
            assert white["opaque"] == white["width"] * white["height"]
            passed("Real PNG pixels have a 1 cm legend-to-atom gap, physical DPI, and correct backgrounds")

            high = export("high-resolution", 2400, size=5)
            assert struct.unpack_from(">II", high.read_bytes(), 16) == (4724, 4724)
            pdf = export("transparent-figure", 300, format="pdf").read_bytes()
            assert pdf.startswith(b"%PDF") and b"/SMask" in pdf, "PDF retains PNG alpha mask"
            box = re.search(rb"/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]", pdf)
            assert box and abs(float(box[1]) - 80 * 72 / 25.4) < 0.01
            assert abs(float(box[2]) - 80 * 72 / 25.4) < 0.01
            export("no-legend", 300, legend=False)
            expect(page.locator("#background")).to_have_value("dark")
            assert project("after-exports")["camera"] == camera_before
            passed("4,724 px export, transparent PDF physical size, legend-off export, and camera restoration")

            # Repeating the measurement after a real orbit catches camera-dependent spacing.
            viewport = page.locator('#viewport > canvas[role="img"]').bounding_box()
            assert viewport
            page.mouse.move(viewport["x"] + viewport["width"] * 0.5, viewport["y"] + viewport["height"] * 0.5)
            page.mouse.down()
            page.mouse.move(viewport["x"] + viewport["width"] * 0.6, viewport["y"] + viewport["height"] * 0.58, steps=8)
            page.mouse.up()
            page.locator("#zoom-in").click()
            rotated = image_bounds(export("rotated-600", 600))
            assert any(abs(gap["pixels"] - round(600 / 2.54)) <= 1 for gap in rotated["gaps"]), rotated
            page.locator("#open-export").click()
            page.locator("#export-width").fill("30")
            page.locator("#export-dpi").fill("2400")
            expect(page.locator("#export-submit")).to_be_disabled()
            page.keyboard.press("Escape")
            page.locator("#open-manual").click()
            page.locator("#copy-current-manual").click()
            expect(page.locator("#manual-name")).to_have_value("Manual skewed hydrogen")
            page.keyboard.press("Escape")
            page.screenshot(path=output / "desktop.png", full_page=True)
            page.set_viewport_size({"width": 375, "height": 1000})
            page.screenshot(path=output / "mobile.png", full_page=True)
            assert not errors, errors
            passed("1 cm spacing after orbit and zoom, export limits, editor copy, and zero browser script errors")
            (output / "report.json").write_text(json.dumps({"url": args.url, "api": args.api, "checks": checks, "errors": errors}, indent=2), encoding="utf-8")
        finally:
            browser.close()


if __name__ == "__main__":
    main()
