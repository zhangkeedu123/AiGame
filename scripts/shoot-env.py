# -*- coding: utf-8 -*-
"""截图验证预览页在 dev / master 两个环境下都能从后台取到关卡。

页面上不再有环境切换，所以这里按环境分别起一个预览进程（不同端口），各截一张图。
用法：python scripts/shoot-env.py
"""
import os
import subprocess
import sys
import time
import urllib.request

from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'scripts', 'shots-env')
os.makedirs(OUT, exist_ok=True)

PORTS = {'dev': 4183, 'master': 4184}


def start_preview(env, port):
    node = 'node'
    proc = subprocess.Popen(
        [node, os.path.join('scripts', 'preview.js'), str(port), '--env', env],
        cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT,
    )
    deadline = time.time() + 20
    while time.time() < deadline:
        try:
            with urllib.request.urlopen('http://127.0.0.1:%d/online-enabled' % port, timeout=1) as r:
                if r.status == 200:
                    return proc
        except Exception:
            time.sleep(0.5)
    proc.terminate()
    raise RuntimeError('%s 预览没能在端口 %d 起来' % (env, port))


def main():
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
        try:
            for env, port in PORTS.items():
                proc = start_preview(env, port)
                try:
                    page.goto('http://127.0.0.1:%d/' % port, wait_until='load')
                    page.wait_for_timeout(6000)
                    path = os.path.join(OUT, '%s-home.png' % env)
                    page.screenshot(path=path)
                    print(env, '->', path)
                finally:
                    proc.terminate()
                    proc.wait(timeout=10)
        finally:
            browser.close()
    print('--- console ---')
    for line in logs[:40]:
        print(line)


if __name__ == '__main__':
    sys.exit(main())
