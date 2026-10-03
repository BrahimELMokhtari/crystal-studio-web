"""Browser verification of cell presets, explicit reference sites and saved geometry."""
import argparse
import json
import math
from pathlib import Path
from playwright.sync_api import expect, sync_playwright


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url',default='http://127.0.0.1:5174')
    args=parser.parse_args()
    output=Path(__file__).resolve().parents[1]/'artifacts'/'crystal-presets'
    output.mkdir(parents=True,exist_ok=True)
    checks=[]
    def passed(message):
        checks.append(message);print('PASS '+message,flush=True)
    with sync_playwright() as p:
        browser=p.chromium.launch(channel='chrome',headless=True,args=['--enable-unsafe-swiftshader'])
        try:
            page=browser.new_page(viewport={'width':1280,'height':1000})
            errors=[];page.on('pageerror',lambda error:errors.append(str(error)))
            page.goto(args.url);page.wait_for_load_state('networkidle')
            page.locator('#open-manual').click()
            initial=page.locator('#manual-atoms').input_value()
            ids=['cubic','tetragonal','orthorhombic','hexagonal','trigonal','monoclinic','triclinic','fcc','bcc','simple-cubic']
            assert page.locator('#manual-system option').count()==11
            locked={
                'cubic':{'b','c','alpha','beta','gamma'},'tetragonal':{'b','alpha','beta','gamma'},
                'orthorhombic':{'alpha','beta','gamma'},'hexagonal':{'b','alpha','beta','gamma'},
                'trigonal':{'b','c','beta','gamma'},'monoclinic':{'alpha','gamma'},'triclinic':set(),
                'fcc':{'b','c','alpha','beta','gamma'},'bcc':{'b','c','alpha','beta','gamma'},'simple-cubic':{'b','c','alpha','beta','gamma'}
            }
            for preset in ids:
                page.locator('#manual-system').select_option(preset)
                expect(page.locator('#manual-atoms')).to_have_value(initial)
                for field in ['a','b','c','alpha','beta','gamma']:
                    assert page.locator('#manual-'+field).evaluate('(input)=>input.readOnly')==(field in locked[preset]),(preset,field)
            page.locator('#manual-system').select_option('cubic')
            page.locator('#manual-a').fill('6.25')
            for field in ['a','b','c']:expect(page.locator('#manual-'+field)).to_have_value('6.25')
            page.locator('#manual-system').select_option('tetragonal')
            page.locator('#manual-a').fill('6.2');page.locator('#manual-c').fill('8.1')
            expect(page.locator('#manual-b')).to_have_value('6.2')
            expect(page.locator('#manual-c')).to_have_value('8.1')
            page.locator('#manual-system').select_option('trigonal')
            page.locator('#manual-alpha').fill('80')
            for field in ['alpha','beta','gamma']:expect(page.locator('#manual-'+field)).to_have_value('80')
            page.locator('#manual-alpha').fill('120')
            expect(page.locator('#manual-preset-error')).to_contain_text('less than 120')
            page.locator('#manual-submit').click()
            expect(page.locator('#manual-error')).to_contain_text('less than 120')
            expect(page.locator('#manual-atoms')).to_have_value(initial)
            passed('All ten presets preserve atom text, constrain dependent fields and reject impossible rhombohedral geometry')
            page.locator('#manual-system').select_option('fcc')
            page.locator('.reference-editor > summary').click()
            assert page.locator('#reference-sites input[type=checkbox]:checked').count()==4
            assert page.locator('#reference-origin-element option').count()==118
            page.locator('#reference-origin-element').select_option('Na')
            page.locator('#reference-face-ab-element').select_option('Cl')
            page.locator('#reference-face-ab-occupancy').fill('0.75')
            page.locator('#reference-face-ac-element').select_option('O')
            page.locator('#reference-face-bc-element').select_option('Og')
            page.locator('#reference-action').select_option('replace')
            page.locator('#apply-reference-sites').click()
            rows=page.locator('#manual-atoms').input_value()
            assert rows.splitlines()==['Na 0 0 0 1','Cl 0.5 0.5 0 0.75','O 0.5 0 0.5 1','Og 0 0.5 0.5 1'],rows
            page.locator('#reference-action').select_option('append')
            page.locator('#apply-reference-sites').click()
            expect(page.locator('#manual-atoms')).to_have_value(rows)
            expect(page.locator('#reference-message')).to_contain_text('4 identical sites')
            page.locator('#reference-origin-element').select_option('Cu')
            page.locator('#apply-reference-sites').click()
            expect(page.locator('#reference-message')).to_contain_text('already occupied by Na')
            expect(page.locator('#manual-atoms')).to_have_value(rows)
            page.locator('#reference-origin-element').select_option('Na')
            page.locator('#reference-face-ab-occupancy').fill('NaN')
            page.locator('#apply-reference-sites').click()
            expect(page.locator('#reference-message')).to_contain_text('occupancy')
            expect(page.locator('#manual-atoms')).to_have_value(rows)
            # An unapplied picker draft must not block committed manual atoms.
            page.locator('#manual-name').fill('Synthetic FCC reference template')
            page.locator('#manual-submit').click()
            expect(page.locator('#manual-dialog')).not_to_be_visible()
            def project():
                with page.expect_download() as download:page.locator('#save-project').click()
                return json.loads(Path(download.value.path()).read_text())
            model=project()['unit']
            assert len(model['atoms'])==4
            assert [atom['element'] for atom in model['atoms']]==['Na','Cl','O','Og']
            assert model['atoms'][1]['occupancy']==.75
            assert model['cell']['lengths']==[5,5,5] and model['cell']['angles']==[90,90,90]
            assert model['contactsCalculated'] is False
            passed('FCC sites support independent elements/occupancies; duplicate append is idempotent and conflicts preserve the draft')
            page.locator('#open-manual').click()
            page.locator('#manual-system').select_option('bcc')
            assert page.locator('#reference-sites input[type=checkbox]:checked').count()==2
            page.locator('#reference-action').select_option('replace')
            page.locator('#reference-origin-element').select_option('Fe')
            page.locator('#reference-body-element').select_option('Fe')
            page.locator('#apply-reference-sites').click()
            page.locator('#manual-submit').click()
            bcc=project()['unit']
            assert [atom['fractional'] for atom in bcc['atoms']]==[[0,0,0],[.5,.5,.5]]
            page.locator('#open-manual').click()
            page.locator('#manual-system').select_option('simple-cubic')
            assert page.locator('#reference-sites input[type=checkbox]:checked').count()==1
            page.locator('#apply-reference-sites').click()
            page.locator('#manual-submit').click()
            assert len(project()['unit']['atoms'])==1
            passed('BCC and simple-cubic reference bases contain exactly two and one unique periodic sites')
            page.locator('#open-manual').click()
            page.locator('#manual-system').select_option('hexagonal')
            page.locator('#manual-a').fill('4');page.locator('#manual-c').fill('6')
            page.locator('#manual-atoms').fill('C 0 0 0\nH 0.2 0.3 0.4')
            page.locator('#manual-submit').click()
            hexagonal=project()['unit']
            vector=hexagonal['cell']['vectors'][1]
            assert abs(vector[0]+2)<1e-10 and abs(vector[1]-2*math.sqrt(3))<1e-10
            assert hexagonal['cell']['angles']==[90,90,120]
            page.locator('#open-manual').click()
            page.locator('#manual-system').select_option('fcc')
            page.locator('#copy-current-manual').click()
            expect(page.locator('#manual-system')).to_have_value('custom')
            expect(page.locator('#manual-b')).to_have_value('4')
            expect(page.locator('#manual-c')).to_have_value('6')
            expect(page.locator('#manual-gamma')).to_have_value('120')
            assert not page.locator('#manual-gamma').evaluate('(input)=>input.readOnly')
            passed('Hexagonal vectors preserve correct metric geometry and copying restores an unconstrained exact cell')
            # Boundary1 matches origin0; original comments and formatting survive.
            page.locator('#manual-atoms').fill('# preserve this comment\nSi 1 0 0 1\n')
            page.locator('#reference-action').select_option('append')
            page.locator('#reference-origin-element').select_option('Si')
            page.locator('#apply-reference-sites').click()
            expect(page.locator('#manual-atoms')).to_have_value('# preserve this comment\nSi 1 0 0 1\n')
            expect(page.locator('#reference-message')).to_contain_text('1 identical site')
            page.locator('#reference-origin-include').uncheck()
            page.locator('#apply-reference-sites').click()
            expect(page.locator('#reference-message')).to_contain_text('at least one')
            page.locator('#reference-origin-include').check()
            page.locator('#manual-atoms').fill('# comment-only draft\n')
            page.locator('#apply-reference-sites').click()
            assert page.locator('#manual-atoms').input_value().startswith('# comment-only draft\nSi 0 0 0 1')
            passed('Periodic boundary duplicates and comment-only drafts append safely without reformatting existing text')
            for width in [320,390,768]:
                page.set_viewport_size({'width':width,'height':950})
                page.locator('#manual-system').select_option('fcc')
                page.locator('#manual-dialog').evaluate('(dialog)=>dialog.scrollTop=0')
                assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
                assert page.locator('#manual-dialog').evaluate('(dialog)=>dialog.scrollWidth<=dialog.clientWidth'),width
                page.screenshot(path=str(output/f'editor-{width}.png'))
            passed('Manual editor and reference picker fit 320,390 and768 pixel screens')
            assert not errors,errors
        finally:browser.close()
    (output/'report.json').write_text(json.dumps({'url':args.url,'checks':checks},indent=2))


if __name__=='__main__':main()
