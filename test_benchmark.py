from playwright.sync_api import sync_playwright
import time

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        page.goto("http://localhost:8080/")
        
        # Click toggle benchmark
        page.click("#btn-toggle-benchmark")
        time.sleep(1)
        
        # Click start
        page.click("#btn-start-benchmark")
        time.sleep(2)
        
        # Extract state
        state = page.evaluate("window.__test_state || (() => { import('./app.js').then(m => window.__test_state = m.state); return 'loading'; })()")
        time.sleep(1)
        state = page.evaluate("window.__test_state")
        
        print("STATE:", state)
        
        browser.close()

if __name__ == "__main__":
    run()
