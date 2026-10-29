const app=require('../bench/env.js');
const ac=require('../assembly_check.js');
const cat=app.__catalog; ac.setCatalog(cat);
let tot=0,ok=0,no=0;
const rows=[];
for(const k of Object.keys(cat)){
  const arr=cat[k]; if(!Array.isArray(arr)) continue;
  let o=0,n=0,ex=[];
  arr.forEach(it=>{ if(!it||!it.id) return; tot++; const r=ac.portsOf(Object.assign({},it),true); if(!r){n++; no++; if(ex.length<2) ex.push(String(it.name||it.id).slice(0,55));} else {o++; ok++;} });
  if(n) rows.push([k,o,n,ex.join(' ¦ ')]);
}
console.log('всего',tot,'известно',ok,'нет данных',no);
rows.sort((a,b)=>b[2]-a[2]);
rows.forEach(r=>console.log(r.join(' | ')));
