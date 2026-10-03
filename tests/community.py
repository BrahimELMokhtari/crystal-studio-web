"""Browser checks for transparent scene export and optional accounts/support.

--url: normal app, without accounts configured. --auth-url: isolated Vite server
configured with https://crystaltest.supabase.co and public dummy test key/links.
The real Supabase SDK is tested against intercepted HTTP, never real accounts.
"""
import argparse
import base64
import json
import time
from pathlib import Path
from playwright.sync_api import expect, sync_playwright


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url', default='http://127.0.0.1:5174')
    parser.add_argument('--auth-url', default='http://127.0.0.1:5176')
    parser.add_argument('--public-only', action='store_true')
    args = parser.parse_args()
    output = Path(__file__).resolve().parents[1] / 'artifacts' / 'community'
    output.mkdir(parents=True, exist_ok=True)
    checks = []
    def passed(name):
        checks.append(name)
        print('PASS ' + name, flush=True)
    with sync_playwright() as p:
        browser = p.chromium.launch(channel='chrome', headless=True, args=['--enable-unsafe-swiftshader'])
        page = browser.new_page(viewport={'width': 1440, 'height': 1080})
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.goto(args.url)
        page.wait_for_load_state('networkidle')
        expect(page.locator('#viewport > canvas')).to_be_visible()
        page.locator('#open-account').click()
        expect(page.locator('#account-unavailable')).to_be_visible()
        expect(page.locator('#account-form')).to_be_hidden()
        page.get_by_role('button', name='Close account', exact=True).click()
        page.locator('#open-support').click()
        expect(page.locator('#support-unavailable')).to_be_visible()
        expect(page.locator('#donate-monthly')).to_be_hidden()
        expect(page.locator('#donate-once')).to_be_hidden()
        page.screenshot(path=str(output / 'support-unconfigured.png'))
        page.get_by_role('button', name='Continue using Crystal Studio').click()
        passed('Unconfigured accounts/payments are honest and do not block free tools')
        for checkbox in ['show-cell', 'show-axes', 'show-periodic']:
            page.locator('#' + checkbox).uncheck()
        page.locator('#zoom-in').click()
        page.locator('#zoom-in').click()
        canvas = page.locator('#viewport > canvas')
        canvas.scroll_into_view_if_needed()
        box = canvas.bounding_box()
        page.mouse.move(box['x'] + box['width'] / 2, box['y'] + box['height'] / 2)
        page.mouse.down(button='right')
        page.mouse.move(box['x'] + box['width'] * .6, box['y'] + box['height'] * .55, steps=8)
        page.mouse.up(button='right')
        # Let OrbitControls' pan damping finish before measuring the saved camera.
        page.wait_for_timeout(3500)
        def project():
            with page.expect_download() as download:
                page.locator('#save-project').click()
            return json.loads(Path(download.value.path()).read_text())
        before = project()
        page.locator('#save-transparent-scene').click()
        expect(page.locator('#export-content')).to_have_value('scene')
        expect(page.locator('#export-legend')).to_be_hidden()
        page.locator('#export-width').fill('2.5')
        page.locator('#export-height').fill('2.5')
        page.locator('#export-dpi').fill('400')
        with page.expect_download() as download:
            page.locator('#export-submit').click()
        scene = output / 'transparent-scene.png'
        download.value.save_as(scene)
        data = base64.b64encode(scene.read_bytes()).decode()
        pixels = page.evaluate('''async data => {
          const image = new Image(); image.src = 'data:image/png;base64,' + data; await image.decode();
          const canvas = document.createElement('canvas'); canvas.width=image.width;canvas.height=image.height;
          const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);
          const pixels=ctx.getImageData(0,0,image.width,image.height).data;
          let empty=0,solid=0;for(let i=3;i<pixels.length;i+=4){if(pixels[i]===0)empty++;if(pixels[i]===255)solid++;}
          return {width:image.width,height:image.height,empty,solid};
        }''', data)
        assert pixels['width'] == pixels['height'] == 394, pixels
        assert pixels['empty'] > 40000 and pixels['solid'] > 500, pixels
        after = project()
        for key in before['camera']:
            first, last = before['camera'][key], after['camera'][key]
            pairs = zip(first,last) if isinstance(first,list) else [(first,last)]
            assert all(abs(a-b)<1e-7 for a,b in pairs), ('Export preserves camera',key,first,last)
        assert before['settings'] == after['settings'], 'Export preserves display settings'
        passed('Actual scene PNG has transparent pixels and preserves zoom/pan/settings')
        for width in [390, 768]:
            page.set_viewport_size({'width':width,'height':900})
            page.locator('#open-support').click()
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), 'No horizontal page overflow'
            bounds=page.locator('#support-dialog').bounding_box()
            assert bounds['x'] >= 0 and bounds['x'] + bounds['width'] <= width + 1
            page.get_by_role('button', name='Continue using Crystal Studio').click()
        passed('Account/support controls and modals fit mobile and tablet')
        assert not errors, errors
        page.close()
        if not args.public_only:
            auth = browser.new_page(viewport={'width':1200,'height':900})
            auth_errors = []
            auth.on('pageerror', lambda error: auth_errors.append(str(error)))
            calls = []
            user = {'id':'00000000-0000-4000-8000-000000000001','aud':'authenticated','role':'authenticated',
                    'email':'researcher@example.org','email_confirmed_at':'2026-10-03T12:00:00Z',
                    'app_metadata':{'provider':'email','providers':['email']},'user_metadata':{},
                    'identities':[], 'created_at':'2026-10-03T12:00:00Z'}
            def encoded(value):
                return base64.urlsafe_b64encode(json.dumps(value).encode()).decode().rstrip('=')
            token = encoded({'alg':'HS256','typ':'JWT'}) + '.' + encoded({'sub':user['id'],'exp':int(time.time())+3600,'iat':int(time.time()),'role':'authenticated'}) + '.test'
            session = {'access_token':token,'token_type':'bearer','expires_in':3600,'refresh_token':'test-refresh-token','user':user}
            def handle(route):
                request = route.request
                body = request.post_data_json if request.post_data else None
                calls.append({'url':request.url,'method':request.method,'body':body})
                response = session if '/token?' in request.url else user if '/user' in request.url else {'user':user,'session':None} if '/signup' in request.url else {}
                if '/token?' in request.url and body.get('password') == 'incorrect-password':
                    route.fulfill(status=400,content_type='application/json',body=json.dumps({'code':'invalid_credentials','msg':'Invalid login credentials'}))
                else:
                    route.fulfill(status=200,content_type='application/json',body=json.dumps(response))
            auth.route('https://crystaltest.supabase.co/**',handle)
            auth.goto(args.auth_url)
            auth.wait_for_load_state('networkidle')
            auth.locator('#open-account').click()
            expect(auth.locator('#account-unavailable')).to_be_hidden()
            auth.locator('#account-switch').click()
            auth.locator('#account-email').fill(user['email'])
            auth.locator('#account-password').fill('test-password-123')
            auth.locator('#account-confirm').fill('different-password')
            auth.locator('#account-submit').click()
            expect(auth.locator('#account-message')).to_have_text('The passwords do not match.')
            assert not any('/signup' in call['url'] for call in calls)
            auth.locator('#account-confirm').fill('test-password-123')
            auth.locator('#account-submit').click()
            expect(auth.locator('#account-message')).to_contain_text('Check your email')
            expect(auth.locator('#account-password')).to_have_value('')
            passed('Real SDK signup validates password confirmation and handles pending email verification (mock HTTP)')
            auth.locator('#account-switch').click()
            auth.locator('#account-email').fill(user['email'])
            auth.locator('#account-password').fill('incorrect-password')
            auth.locator('#account-submit').click()
            expect(auth.locator('#account-message')).to_contain_text('Invalid login credentials')
            expect(auth.locator('#account-password')).to_have_value('')
            auth.locator('#account-password').fill('test-password-123')
            auth.locator('#account-submit').click()
            expect(auth.locator('#account-profile')).to_be_visible()
            expect(auth.locator('#account-profile-email')).to_have_text(user['email'])
            auth.get_by_role('button', name='Close account', exact=True).click()
            auth.reload()
            auth.wait_for_load_state('networkidle')
            auth.locator('#open-account').click()
            expect(auth.locator('#account-profile')).to_be_visible()
            auth.locator('#account-signout').click()
            expect(auth.locator('#account-form')).to_be_visible()
            auth.locator('#account-forgot').click()
            auth.locator('#account-email').fill(user['email'])
            auth.locator('#account-submit').click()
            expect(auth.locator('#account-message')).to_contain_text('If an account exists')
            assert any('/recover' in call['url'] for call in calls)
            passed('Real SDK login, error feedback, session reload, logout and reset request work (mock HTTP)')
            auth.get_by_role('button', name='Close account', exact=True).click()
            auth.evaluate("localStorage.setItem('sb-crystaltest-auth-token-code-verifier', JSON.stringify('browser-test-verifier/recovery'))")
            auth.goto(args.auth_url + '?account=recovery&code=browser-test-code')
            auth.wait_for_load_state('networkidle')
            expect(auth.locator('#account-dialog')).to_be_visible()
            expect(auth.locator('#account-title')).to_have_text('Choose a new password')
            expect(auth.locator('#account-email-label')).to_be_hidden()
            # SDK consumes the one-use code; the recovery marker survives a reload.
            assert 'code=' not in auth.url, auth.url
            auth.reload()
            auth.wait_for_load_state('networkidle')
            expect(auth.locator('#account-title')).to_have_text('Choose a new password')
            auth.locator('#account-password').fill('updated-password-123')
            auth.locator('#account-confirm').fill('updated-password-123')
            auth.locator('#account-submit').click()
            expect(auth.locator('#account-profile')).to_be_visible()
            expect(auth.locator('#account-message')).to_have_text('Your password has been updated.')
            assert 'account=recovery' not in auth.url
            assert any('/user' in call['url'] and call['method']=='PUT' for call in calls)
            assert len([call for call in calls if 'grant_type=pkce' in call['url']]) == 1
            passed('Recovery callback consumes the code once, survives reload and updates the password (mock HTTP)')
            auth.get_by_role('button', name='Close account', exact=True).click()
            auth.locator('#open-support').click()
            expect(auth.locator('#donate-monthly')).to_have_attribute('href','https://buy.stripe.com/test_monthly')
            expect(auth.locator('#donate-once')).to_have_attribute('href','https://buy.stripe.com/test_once')
            expect(auth.locator('#donate-monthly')).to_have_attribute('rel','noopener noreferrer')
            expect(auth.locator('#donate-once')).to_have_attribute('target','_blank')
            auth.get_by_role('button', name='Continue using Crystal Studio').click()
            expect(auth.locator('#save-transparent-scene')).to_be_enabled()
            assert all('password' not in key for key in auth.evaluate('Object.keys(localStorage)'))
            assert not auth_errors, auth_errors
            passed('Configured optional payments use separate secure hosted links and never gate exports')
            auth.close()
        browser.close()
    (output/'report.json').write_text(json.dumps({'checks':checks,'accountVerification':'Mock HTTP with real SDK; not live provider verification'},indent=2))


if __name__ == '__main__':
    main()
