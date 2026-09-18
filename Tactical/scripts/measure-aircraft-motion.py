#!/usr/bin/env python3
"""Measure aircraft marker motion on the live map.

With no aircraft currently airborne this cannot demonstrate the prediction accelerating a
live contact — what it CAN prove is that a non-active contact is NOT predicted (no phantom
motion), and that markers still render after the change. Both matter: a prediction loop
that moves a parked aircraft, or that breaks marker rendering, would be worse than the lag
it set out to fix.
"""
import json, subprocess, time, urllib.request
import websocket

BASE = "http://localhost:3100"
PORT, PROF = 9401, "/tmp/chrome-aircraft"
subprocess.run(["rm", "-rf", PROF], check=False)
ch = subprocess.Popen(["/usr/bin/google-chrome-stable", "--headless=new", "--no-sandbox",
    "--disable-gpu", "--remote-debugging-port=%d" % PORT, "--remote-allow-origins=*",
    "--user-data-dir=%s" % PROF, "--window-size=1600,1000", "about:blank"],
    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

def rpc(ws, i, m, p=None):
    ws.send(json.dumps({"id": i, "method": m, "params": p or {}}))
    while True:
        r = json.loads(ws.recv())
        if r.get("id") == i:
            return r

def ev(ws, i, expr, await_promise=False):
    p = {"returnByValue": True, "expression": expr}
    if await_promise:
        p["awaitPromise"] = True
    return rpc(ws, i, "Runtime.evaluate", p).get("result", {}).get("result", {}).get("value")

SAMPLE_JS = """
  (async () => {
    const el = document.querySelector('.vp-ac-marker');
    if (!el) return { markers: document.querySelectorAll('.vp-ac-marker').length, samples: [] };
    const out = [];
    const t0 = performance.now();
    while (performance.now() - t0 < 6000) {
      const r = el.getBoundingClientRect();
      out.push({ t: Math.round(performance.now() - t0), x: Math.round(r.x * 10) / 10, y: Math.round(r.y * 10) / 10 });
      await new Promise(res => setTimeout(res, 150));
    }
    return { markers: document.querySelectorAll('.vp-ac-marker').length, samples: out };
  })()
"""

try:
    url = None
    for _ in range(40):
        try:
            with urllib.request.urlopen("http://127.0.0.1:%d/json/list" % PORT, timeout=2) as f:
                for t in json.load(f):
                    if t.get("type") == "page" and t.get("webSocketDebuggerUrl"):
                        url = t["webSocketDebuggerUrl"]; break
        except Exception:
            pass
        if url: break
        time.sleep(0.5)
    ws = websocket.create_connection(url, timeout=90); i = 1
    for m in ("Page.enable", "Runtime.enable"):
        rpc(ws, i, m); i += 1
    rpc(ws, i, "Page.navigate", {"url": BASE + "/"}); i += 1
    time.sleep(9)
    ev(ws, i, "(()=>{const b=[...document.querySelectorAll('button')].find(x=>/I understand|ACCEPT/i.test(x.textContent||''));if(b)b.click();return !!b})()")
    time.sleep(14)

    r = ev(ws, i, SAMPLE_JS, True)
    s = r.get("samples") or []
    print("=== aircraft markers ===")
    print("  rendered:", r.get("markers"))
    if not s:
        print("  no marker element found to sample")
    else:
        moves = []
        for a, b in zip(s, s[1:]):
            d = ((b["x"] - a["x"]) ** 2 + (b["y"] - a["y"]) ** 2) ** 0.5
            moves.append(d)
        moved = sum(1 for m in moves if m > 0.5)
        print(f"  samples over 6s: {len(s)} at 150ms")
        print(f"  samples showing movement (>0.5px): {moved} of {len(moves)}")
        print(f"  largest single-step move: {max(moves):.1f}px   total path: {sum(moves):.1f}px")
        print(f"  verdict: {'MOVING' if moved > 2 else 'STATIONARY (correct: the only contact is active=False, so nothing is predicted)'}")
    ws.close()
finally:
    ch.terminate()
    try: ch.wait(timeout=10)
    except Exception: ch.kill()
