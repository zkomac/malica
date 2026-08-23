// Admin panel: groups, change log, version restore.
async function adminApi(path, body){
  const tok = sessionStorage.getItem('adminTok')||'';
  const r = await fetch(path, {method: body?'POST':'GET', headers:{'Content-Type':'application/json','X-Admin':tok}, body: body?JSON.stringify(body):undefined});
  const j = await r.json().catch(()=>({error:'Napaka'}));
  if(r.status===403){ sessionStorage.removeItem('adminTok'); closeModal(); adminModal(); throw new Error('auth'); }
  if(!r.ok){ toast(j.error||'Napaka'); throw new Error(j.error); }
  return j;
}
function adminModal(){
  if(!sessionStorage.getItem('adminTok')){
    openModal(`<div class="body"><h2>🛠 Admin</h2><p class="desc">Vnesi admin kodo (ni isto kot PIN skupine).</p>
      <form id="adminLogin"><input name="pin" type="password" inputmode="numeric" autofocus placeholder="admin koda" style="font-size:1.2rem;text-align:center;letter-spacing:.2em"></form></div>
      <div class="foot"><button class="btn primary" id="adminGo" style="flex:1">Odkleni</button></div>`);
    const go = async ()=>{ const pin=$('#adminLogin').pin.value; const r=await fetch('/api/admin/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pin})}); const j=await r.json(); if(!r.ok){ toast(j.error||'Napaka'); return; } sessionStorage.setItem('adminTok', j.token); closeModal(); setTimeout(adminModal,300); };
    $('#adminGo').addEventListener('click', go); $('#adminLogin').addEventListener('submit', e=>{ e.preventDefault(); go(); });
    return;
  }
  let view='groups', gid=null;
  openModal(`<div class="picker-head"><h2>🛠 Admin</h2><div class="tabs" style="position:static;margin:0"><button class="active" data-av="groups">Skupine</button><button data-av="log">Dnevnik sprememb</button><button data-av="versions">Različice</button></div></div><div class="picker-body" id="ab"><div class="spinner">Nalagam…</div></div>`, true);
  const groupSel = (gs, cur) => `<div class="row" style="margin-bottom:12px"><div><label>Skupina</label><select id="agSel">${gs.map(g=>`<option value="${esc(g.id)}" ${g.id===cur?'selected':''}>${esc(g.name)} (PIN ${esc(g.pin)})</option>`).join('')}</select></div></div>`;
  const draw = async ()=>{
    const d = await adminApi('/api/admin/groups'); gid = gid || d.active || d.groups[0]?.id;
    let h='';
    if(view==='groups'){
      h += `<div class="card"><h3>Nova skupina</h3><form id="agNew" class="row"><div><label>Ime</label><input name="name" placeholder="npr. Pro Plus – marketing" required></div><div><label>PIN (4–8 številk)</label><input name="pin" inputmode="numeric" pattern="\\d{4,8}" required></div><div class="auto"><button class="btn primary">Ustvari</button></div></form></div>`;
      for(const g of d.groups){
        h += `<div class="card"><h3 style="display:flex;align-items:center;gap:10px">${esc(g.name)} <span class="pill-badge">PIN ${esc(g.pin)}</span>${g.id===d.active?'<span class="sub">(trenutna)</span>':''}</h3>
          <div class="meta" style="margin-bottom:8px"><span>${g.people.length} ${plural(g.people.length,'oseba','osebi','osebe','oseb')}</span><span>${g.days} dni</span><span>📍 ${esc(g.location)}</span>${g.last?`<span>zadnja sprememba ${esc(g.last.replace('T',' ').replace(/[+-]\d\d:\d\d$/,''))}</span>`:''}</div>
          <div style="margin-bottom:10px">${g.people.map(p=>`<span class="tag">${esc(p)} <button type="button" class="tagx" data-rmperson="${esc(p)}" data-gid="${esc(g.id)}" title="Odstrani osebo iz skupine">×</button></span>`).join('')||'<span class="sub">še nihče</span>'}</div>
          <form class="row agEdit" data-gid="${esc(g.id)}"><div><label>Ime</label><input name="name" value="${esc(g.name)}"></div><div><label>PIN</label><input name="pin" value="${esc(g.pin)}" inputmode="numeric" pattern="\\d{4,8}"></div><div class="auto"><button class="btn">Shrani</button></div></form></div>`;
      }
    } else if(view==='log'){
      h += groupSel(d.groups, gid);
      const {log} = await adminApi(`/api/admin/group/${gid}/log`);
      h += log.length ? `<div class="table-wrap"><table><thead><tr><th>Kdaj</th><th>Kdo</th><th>Kaj</th></tr></thead><tbody>${log.map(e=>`<tr class="${/IZBRISAL|OBNOVIL|NAPAKA/.test(e.text)?'mine':''}"><td class="sub" style="white-space:nowrap">${esc(e.ts.replace('T',' ').replace(/[+-]\d\d:\d\d$/,''))}</td><td><b>${esc(e.who)}</b></td><td>${esc(e.text)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">Dnevnik je prazen.</div>';
    } else {
      h += groupSel(d.groups, gid) + `<p class="sub">Pred vsako spremembo se shrani prejšnje stanje. Obnovitev vrne skupino v izbrano stanje (tudi ta korak se zabeleži in ga je mogoče razveljaviti).</p>`;
      const {versions} = await adminApi(`/api/admin/group/${gid}/versions`);
      h += versions.length ? `<div class="table-wrap"><table><thead><tr><th>Stanje pred</th><th class="num">Dni</th><th class="num">Naročil</th><th class="num">Oseb</th><th></th></tr></thead><tbody>${versions.map(v=>`<tr><td>${esc(v.id.replace(/^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2}).*/,'$3. $2. $1 $4:$5:$6'))}</td><td class="num">${v.days}</td><td class="num">${v.orders}</td><td class="num">${v.people}</td><td class="num"><button class="btn sm" data-restore="${esc(v.id)}">Obnovi</button></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">Ni shranjenih različic.</div>';
    }
    const ab=$('#ab'); if(ab) ab.innerHTML=h;
  };
  draw();
  const m=$('.modal');
  m.addEventListener('click', async e=>{
    const t=e.target.closest('[data-av]'); if(t){ view=t.dataset.av; [...m.querySelectorAll('[data-av]')].forEach(x=>x.classList.toggle('active',x===t)); draw(); return; }
    const x=e.target.closest('[data-rmperson]'); if(x){ if(!confirm(`Odstranim osebo „${x.dataset.rmperson}“ iz skupine? Njena pretekla naročila ostanejo v zgodovini.`)) return; await adminApi(`/api/admin/group/${x.dataset.gid}/removeperson`,{name:x.dataset.rmperson}); toast('✓ Oseba odstranjena'); lastJson=''; refresh(); draw(); return; }
    const r=e.target.closest('[data-restore]'); if(r){ if(!confirm('Obnovim to različico? Trenutno stanje bo shranjeno kot različica.')) return; await adminApi(`/api/admin/group/${gid}/restore`,{version:r.dataset.restore}); toast('✓ Obnovljeno'); lastJson=''; refresh(); draw(); }
  });
  m.addEventListener('change', e=>{ if(e.target.id==='agSel'){ gid=e.target.value; draw(); } });
  m.addEventListener('submit', async e=>{
    e.preventDefault(); const f=e.target; const d=Object.fromEntries(new FormData(f));
    if(f.id==='agNew'){ await adminApi('/api/admin/groups', d); toast('✓ Skupina ustvarjena'); draw(); }
    else if(f.classList.contains('agEdit')){ await adminApi(`/api/admin/group/${f.dataset.gid}`, d); toast('✓ Shranjeno'); draw(); }
  });
}
