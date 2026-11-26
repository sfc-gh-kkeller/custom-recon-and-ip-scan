"""Capture screenshots and a short GIF of Watchtower using SYNTHETIC demo data.

The dashboard talks to /api/* routes. This script intercepts those calls in the browser and answers
with made-up users and numbers, so the images show a full scenario (quiet, burst, containment)
without exposing anything from a real account.

    # production server (no dev overlay), from the dashboard folder:
    npm run build && npm run start -- -p 3100
    # then, in another shell:
    uv run --with playwright --with pillow python scripts/capture_demo.py http://localhost:3100/ ../docs/images
"""

import json
import random
import sys
import time
from io import BytesIO
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from PIL import Image
from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:3100/"
OUT = Path(sys.argv[2] if len(sys.argv) > 2 else "../docs/images")
OUT.mkdir(parents=True, exist_ok=True)

ETL, RPT, ADM = "SVC_ETL_LOADER", "SVC_REPORTING", "BREAKGLASS_ADMIN"

state = {"phase": "quiet", "log": [], "last_action": {}}


def bucket_minutes(win: int) -> int:
    return 1 if win <= 60 else 5 if win <= 180 else 15


def pulse(win: int):
    now = int(time.time())
    step = bucket_minutes(win) * 60
    end = now // step * step
    start = end - (win * 60 // step) * step
    rnd = random.Random(11)
    series, ok_total, failed_total = [], 0, 0
    attack_from = end - 14 * 60
    for t in range(start, end + 1, step):
        ok = rnd.choice([0, 0, 1, 1, 2, 3]) * (step // 60)
        failed = 0
        if state["phase"] in ("watch", "attack") and t >= attack_from:
            ramp = (t - attack_from) // 60 + 1
            if state["phase"] == "watch":
                failed = rnd.choice([1, 2, 3]) if ramp > 9 else 0
            else:
                failed = int(min(52, 4 * ramp + rnd.randint(0, 6)))
                ok += rnd.randint(2, 9)
        if ok or failed:
            series.append({"t": t, "ok": ok, "failed": failed})
            ok_total += ok
            failed_total += failed
    attack = state["phase"] == "attack"
    users = [
        {"user": ETL, "attempts": ok_total // 2 + failed_total if attack else 31, "failed": failed_total if attack else 0,
         "ips": 7 if attack else 1, "clients": "PYTHON_DRIVER, ODBC" if attack else "ODBC", "last": now - 2},
        {"user": RPT, "attempts": 38, "failed": 3 if state["phase"] != "quiet" else 0, "ips": 2, "clients": "JDBC_DRIVER", "last": now - 41},
        {"user": "ANALYST_JDOE", "attempts": 12, "failed": 0, "ips": 1, "clients": "SNOWFLAKE_UI", "last": now - 190},
    ]
    users.sort(key=lambda u: -u["attempts"])
    attempts = ok_total + failed_total
    return {"window": win, "bucketMinutes": bucket_minutes(win), "fetchedAt": now * 1000, "series": series,
            "totals": {"attempts": attempts, "failed": failed_total, "ips": 9 if attack else 3, "users": 3}, "users": users}


def flagged():
    now = int(time.time())
    if state["phase"] == "quiet":
        return []
    last = state["last_action"]

    def row(user, scanners, n, high, ago, protected=False):
        a = last.get(user)
        return {"user": user, "scanners": scanners, "findings": n, "high": high, "last": now - ago, "protected": protected,
                "autoContain": user == ETL, "lastAction": a["action"] if a else None, "lastResult": a["result"] if a else None,
                "lastActionAt": a["at"] if a else None}

    if state["phase"] == "watch":
        return [row(RPT, ["RT_FAILED_LOGINS"], 1, False, 95)]
    return [
        row(ETL, ["RT_LOGIN_BURST", "RT_IP_HOPPING", "RT_FAILED_LOGINS", "RT_UNEXPECTED_CLIENT"], 4, True, 20),
        row(ADM, ["RT_RECON", "RT_IP_HOPPING"], 2, True, 300, protected=True),
        row(RPT, ["RT_FAILED_LOGINS"], 1, False, 400),
    ]


def findings():
    now = int(time.time())
    if state["phase"] == "quiet":
        return []
    items = [("RT_FAILED_LOGINS", "MEDIUM", RPT, "3 failed logins from 1 IPs in 60 min", 95)]
    if state["phase"] == "attack":
        items = [
            ("RT_UNEXPECTED_CLIENT", "HIGH", ETL, "Unexpected client type(s) PYTHON_DRIVER in 60 min", 20),
            ("RT_LOGIN_BURST", "HIGH", ETL, "212 login attempts (171 failed) from 7 IP(s) in 60 min; top single-IP count 64", 45),
            ("RT_IP_HOPPING", "HIGH", ETL, "41 successful logins from 7 distinct IPs in 60 min", 90),
            ("RT_RECON", "HIGH", ADM, "27 reconnaissance queries across 9 object types in 60 min", 300),
            ("RT_IP_HOPPING", "MEDIUM", ADM, "6 successful logins from 3 distinct IPs in 60 min", 330),
        ] + items
    return [{"id": f"f{i}", "scanner": s, "severity": sev, "user": u, "summary": text, "at": now - ago}
            for i, (s, sev, u, text, ago) in enumerate(items)]


def payload(path: str, query: dict):
    now = int(time.time())
    attack = state["phase"] == "attack"
    if path == "/api/pulse":
        return pulse(int(query.get("window", ["60"])[0]))
    if path == "/api/flagged":
        return {"fetchedAt": now * 1000, "users": flagged()}
    if path == "/api/findings":
        return {"fetchedAt": now * 1000, "findings": findings()}
    if path == "/api/blocks":
        blocks = [
            {"queryId": "q2", "user": ETL, "text": "SELECT * FROM CUSTOMERS.PUBLIC.ACCOUNTS", "at": now - 70},
            {"queryId": "q1", "user": ETL, "text": "SELECT * FROM CUSTOMERS.PUBLIC.PAYMENTS", "at": now - 190},
        ] if attack else []
        return {"fetchedAt": now * 1000, "window": 60, "blocks": blocks}
    if path == "/api/movement-alerts":
        events = [
            {"queryId": "m3", "user": ETL, "movement": "PROGRAMMATIC_FETCH", "outcome": "blocked", "at": now - 70},
            {"queryId": "m2", "user": ETL, "movement": "PROGRAMMATIC_FETCH", "outcome": "allowed with alert", "at": now - 260},
            {"queryId": "m1", "user": RPT, "movement": "PROGRAMMATIC_FETCH", "outcome": "allowed with alert", "at": now - 3600},
        ] if attack else [{"queryId": "m1", "user": RPT, "movement": "PROGRAMMATIC_FETCH", "outcome": "allowed with alert", "at": now - 3600}]
        return {"fetchedAt": now * 1000, "events": events}
    if path == "/api/containment":
        return {"fetchedAt": now * 1000, "entries": list(reversed(state["log"]))}
    if path == "/api/status":
        jobs = [{"name": n, "state": "started", "schedule": s, "kind": k} for n, s, k in [
            ("SCAN_REALTIME_TASK", "5 MINUTE", "task"), ("AUTO_CONTAIN_TASK", "", "task"),
            ("DMP_BLOCK_ALERT_REALTIME", "5 MINUTE", "alert"), ("DMP_VIOLATION_ALERT", "60 MINUTE", "alert")]]
        return {"fetchedAt": now * 1000, "jobs": jobs, "population": {"watched": 4, "protected": 1},
                "thresholds": {"windowMinutes": 60, "ipDistinct": 3, "failedLogins": 5, "loginBurst": 50, "sameIp": 20}}
    return None


def handle(route):
    req = route.request
    parsed = urlparse(req.url)
    if parsed.path == "/api/contain":
        body = json.loads(req.post_data or "{}")
        action, user = body["action"], body["user"]
        result = {"ABORT_QUERIES": f"OK: aborted running queries for {user}", "DISABLE_USER": f"OK: disabled {user}",
                  "ENABLE_USER": f"OK: re-enabled {user}"}[action]
        now = int(time.time())
        state["log"].append({"at": now, "user": user, "action": action, "by": "dashboard", "confirmed": bool(body.get("confirmed")), "result": result})
        state["last_action"][user] = {"action": action, "result": result, "at": now}
        route.fulfill(status=200, content_type="application/json", body=json.dumps({"ok": True, "result": result}))
        return
    data = payload(parsed.path, parse_qs(parsed.query))
    route.fulfill(status=200, content_type="application/json", body=json.dumps(data if data is not None else {}))


def settle(page):
    page.wait_for_function("!document.querySelector('.animate-pulse')", timeout=30000)
    page.wait_for_timeout(1400)


def new_page(browser, theme, width, height):
    ctx = browser.new_context(viewport={"width": width, "height": height}, color_scheme=theme, device_scale_factor=1)
    ctx.add_init_script(f"localStorage.setItem('theme', '{theme}')")
    page = ctx.new_page()
    page.route("**/api/**", handle)
    return ctx, page


def png_to_image(png: bytes) -> Image.Image:
    return Image.open(BytesIO(png)).convert("RGB")


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch()

        # Static screenshots: the burst state.
        state.update(phase="attack", log=[], last_action={})
        for name, theme, w, h, full in [("watchtower-dark", "dark", 1280, 900, True), ("watchtower-light", "light", 1280, 900, True),
                                        ("watchtower-mobile", "dark", 390, 844, False)]:
            ctx, page = new_page(browser, theme, w, h)
            page.goto(URL)
            settle(page)
            page.screenshot(path=str(OUT / f"{name}.png"), full_page=full)
            print(OUT / f"{name}.png")
            ctx.close()

        # The containment dialog.
        ctx, page = new_page(browser, "dark", 1280, 900)
        page.goto(URL)
        settle(page)
        row = page.locator("section[aria-label='Flagged users'] tr", has_text=ETL)
        row.get_by_role("button", name="Disable…").click()
        page.get_by_role("dialog").get_by_label("User name").fill(ETL)
        page.wait_for_timeout(500)
        page.screenshot(path=str(OUT / "watchtower-disable-dialog.png"))
        print(OUT / "watchtower-disable-dialog.png")
        ctx.close()

        # The GIF: quiet -> watch -> burst -> abort -> disable.
        state.update(phase="quiet", log=[], last_action={})
        ctx, page = new_page(browser, "dark", 1280, 940)
        frames: list[tuple[Image.Image, int]] = []

        def grab(ms):
            frames.append((png_to_image(page.screenshot()), ms))

        page.goto(URL)
        settle(page)
        grab(1800)
        state["phase"] = "watch"
        page.reload()
        settle(page)
        grab(1800)
        state["phase"] = "attack"
        page.reload()
        page.wait_for_function("!document.querySelector('.animate-pulse')", timeout=30000)
        page.wait_for_timeout(350)
        grab(300)
        page.wait_for_timeout(700)
        grab(2200)
        row = page.locator("section[aria-label='Flagged users'] tr", has_text=ETL)
        row.get_by_role("button", name="Abort queries").click()
        page.get_by_role("status").filter(has_text="OK: aborted").wait_for(timeout=15000)
        page.wait_for_timeout(500)
        grab(2000)
        row.get_by_role("button", name="Disable…").click()
        dialog = page.get_by_role("dialog")
        field = dialog.get_by_label("User name")
        page.wait_for_timeout(450)
        grab(1100)
        field.fill(ETL[:7])
        page.wait_for_timeout(250)
        grab(700)
        field.fill(ETL)
        page.wait_for_timeout(250)
        grab(1300)
        dialog.get_by_role("button", name="Disable user").click()
        page.get_by_role("status").filter(has_text="OK: disabled").wait_for(timeout=15000)
        page.wait_for_timeout(900)
        grab(3200)
        ctx.close()
        browser.close()

    width = 960
    resized = [(im.resize((width, round(im.height * width / im.width)), Image.LANCZOS), d) for im, d in frames]
    pal = [im.quantize(colors=96, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE) for im, _ in resized]
    gif = OUT / "watchtower-demo.gif"
    pal[0].save(gif, save_all=True, append_images=pal[1:], duration=[d for _, d in resized], loop=0, optimize=True, disposal=1)
    print(gif, f"{gif.stat().st_size / 1024:.0f} KB", f"{len(pal)} frames")


if __name__ == "__main__":
    main()
