# -*- coding: utf-8 -*-
"""截图验证预览页在 dev / master 两个环境下都能从后台取到关卡。"""
import sys, time, os
from playwright.sync_api import sync_playwright

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'shots-env')
os.makedirs(OUT, exist_ok=True)

def shoot(page, env):
    page.goto('http://127.0.0.1:4173/?env=%s' % env, wait_until='load')
    page.wait_for_timeout(6000)
    path = os.path.join(OUT, '%s-home.png' % env)
    page.screenshot(path=path)
    print(env, '->', path)

with sync_playwright() as p:
    try:
        browser = p.chromium.launch()
    except Exception:
        browser = p.chromium.launch(channel='msedge')
    ctx = browser.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2)
    page = ctx.new_page()
    logs = []
    page.on('console', lambda m: logs.append('%s: %s' % (m.type, m.text)))
    page.on('requestfailed', lambda r: logs.append('failed: %s %s' % (r.url, r.failure)))
    for env in ('dev', 'master'):
        shoot(page, env)
    print('--- console ---')
    for line in logs[:40]:
        print(line)
    browser.close()
