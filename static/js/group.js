// Group-decision days: "eat out" plans and polls. Ordering days live in views.js/modals.js.
// renderOut / renderPoll are called from renderDay(); the modals are opened from the start chooser.

const KIND_ICON = { order: '🍽', out: '🚶', poll: '🗳' };

// ---------- start chooser ----------
// Opened by "+ Predlagaj": pick how today is decided before anything else.
function startModal() {
  if (!me) { welcomeModal(); return; }
  openModal(`<div class="body"><h2>Kaj danes?</h2>
    <p class="desc">Izberi, kako se ekipa danes odloči.</p>
    <div class="start-grid">
      <button class="start-card" data-start="order"><span class="ic">🍽</span><b>Že odločeno: naročamo na Wolt</b><small>Vsak izbere jed, eden naroči, Malica razdeli strošek.</small></button>
      <button class="start-card" data-start="out"><span class="ic">🚶</span><b>Že odločeno: gremo ven</b><small>Kraj in ura, vsak potrdi, ali gre zraven.</small></button>
      <button class="start-card" data-start="poll"><span class="ic">🗳</span><b>Anketa — naj se sodelavci odločijo</b><small>Predlagaj opcije, vsi glasujejo; zmagovalec postane načrt.</small></button>
    </div></div>`);
  $('.modal').addEventListener('click', e => {
    const b = e.target.closest('[data-start]'); if (!b) return;
    const k = b.dataset.start;
    if (k === 'order') pickerModal();
    else if (k === 'out') outModal();
    else pollCreateModal();
  });
}

// ---------- eat out ----------
function outModal(existing) {
  const d = existing || {};
  openModal(`<div class="body"><h2>${existing ? 'Uredi načrt' : 'Gremo ven'}</h2>
    <form id="outForm">
      <div class="opt"><label>Kam gremo?</label><input name="restaurant" required maxlength="80" value="${esc(d.restaurant || '')}" placeholder="npr. Foculus, burek pri parku, kitajec…"></div>
      <div class="opt row">
        <div><label>Ob kateri uri</label><input name="outTime" maxlength="20" value="${esc(d.outTime || '')}" placeholder="npr. 12:30"></div>
        <div><label>Datum</label><input name="date" type="date" value="${esc(d.date || todayIso())}"></div>
      </div>
      <div class="opt"><label>Povezava na Wolt (neobvezno)</label><input name="url" maxlength="500" value="${esc(d.url || '')}" placeholder="https://wolt.com/… (za oceno in naslov)"></div>
    </form></div>
    <div class="foot"><button class="btn primary" id="outSave">${existing ? 'Shrani' : 'Predlagaj'}</button></div>`);
  $('#outSave').addEventListener('click', async () => {
    const f = $('#outForm'); if (!f.reportValidity()) return;
    const b = Object.fromEntries(new FormData(f)); $('#outSave').disabled = true;
    try {
      if (existing) { await mutate(`/api/days/${existing.id}`, { restaurant: b.restaurant, outTime: b.outTime, date: b.date, url: b.url }); }
      else { const s = await mutate('/api/days', { kind: 'out', restaurant: b.restaurant, outTime: b.outTime, date: b.date, url: b.url, proposedBy: me }); currentDayId = s.days[s.days.length - 1].id; localStorage.setItem('wolt.day', currentDayId); }
    } catch (e) { const x = $('#outSave'); if (x) x.disabled = false; return; }
    closeModal(); render(); toast(existing ? '✓ Shranjeno' : '✓ Predlagano');
  });
}

// equal split of a shared bill among the people who are going
function outSplit(day) {
  const total = +day.grandTotal || 0;
  const att = (day.going && day.going.length) ? day.going : (day.payer ? [day.payer] : []);
  const share = att.length ? Math.round(total / att.length * 100) / 100 : 0;
  const rows = att.map(p => ({ person: p, total: p === day.payer ? 0 : share })).sort((a, b) => a.person.localeCompare(b.person));
  return { rows, share, total, att };
}

function renderOut(day) {
  const v = day.venue || {};
  const going = day.going || [], skip = day.skip || [];
  const iGo = me && going.includes(me), iSkip = me && skip.includes(me);
  const total = +day.grandTotal || 0;
  let html = `<div class="venue-block">${v.image?`<div class="hero" style="background-image:url('${esc(img(v.image, 1200))}')"></div>`:''}
    <div class="venue-head"><div style="min-width:0">
      <h1>🚶 ${esc(day.restaurant)}</h1>
      <div class="meta">
        <span class="status open">● Gremo ven</span>
        <span>${dateLong(day.date)}</span>
        ${day.outTime ? `<span>🕐 ${esc(day.outTime)}</span>` : ''}
        ${v.rating ? `<span>⭐ ${v.rating}</span>` : ''}
        ${(v.url || day.url) ? `<a href="${esc(v.url || day.url)}" target="_blank" rel="noopener">Wolt ↗</a>` : ''}
        ${day.poll && day.poll.closed ? `<span title="Ta načrt je zmagal v anketi">🗳 izbrano z anketo</span>` : ''}
      </div></div>
      <div class="actions"><div class="dd"><button class="btn" data-act="daymenu">Načrt ▾</button>
        <div class="dd-menu" id="dayMenu">
          <div class="dd-head"><b>${esc(day.restaurant)}</b><span class="sub">gremo ven · ${going.length} ${plural(going.length, 'gre', 'gresta', 'gredo', 'gre')}</span></div>
          <button data-act="editday"><i>✎</i><span>Uredi načrt<small>kraj, ura, datum</small></span></button>
          <div class="dd-sep"></div>
          <button class="danger" data-delday="${day.id}"><i>🗑</i><span>Izbriši ta načrt</span></button>
        </div></div></div>
    </div></div>`;

  html += `<div class="card"><h3>Kdo gre?</h3>
    <div class="who-list">${going.length ? going.map(n => `<span class="who-chip in">${esc(n)}${n === me ? ' (jaz)' : ''}</span>`).join('') : '<span class="sub">Še nihče ni potrdil.</span>'}</div>
    ${skip.length ? `<div class="sub" style="margin-top:8px">Ne morejo: ${skip.map(esc).join(', ')}</div>` : ''}
    ${me ? `<div class="attend-btns">
      <button class="btn ${iGo ? 'primary' : ''}" data-act="attend" data-going="1">✓ Grem zraven</button>
      <button class="btn ${iSkip ? 'danger-soft' : ''}" data-act="attend" data-going="0">Ne morem</button>
    </div>` : `<p class="sub" style="margin-top:10px">Izberi svoje ime zgoraj, da potrdiš.</p>`}
  </div>`;

  if (!total) {
    html += `<div class="card"><h3>Skupni račun <span class="sub">(neobvezno)</span></h3>
      <p class="sub" style="margin:-6px 0 10px">Če ste imeli skupno mizo in je en plačal, vpiši znesek — Malica ga enako razdeli med tiste, ki so šli.</p>
      <button class="btn" data-act="out-bill">💶 Dodaj skupni račun</button></div>`;
  } else {
    const s = outSplit(day), payer = day.payer;
    html += `<div class="card"><div class="meta"><span>Račun <b>${fmt(s.total)}</b></span><span>${s.att.length} ${plural(s.att.length, 'oseba', 'osebi', 'osebe', 'oseb')}</span><span>Na osebo <b>${fmt(s.share)}</b></span>${payer ? `<span>Plačal/a <b>${esc(payer)}</b></span>` : ''}<button class="btn sm" style="margin-left:auto" data-act="out-bill">Uredi</button></div></div>`;
    const others = s.rows.filter(r => r.person !== payer);
    if (others.length) {
      html += `<h3 style="margin:18px 0 8px">Kdo koliko nakaže</h3>
        <p class="sub" style="margin:-6px 0 10px">Vsak odkljuka, ko ${esc(payer || 'plačniku')} nakaže svoj delež.</p>
        <div class="table-wrap"><table><thead><tr><th>Oseba</th><th class="num">Nakaže</th><th>Poravnano</th></tr></thead><tbody>`;
      for (const r of s.rows) {
        const isPayer = r.person === payer, paid = isPayer || day.paid.includes(r.person);
        html += `<tr class="${paid && !isPayer ? 'paid' : ''} ${r.person === me ? 'mine' : ''}"><td><b>${esc(r.person)}</b>${isPayer ? '<span class="pill-badge">plačnik</span>' : ''}</td><td class="num">${isPayer ? '<span class="sub">—</span>' : `<b>${fmt(r.total)}</b>`}</td><td>${isPayer ? '<span class="sub">—</span>' : `<input type="checkbox" data-paid="${esc(r.person)}" ${paid ? 'checked' : ''} style="width:20px;height:20px;accent-color:var(--blue)">`}</td></tr>`;
      }
      html += `</tbody></table></div>`;
    }
  }
  return html;
}

function outBillModal(day) {
  openModal(`<div class="body"><h2>Skupni račun</h2>
    <p class="desc">${esc(day.restaurant)} · ${(day.going || []).length} ${plural((day.going || []).length, 'oseba', 'osebi', 'osebe', 'oseb')} gre. Znesek se enako razdeli mednje.</p>
    <form id="obForm">
      <div class="opt"><label>Skupni znesek (€)</label><input name="grandTotal" type="number" step="0.01" min="0" inputmode="decimal" value="${day.grandTotal || ''}" style="font-size:1.25rem"></div>
      <div class="opt"><label>Kdo je plačal</label><select name="payer">${['', ...state.people].map(p => `<option value="${esc(p)}" ${(day.payer || '') === p ? 'selected' : ''}>${p ? esc(p) : '— izberi —'}</option>`).join('')}</select></div>
    </form></div>
    <div class="foot"><button class="btn primary" id="obSave">Shrani</button></div>`);
  $('#obSave').addEventListener('click', async () => {
    const b = Object.fromEntries(new FormData($('#obForm')));
    await mutate(`/api/days/${day.id}`, { grandTotal: +b.grandTotal || 0, payer: b.payer });
    closeModal(); render(); toast('✓ Shranjeno');
  });
}

// ---------- poll ----------
function pollCreateModal() {
  openModal(`<div class="body"><h2>🗳 Nova anketa</h2>
    <p class="desc">Vprašaj ekipo. Opcije lahko doda vsak; ti dodaš prvo.</p>
    <form id="pollForm">
      <div class="opt"><label>Vprašanje</label><input name="q" maxlength="80" value="Kaj danes jemo?"></div>
      <div class="opt"><label>Prva opcija (neobvezno)</label>
        <div class="seg" id="pcSeg"><button type="button" class="seg-btn active" data-optkind="out">🚶 Ven</button><button type="button" class="seg-btn" data-optkind="order">🍽 Naročamo</button></div>
        <input name="opt" maxlength="80" placeholder="npr. Foculus / Pizza Wolt" style="margin-top:6px">
      </div>
    </form></div>
    <div class="foot"><button class="btn primary" id="pollSave">Začni anketo</button></div>`);
  $('#pcSeg').addEventListener('click', e => { const b = e.target.closest('.seg-btn'); if (!b) return; $('#pcSeg').querySelectorAll('.seg-btn').forEach(x => x.classList.toggle('active', x === b)); });
  $('#pollSave').addEventListener('click', async () => {
    const b = Object.fromEntries(new FormData($('#pollForm'))); $('#pollSave').disabled = true;
    let s; try { s = await mutate('/api/days', { kind: 'poll', restaurant: b.q, proposedBy: me }); } catch (e) { const x = $('#pollSave'); if (x) x.disabled = false; return; }
    const id = s.days[s.days.length - 1].id; currentDayId = id; localStorage.setItem('wolt.day', id);
    if (b.opt && b.opt.trim()) { const kind = $('#pcSeg .seg-btn.active').dataset.optkind; try { await mutate(`/api/days/${id}/poll-option`, { label: b.opt.trim(), optKind: kind, person: me }); } catch (e) {} }
    closeModal(); render(); toast('✓ Anketa začeta');
  });
}

function renderPoll(day) {
  const poll = day.poll || { options: [] };
  const opts = [...poll.options].sort((a, b) => b.votes.length - a.votes.length);
  const totalVotes = poll.options.reduce((a, o) => a + o.votes.length, 0);
  const maxV = Math.max(1, ...poll.options.map(o => o.votes.length));
  let html = `<div class="venue-block"><div class="venue-head"><div style="min-width:0">
      <h1>🗳 ${esc(day.restaurant)}</h1>
      <div class="meta"><span class="status open">● Anketa</span><span>${dateLong(day.date)}</span>${day.proposedBy ? `<span>predlagal/a ${esc(day.proposedBy)}</span>` : ''}<span>${totalVotes} ${plural(totalVotes, 'glas', 'glasova', 'glasovi', 'glasov')}</span></div>
    </div>
    <div class="actions"><div class="dd"><button class="btn" data-act="daymenu">Anketa ▾</button>
      <div class="dd-menu" id="dayMenu">
        <div class="dd-head"><b>${esc(day.restaurant)}</b><span class="sub">anketa · ${poll.options.length} ${plural(poll.options.length, 'opcija', 'opciji', 'opcije', 'opcij')}</span></div>
        <button data-act="editday"><i>✎</i><span>Uredi vprašanje</span></button>
        <div class="dd-sep"></div>
        <button class="danger" data-delday="${day.id}"><i>🗑</i><span>Izbriši anketo</span></button>
      </div></div></div></div></div>`;
  html += `<p class="sub">Izberi eno opcijo (lahko spremeniš). Kdorkoli lahko doda opcijo. Ko je zmagovalec jasen, klikni <b>Zaključi</b> — Malica iz njega naredi načrt.</p><div class="poll">`;
  if (!opts.length) html += `<div class="empty" style="padding:24px">Še ni opcij — dodaj prvo spodaj.</div>`;
  for (const o of opts) {
    const mine = me && o.votes.includes(me);
    const pct = Math.round(o.votes.length / maxV * 100);
    html += `<div class="poll-opt ${mine ? 'mine' : ''}" data-pollvote="${o.id}">
      <div class="poll-bar" style="width:${pct}%"></div>
      <span class="poll-radio">${mine ? '●' : '○'}</span>
      <span class="poll-label">${KIND_ICON[o.kind] || '🚶'} ${esc(o.label)}${o.kind === 'order' ? '<span class="sub"> · Wolt</span>' : ''}${(o.by || o.votes.length) ? `<div class="sub">${o.by ? 'predlagal/a ' + esc(o.by) : ''}${o.by && o.votes.length ? ' · ' : ''}${o.votes.length ? 'glasovali: ' + o.votes.map(esc).join(', ') : ''}</div>` : ''}</span>
      <span class="poll-count">${o.votes.length}</span>
      <button class="poll-x" data-pollremove="${o.id}" title="Odstrani opcijo">×</button>
    </div>`;
  }
  html += `</div>
    <div class="card" style="margin-top:14px"><h3>Dodaj opcijo</h3>
      <div class="poll-add">
        <div class="seg" id="pollSeg"><button type="button" class="seg-btn active" data-optkind="out">🚶 Ven</button><button type="button" class="seg-btn" data-optkind="order">🍽 Naročamo</button></div>
        <div class="row2"><input id="pollOptLabel" maxlength="80" autocomplete="off" placeholder="npr. Foculus / burek / Pizza Wolt"><button class="btn primary" data-act="poll-add">+ Dodaj</button></div>
        <div class="poll-sug" id="pollSug"></div><div class="sub" id="pollPicked"></div>
      </div>
    </div>
    <button class="btn primary poll-close-btn" data-act="poll-close" ${poll.options.length ? '' : 'disabled'}>✓ Zaključi in izberi zmagovalca</button>`;
  return html;
}

// ---------- competing proposals ----------
// Two or more proposals for the same date render as a mini-poll above the day view:
// tap a card to back it (one vote per person per date, tap again to retract),
// "Poglej" switches to that proposal without voting. Real polls are excluded.
function votePanel(rivals){
  const maxV = Math.max(1, ...rivals.map(d => (d.votes||[]).length));
  const opts = rivals.map(d => {
    const votes = d.votes||[]; const mine = me && votes.includes(me);
    const icon = (d.kind||'order')==='out' ? '<em class="tag-k k-out">🚶 ven</em>' : '<em class="tag-k k-order">🛵 Wolt</em>';
    const cur = d.id===currentDayId;
    return `<div class="poll-opt ${mine?'mine':''}" data-dayvote="${d.id}">
      <div class="poll-bar" style="width:${Math.round(votes.length/maxV*100)}%"></div>
      <span class="poll-radio">${mine?'●':'○'}</span>
      <span class="poll-label">${icon} ${esc(d.restaurant)}${(d.kind||'order')==='out'&&d.outTime?` <span class="sub">ob ${esc(d.outTime)}</span>`:''}${votes.length?`<div class="sub">glasovali: ${votes.map(esc).join(', ')}</div>`:''}</span>
      <span class="poll-count">${votes.length}</span>
      ${cur?'':`<button class="btn sm ghost" data-day="${d.id}">Poglej ›</button>`}
    </div>`;
  }).join('');
  return `<div class="card votepanel"><h3>🗳 Danes: ${rivals.length} ${plural(rivals.length,'predlog','predloga','predlogi','predlogov')} — kateri ti paše?</h3>
    <p class="sub" style="margin:-4px 0 10px">Tapni svojega favorita (glas lahko kadar koli prestaviš). Obvelja tisti z največ glasovi.</p>
    <div class="poll">${opts}</div></div>`;
}

// Wolt autocomplete for poll options: with "Naročamo" selected, typing searches the
// same venue list as the restaurant picker, so the winning option already carries
// the venue (menu opens right after the poll closes).
let pollVenuePick = null;
function pollPickNote(){ const m = $('#pollPicked'); if(m) m.textContent = pollVenuePick ? '✓ Restavracija z Wolta — ob zmagi se takoj odpre njen meni.' : ''; }
async function pollSuggest(){
  const box = $('#pollSug'), inp = $('#pollOptLabel'); if(!box || !inp) return;
  const seg = $('#pollSeg .seg-btn.active'); const q = inp.value.trim();
  if(!seg || seg.dataset.optkind !== 'order' || q.length < 2){ box.innerHTML = ''; return; }
  if(!venuesCache){ try{ venuesCache = await api('/api/wolt/venues', null, true); }catch(e){ return; } }
  const vs = (venuesCache.venues||[]).filter(v => matches(q, v.name)).slice(0, 6);
  box.innerHTML = vs.map(v => `<button type="button" class="poll-sug-item" data-sugslug="${esc(v.slug||v.name)}">
    ${v.image?`<img src="${esc(img(v.image,80))}" alt="">`:''}<span>${esc(v.name)}</span>${v.rating?`<span class="sub">⭐ ${v.rating}</span>`:''}${v.online===false?'<span class="sub">zaprto</span>':''}</button>`).join('');
}
document.addEventListener('input', e => {
  if(e.target.id !== 'pollOptLabel') return;
  pollVenuePick = null; pollPickNote(); pollSuggest();
});
document.addEventListener('click', e => {
  const b = e.target.closest('[data-sugslug]');
  if(!b){ if(!e.target.closest('.poll-add')) { const x=$('#pollSug'); if(x) x.innerHTML=''; } return; }
  const v = (venuesCache && venuesCache.venues || []).find(x => (x.slug||x.name) === b.dataset.sugslug);
  if(!v) return;
  pollVenuePick = v; const inp = $('#pollOptLabel'); if(inp) inp.value = v.name;
  const box = $('#pollSug'); if(box) box.innerHTML = ''; pollPickNote();
});
