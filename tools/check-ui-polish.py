"""Bounded Chromium regressions for hover frames and the calendar footer.

Run through capture-showcase.py --bounded polish on the Linux CI host.
The frame cases use the real card renderer with explicit simulated inputs.
"""
import argparse
import asyncio
import json
import os
from pathlib import Path
import subprocess
import urllib.request

from playwright.async_api import async_playwright

RECTS = """() => {
 const panel=document.querySelector('#header-period-panel');
 const scroll=panel.querySelector('.cal-scroll'), foot=panel.querySelector('.cal-foot');
 const box=e=>{const r=e.getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right,height:r.height};};
 const today=foot.querySelector('.cal-today'), r=today.getBoundingClientRect();
 return {panel:box(panel),scroll:box(scroll),foot:box(foot),today:box(today),
   panelScroll:panel.scrollTop,gridScroll:scroll.scrollTop,bodyScroll:scrollY,
   gridScrollable:scroll.scrollHeight>scroll.clientHeight,
   hit:today.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2))};
}"""

async def calendar(browser, output, width, height):
    print(json.dumps({'calendar_case':[width,height]}), flush=True)
    page = await browser.new_page(viewport={'width':width,'height':height})
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    await page.goto('http://127.0.0.1:4317/')
    await page.locator('.card').first.wait_for()
    await page.locator('#menu-btn').click()
    await page.locator('#menu-textSize').select_option('largest')
    await page.get_by_label('Close menu', exact=True).click()
    await page.locator('#header-league').click()
    await page.locator('#header-league-options [data-value="nba"]').click()
    await page.locator('#header-period').click()
    await page.locator('#header-calendar .cal-today').wait_for(state='visible')
    before = await page.evaluate(RECTS)
    assert before['hit'] and before['today']['bottom'] <= height and before['today']['top'] >= 0, before
    assert before['panelScroll'] == 0 and before['scroll']['height'] >= 44, before
    await page.keyboard.press('End')
    for _ in range(5):
        await page.keyboard.press('ArrowDown')
    moved = await page.evaluate(RECTS)
    focused = await page.evaluate("""() => {const r=document.activeElement.getBoundingClientRect(),s=document.querySelector('.cal-scroll').getBoundingClientRect();return {day:document.activeElement.classList.contains('cal-day'),visible:r.top>=s.top-1&&r.bottom<=s.bottom+1,needsScroll:r.bottom+document.querySelector('.cal-scroll').scrollTop>s.bottom+1};}""")
    assert focused['day'] and focused['visible'], focused
    assert moved['panelScroll'] == 0 and moved['bodyScroll'] == before['bodyScroll'], moved
    assert moved['today'] == before['today'] and moved['hit'], moved
    if focused['needsScroll']:
        assert moved['gridScroll'] > 0, moved
    await page.keyboard.press('Tab')
    assert await page.locator('.cal-today').evaluate('(e)=>e===document.activeElement')
    await page.keyboard.press('Enter')
    assert await page.locator('#header-period-panel').is_hidden()
    assert await page.locator('#header-period').evaluate('(e)=>e===document.activeElement')
    await page.locator('#header-period').click()
    await page.keyboard.press('Escape')
    assert await page.locator('#header-period-panel').is_hidden()
    assert await page.locator('#header-period').evaluate('(e)=>e===document.activeElement')
    await page.locator('#header-period').click()
    await page.locator('#header-period-panel .cal-today').click()
    assert await page.locator('#header-period-panel').is_hidden()
    await page.locator('#header-period').click()
    reopen = await page.evaluate("""() => {
      const s=document.querySelector('#header-period-panel .cal-scroll');
      const r=document.activeElement.getBoundingClientRect(),b=s.getBoundingClientRect();
      return {gridScroll:s.scrollTop,fits:r.bottom+s.scrollTop<=b.bottom-6};
    }""")
    assert not reopen['fits'] or reopen['gridScroll'] == 0, (width,height,reopen)
    await page.screenshot(path=str(output/f'calendar-{width}x{height}.png'))
    for _ in range(5):
        await page.keyboard.press('Shift+Tab')
        if await page.evaluate("()=>!!document.activeElement.closest('.header-phases')"):
            break
    phase = await page.evaluate("""() => {
      const e=document.activeElement,p=document.querySelector('#header-period-panel .header-phases');
      if(!p||!p.contains(e))return {inPhases:false};
      const r=e.getBoundingClientRect(),b=p.getBoundingClientRect();
      const h=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);
      return {inPhases:true,text:e.textContent,visible:r.top>=b.top-1&&r.bottom<=b.bottom+1,hit:!!h&&e.contains(h)};
    }""")
    assert phase['inPhases'] and phase['visible'] and phase['hit'], (width,height,phase)
    assert not errors, errors
    await page.close()
    return {'viewport':[width,height],'text_size':'largest','before':before,'after_keyboard':moved,'focused_day':focused,'keyboard_today':True,'pointer_today':True,'escape_focus_return':True,'phase_keyboard':phase,'reopen':reopen}

async def frames(browser, output):
    page = await browser.new_page(viewport={'width':1920,'height':1080})
    await page.goto('http://127.0.0.1:4317/')
    await page.locator('.card').first.wait_for()
    await page.evaluate("""async () => {
      const {buildCard}=await import('/lib/render.mjs');
      const teams={AAA:{abbr:'AAA',name:'Alpha Owls',color:'#335577',record:'5-4'},BBB:{abbr:'BBB',name:'Beta Hawks',color:'#775533',record:'4-5'}};
      const base={league:'nfl',sport:'football',format:'quarters',away:'AAA',home:'BBB',kickoff:'2026-11-15T18:00:00Z',status:'live',period:2,clock:'7:00',total:{away:7,home:3},linescore:null,redZone:false,overtime:false,scoringCue:null,possession:null,situation:null,timeouts:null,lastPlay:null,leaders:null,missing:[],network:'SIM',corrected:null};
      const host=document.createElement('section');host.id='frame-cases';
      Object.assign(host.style,{position:'fixed',inset:'0',zIndex:'100',display:'flex',gap:'16px',padding:'16px',background:'var(--bg)'});
      for(const [name,over] of [['red',{redZone:true,scoringCue:'TD'}],['orange',{period:5,scoringCue:'TD'}],['yellow',{period:4,clock:'4:30',total:{away:17,home:14},scoringCue:'TD'}],['green',{scoringCue:'TD'}],['ordinary',{}]]){
        const ref=buildCard(document,{...base,...over,id:name},teams,{zone:'America/Chicago'});
        ref.root.id='frame-'+name;
        Object.assign(ref.root.style,{position:'relative',width:'320px',height:'220px',flex:'0 0 320px'});
        Object.assign(ref.sections[1].style,{width:'320px',height:'220px'});
        host.appendChild(ref.root);
      }
      document.body.appendChild(host);
    }""")
    results = []
    for name in ['red','orange','yellow','green','ordinary']:
        print(json.dumps({'frame_case':name}), flush=True)
        card = page.locator('#frame-'+name)
        await page.mouse.move(1900,1000)
        before = await card.evaluate("e=>({border:getComputedStyle(e,'::after').borderColor,text:e.textContent})")
        await card.hover()
        after = await card.evaluate("e=>({border:getComputedStyle(e,'::after').borderColor,text:e.textContent,hover:e.matches(':hover')})")
        expected_var = 'line-strong' if name == 'ordinary' else 'live' if name == 'green' else 'prio-'+name
        expected = await card.evaluate("(e,v)=>{const p=document.createElement('span');p.style.color='var(--'+v+')';e.appendChild(p);const c=getComputedStyle(p).color;p.remove();return c;}", expected_var)
        assert after['hover'] and after['border'] == expected and after['text'] == before['text'], (name,before,after,expected)
        if name != 'ordinary':
            assert before['border'] == after['border'], (name,before,after)
            assert await card.locator('.tag-td').is_visible()
        else:
            assert before['border'] != after['border'], (name,before,after)
        await page.keyboard.press('Tab')
        await card.focus()
        focus = await card.evaluate("e=>({visible:e.matches(':focus-visible'),outline:getComputedStyle(e,'::after').outlineStyle,border:getComputedStyle(e,'::after').borderColor})")
        assert focus['visible'] and focus['outline'] != 'none', focus
        if name in ['red','orange','yellow']:
            assert focus['border'] == expected, focus
        await card.screenshot(path=str(output/f'hover-{name}.png'))
        results.append({'case':name,'before':before,'hover':after,'focus':focus})
    await page.close()
    return results

async def run(output):
    assert os.environ.get('WTS_GUARDED_UNIT'), 'Use the bounded runner'
    output.mkdir(exist_ok=False)
    server = subprocess.Popen(['node','--max-old-space-size=128','server.mjs'],stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
    try:
        for _ in range(100):
            try:
                with urllib.request.urlopen('http://127.0.0.1:4317/',timeout=1) as response:
                    assert response.status == 200
                break
            except OSError:
                await asyncio.sleep(.05)
        else:
            raise RuntimeError('Server did not become ready')
        async with async_playwright() as playwright:
            browser = await playwright.chromium.launch(headless=True,args=['--disable-dev-shm-usage','--renderer-process-limit=1'])
            try:
                result={'browser':browser.version,'frames':await frames(browser,output),'calendars':[]}
                for width,height in [(960,540),(1280,720),(1920,1080),(390,844)]:
                    result['calendars'].append(await calendar(browser,output,width,height))
            finally:
                await browser.close()
        result['pass']=True
        with (output/'result.json').open('x') as handle:
            json.dump(result,handle,indent=2)
        print(json.dumps({'pass':True,'frame_cases':5,'calendar_viewports':4}))
    finally:
        server.terminate()
        server.wait(timeout=5)

if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--work',required=True)
    asyncio.run(run(Path(parser.parse_args().work)))
