"""End-to-end console check against a live public testnet (Ethereum Sepolia).

Drives the real UI against the deployed vault: shock the simulated market with
the owner controls, draft and sign a mandate, run the rescue, and verify that
every mined transaction and every contract link resolves on the block explorer.

    source ~/.local/opencode-venv/bin/activate
    python3 apps/web/test/browser_testnet.py --base-url http://127.0.0.1:8790 \
        --artifacts .playwright-artifacts

It needs a running agent in chain mode (`bash scripts/start-testnet.sh testnet`)
and a funded executor. It never prints key material.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

EXPLORER = "https://sepolia.etherscan.io"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="http://127.0.0.1:8790")
    parser.add_argument("--artifacts", default=".playwright-artifacts")
    parser.add_argument("--explorer", default=EXPLORER)
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

        # 1. The chain badge links straight to the deployed vault on the explorer.
        badge = page.locator("a.mode-badge")
        expect(badge).to_have_count(1, timeout=20_000)
        badge_href = badge.get_attribute("href") or ""
        assert badge_href.startswith(f"{args.explorer}/address/"), badge_href

        # 2. Every deployed contract is listed with an explorer address link.
        deployment_links = page.locator(".deployment-list a")
        expect(deployment_links.first).to_be_visible(timeout=20_000)
        contract_hrefs = [
            deployment_links.nth(index).get_attribute("href") or ""
            for index in range(deployment_links.count())
        ]
        assert len(contract_hrefs) >= 4, contract_hrefs
        assert all(href.startswith(f"{args.explorer}/address/") for href in contract_hrefs), contract_hrefs

        # 3. Shock the simulated market through the owner controls (-20% on both
        #    pools), exactly as the SCENARIOS base state expects.
        page.locator("details.scenario-lab summary").click()
        page.get_by_role("button", name="mWETH -20%").click(timeout=90_000)
        expect(page.locator(".announcements")).to_contain_text("mWETH -20%", timeout=90_000)
        page.get_by_role("button", name="mWSTETH -20%").click(timeout=90_000)
        expect(page.locator(".announcements")).to_contain_text("mWSTETH -20%", timeout=90_000)
        page.reload(wait_until="networkidle")
        hfs = page.locator(".hf-pill strong")
        expect(hfs.first).to_have_text("0.943", timeout=30_000)

        # 4. Draft and sign the mandate with the server owner key.
        page.get_by_role("button", name="Draft mandate").click()
        expect(page.get_by_text("DRAFT · NOT SIGNED").first).to_be_visible(timeout=30_000)
        page.get_by_role("button", name="Sign & activate · owner key").click(timeout=90_000)
        expect(page.locator(".announcements")).to_contain_text("activated on chain", timeout=90_000)
        expect(page.get_by_text("ACTIVE · TESTNET").first).to_be_visible(timeout=30_000)

        # The mandate transaction itself is linked for the record.
        mandate_link = page.locator(".mandate-sheet a[href*='/tx/']").first
        expect(mandate_link).to_be_visible(timeout=20_000)
        mandate_href = mandate_link.get_attribute("href") or ""
        assert mandate_href.startswith(f"{args.explorer}/tx/"), mandate_href

        # 5. Run the rescue and wait for the chain to confirm both actions.
        page.get_by_role("button", name="Run rescue").click()
        expect(page.locator(".status-line")).to_have_text(
            "COMPLETED", timeout=300_000
        )
        expect(page.get_by_text("MINED").first).to_be_visible(timeout=30_000)

        tx_links = page.locator(".tx-list a[href*='/tx/']")
        count = tx_links.count()
        assert count >= 2, f"expected two mined transactions, saw {count}"
        tx_hrefs = [tx_links.nth(index).get_attribute("href") or "" for index in range(count)]
        assert all(href.startswith(f"{args.explorer}/tx/") for href in tx_hrefs), tx_hrefs

        page.screenshot(path=str(artifacts / "testnet-desktop.png"), full_page=True)
        page.set_viewport_size({"width": 390, "height": 844})
        overflow = page.evaluate(
            "document.documentElement.scrollWidth > document.documentElement.clientWidth"
        )
        assert not overflow, "390px viewport has horizontal overflow"
        page.screenshot(path=str(artifacts / "testnet-mobile.png"), full_page=True)

        assert not errors, errors
        summary = {
            "badgeHref": badge_href,
            "contractHrefs": contract_hrefs,
            "mandateHref": mandate_href,
            "txHrefs": tx_hrefs,
        }
        (artifacts / "testnet-links.json").write_text(json.dumps(summary, indent=2))
        print("testnet console check: TESTNET badge, contract links, signed mandate, mined actions")
        for href in tx_hrefs:
            print(f"  {href}")
        context.close()
        browser.close()


if __name__ == "__main__":
    main()
