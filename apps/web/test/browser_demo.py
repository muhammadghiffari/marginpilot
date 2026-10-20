"""Optional click-through smoke check for the served SIMULATED demo.

Not part of `pnpm test` (it needs a real browser). Run it against a built UI:

    pnpm --filter @marginpilot/web build
    DEMO_MODE=true pnpm --filter @marginpilot/agent start
    source ~/.local/opencode-venv/bin/activate
    python3 apps/web/test/browser_demo.py --base-url http://127.0.0.1:8787

It checks the default run, the plan/ledger, the demo signing error path,
390px layout (no horizontal overflow) and collects console page errors.
Screenshots are written to the directory passed with --artifacts.
"""

from __future__ import annotations

import argparse
from pathlib import Path

from playwright.sync_api import expect, sync_playwright


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="http://127.0.0.1:8787")
    parser.add_argument("--artifacts", default=".playwright-artifacts")
    args = parser.parse_args()
    artifacts = Path(args.artifacts)
    artifacts.mkdir(parents=True, exist_ok=True)

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        context = browser.new_context(
            viewport={"width": 1440, "height": 900}, reduced_motion="reduce"
        )
        page = context.new_page()
        errors: list[str] = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.goto(args.base_url, wait_until="networkidle")
        expect(page.get_by_role("heading", name="MarginPilot", level=1)).to_be_visible()
        expect(page.get_by_text("SIMULATED", exact=True).first).to_be_visible()

        page.get_by_role("button", name="Run rescue").click()
        expect(page.locator(".status-line")).to_have_text("COMPLETED", timeout=15_000)
        expect(page.get_by_text("Transaction ledger")).to_be_visible()
        expect(page.get_by_text("MINED").first).to_be_visible()
        page.screenshot(path=str(artifacts / "desktop-after.png"), full_page=True)

        page.get_by_role("button", name="Draft mandate").click()
        expect(page.get_by_text("DRAFT · NOT SIGNED").first).to_be_visible()
        page.get_by_role("button", name="Sign & activate · demo owner").click()
        expect(page.get_by_role("alert")).to_contain_text("Demo signing is not configured")

        page.set_viewport_size({"width": 390, "height": 844})
        overflow = page.evaluate(
            "document.documentElement.scrollWidth > document.documentElement.clientWidth"
        )
        assert not overflow, "390px viewport has horizontal overflow"
        page.screenshot(path=str(artifacts / "mobile.png"), full_page=True)

        page.keyboard.press("Tab")
        focused = page.evaluate("document.activeElement?.tagName")
        assert focused in ("A", "BUTTON", "TEXTAREA", "INPUT", "SUMMARY"), focused
        assert not errors, errors
        print("web smoke: run/ledger/draft, 390px no overflow, no page errors")
        context.close()
        browser.close()


if __name__ == "__main__":
    main()
