"""Real browser regressions for mouse connections, element sizing and 5,000 DPI.

Start Vite, then: python tests/mouse-and-sizing.py [--url http://127.0.0.1:5174]
CRYSTAL_URL and CHROME_PATH are supported. No backend or table clicks required.
"""
from __future__ import annotations
import argparse
import base64
import copy
import json
import math
import os
from pathlib import Path
import struct
import zlib
from playwright.sync_api import expect, sync_playwright

CANVAS = '#viewport > canvas[role="img"]'

def dot(a, b):
    return sum(x * y for x, y in zip(a, b))

def cross(a, b):
    return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]]

def unit(vector):
    length = math.sqrt(dot(vector, vector))
    assert length > 0, 'Nonzero camera basis'
    return [value / length for value in vector]

def png_metadata(path, expected_size, dpi):
    data = path.read_bytes()
    assert data[:8] == b'\x89PNG\r\n\x1a\n', 'Actual PNG download'
    assert struct.unpack_from('>II', data, 16) == (expected_size, expected_size)
    offset, physical = 8, []
    while offset < len(data):
        assert offset + 12 <= len(data)
        length = struct.unpack_from('>I', data, offset)[0]
        end = offset + length + 12
        assert end <= len(data), 'Complete PNG chunk'
        if data[offset+4:offset+8] == b'pHYs':
            assert length == 9
            actual_crc = struct.unpack_from('>I', data, end-4)[0]
            assert actual_crc == zlib.crc32(data[offset+4:end-4]) & 0xFFFFFFFF
            physical.append(struct.unpack_from('>IIB', data, offset+8))
        offset = end
    ppm = round(dpi / 0.0254)
    assert physical == [(ppm, ppm, 1)], ('Exactly one correct physical DPI chunk', physical)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url', default=os.environ.get('CRYSTAL_URL', 'http://127.0.0.1:5174'))
    args = parser.parse_args()
    output = Path(__file__).resolve().parents[1] / 'artifacts' / 'mouse-and-sizing'
    output.mkdir(parents=True, exist_ok=True)
    checks, errors, api_requests = [], [], []
    def passed(message):
        checks.append(message)
        print('PASS ' + message, flush=True)
    with sync_playwright() as playwright:
        launch = {'headless': True, 'args': ['--enable-unsafe-swiftshader']}
        if os.environ.get('CHROME_PATH'):
            launch['executable_path'] = os.environ['CHROME_PATH']
        else:
            launch['channel'] = 'chrome'
        browser = playwright.chromium.launch(**launch)
        try:
            context = browser.new_context(viewport={'width':1440,'height':1200}, accept_downloads=True, reduced_motion='reduce')
            context.add_init_script("localStorage.setItem('crystal-studio-api-url', '')")
            page = context.new_page()
            page.set_default_timeout(15000)
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.on('console', lambda message: errors.append(message.text) if message.type == 'error' else None)
            page.on('request', lambda request: api_requests.append(request.url) if '/api/' in request.url else None)
            page.goto(args.url, wait_until='networkidle')
            expect(page.locator('#status')).to_contain_text('Ready')
            expect(page.locator('#webgl-error')).not_to_be_visible()
            def settle():
                page.evaluate('() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
            def project():
                with page.expect_download() as event:
                    page.locator('#save-project').click()
                return json.loads(Path(event.value.path()).read_text(encoding='utf-8'))
            def load(saved, name='mouse-sizing.crystal.json'):
                page.locator('#project-file').set_input_files({'name':name,'mimeType':'application/json','buffer':json.dumps(saved).encode('utf-8')})
                expect(page.locator('#status')).to_contain_text('Project restored')
                settle()
            def fit():
                page.locator('#camera-view').select_option('c')
                page.locator('#reset-camera').click()
                settle()
            def numeric(label, expected):
                assert math.isclose(float(page.get_by_label(label, exact=True).input_value()), expected, abs_tol=1e-9), (label, expected)
            def coordinates(saved=None):
                saved = saved or project()
                canvas = page.locator(CANVAS)
                canvas.scroll_into_view_if_needed()
                settle()
                box = canvas.bounding_box()
                assert box and box['width'] > 240 and box['height'] > 240
                camera = saved['camera']
                back = unit([a-b for a,b in zip(camera['position'],camera['target'])])
                right = unit(cross(camera.get('up',[0,0,1]), back))
                up = cross(back, right)
                aspect = box['width']/box['height']
                half = camera['halfHeight']/min(1,aspect)/camera['zoom']
                points = []
                for atom in saved['view']['atoms']:
                    delta = [a-b for a,b in zip(atom['position'],camera['position'])]
                    x = box['x']+(dot(delta,right)/(half*aspect)+1)*box['width']/2
                    y = box['y']+(1-dot(delta,up)/half)*box['height']/2
                    assert box['x'] < x < box['x']+box['width'] and box['y'] < y < box['y']+box['height'], (atom,x,y,box)
                    points.append({'x':x,'y':y})
                return points, box
            def connect_mode(active):
                toggle = page.locator('#mouse-connect-mode')
                if toggle.get_attribute('aria-pressed') != str(active).lower():
                    toggle.click()
                expect(toggle).to_have_attribute('aria-pressed', str(active).lower())
                if active:
                    expect(page.locator('#mouse-connect-hint')).to_be_visible()
                settle()
            def click_atom(atom_id):
                points, _ = coordinates()
                page.mouse.click(**points[atom_id])
                settle()
            def drag(source, target):
                page.mouse.move(**source)
                page.mouse.down()
                page.mouse.move(**target, steps=12)
                page.mouse.up()
                settle()
            def bonds(expected):
                saved = project()
                actual = saved['settings']['customBonds']
                assert len(actual) == len(expected), (expected, actual)
                assert {(min(item['i'],item['j']),max(item['i'],item['j'])) for item in actual} == expected
                assert all(item['shift'] == [0,0,0] for item in actual)
                expect(page.locator('#manual-connections .manual-connection')).to_have_count(len(expected))
                return saved
            page.locator('#open-manual').click()
            page.locator('#manual-name').fill('Mouse and element-size regression')
            for key,value in [('a','10'),('b','10'),('c','10'),('alpha','90'),('beta','90'),('gamma','90')]:
                page.locator('#manual-'+key).fill(value)
            page.locator('#manual-atoms').fill('H 0.25 0.30 0.50\nO 0.72 0.30 0.50\nH 0.46 0.75 0.50')
            page.locator('#manual-submit').click()
            expect(page.locator('#manual-dialog')).not_to_be_visible()
            expect(page.locator('#structure-title')).to_have_text('Mouse and element-size regression')
            for selector in ['#show-cell','#show-axes','#show-periodic','#show-legend']:
                page.locator(selector).uncheck()
            page.locator('#background').select_option('dark')
            for symbol,color in [('H','#e3242b'),('O','#1955df')]:
                page.get_by_label(symbol+' color', exact=True).evaluate("(input,color) => {input.value=color;input.dispatchEvent(new Event('input',{bubbles:true}));}", color)
            fit()
            connect_mode(False)
            initial = bonds(set())
            points, _ = coordinates(initial)
            # A diagonal drag also changes latitude when viewing along a pole.
            drag(points[0],points[2])
            orbited = bonds(set())
            assert math.dist(orbited['camera']['position'],initial['camera']['position']) > 0.05, ('Normal drag retains orbit', initial['camera'], orbited['camera'], points, errors)
            fit()
            connect_mode(True)
            before_drag = project()['camera']
            points, _ = coordinates()
            drag(points[0],points[1])
            connected = bonds({(0,1)})
            assert math.dist(connected['camera']['position'],before_drag['position']) < 1e-8, 'Connection drag must not orbit'
            points, _ = coordinates()
            drag(points[1],points[0])
            bonds({(0,1)})
            click_atom(0)
            click_atom(2)
            bonds({(0,1),(0,2)})
            click_atom(1)
            click_atom(1)
            bonds({(0,1),(0,2)})
            connect_mode(False)
            passed('Real atom drags and two-click links; reverse duplicates and self-links rejected; normal orbit retained')

            # Each cancellation starts with a clean pair. The following atom click
            # must only arm a new pair, never complete the canceled one.
            connect_mode(True)
            click_atom(1)
            page.keyboard.press('Escape')
            click_atom(2)
            bonds({(0,1),(0,2)})
            connect_mode(False)
            connect_mode(True)
            click_atom(1)
            _, box = coordinates()
            blank = {'x':box['x']+box['width']*.92,'y':box['y']+box['height']*.10}
            page.mouse.click(**blank)
            click_atom(2)
            bonds({(0,1),(0,2)})
            connect_mode(False)
            connect_mode(True)
            points, box = coordinates()
            blank = {'x':box['x']+box['width']*.92,'y':box['y']+box['height']*.10}
            drag(points[1],blank)
            click_atom(2)
            bonds({(0,1),(0,2)})
            connect_mode(False)
            connect_mode(True)
            points, _ = coordinates()
            page.mouse.move(**points[1])
            page.mouse.down()
            page.locator(CANVAS).dispatch_event('pointercancel', {'pointerId':1,'pointerType':'mouse','bubbles':True})
            page.mouse.move(**points[2], steps=8)
            page.mouse.up()
            bonds({(0,1),(0,2)})
            connect_mode(False)
            normal_before = project()['camera']
            _, box = coordinates()
            drag({'x':box['x']+box['width']*.87,'y':box['y']+box['height']*.28},
                 {'x':box['x']+box['width']*.76,'y':box['y']+box['height']*.18})
            normal_after = bonds({(0,1),(0,2)})['camera']
            assert math.dist(normal_before['position'],normal_after['position']) > .05, 'Cancel restores orbit'
            fit()
            page.locator('#clear-selection').click()
            passed('Escape, empty click/drop and pointercancel discard pending links and restore camera interactions')

            page.locator('#representation').select_option('spheres')
            fit()
            for symbol in ['H','O']:
                numeric(symbol+' size',1)
                numeric(symbol+' size multiplier',1)
            def silhouettes():
                points, _ = coordinates()
                return page.locator(CANVAS).evaluate("""(source,points) => {
                    const rect=source.getBoundingClientRect(),sx=source.width/rect.width,sy=source.height/rect.height;
                    const canvas=document.createElement('canvas');canvas.width=source.width;canvas.height=source.height;
                    const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(source,0,0);
                    return points.map(point=>{
                        const cx=Math.round((point.x-rect.left)*sx),cy=Math.round((point.y-rect.top)*sy),r=Math.ceil(85*sx);
                        const left=Math.max(0,cx-r),top=Math.max(0,cy-r),w=Math.min(canvas.width-left,r*2+1),h=Math.min(canvas.height-top,r*2+1);
                        const data=ctx.getImageData(left,top,w,h).data;let minX=w,minY=h,maxX=-1,maxY=-1;
                        for(let y=0;y<h;y++)for(let x=0;x<w;x++){
                            const i=(y*w+x)*4;
                            if(Math.max(Math.abs(data[i]-16),Math.abs(data[i+1]-43),Math.abs(data[i+2]-50))<=3)continue;
                            minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);
                        }
                        return {width:maxX-minX+1,height:maxY-minY+1,clipped:minX===0||minY===0||maxX===w-1||maxY===h-1};
                    });
                }""", points)
            baseline = silhouettes()
            assert all(item['width']>4 and item['height']>4 and not item['clipped'] for item in baseline), baseline
            page.get_by_label('H size',exact=True).evaluate("input => {input.value='1.8';input.dispatchEvent(new Event('input',{bubbles:true}));}")
            numeric('H size multiplier',1.8)
            grown = silhouettes()
            for atom_id in [0,2]:
                assert grown[atom_id]['width'] >= baseline[atom_id]['width']*1.5, (baseline,grown)
            assert abs(grown[1]['width']-baseline[1]['width']) <= 2, ('Hydrogen leaves oxygen unchanged',baseline,grown)
            page.get_by_label('O size multiplier',exact=True).fill('0.7')
            page.get_by_label('O size multiplier',exact=True).press('Tab')
            numeric('O size',.7)
            independent = silhouettes()
            assert independent[1]['width'] < baseline[1]['width']*.85, (baseline,independent)
            assert all(abs(independent[i]['width']-grown[i]['width'])<=2 for i in [0,2]), (grown,independent)
            page.locator('#atom-scale').evaluate("input => {input.value='1.25';input.dispatchEvent(new Event('input',{bubbles:true}));}")
            globally_scaled = silhouettes()
            assert all(after['width']>before['width']*1.12 for before,after in zip(independent,globally_scaled)), (independent,globally_scaled)
            sized = project()
            assert sized['settings']['elementScales'] == {'H':1.8,'O':.7}
            (output/'sized-project.crystal.json').write_text(json.dumps(sized,indent=2),encoding='utf-8')
            page.locator('#example-select').select_option('nacl')
            load(sized)
            numeric('H size',1.8)
            numeric('O size multiplier',.7)
            restored = project()
            assert restored['settings']['elementScales'] == sized['settings']['elementScales']
            assert restored['settings']['customBonds'] == sized['settings']['customBonds']
            for key in ['position','target','up']:
                assert math.dist(restored['camera'][key],sized['camera'][key]) < 1e-7, (key,sized['camera'],restored['camera'])
            for key in ['halfHeight','zoom']:
                assert math.isclose(restored['camera'][key],sized['camera'][key],abs_tol=1e-12)
            restored_pixels = silhouettes()
            assert all(abs(a['width']-b['width'])<=2 for a,b in zip(globally_scaled,restored_pixels)), (globally_scaled,restored_pixels)
            legacy = copy.deepcopy(sized)
            legacy['settings'].pop('elementScales')
            load(legacy,'legacy-no-element-scales.crystal.json')
            for symbol in ['H','O']:
                numeric(symbol+' size',1)
                numeric(symbol+' size multiplier',1)
            legacy_saved = project()
            assert all(value==1 for value in legacy_saved['settings']['elementScales'].values())
            load(sized)
            page.locator('#clear-selection').click()
            passed('Element controls resize actual spheres independently, compose with global sizing, persist, and default legacy scales to 1')

            before_export = project()
            page.locator('#open-export').click()
            expect(page.locator('#export-dpi')).to_have_attribute('max','5000')
            page.locator('#export-width').fill('2.5')
            page.locator('#export-height').fill('2.5')
            page.locator('#export-dpi').fill('5000')
            page.locator('#export-format').select_option('png')
            page.locator('#export-background').select_option('transparent')
            page.locator('#export-legend').check()
            expect(page.locator('#export-submit')).to_be_enabled()
            with page.expect_download(timeout=120000) as event:
                page.locator('#export-submit').click()
            image_path = output/'transparent-5000-dpi.png'
            event.value.save_as(image_path)
            expected_size = round(2.5*5000/2.54)
            png_metadata(image_path,expected_size,5000)
            encoded = base64.b64encode(image_path.read_bytes()).decode('ascii')
            pixels = page.evaluate("""async encoded => {
                const image=new Image();image.src='data:image/png;base64,'+encoded;await image.decode();
                const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
                const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(image,0,0);
                const ink=new Uint8Array(canvas.width);let left=canvas.width,right=-1,top=canvas.height,bottom=-1,clear=0;
                for(let y0=0;y0<canvas.height;y0+=64){
                    const h=Math.min(64,canvas.height-y0),data=ctx.getImageData(0,y0,canvas.width,h).data;
                    for(let y=0;y<h;y++)for(let x=0;x<canvas.width;x++){
                        if(data[(y*canvas.width+x)*4+3]===0){clear++;continue;}
                        ink[x]=1;left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y0+y);bottom=Math.max(bottom,y0+y);
                    }
                }
                const gaps=[];let start=-1;
                for(let x=0;x<=canvas.width;x++){
                    if(x<canvas.width&&!ink[x]){if(start<0)start=x;}
                    else if(start>=0){if(start>0&&x<canvas.width)gaps.push({start,end:x-1,pixels:x-start});start=-1;}
                }
                return {width:canvas.width,height:canvas.height,left,right,top,bottom,clear,gaps,cornerAlpha:ctx.getImageData(0,0,1,1).data[3]};
            }""",encoded)
            expected_gap = round(5000/2.54)
            largest_gap = max(pixels['gaps'],key=lambda gap:gap['pixels'])
            # Final PNG alpha edges can differ by one pixel during compositing.
            assert abs(largest_gap['pixels']-expected_gap) <= 1, ('Visible 1 cm whitespace at 5000 DPI',pixels)
            assert pixels['cornerAlpha']==0 and pixels['clear']>expected_size*expected_size/2, pixels
            assert 0<pixels['left']<pixels['right']<expected_size-1 and 0<pixels['top']<pixels['bottom']<expected_size-1, ('All content is clear of the frame',pixels)
            after_export = project()
            # OrbitControls can introduce tiny spherical-coordinate rounding at a pole.
            for key in ['position','target','up']:
                assert math.dist(after_export['camera'][key],before_export['camera'][key]) < 1e-7, ('Export restores live camera',key,before_export['camera'],after_export['camera'])
            for key in ['halfHeight','zoom']:
                assert math.isclose(after_export['camera'][key],before_export['camera'][key],abs_tol=1e-12)
            assert after_export['settings']==before_export['settings'], 'Export restores display settings and element scales'
            page.locator('#open-export').click()
            page.locator('#export-width').fill('3')
            page.locator('#export-height').fill('3')
            expect(page.locator('#export-submit')).to_be_disabled()
            expect(page.locator('#export-error')).to_contain_text('32 million')
            page.locator('#export-width').fill('30')
            expect(page.locator('#export-submit')).to_be_disabled()
            page.locator('#export-dpi').fill('5001')
            expect(page.locator('#export-submit')).to_be_disabled()
            page.locator('#export-dpi').fill('5000')
            page.locator('#export-width').fill('8')
            page.locator('#export-height').fill('8')
            expect(page.locator('#export-submit')).to_be_disabled()
            expect(page.locator('#fit-export-size')).to_be_visible()
            page.locator('#fit-export-size').click()
            expect(page.locator('#export-submit')).to_be_enabled()
            fit_width = float(page.locator('#export-width').input_value())
            fit_height = float(page.locator('#export-height').input_value())
            fit_px_width,fit_px_height = round(fit_width*5000/2.54),round(fit_height*5000/2.54)
            assert fit_width<8 and fit_height<8
            assert max(fit_px_width,fit_px_height)<=8192 and fit_px_width*fit_px_height<=32000000
            assert float(page.locator('#export-dpi').input_value())==5000, 'Fit changes size while keeping DPI'
            page.keyboard.press('Escape')
            passed('Actual 4921 px transparent PNG at 5000 DPI, 1 cm alpha gap within one pixel, pHYs metadata, restoration, bounds and automatic size fitting')
            assert not api_requests, ('No backend requests required',api_requests)
            assert not errors, errors
            page.screenshot(path=output/'desktop.png',full_page=True)
            (output/'report.json').write_text(json.dumps({'url':args.url,'checks':checks,'errors':errors,'exportPixels':pixels},indent=2),encoding='utf-8')
        finally:
            browser.close()

if __name__ == '__main__':
    main()
