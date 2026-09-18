#!/usr/bin/env python3
"""Prove the push path end to end, in a real browser.

Walks the exact path a user walks: register/login -> read the VAPID key from the settings
API -> register the service worker -> subscribe -> store the subscription server-side.
Then it asks Chrome to deliver a push to that worker, which is the only way to prove the
receiving end works without waiting for a real alert to fire.

Reports each step separately: "the subscription was stored" and "a push arrived and the
worker handled it" are different claims and are not the same evidence.

JS lives in plain triple-quoted strings with __PLACEHOLDERS__, never f-strings: doubling
braces through an f-string is exactly the bug this script was written to catch elsewhere.
"""
import json, subprocess, time, urllib.request
import websocket

BASE = "http://localhost:3100"
PORT, PROF = 9397, "/tmp/chrome-push"
EMAIL = "pushtest+%d@example.invalid" % int(time.time())
PASSWORD = "Test-passw0rd-not-a-real-secret"

REG_JS = """
  fetch('/api/auth/register', {method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({email:'__EMAIL__', password:'__PASSWORD__'})})
    .then(async r => ({ status: r.status, body: (await r.text()).slice(0,160) }))
"""

SETTINGS_JS = """
  fetch('/api/alerts/settings',{cache:'no-store'}).then(async r => {
    const d = await r.json();
    return { status: r.status, hasVapid: !!d.vapidPublicKey,
             vapidLen: (d.vapidPublicKey||'').length, channels: d.channelsAvailable };
  })
"""

SW_JS = """
  navigator.serviceWorker.register('/sw.js', {scope:'/'})
    .then(async reg => { await navigator.serviceWorker.ready;
      return { ok:true, scope: reg.scope, state: (reg.active||{}).state || 'pending' }; })
    .catch(e => ({ ok:false, error: e.name + ': ' + e.message }))
"""

SUBSCRIBE_JS = """
  (async () => {
    const s = await fetch('/api/alerts/settings',{cache:'no-store'}).then(r=>r.json());
    const key = s.vapidPublicKey;
    if (!key) return { ok:false, error:'no VAPID key from the server' };
    const pad = '='.repeat((4 - key.length % 4) % 4);
    const b64 = (key + pad).replace(/-/g,'+').replace(/_/g,'/');
    const raw = atob(b64); const arr = new Uint8Array(raw.length);
    for (let i=0;i<raw.length;i++) arr[i] = raw.charCodeAt(i);
    const reg = await navigator.serviceWorker.getRegistration('/');
    if (!reg) return { ok:false, error:'no service worker registration' };
    try {
      let sub = await reg.pushManager.getSubscription();
      if (!sub) sub = await reg.pushManager.subscribe({userVisibleOnly:true, applicationServerKey: arr});
      const j = sub.toJSON();
      return { ok:true, endpointHost: new URL(j.endpoint).host,
               hasKeys: !!(j.keys && j.keys.p256dh && j.keys.auth) };
    } catch (e) { return { ok:false, error: e.name + ': ' + e.message }; }
  })()
"""

STORE_JS = """
  (async () => {
    const csrf = (/(?:^|;\\s*)vp_csrf=([^;]+)/.exec(document.cookie)||[])[1] || '';
    const reg = await navigator.serviceWorker.getRegistration('/');
    const sub = reg ? await reg.pushManager.getSubscription() : null;
    if (!sub) return { ok:false, error:'no subscription to store' };
    const r = await fetch('/api/alerts/settings', {method:'POST', credentials:'same-origin',
      headers:{'Content-Type':'application/json','x-csrf-token': decodeURIComponent(csrf)},
      body: JSON.stringify({pushEnabled:true, pushSubscription: sub.toJSON()})});
    const d = await r.json().catch(()=>({}));
    const after = await fetch('/api/alerts/settings',{cache:'no-store'}).then(x=>x.json());
    return { ok:r.ok, status:r.status, error:d.error||null,
             hasPushSubscription: after.hasPushSubscription, pushEnabled: after.pushEnabled };
  })()
"""

DUMP_SUB_JS = """
  (async () => { const reg = await navigator.serviceWorker.getRegistration('/');
    const sub = reg ? await reg.pushManager.getSubscription() : null;
    return sub ? JSON.stringify(sub.toJSON()) : null; })()
"""

subprocess.run(["rm", "-rf", PROF], check=False)
ch = subprocess.Popen(["/usr/bin/google-chrome-stable", "--headless=new", "--no-sandbox",
    "--disable-gpu", "--remote-debugging-port=%d" % PORT, "--remote-allow-origins=*",
    "--user-data-dir=%s" % PROF, "--window-size=1400,900", "about:blank"],
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
    for m in ("Page.enable", "Runtime.enable", "ServiceWorker.enable"):
        rpc(ws, i, m); i += 1
    rpc(ws, i, "Browser.grantPermissions", {"origin": BASE, "permissions": ["notifications"]}); i += 1
    rpc(ws, i, "Page.navigate", {"url": BASE + "/dashboard"}); i += 1
    time.sleep(8)

    print("=== 1. account + session (the alerts API needs a user) ===")
    print("  register:", json.dumps(ev(ws, i, REG_JS.replace("__EMAIL__", EMAIL).replace("__PASSWORD__", PASSWORD), True)))
    print("  /api/auth/me:", ev(ws, i, "fetch('/api/auth/me',{cache:'no-store'}).then(r=>r.status)", True))

    print("\n=== 2. the VAPID public key now reaches the client ===")
    print(" ", json.dumps(ev(ws, i, SETTINGS_JS, True)))

    print("\n=== 3. service worker registers ===")
    print(" ", json.dumps(ev(ws, i, SW_JS, True)))

    print("\n=== 4. browser creates a real push subscription with that key ===")
    print(" ", json.dumps(ev(ws, i, SUBSCRIBE_JS, True)))

    print("\n=== 5. the subscription is stored server-side (POST with CSRF) ===")
    print(" ", json.dumps(ev(ws, i, STORE_JS, True)))

    raw = ev(ws, i, DUMP_SUB_JS, True)
    if raw:
        with open("/tmp/test-push-subscription.json", "w") as f:
            f.write(raw)
        j = json.loads(raw)
        print("\n  saved the subscription for the server-side test (endpoint host %s)" % j["endpoint"].split("/")[2])
    else:
        print("\n  NO subscription to save — steps 4/5 did not produce one")

    print("\n=== 6. does the worker handle a push? (Chrome delivers one directly) ===")
    regs = ev(ws, i, "navigator.serviceWorker.getRegistration('/').then(r=>r?r.scope:null)", True)
    print("  registration scope:", regs)
    res = rpc(ws, i, "ServiceWorker.deliverPushMessage",
              {"origin": BASE, "registrationId": "0",
               "data": json.dumps({"title": "VP-OVERWATCH test", "body": "push handler check", "data": {"level": "info"}})})
    print("  deliverPushMessage:", json.dumps(res.get("error") or res.get("result") or "accepted, no error"))
    time.sleep(2)
    ws.close()
finally:
    ch.terminate()
    try: ch.wait(timeout=10)
    except Exception: ch.kill()
