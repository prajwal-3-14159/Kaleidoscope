from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page()
    page.on("console", lambda msg: print(f"Browser Console: {msg.text}"))
    page.goto("http://127.0.0.1:8000/")
    page.wait_for_timeout(2000)
    width = page.evaluate("document.getElementById('fractal-canvas').width")
    height = page.evaluate("document.getElementById('fractal-canvas').height")
    print(f"Canvas size: {width}x{height}")
    bounds = page.evaluate("state")
    print(f"State: {bounds}")
    browser.close()
