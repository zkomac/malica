"""Server-rendered landing page (config.PIN entry). The app itself is ``static/index.html``."""
from . import config

PIN_PAGE = """<!doctype html><html lang="sl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Malica — skupinsko naročanje kosila</title>
<link rel="icon" type="image/svg+xml" href="/icon.svg"><link rel="apple-touch-icon" href="/apple-touch-icon.png">
<meta property="og:type" content="website">
<meta property="og:title" content="Malica — skupinsko naročanje kosila">
<meta property="og:description" content="Ekipa skupaj naroči kosilo prek Wolta: vsak izbere svojo jed, eden naroči, aplikacija razdeli ceno.">
<meta property="og:image" content="https://malica.stavio.net/og.png">
<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
<meta property="og:url" content="https://malica.stavio.net/">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#009de0">
<style>body{margin:0;font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#fff;color:#202125;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:24px}
.wrap{width:340px;text-align:center}
.logo{color:#009de0;font-size:2.6rem;font-weight:800;letter-spacing:-.03em;line-height:1}
.tag{color:#202125;font-size:1.05rem;font-weight:600;margin:14px 0 4px}
.lead{color:#717173;font-size:.95rem;line-height:1.45;margin:0 0 4px}
.steps{list-style:none;padding:0;margin:16px 0 20px;text-align:left}
.steps li{display:flex;gap:10px;align-items:flex-start;margin:8px 0;color:#4b5563;font-size:.92rem}
.steps .n{flex:0 0 22px;height:22px;border-radius:50%;background:#e6f5fc;color:#009de0;font-weight:700;font-size:.8rem;display:flex;align-items:center;justify-content:center}
.pinlbl{color:#717173;font-size:.85rem;margin:0 0 8px}
input{width:100%;box-sizing:border-box;font-size:1.3rem;text-align:center;letter-spacing:.3em;padding:12px;border:1px solid #e4e4e5;border-radius:8px}
button{width:100%;margin-top:10px;padding:12px;background:#009de0;color:#fff;border:none;border-radius:8px;font-size:1rem;font-weight:600;cursor:pointer}
.err{color:#e0453a;font-size:.9rem;margin-top:10px}
.foot{color:#a3a3a3;font-size:.78rem;margin-top:18px}
.extnote{background:#eef8fc;border:1px solid #cfeaf7;border-radius:10px;padding:12px 14px;margin:16px 0 0;font-size:.85rem;color:#333;line-height:1.45;text-align:left}
.extnote.extok{background:#edf9f1;border-color:#bfe6cc}
.extnote .dot{display:inline-block;width:10px;height:10px;border-radius:50%;background:#1aa35b;margin-right:8px;vertical-align:middle;box-shadow:0 0 0 3px #d3f0dd}
.extnote .sub{color:#717173;font-size:.8rem}
.extbtn{display:inline-block;margin-top:8px;background:#009de0;color:#fff;padding:8px 14px;border-radius:8px;font-weight:600;text-decoration:none;font-size:.85rem}
.woltbox{margin:18px 0 0;padding:18px 16px 20px;border:1px solid #e4e4e5;border-radius:12px;text-align:center;background:#fff}
.woltbox .sub{font-size:.84rem;color:#717173;line-height:1.5;margin:10px 0 14px}
.woltlogo{display:flex;justify-content:center;align-items:center}
.woltbtn{display:inline-block;background:#fff;color:#009de0;border:2px solid #009de0;padding:11px 26px;border-radius:10px;font-weight:700;text-decoration:none;font-size:.95rem}
.woltbtn:hover{background:#eef8fc}
@media (max-width:640px){ .extnote{display:none} }</style></head><body>
<div class="wrap">
  <div class="logo">🍴 malica</div>
  <div class="tag">Skupaj naročimo malico prek Wolta</div>
  <p class="lead">Brez zbiranja naročil po chatu — vsi izberejo na enem mestu, eden naroči.</p>
  <ol class="steps">
    <li><span class="n">1</span><div>Nekdo predlaga restavracijo.</div></li>
    <li><span class="n">2</span><div>Vsak si izbere, kaj bo jedel.</div></li>
    <li><span class="n">3</span><div>Eden naroči na Woltu, Malica pa izračuna, kdo komu koliko dolguje.</div></li>
  </ol>
  <form method="post" action="/pin">
    <div class="pinlbl">config.PIN tvoje skupine</div>
    <input name="pin" type="password" inputmode="numeric" autofocus autocomplete="one-time-code">
    <button>Vstopi</button>__ERR__
  </form>
  __EXT__
  <script>
  // Razširitev Malica ↔ Wolt ob nalaganju pošlje sporočilo "ready" → pokaži zelen status namesto poziva.
  window.addEventListener('message', function(ev){
    if(ev.source!==window || !ev.data || ev.data.malicaWolt!=='ready') return;
    var n=document.getElementById('extnote'); if(!n) return;
    n.className='extnote extok';
    n.innerHTML='<span class="dot"></span><b>Razširitev Malica ↔ Wolt je nameščena</b>'+(ev.data.version?' <span class="sub">v'+String(ev.data.version).replace(/[^0-9.]/g,'')+'</span>':'')+'<br>Kdor naroča, z enim klikom prenese vse jedi v svojo Wolt košarico.';
  });
  </script>
  <div class="woltbox">
    <div class="woltlogo"><img src="/wolt-logo.png" alt="Wolt" height="34"></div>
    <div class="sub">Tisti, ki naroča, odda skupno naročilo s svojim Wolt računom. Prijavi se na Woltu v novem zavihku in se potem vrni sem.</div>
    <a class="woltbtn" href="https://wolt.com/sl/login" target="_blank" rel="noopener">Prijava v Wolt ↗</a>
  </div>
  <div class="foot">Samo za tvoje sodelavce — noter prideš s config.PIN-om. Malica ni povezana z Woltom.</div>
</div></body></html>"""

EXT_NOTE = """<div class="extnote" id="extnote">💻 <b>Na računalniku (Chrome ali Edge):</b> namesti razširitev <b>Malica ↔ Wolt</b> — kdor naroča, z enim klikom prenese vse jedi v svojo Wolt košarico.<br><a class="extbtn" href="%s" target="_blank" rel="noopener">Namesti razširitev ↗</a></div>"""


def _pin_page(start_response, error=""):
    page = PIN_PAGE.replace("__ERR__", '<div class="err">%s</div>' % error if error else "")
    page = page.replace("__EXT__", (EXT_NOTE % config.EXT_URL) if config.EXT_URL else "")
    body = page.encode("utf-8")
    start_response("200 OK", [("Content-Type", "text/html; charset=utf-8"), ("Content-Length", str(len(body)))])
    return [body]
