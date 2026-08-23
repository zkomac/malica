// Cost split: food subtotal, extra costs (delivery, fees, tips) and per-person totals.
// ---------- obračun ----------
function calc(day){
  const f = day.fees || {};
  const per = {};
  for(const o of day.orders) per[o.person] = (per[o.person]||0) + o.price*o.qty;
  const people = Object.keys(per);
  const subtotal = people.reduce((a,p)=>a+per[p],0);
  // če je vpisan skupni znesek naročila, je doplačilo razlika do jedi; sicer stare postavke
  const extra = (day.grandTotal!=null && +day.grandTotal>0) ? Math.round((+day.grandTotal - subtotal)*100)/100
    : (+f.delivery||0) + (+f.service||0) + (+f.tip||0) - (+f.discount||0);
  const rows = people.map(p=>{
    const raw = !people.length ? 0 : (day.feeSplit!=='equal' && subtotal>0 ? extra*per[p]/subtotal : extra/people.length);
    return {person:p, items:per[p], share: Math.round(raw*100)/100};
  }).sort((a,b)=>a.person.localeCompare(b.person));
  if(rows.length){ const diff = Math.round((extra - rows.reduce((a,r)=>a+r.share,0))*100)/100; const tgt = rows.find(r=>r.person===day.payer) || rows[rows.length-1]; tgt.share = Math.round((tgt.share+diff)*100)/100; }
  for(const r of rows) r.total = Math.round((r.items + r.share)*100)/100;
  return {rows, subtotal, extra, total: subtotal+extra};
}
