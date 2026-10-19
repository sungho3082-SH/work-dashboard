// ════════════════════════════════════════════════════════════════
//  개발 프로젝트 관리 대시보드 v4 — Supabase 연동
//  홈 / 타임라인(동그라미 플로우 + 세로 5컬럼) / BOM / To-Do
// ════════════════════════════════════════════════════════════════

// ── 상태 ──
let sb = null;
let projects = [], schedules = [], boms = [], todos = [], attachments = [];
let ptasks = [];                   // project_tasks — 부품별 체크 항목 기록
let schedMap = {};                 // car_model → car_schedules 행
let hasSched = true, hasBom = true, hasCk = true, hasOpenDate = true;   // 마이그레이션 여부
let hasTasks = true, hasPm = true;
let carColor = {}, _ci = 0;

let curView = 'main';
let tlSup = '전체', tlCar = '전체';
let tlOpen = {};                   // 차종 펼침
let selPid = null;                 // 선택된 부품(확장 패널)
let bomCur = null, bomExp = {}, bomSup = null;
let todoFilter = 'all';
let modalCallback = null;
let bigCtx = null;                 // 확대 편집 중인 {pid,k}

const today = stripTime(new Date());

// ── 상수 ──
const STAGES = [
  { k:'proto', n:'Proto', pos:0,   c:'#38bdf8' },
  { k:'p1',    n:'P1',    pos:.25, c:'#2dd4bf' },
  { k:'p2',    n:'P2',    pos:.5,  c:'#4ade80' },
  { k:'m',     n:'M',     pos:.75, c:'#a3e635' },
  { k:'sop',   n:'SOP',   pos:1,   c:'#fbbf24' }
];
const CKS = [
  { k:'ck_all_tool',  n:'All Tool',  s:'AT',   pos:.375, ph:'p1' },
  { k:'ck_full_tool', n:'Full Tool', s:'FT',   pos:.625, ph:'p2' },
  { k:'ck_audit',     n:'공정감사',   s:'감사',  pos:.70,  ph:'p2' },
  { k:'ck_full_capa', n:'Full CAPA', s:'CAPA', pos:.84,  ph:'m'  }
];
const CAR_PAL = ['#6366f1','#0ea5e9','#14b8a6','#f59e0b','#f43f5e','#ec4899',
                 '#8b5cf6','#84cc16','#06b6d4','#eab308','#22c55e','#fb7185'];
const STAGE_SOFT = {
  proto:['rgba(56,189,248,.16)','#7dd3fc'], p1:['rgba(45,212,191,.16)','#5eead4'],
  p2:['rgba(74,222,128,.16)','#86efac'],    m:['rgba(163,230,53,.16)','#bef264'],
  sop:['rgba(251,191,36,.16)','#fcd34d'],   none:['rgba(255,255,255,.06)','#94a2be']
};

// ── 유틸 ──
const $ = id => document.getElementById(id);
function stripTime(d){ return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
function toDate(s){ if(!s) return null; const v=String(s).slice(0,10); const d=new Date(v+'T00:00:00'); return isNaN(d)?null:d; }
function ymd(d){ return d ? d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0') : ''; }
function md(d){ return d ? (d.getMonth()+1)+'/'+d.getDate() : ''; }
function clean(v){ return v ? String(v).slice(0,10) : ''; }
// 화면 표시는 전부 YYYY/MM/DD, DB 에는 YYYY-MM-DD 로 저장
function slash(v){ return clean(v).replace(/-/g,'/'); }
function ymdS(d){ return slash(ymd(d)); }
// 입력 해석: 2026/10/01 · 2026-10-01 · 10/01(올해) 전부 허용
// 반환 — 'YYYY-MM-DD' | null(비움) | undefined(형식 오류)
function parseDateInput(v){
  const t=String(v==null?'':v).trim();
  if(!t) return null;
  let m=t.match(/^(\d{4})[\/.\-](\d{1,2})[\/.\-](\d{1,2})$/);
  if(m) return `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`;
  m=t.match(/^(\d{1,2})[\/.\-](\d{1,2})$/);            // 연도 생략 → 올해
  if(m) return `${today.getFullYear()}-${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}`;
  m=t.match(/^(\d{4})(\d{2})(\d{2})$/);                // 20261001
  if(m) return `${m[1]}-${m[2]}-${m[3]}`;
  return undefined;
}
function addDays(d,n){ const x=new Date(d); x.setDate(x.getDate()+n); return x; }
function daysUntil(d){ return d ? Math.ceil((d-today)/86400000) : null; }
function esc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function attr(s){ return esc(s).replace(/"/g,'&quot;'); }
function getColor(s){ if(!s) return '#64748b'; if(!carColor[s]){ carColor[s]=CAR_PAL[_ci%CAR_PAL.length]; _ci++; } return carColor[s]; }
function setConn(cls,msg){ const el=$('connStatus'); el.className='chip-s '+cls; $('connText').textContent=msg; }
function showLoading(m){ $('loadingText').textContent=m||'처리 중...'; $('loading').classList.remove('hidden'); }
function hideLoading(){ $('loading').classList.add('hidden'); }
function viewImg(src){ $('viewerImg').src=src; $('viewer').classList.add('on'); }
// 지금 글자가 드래그로 선택돼 있는가
function hasSelection(){
  const s=window.getSelection();
  return !!(s && s.type==='Range' && String(s).trim());
}
function isImg(n){ return /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(n||''); }

// ── 첨부: 업로드 파일 vs 외부 링크 ──
const MAX_UPLOAD = 50*1024*1024;        // Supabase 무료 플랜 파일당 한도
const IMG_MAX_EDGE = 2000, IMG_QUALITY = .85;
// 우리 Storage 주소가 아니면 외부 링크로 취급
function isExternal(a){
  const u=a&&a.file_url||'';
  return !!u && (typeof SUPABASE_URL==='undefined' || u.indexOf(SUPABASE_URL)!==0);
}
function linkSource(url){
  const u=String(url||'').toLowerCase();
  if(u.includes('sharepoint.com')||u.includes('-my.sharepoint'))   return 'SharePoint';
  if(u.includes('onedrive.live.com')||u.includes('1drv.ms'))       return 'OneDrive';
  if(u.includes('drive.google.com')||u.includes('docs.google.com'))return 'Google Drive';
  if(u.includes('dropbox.com'))                                    return 'Dropbox';
  try{ return new URL(url).hostname.replace(/^www\./,''); }catch(e){ return '링크'; }
}
function fmtSize(b){ return b>=1048576 ? (b/1048576).toFixed(1)+'MB' : Math.max(1,Math.round(b/1024))+'KB'; }
// 사진은 올리기 전에 줄인다 (긴 변 2000px, JPEG 85%)
async function shrinkImage(file){
  if(!/^image\//.test(file.type) || /svg|gif/i.test(file.type)) return file;
  if(file.size < 400*1024) return file;                 // 이미 작으면 그대로
  try{
    const bmp = await createImageBitmap(file, { imageOrientation:'from-image' });
    const scale = Math.min(1, IMG_MAX_EDGE/Math.max(bmp.width, bmp.height));
    const w=Math.round(bmp.width*scale), h=Math.round(bmp.height*scale);
    const cv=document.createElement('canvas'); cv.width=w; cv.height=h;
    cv.getContext('2d').drawImage(bmp,0,0,w,h);
    const blob=await new Promise(r=>cv.toBlob(r,'image/jpeg',IMG_QUALITY));
    if(!blob || blob.size>=file.size) return file;      // 오히려 커지면 원본
    return new File([blob], file.name.replace(/\.[^.]+$/,'')+'.jpg', { type:'image/jpeg' });
  }catch(e){ console.warn('이미지 압축 실패, 원본 업로드', e); return file; }
}
function askDate(label, cur){
  const v = prompt(label+'\n2026/10/01 형식 (10/01 처럼 연도 생략 가능)\n비우면 삭제(생략 처리)', slash(cur)||'');
  if(v===null) return undefined;                 // 취소
  const r = parseDateInput(v);
  if(r===undefined){ alert('날짜 형식이 올바르지 않습니다.\n예: 2026/10/01 또는 10/01'); return undefined; }
  return r;                                      // null 이면 삭제
}

// ════════ 일정 (차종 단위) ════════
// car_schedules 가 있으면 그걸, 없으면 projects 컬럼에서 유도
function schedOf(car){
  const out = { start:{}, skip:{} };
  const row = schedMap[car];
  if(row){
    STAGES.forEach(s=>{ out.start[s.k] = row[s.k+'_skip'] ? null : toDate(row[s.k+'_start']); out.skip[s.k] = !!row[s.k+'_skip']; });
    out.volume = row.volume;
  } else {
    const parts = projects.filter(p=>p.car_model===car);
    STAGES.forEach(s=>{
      let best=null, skip=true;
      parts.forEach(p=>{ if(p[s.k+'_skip']) return; const d=toDate(p[s.k+'_start']); if(d){ skip=false; if(!best||d<best) best=d; } });
      out.start[s.k]=best; out.skip[s.k]=!best;
    });
    out.volume = (parts[0]||{}).volume;
  }
  return out;
}
// 활성 단계 목록 + 종료일
function nodesOf(car){
  const sc = schedOf(car);
  const nodes = STAGES.map(s=>({ ...s, start:sc.start[s.k], skip:!sc.start[s.k] }));
  const act = nodes.filter(n=>n.start);
  act.forEach((n,i)=>{
    n.end = n.k==='sop' ? addDays(n.start,100)
          : i===act.length-1 ? addDays(n.start,45)
          : addDays(act[i+1].start,-1);
  });
  return { nodes, act, sc };
}
// 오늘 위치를 단계 사이 비율로 보간
function posOfDate(dt, nodes){
  const a = nodes.filter(n=>n.start);
  if(!a.length) return 0;
  if(dt<=a[0].start) return a[0].pos;
  for(let i=0;i<a.length-1;i++){
    if(dt>=a[i].start && dt<=a[i+1].start)
      return a[i].pos + (a[i+1].pos-a[i].pos)*((dt-a[i].start)/(a[i+1].start-a[i].start));
  }
  return a[a.length-1].pos;
}
// 차종 대표 체크포인트 = 부품들 중 가장 빠른 날짜
function ckOf(parts){
  const out={};
  CKS.forEach(c=>{
    let best=null;
    (parts||[]).forEach(p=>{ const d=toDate(p[c.k]); if(d && (!best||d<best)) best=d; });
    out[c.k]=best;
  });
  return out;
}
// 부품의 현재 단계
function curStageOf(car){
  const { nodes, act } = nodesOf(car);
  if(!act.length) return { key:null, label:'일정 미정' };
  let idx=-1; nodes.forEach((n,i)=>{ if(n.start && n.start<=today) idx=i; });
  if(idx<0) return { key:null, label:act[0].n+' 전' };
  const last = act[act.length-1];
  if(nodes[idx].k==='sop' || today>last.end) return { key:'sop', label:'SOP' };
  return { key:nodes[idx].k, label:nodes[idx].n };
}

// ════════ 플로우 (동그라미 + 화살표) ════════
function flowHtml(car, parts, size){
  const big  = size!=='sm';
  const wrapC = big ? 'flow'   : 'h-flow';
  const L = big ? p=>`calc(26px + (100% - 42px) * ${p})`
                : p=>`calc(8px + (100% - 18px) * ${p})`;
  const { nodes, act } = nodesOf(car);
  const cks = ckOf(parts);
  let curGI=-1; nodes.forEach((n,i)=>{ if(n.start && n.start<=today) curGI=i; });
  const tp = act.length ? posOfDate(today,nodes) : 0;

  let h = `<div class="${wrapC}"><div class="rail"></div>`;

  // ★ 체크포인트
  if(hasCk) CKS.forEach(c=>{
    const ps = nodes.find(n=>n.k===c.ph);
    const past = ps && ps.start && ps.start<=today;
    const cd = cks[c.k];
    const cls = 'fchk' + (past?'':' future') + (cd?'':' none');
    const tip = c.n + (cd ? ' : '+ymdS(cd) : ' : 미실시');
    h += `<div class="${cls}" style="left:${L(c.pos)}" title="${attr(tip)}">
            <div class="flbl"><div class="fd">${cd?md(cd):''}</div><div class="fl">${big?c.n:c.s}</div></div>
            <div class="st">★</div></div>`;
  });

  // 단계 원 + 라벨
  nodes.forEach((nd,i)=>{
    let cls='circ';
    if(nd.skip) cls+=' skip';
    else { if(nd.start<=today) cls+=' done'; if(i===curGI) cls+=' cur'; }
    h += `<div class="${cls}" style="left:${L(nd.pos)};--c:${nd.c}" title="${attr(nd.n+(nd.start?' : '+ymdS(nd.start):' : 생략'))}"></div>`;
    const dcls = big ? 'sd edit' : 'sd';
    h += `<div class="stg${nd.skip?' skip':''}" style="left:${L(nd.pos)}">
            <div class="${dcls}" ${big?`data-a="sched" data-car="${attr(car)}" data-k="${nd.k}"`:''}>${nd.skip?'—':md(nd.start)}</div>
            <div class="sl">${nd.n}</div></div>`;
  });

  // TODAY ▶ + 다음 단계
  let nx='', done=false;
  if(!act.length){ nx='일정 미정'; }
  else {
    const nxt = nodes.find(n=>n.start && n.start>today);
    if(today<act[0].start){
      const d=daysUntil(act[0].start); nx=`${act[0].n}까지 D-${d}`;
      h += `<div class="tdmark" style="left:${L(tp)}"><div class="dd">D-${d}</div><div class="tri">▶</div></div>`;
    } else if(nxt){
      const d=daysUntil(nxt.start); nx=`${nxt.n}까지 D-${d}`;
      h += `<div class="tdmark" style="left:${L(tp)}"><div class="dd">D-${d}</div><div class="tri">▶</div></div>`;
    } else {
      nx='SOP 단계'; done=true;
      h += `<div class="tdmark" style="left:${L(1)}"><div class="tri">▶</div></div>`;
    }
  }
  h += '</div>';
  return { html:h, nx, done };
}

// ════════ 이슈 텍스트 ════════
function issueHtml(txt){
  return esc(txt).replace(/\((\d{1,2}\/\d{1,2})\)/g,
    '<span style="display:inline-block;font-size:10.5px;font-weight:700;color:#a5b4fc;border:1px solid #39456b;padding:0 7px;border-radius:5px;">$1</span>');
}
// (MM/DD) 단위로 섹션 분할 + 날짜 필터 칩
function issueSections(txt){
  const s=String(txt||''), re=/\((\d{1,2}\/\d{1,2})\)/g, marks=[]; let m;
  while((m=re.exec(s))) marks.push({ date:m[1], start:m.index });
  const secs=[];
  if(!marks.length){ secs.push({ date:'', text:s }); }
  else {
    if(marks[0].start>0){ const pre=s.slice(0,marks[0].start).trim(); if(pre) secs.push({date:'',text:pre}); }
    for(let i=0;i<marks.length;i++){
      const end = i+1<marks.length ? marks[i+1].start : s.length;
      secs.push({ date:marks[i].date, text:s.slice(marks[i].start,end).trim() });
    }
  }
  const dates=[...new Set(marks.map(x=>x.date))];
  const bar = dates.length>1
    ? `<div class="dfbar"><span class="dfchip on" data-d="">전체</span>${dates.map(d=>`<span class="dfchip" data-d="${d}">${d}</span>`).join('')}</div>`
    : '';
  const body = `<div class="itx">${secs.map(sec=>`<div class="isec" data-date="${sec.date}">${issueHtml(sec.text)}</div>`).join('')}</div>`;
  return bar+body;
}
function dfClick(chip){
  const bar=chip.parentNode, item=chip.closest('.iitem');
  const chips=[...bar.querySelectorAll('.dfchip')], allChip=chips.find(c=>c.dataset.d==='');
  if(chip===allChip){ chips.forEach(c=>c.classList.toggle('on', c===allChip)); }
  else {
    allChip.classList.remove('on'); chip.classList.toggle('on');
    if(!chips.some(c=>c.dataset.d!=='' && c.classList.contains('on'))) allChip.classList.add('on');
  }
  const allOn=allChip.classList.contains('on');
  const active=new Set(chips.filter(c=>c.classList.contains('on')&&c.dataset.d!=='').map(c=>c.dataset.d));
  item.querySelectorAll('.isec').forEach(sec=>{
    sec.style.display = (allOn||active.has(sec.dataset.date)) ? '' : 'none';
  });
}
// 부품의 단계별 이슈 목록
function stageIssues(p){
  return STAGES.filter(s=>{ const v=p[s.k+'_issue']; return v && String(v).trim() && String(v).trim()!=='-'; })
               .map(s=>({ stage:s, text:p[s.k+'_issue'] }));
}
function photosOf(pid, stage){
  return attachments.filter(a=>a.project_id===pid && !a.todo_id && !a.ptask_id && (stage===undefined || a.stage===stage));
}
// 이슈그룹으로 묶기 (같은 내용 반복 방지)
function collapseGroup(list){
  const map={}, out=[];
  list.forEach(x=>{
    const g=x.issue_group;
    if(g){ if(!map[g]){ map[g]={rep:x,members:[]}; out.push(map[g]); } map[g].members.push(x); }
    else out.push({ rep:x, members:[x] });
  });
  return out;
}

// ════════════════════════════════════════════════════════════════
//  로드
// ════════════════════════════════════════════════════════════════
async function loadAll(){
  // PostgREST 는 한 번에 1000행까지만 주므로 끝까지 페이지로 받아온다
  const q = async (t, order) => {
    try{
      const PAGE=1000; let out=[], from=0;
      for(;;){
        let b=sb.from(t).select('*');
        if(order) b=b.order(order);
        const { data, error } = await b.range(from, from+PAGE-1);
        if(error) return { ok:false, error };
        out = out.concat(data||[]);
        if(!data || data.length < PAGE) break;
        from += PAGE;
      }
      return { ok:true, data:out };
    }catch(e){ return { ok:false, error:e }; }
  };
  const [pr,sc,bm,td,at,pt] = await Promise.all([
    q('projects','sort_order'), q('car_schedules','sort_order'), q('bom','id'),
    q('todos','sort_order'), q('attachments','created_at'), q('project_tasks','id')
  ]);

  if(!pr.ok){ setConn('err','불러오기 실패'); console.error(pr.error); alert('프로젝트 불러오기 실패: '+(pr.error.message||pr.error)); return; }
  projects = pr.data;
  hasCk = !!(projects[0] && ('ck_all_tool' in projects[0]));
  hasSched = sc.ok; schedules = sc.ok ? sc.data : [];
  hasBom   = bm.ok; boms      = bm.ok ? bm.data : [];
  todos = td.ok ? td.data : [];
  attachments = at.ok ? at.data : [];
  hasOpenDate = !todos.length || ('open_date' in todos[0]);
  hasTasks = pt.ok; ptasks = pt.ok ? pt.data : [];
  hasPm = !projects.length || ('pm' in projects[0]);

  schedMap = {}; schedules.forEach(r=>{ schedMap[r.car_model]=r; });
  projects.forEach(p=>getColor(p.car_model));

  // 마이그레이션 안내
  const miss=[];
  if(!hasSched) miss.push('car_schedules 테이블');
  if(!hasBom)   miss.push('bom 테이블');
  if(!hasCk)    miss.push('체크포인트 컬럼');
  if(!hasOpenDate) miss.push('todos.open_date 컬럼');
  if(!hasTasks) miss.push('project_tasks 테이블');
  if(!hasPm)    miss.push('projects.pm 컬럼');
  if(miss.length){ $('migWhat').textContent = miss.join(' / ')+' 없음'; $('migBanner').classList.add('on'); }
  else $('migBanner').classList.remove('on');

  setConn('ok', `연결됨 · 부품 ${projects.length}`);
  if(!bomCur){ const cars=[...new Set(boms.map(b=>b.car_model))]; bomCur = cars[0]||null; }
  renderAll();
  // 주소 끝이 #p=부품번호[&s=단계&a=항목] 이면 그 부품 상세를 바로 연다
  const m=/^#p=(\d+)(?:&s=(\w+))?(?:&a=(\d+))?/.exec(location.hash||'');
  if(m && !$('pjOverlay').classList.contains('on')){
    openPj(Number(m[1]), m[2]);
    if(m[3]){ pj.act=Number(m[3]); renderPj(); }
  }
}
function renderAll(){
  renderMain(); renderHome(); renderTimeline(); renderBOM(); renderTodos();
  if(pj.pid && $('pjOverlay').classList.contains('on')) renderPj();
}

// ════════════════════════════════════════════════════════════════
//  홈
// ════════════════════════════════════════════════════════════════
function renderHome(){
  // KPI
  const cars=[...new Set(projects.map(p=>p.car_model))];
  let sop90=0, issued=0;
  cars.forEach(c=>{ const s=schedOf(c).start.sop; if(s){ const d=daysUntil(s); if(d>=0&&d<=90) sop90++; } });
  projects.forEach(p=>{ if(stageIssues(p).length) issued++; });
  $('kpis').innerHTML = `
    <div class="kpi"><div class="l">전체 부품</div><div class="v">${projects.length}</div><div class="s">${cars.length}개 차종</div></div>
    <div class="kpi"><div class="l">협력사</div><div class="v">${new Set(projects.map(p=>p.supplier_name).filter(Boolean)).size}</div><div class="s">공급망 기준</div></div>
    <div class="kpi warn"><div class="l">SOP 90일 이내</div><div class="v">${sop90}</div><div class="s">차종 기준</div></div>
    <div class="kpi risk"><div class="l">이슈 기록 있음</div><div class="v">${issued}</div><div class="s">전체 ${projects.length}개 중</div></div>`;

  // 차종 → 협력사 → 부품
  const byCar={}, order=[];
  projects.forEach(p=>{
    const cm=p.car_model||'(미지정)';
    if(!byCar[cm]){ byCar[cm]={ order:[], sup:{} }; order.push(cm); }
    const c=byCar[cm], s=p.supplier_name||'(미지정)';
    if(!c.sup[s]){ c.sup[s]=[]; c.order.push(s); }
    c.sup[s].push(p);
  });

  const box=$('homeRows'); box.innerHTML='';
  if(!order.length){ box.innerHTML='<tr><td colspan="3" class="empty">등록된 프로젝트가 없습니다.</td></tr>'; return; }

  order.forEach(cm=>{
    const c=byCar[cm], col=getColor(cm);
    const allParts=c.order.reduce((a,s)=>a.concat(c.sup[s]),[]);
    const { html, nx, done } = flowHtml(cm, allParts, 'sm');
    const nSup=c.order.length;
    c.order.forEach((sup,si)=>{
      const parts=c.sup[sup];
      const tr=document.createElement('tr');
      let cells='';
      if(si===0){
        cells += `<td class="h-tinfo" style="--c:${col}" rowspan="${nSup}">
            <div class="h-cm">${esc(cm)}</div>
            <div class="h-meta">${allParts.length}개 · ${esc(c.order.join('/'))}</div>
            <div class="h-nx${done?' done':''}">${esc(nx)}</div></td>`;
        cells += `<td class="h-tflow" rowspan="${nSup}">${html}</td>`;
      }
      cells += `<td class="hiss">
          <div style="font-size:10px;font-weight:700;color:var(--sub);margin-bottom:5px;">${esc(sup)} · ${parts.length}개</div>
          ${homeIssueCell(parts)}</td>`;
      tr.innerHTML=cells;
      box.appendChild(tr);
    });
  });
}
function homeIssueCell(parts){
  const withIss = parts.filter(p=>stageIssues(p).length);
  if(!withIss.length) return '<span class="noiss">— 이슈 없음</span>';
  return collapseGroup(withIss).map(g=>{
    const rep=g.rep;
    const nm=esc(rep.part_name||'-');
    const names = g.members.length>1 ? `${nm} <span class="imore">외 ${g.members.length-1}개</span>` : nm;
    const pics = [].concat(...g.members.map(m=>photosOf(m.id)));
    const thumbs = pics.length
      ? `<div class="ithumbs">${pics.slice(0,6).map(a=>(!isExternal(a)&&isImg(a.file_name||a.file_url))
          ? `<img class="ith" src="${attr(a.file_url)}" data-a="view" data-url="${attr(a.file_url)}">`
          : '').join('')}</div>`
      : '';
    // 썸네일은 첫 항목 안에 넣어야 float 이 td 밖으로 새지 않는다
    return stageIssues(rep).map((si,i)=>{
      const [bg,fg]=STAGE_SOFT[si.stage.k];
      return `<div class="iitem${i>0?' isep':''}">${i===0?thumbs:''}<div class="itop">
          <span class="ispill" style="background:${bg};color:${fg}">${si.stage.n}</span>
          <span class="inm">${names}</span>
          <span class="isup">${esc(rep.part_number||'')}</span></div>
          ${issueSections(si.text)}</div>`;
    }).join('');
  }).join('');
}

// ════════════════════════════════════════════════════════════════
//  QRM 체크 항목 (qrm_data.js) — 부품 × 활동 × 단계
// ════════════════════════════════════════════════════════════════
const QACT = {}; (typeof QRM!=='undefined' ? QRM.acts : []).forEach(a=>{ QACT[a.no]=a; });
const STAGE_MS = { proto:'CAAV · PRKF · REQF · SOCO · DESF', p1:'IARV · TOGO · OFTO', p2:'OTOP',
                   m:'FDPR · ISVA', sop:'SOPR · SOP · PRCL' };
const ST_ICON = { plan:'☐', doing:'◧', done:'∎', late:'▲', na:'–' };
const ST_NAME = { plan:'계획', doing:'진행', done:'완료', late:'지연', na:'제외' };
let qLang = (()=>{ try{ return localStorage.getItem('qrm_lang')||'en'; }catch(e){ return 'en'; } })();

function stageActs(stage){ return (typeof QRM!=='undefined' ? QRM.acts : []).filter(a=>a.stages.includes(stage)); }
function taskRow(pid, no, stage){ return ptasks.find(t=>t.project_id===pid && t.act_no===no && t.stage===stage); }
// 적용 여부: 직접 고른 값이 없으면 추천(개발 관점) 여부를 따른다
function isApplicable(pid, a, stage){
  const r=taskRow(pid, a.no, stage);
  return (r && r.applicable!==null && r.applicable!==undefined) ? r.applicable : a.rec;
}
function taskState(pid, a, stage){
  if(!isApplicable(pid,a,stage)) return 'na';
  const r=taskRow(pid, a.no, stage), s=(r&&r.status)||'plan';
  if(s!=='done' && r && r.plan_date && toDate(r.plan_date)<today) return 'late';
  return s;
}
function stageProgress(pid, stage){
  const acts=stageActs(stage).filter(a=>isApplicable(pid,a,stage));
  const done=acts.filter(a=>{ const r=taskRow(pid,a.no,stage); return r && r.status==='done'; }).length;
  return { n:acts.length, done };
}
function projProgress(pid){
  let n=0, done=0;
  STAGES.forEach(s=>{ const p=stageProgress(pid,s.k); n+=p.n; done+=p.done; });
  return { n, done, pct: n ? Math.round(done*100/n) : 0 };
}
function tx(a, f){ return (a[qLang]&&a[qLang][f]) || a.en[f] || ''; }
function catName(k){ const c=QRM.cats.find(x=>x.k===k); return c ? c[qLang] : k; }
function ymd2(d){ return d ? String(d.getFullYear()).slice(2)+'/'+String(d.getMonth()+1).padStart(2,'0')+'/'+String(d.getDate()).padStart(2,'0') : ''; }

// ════════════════════════════════════════════════════════════════
//  HOME — 차종 ▸ 부품 엑셀형 표 + 월별 현황
// ════════════════════════════════════════════════════════════════
let gClosed = (()=>{ try{ return JSON.parse(localStorage.getItem('g_closed')||'{}'); }catch(e){ return {}; } })();
let gSort = { k:null, dir:1 };
let gScrolled = false;
function saveClosed(){ try{ localStorage.setItem('g_closed', JSON.stringify(gClosed)); }catch(e){} }

// 표에 그릴 월 범위 — 올해 1월부터, 마지막 SOP 가 들어가는 해 12월까지 (최대 4년)
function monthRange(cars){
  const y0=today.getFullYear(); let y1=y0+1;
  cars.forEach(c=>{ STAGES.forEach(s=>{ const d=schedOf(c).start[s.k]; if(d && d.getFullYear()>y1) y1=d.getFullYear(); }); });
  y1=Math.min(y1, y0+3);
  const out=[]; for(let y=y0;y<=y1;y++) for(let m=0;m<12;m++) out.push({ y, m });
  return out;
}
function monIdx(d, months){ if(!d) return -1; return months.findIndex(x=>x.y===d.getFullYear() && x.m===d.getMonth()); }

function dateCls(car){
  const { nodes } = nodesOf(car);
  const nxt = nodes.find(n=>n.start && n.start>today);
  const out={};
  nodes.forEach(n=>{
    if(!n.start){ out[n.k]={ cls:'skip', txt:'—' }; return; }
    const d=daysUntil(n.start);
    let cls = d<0 ? 'past' : d<=30 ? 'soon' : d<=90 ? 'near' : '';
    if(nxt && nxt.k===n.k) cls+=' next';
    out[n.k]={ cls, txt:ymd2(n.start), d };
  });
  return out;
}

function renderMain(){
  const box=$('gScroll'); if(!box) return;
  const q=($('gSearch').value||'').trim().toLowerCase();
  const hit=p=>!q || [p.car_model,p.part_name,p.part_number,p.supplier_name,p.pm].some(v=>v && String(v).toLowerCase().includes(q));

  const byCar={}, order=[];
  projects.filter(hit).forEach(p=>{
    const cm=p.car_model||'(미지정)';
    if(!byCar[cm]){ byCar[cm]=[]; order.push(cm); }
    byCar[cm].push(p);
  });
  if(gSort.k){
    order.sort((a,b)=>{
      const da=schedOf(a).start[gSort.k], db=schedOf(b).start[gSort.k];
      if(!da && !db) return 0; if(!da) return 1; if(!db) return -1;
      return (da-db)*gSort.dir;
    });
  }
  const nParts=order.reduce((s,c)=>s+byCar[c].length,0);
  $('gStat').innerHTML=`<span><b>${order.length}</b> 차종</span><span><b>${nParts}</b> 부품</span>`;
  if(!order.length){ box.innerHTML='<div class="empty">'+(q?'검색 결과가 없습니다.':'등록된 프로젝트가 없습니다.')+'</div>'; return; }

  const months=monthRange(order);
  const nowI=monIdx(today, months);

  // ── 머리글 (2줄: 연도 / 월) ──
  const sortTh=(k,n)=>`<th class="c-dt sortable${gSort.k===k?' sorted':''}" rowspan="2" data-sort="${k}" title="눌러서 정렬">${n}${gSort.k===k?(gSort.dir>0?' ▲':' ▼'):''}</th>`;
  let yrs='', mons='';
  [...new Set(months.map(m=>m.y))].forEach(y=>{ yrs+=`<th colspan="12" class="c-mon ystart">${y}</th>`; });
  months.forEach((m,i)=>{ mons+=`<th class="c-mon${i===nowI?' now':''}${m.m===0?' ystart':''}">${m.m+1}</th>`; });
  let h=`<table class="gt"><thead>
    <tr><th class="c-tog" rowspan="2"></th><th class="c-name" rowspan="2" style="text-align:left">차종 / 부품</th>
      <th class="c-sup" rowspan="2">협력사</th><th class="c-pm" rowspan="2">PM</th><th class="c-step" rowspan="2">Step</th>
      ${STAGES.map(s=>sortTh(s.k,s.n)).join('')}
      <th class="c-prog" rowspan="2">진행률</th>${yrs}</tr>
    <tr class="r2">${mons}</tr></thead><tbody>`;

  order.forEach(cm=>{
    const parts=byCar[cm], col=getColor(cm), open=!gClosed[cm] || !!q;
    const dc=dateCls(cm), sc=schedOf(cm);
    const cur=curStageOf(cm);
    const sups=[...new Set(parts.map(p=>p.supplier_name).filter(Boolean))];
    const pms=[...new Set(parts.map(p=>p.pm).filter(Boolean))];
    let n=0, done=0; parts.forEach(p=>{ const r=projProgress(p.id); n+=r.n; done+=r.done; });
    const pct = n ? Math.round(done*100/n) : 0;

    // 월 칸: 단계 시작 칩
    const mcell = months.map((m,i)=>{
      const chips = STAGES.filter(s=>monIdx(sc.start[s.k],months)===i).map(s=>
        `<span class="mchip${sc.start[s.k]<today?' past':''}" style="background:${s.c}" title="${s.n} ${ymdS(sc.start[s.k])}">${s.n==='Proto'?'Pr':s.n}</span>`).join('');
      return `<td class="c-mon${i===nowI?' now':''}${m.m===0?' ystart':''}">${chips}</td>`;
    }).join('');

    h+=`<tr class="gcar${open?' open':''}" data-car="${attr(cm)}">
      <td class="c-tog"><span class="tri2">▶</span></td>
      <td class="c-name"><span class="cbar2" style="background:${col}"></span>${esc(cm)}<span class="cnt">${parts.length}개</span></td>
      <td class="c-sup" title="${attr(sups.join(', '))}">${esc(sups.join(', '))}</td>
      <td class="c-pm" style="cursor:default">${esc(pms.join(', '))}</td>
      <td class="c-step"><span class="tstep" style="background:${(STAGE_SOFT[cur.key]||STAGE_SOFT.none)[0]};color:${(STAGE_SOFT[cur.key]||STAGE_SOFT.none)[1]}">${esc(cur.label)}</span></td>
      ${STAGES.map(s=>`<td class="c-dt"><span class="dcell ${dc[s.k].cls}" ${dc[s.k].d!==undefined?`title="${dc[s.k].d<0?'지남':'D-'+dc[s.k].d}"`:''}>${dc[s.k].txt}</span></td>`).join('')}
      <td class="c-prog"><div class="oprog"><div class="bar"><i style="width:${pct}%"></i></div>${n?pct+'%':'—'}</div></td>
      ${mcell}</tr>`;

    if(!open) return;
    parts.forEach(p=>{
      const pr=projProgress(p.id);
      const stepKey=(p.step||'').toLowerCase().replace(' ','');
      const sk=STAGES.find(s=>s.n.toLowerCase()===stepKey);
      const [bg,fg]=sk ? STAGE_SOFT[sk.k] : STAGE_SOFT.none;
      const stCells=STAGES.map(s=>{
        const g=stageProgress(p.id, s.k);
        if(!g.n) return `<td class="c-dt"><span class="sprog none">—</span></td>`;
        const w=Math.round(g.done*100/g.n);
        return `<td class="c-dt"><span class="sprog${g.done===g.n?' full':''}" style="--c:${s.c}">${g.done}/${g.n}<span class="bar"><i style="width:${w}%"></i></span></span></td>`;
      }).join('');
      const mcellP = months.map((m,i)=>{
        const stars = (hasCk?CKS:[]).filter(c=>monIdx(toDate(p[c.k]),months)===i).map(c=>{
          const d=toDate(p[c.k]);
          return `<span class="mstar${d<today?' past':''}" title="${attr(c.n+' '+ymdS(d))}">★</span>`;
        }).join('');
        return `<td class="c-mon${i===nowI?' now':''}${m.m===0?' ystart':''}">${stars}</td>`;
      }).join('');
      h+=`<tr class="gpart" data-p="${p.id}">
        <td class="c-tog"></td>
        <td class="c-name" title="${attr((p.part_name||'')+' '+(p.part_number||''))}"><span class="pn">${esc(p.part_name||'-')}</span><span class="pno2">${esc(p.part_number||'')}</span></td>
        <td class="c-sup">${esc(p.supplier_name||'')}</td>
        <td class="c-pm" data-pm="${p.id}" title="눌러서 PM 지정">${p.pm?esc(p.pm):'<span class="ph">+</span>'}</td>
        <td class="c-step">${p.step?`<span class="tstep" style="background:${bg};color:${fg}">${esc(p.step)}</span>`:''}</td>
        ${stCells}
        <td class="c-prog"><div class="oprog"><div class="bar"><i style="width:${pr.pct}%"></i></div>${pr.n?pr.pct+'%':'—'}</div></td>
        ${mcellP}</tr>`;
    });
  });
  h+='</tbody></table>';
  box.innerHTML=h;

  // 처음 한 번은 이번 달이 보이도록 가로 스크롤
  if(!gScrolled && nowI>=0){
    const th=box.querySelector('thead tr.r2 th.now');
    if(th){ box.scrollLeft=Math.max(0, th.offsetLeft-box.clientWidth*0.55); gScrolled=true; }
  }
}
function onMainClick(e){
  const sortTh=e.target.closest('th[data-sort]');
  if(sortTh){
    const k=sortTh.dataset.sort;
    if(gSort.k===k){ if(gSort.dir>0) gSort.dir=-1; else gSort={k:null,dir:1}; }
    else gSort={ k, dir:1 };
    renderMain(); return;
  }
  const pmTd=e.target.closest('td[data-pm]');
  if(pmTd){ editPm(Number(pmTd.dataset.pm)); return; }
  const car=e.target.closest('tr.gcar');
  if(car){ const cm=car.dataset.car; gClosed[cm]=!gClosed[cm]; saveClosed(); renderMain(); return; }
  const part=e.target.closest('tr.gpart');
  if(part){ if(hasSelection()) return; openPj(Number(part.dataset.p)); }
}
function editPm(pid){
  if(!hasPm){ alert('PM 칸을 쓰려면 migration.sql 의 마지막 부분(2026-10-19)을 Supabase SQL Editor 에서 실행해 주세요.'); return; }
  const p=projects.find(x=>x.id===pid); if(!p) return;
  openModal(`PM 지정 — ${p.part_name||''}`, fieldHtml('pm','PM 이름',p.pm,'예: 홍길동'), async()=>{
    const v=document.querySelector('#modalFields [data-k="pm"]').value.trim()||null;
    if(await updateProject(pid,{ pm:v })){ closeModal(); renderAll(); }
  });
  setTimeout(()=>{ const el=document.querySelector('#modalFields [data-k="pm"]'); if(el) el.focus(); },60);
}

// ════════════════════════════════════════════════════════════════
//  부품 상세 — 단계 도식 → 체크 항목 → 목적 · 결과 · 첨부
// ════════════════════════════════════════════════════════════════
const pj = { pid:null, stage:null, act:null, showAll:false, snap:null };
const HB_LBL = {
  en:{ why:'Why', what:'What', how:'How this activity must be performed', input:'Key input', deliverable:'Deliverable',
       leader:'Activity leader', support:'Key support', rasic:'RASIC', refs:'Templates & procedures' },
  ko:{ why:'목적 (Why)', what:'내용 (What)', how:'수행 방법 (How)', input:'주요 입력', deliverable:'산출물',
       leader:'주관', support:'지원', rasic:'RASIC', refs:'양식 · 절차' }
};

function openPj(pid, stage){
  const p=projects.find(x=>x.id===pid); if(!p) return;
  pj.pid=pid; pj.act=null; pj.snap=null;
  pj.stage = stage || curStageOf(p.car_model).key || 'proto';
  loadSize($('pjBox'),'pj');
  $('pjOverlay').classList.add('on');
  renderPj();
}
function pjDirty(){
  const ta=$('pjResult');
  return !!(ta && pj.snap!==null && ta.value!==pj.snap);
}
async function pjLeave(){
  if(!pjDirty()) return true;
  if(confirm('결과 입력란에 저장하지 않은 내용이 있습니다.\n\n[확인] 저장하고 이동\n[취소] 저장하지 않고 이동')){
    return await saveResult();
  }
  pj.snap=null; return true;
}
async function closePj(){
  if(!await pjLeave()) return;
  $('pjOverlay').classList.remove('on');
  pj.pid=null; pj.act=null; pj.snap=null;
}
function setLang(l){ qLang=l; try{ localStorage.setItem('qrm_lang',l); }catch(e){} renderPj(); }

function renderPj(){
  const p=projects.find(x=>x.id===pj.pid); if(!p){ $('pjOverlay').classList.remove('on'); return; }
  const col=getColor(p.car_model);
  const keepRes = $('pjResult') ? $('pjResult').value : null;   // 다시 그려도 쓰던 글은 유지
  const keepSnap = pj.snap;

  // ── 머리 ──
  $('pjHead').innerHTML=`
    <div class="ep-badge" style="background:${col};">${esc(p.car_model)}</div>
    <div>
      <div><span class="ep-title">${esc(p.part_name||'-')}</span> <span class="ep-no">${esc(p.part_number||'')}</span></div>
      <div class="ep-meta">${esc(p.supplier_name||'-')} · PM <b>${esc(p.pm||'-')}</b>${p.step?` · Step <b>${esc(p.step)}</b>`:''}</div>
    </div>
    <div class="x">
      <span class="lang-tog" title="Handbook 설명 언어"><button data-lang="en" class="${qLang==='en'?'on':''}">EN</button><button data-lang="ko" class="${qLang==='ko'?'on':''}">한국어</button></span>
      <button class="btn-xs" data-a="editbasic" data-p="${p.id}"><i class="ti ti-pencil"></i> 기본정보</button>
      <button class="btn-x" id="pjClose" title="닫기 (Esc)">✕</button>
    </div>`;

  // ── 단계 도식 ──
  const { nodes } = nodesOf(p.car_model);
  let f='';
  STAGES.forEach((s,i)=>{
    const nd=nodes.find(n=>n.k===s.k);
    const g=stageProgress(p.id, s.k);
    let badge='', bst='';
    if(!nd.start){ badge='생략'; bst='background:#1e2739;color:var(--muted)'; }
    else {
      const d=daysUntil(nd.start), de=daysUntil(nd.end);
      if(d>0){ badge='D-'+d; bst='background:rgba(251,191,36,.14);color:#fcd34d'; }
      else if(de<0){ badge='지남'; bst='background:#1e2739;color:var(--sub)'; }
      else { badge='진행 중'; bst='background:rgba(99,102,241,.2);color:#a5b4fc'; }
    }
    const w=g.n?Math.round(g.done*100/g.n):0;
    f+=`<div class="pjs${pj.stage===s.k?' on':''}${nd.start?'':' skip'}" style="--c:${s.c}" data-pjstage="${s.k}">
        <div class="nm"><b>${s.n}</b><span class="st" style="${bst}">${badge}</span></div>
        <div class="dt">${nd.start?ymdS(nd.start):'일정 없음'}</div>
        <div class="pr"><span class="bar"><i style="width:${w}%"></i></span>${g.done}/${g.n}</div>
        <div class="ms">${STAGE_MS[s.k]}</div></div>`;
    if(i<STAGES.length-1){
      const nx=STAGES[i+1];
      const cks=(hasCk?CKS:[]).filter(c=>c.pos>s.pos && c.pos<nx.pos);
      f+=`<div class="pjarrow">${cks.map(c=>{ const d=toDate(p[c.k]);
          return `<span class="ckp${d?'':' none'}" data-a="ck" data-p="${p.id}" data-f="${c.k}" title="${attr(c.n)} — 눌러서 날짜 입력">★ ${esc(c.s)}<br>${d?md(d):'—'}</span>`; }).join('')}<span>→</span></div>`;
    }
  });
  $('pjFlow').innerHTML=f;

  // ── 항목 목록 ──
  const st=STAGES.find(s=>s.k===pj.stage);
  const acts=stageActs(pj.stage);
  const vis=acts.filter(a=>pj.showAll || isApplicable(p.id,a,pj.stage));
  const hiddenN=acts.length-acts.filter(a=>isApplicable(p.id,a,pj.stage)).length;
  if(pj.act && !vis.some(a=>a.no===pj.act)) pj.act=null;
  if(!pj.act && vis.length) pj.act=vis[0].no;
  const g=stageProgress(p.id, pj.stage);
  let L=`<div class="pjl-top"><span class="tstep" style="background:${STAGE_SOFT[st.k][0]};color:${STAGE_SOFT[st.k][1]}">${st.n}</span>
      <span class="ttl">체크 항목 · ${g.done}/${g.n} 완료</span>
      <label title="이 단계에 해당하는 Handbook 항목을 모두 보여주고, 필요한 것을 이 부품에 추가할 수 있습니다">
        <input type="checkbox" id="pjShowAll" ${pj.showAll?'checked':''}> Handbook 전체 보기${hiddenN?` (+${hiddenN})`:''}</label></div>`;
  if(!acts.length) L+='<div class="pjd-empty">이 단계에 해당하는 항목이 없습니다.</div>';
  QRM.cats.forEach(c=>{
    const items=vis.filter(a=>a.cat===c.k);
    if(!items.length) return;
    L+=`<div class="pjl-cat">${esc(c[qLang])}</div>`;
    items.forEach(a=>{
      const s=taskState(p.id,a,pj.stage), r=taskRow(p.id,a.no,pj.stage);
      const nAtt = r ? attachments.filter(x=>x.ptask_id===r.id).length : 0;
      const pd = r && r.plan_date ? slash(r.plan_date).slice(2) : '';
      L+=`<div class="pjl-it${pj.act===a.no?' on':''}${s==='na'?' na':''}" data-act="${a.no}">
          <span class="sti ${s}" title="${ST_NAME[s]}">${ST_ICON[s]}</span>
          <span class="no">${a.no}</span>
          <span class="tt" title="${attr(tx(a,'title'))}">${esc(tx(a,'title'))}</span>
          ${pj.showAll && a.rec?'<span class="rec" title="개발 관점 추천 항목">추천</span>':''}
          ${nAtt?`<span class="ac">📎${nAtt}</span>`:''}
          ${pd?`<span class="dd${s==='late'?' late':''}">${pd}</span>`:''}</div>`;
    });
  });
  if(!vis.length && acts.length) L+=`<div class="pjd-empty">이 단계에 켜진 항목이 없습니다.<br>위의 <b>Handbook 전체 보기</b>를 켜고 필요한 항목을 추가하세요.</div>`;
  $('pjList').innerHTML=L;

  // ── 상세 ──
  renderPjDetail(p);
  if(keepRes!==null && $('pjResult') && keepSnap!==null && pj.snap===keepSnap){ $('pjResult').value=keepRes; }
}

function renderPjDetail(p){
  const box=$('pjDetail');
  const a=QACT[pj.act];
  if(!a){ box.innerHTML='<div class="pjd-empty">왼쪽 목록에서 항목을 고르세요.</div>'; pj.snap=null; return; }
  const stage=pj.stage, r=taskRow(p.id,a.no,stage);
  const appl=isApplicable(p.id,a,stage), s=taskState(p.id,a,stage);
  const L=HB_LBL[qLang];
  const sec=(k,v,cls)=> v ? `<div class="hb-sec"><h4>${L[k]}</h4><div class="tx ${cls||''}">${esc(v)}</div></div>` : '';
  const how=tx(a,'how');
  const rasic=Object.entries(a.rasic||{}).map(([k,v])=>`<span>${esc(k)}<b>${esc(v)}</b></span>`).join('');
  const atts = r ? attachments.filter(x=>x.ptask_id===r.id) : [];
  const ms=(a.ms&&a.ms[stage]||[]).join(' · ');
  const curStatus=(r&&r.status)||'plan';

  box.innerHTML=`
    <div class="pjd-t">${a.no}. ${esc(tx(a,'title'))}</div>
    <div class="pjd-meta">
      <span class="tagx">${esc(catName(a.cat))}</span>
      ${ms?`<span class="tagx" title="해당 마일스톤">${esc(ms)}</span>`:''}
      ${a.rec?'<span class="tagx" style="color:#fcd34d">추천</span>':''}
      ${qLang==='en'?'':`<span class="tagx" title="영어 원문 제목">${esc(a.en.title)}</span>`}
    </div>
    <div class="pjd-ctl">
      ${appl?`<span class="seg">${['plan','doing','done'].map(k=>`<button class="${k}${curStatus===k?' on':''}" data-pjst="${k}">${ST_ICON[k]} ${ST_NAME[k]}</button>`).join('')}</span>
        <span class="dl">계획일 <span data-pjdate="plan_date" class="${r&&r.plan_date?'':'ph'}">${r&&r.plan_date?slash(r.plan_date):'지정'}</span></span>
        <span class="dl">완료일 <span data-pjdate="done_date" class="${r&&r.done_date?'':'ph'}">${r&&r.done_date?slash(r.done_date):'—'}</span></span>
        ${s==='late'?'<span class="tagx" style="color:#fca5a5">▲ 지연</span>':''}
        <span class="sp"></span>
        <button class="btn-xs danger" data-pjappl="0" title="이 부품에서는 이 항목을 하지 않음">이 부품에서 제외</button>`
      :`<span style="font-size:12px;color:var(--sub)">이 부품에서는 제외된 항목입니다.</span><span class="sp"></span>
        <button class="btn-xs solid" data-pjappl="1">+ 이 부품에 추가</button>`}
    </div>
    ${sec('why',tx(a,'why'))}
    ${sec('what',tx(a,'what'))}
    ${how?`<div class="hb-sec"><h4>${L.how}</h4><div class="tx hb-how${how.length>900?' clip':''}" id="pjHow">${esc(how)}</div>
       ${how.length>900?`<span class="hb-more" id="pjHowMore">${qLang==='en'?'Show all ▾':'전체 보기 ▾'}</span>`:''}</div>`:''}
    <div class="hb-grid">${sec('input',tx(a,'input'))}${sec('deliverable',tx(a,'deliverable'))}</div>
    <div class="hb-grid">${sec('leader',tx(a,'leader'))}${sec('support',tx(a,'support'))}</div>
    ${rasic?`<div class="hb-sec"><h4>${L.rasic}</h4><div class="rasic">${rasic}</div></div>`:''}
    ${a.refs?sec('refs',a.refs):''}
    <div class="pjd-res" data-drop="ptask" data-dropid="${p.id}">
      <div class="hb-sec" style="margin-bottom:6px"><h4>결과 (Result)</h4></div>
      <textarea id="pjResult" placeholder="이 항목을 어떻게 했는지, 결론, 남은 이슈를 적어두세요." ${appl?'':'disabled'}>${esc(r&&r.result||'')}</textarea>
      <div class="row"><span class="hint">Ctrl+Enter 저장 · 파일은 이 영역에 끌어넣거나 Ctrl+V</span>
        <button class="btn-xs solid" id="pjSave" ${appl?'':'disabled'}>저장</button></div>
      <div class="pjd-atts">${atts.map(x=>`<div class="photo-item${isExternal(x)?' is-link':''}">${attachHtml(x,'lg')}<button class="photo-del" data-a="delpic" data-id="${x.id}">✕</button></div>`).join('')}
        ${appl?`<div class="photo-add" data-pjadd="file"><i class="ti ti-paperclip"></i>파일</div><div class="photo-add" data-pjadd="link"><i class="ti ti-link"></i>링크</div>`:''}</div>
    </div>`;
  pj.snap = (r&&r.result)||'';
}

// ── 저장 ──
function needTasks(){
  if(hasTasks) return true;
  alert('체크 항목을 저장하려면 migration.sql 의 마지막 부분(2026-10-19)을 Supabase SQL Editor 에서 실행해 주세요.');
  return false;
}
async function saveTask(patch){
  if(!needTasks()) return null;
  const row=Object.assign({ project_id:pj.pid, act_no:pj.act, stage:pj.stage, updated_at:new Date().toISOString() }, patch);
  showLoading('저장 중...');
  const { data, error } = await sb.from('project_tasks').upsert(row, { onConflict:'project_id,act_no,stage' }).select();
  hideLoading();
  if(error){ alert('저장 실패: '+error.message); return null; }
  const saved=data[0];
  ptasks=ptasks.filter(t=>t.id!==saved.id).concat(saved);
  return saved;
}
async function saveResult(){
  const ta=$('pjResult'); if(!ta) return true;
  const saved=await saveTask({ result:ta.value });
  if(!saved) return false;
  pj.snap=ta.value; renderMain(); renderPj();
  return true;
}
async function setTaskStatus(st){
  const r=taskRow(pj.pid,pj.act,pj.stage);
  const patch={ status:st };
  if(st==='done' && !(r&&r.done_date)) patch.done_date=ymd(today);
  if(st!=='done') patch.done_date=null;
  if(pjDirty()) patch.result=$('pjResult').value;    // 쓰던 결과도 같이 저장
  if(await saveTask(patch)){ if(patch.result!==undefined) pj.snap=patch.result; renderMain(); renderPj(); }
}
async function setTaskDate(field){
  const r=taskRow(pj.pid,pj.act,pj.stage);
  const v=askDate(field==='plan_date'?'계획일':'완료일', r&&r[field]);
  if(v===undefined) return;
  if(await saveTask({ [field]:v })){ renderMain(); renderPj(); }
}
async function setTaskAppl(on){
  const a=QACT[pj.act];
  // 추천 기본값과 같아지면 null 로 되돌려 기본값을 따르게 한다
  const v = (on===a.rec) ? null : on;
  if(await saveTask({ applicable:v })){
    if(!on && !pj.showAll) pj.act=null;
    renderMain(); renderPj();
  }
}
// 이 항목의 첨부 — 기록 줄이 없으면 먼저 만든다
async function ensureTaskId(){
  const r=taskRow(pj.pid,pj.act,pj.stage);
  if(r) return r.id;
  const saved=await saveTask({});
  return saved ? saved.id : null;
}
async function pjUpload(files){
  if(!pj.pid || !pj.act) return;
  const id=await ensureTaskId(); if(!id) return;
  uploadFiles(files, pj.pid, null, null, id);
}
async function pjAddFile(){
  const id=await ensureTaskId(); if(!id) return;
  addFile(pj.pid, null, null, id);
}
async function pjAddLink(){
  const id=await ensureTaskId(); if(!id) return;
  addLink(pj.pid, null, null, id);
}

function onPjClick(e){
  if(e.target.closest('#pjClose')){ closePj(); return; }
  const lb=e.target.closest('[data-lang]'); if(lb){ setLang(lb.dataset.lang); return; }
  const stg=e.target.closest('[data-pjstage]');
  if(stg){ (async()=>{ if(!await pjLeave()) return; pj.stage=stg.dataset.pjstage; pj.act=null; pj.snap=null; renderPj(); })(); return; }
  const it=e.target.closest('[data-act]');
  if(it){ const no=Number(it.dataset.act); if(no===pj.act) return;
    (async()=>{ if(!await pjLeave()) return; pj.act=no; pj.snap=null; renderPj(); })(); return; }
  const stb=e.target.closest('[data-pjst]'); if(stb){ setTaskStatus(stb.dataset.pjst); return; }
  const dt=e.target.closest('[data-pjdate]'); if(dt){ setTaskDate(dt.dataset.pjdate); return; }
  const ap=e.target.closest('[data-pjappl]'); if(ap){ setTaskAppl(ap.dataset.pjappl==='1'); return; }
  const ad=e.target.closest('[data-pjadd]'); if(ad){ if(ad.dataset.pjadd==='file') pjAddFile(); else pjAddLink(); return; }
  if(e.target.closest('#pjSave')){ saveResult(); return; }
  if(e.target.closest('#pjHowMore')){ const h=$('pjHow'); h.classList.remove('clip'); e.target.remove(); return; }
}

// ════════════════════════════════════════════════════════════════
//  타임라인
// ════════════════════════════════════════════════════════════════
function chipRow(boxId, map, cur, cb){
  const box=$(boxId); box.innerHTML='';
  Object.keys(map).forEach(k=>{
    const c=document.createElement('div');
    c.className='chip'+(k===cur?' on':'');
    c.innerHTML=`${esc(k)}<span class="c">${map[k]}</span>`;
    c.onclick=()=>cb(k);
    box.appendChild(c);
  });
}
function renderTimeline(){
  const supMap={}; projects.forEach(p=>{ const s=p.supplier_name||'(미지정)'; supMap[s]=(supMap[s]||0)+1; });
  chipRow('tlSupChips', Object.assign({'전체':projects.length}, supMap), tlSup, v=>{ tlSup=v; tlCar='전체'; renderTimeline(); });

  const src = tlSup==='전체' ? projects : projects.filter(p=>(p.supplier_name||'(미지정)')===tlSup);
  const carMap={}; src.forEach(p=>{ const c=p.car_model||'(미지정)'; carMap[c]=(carMap[c]||0)+1; });
  chipRow('tlCarChips', Object.assign({'전체':src.length}, carMap), tlCar, v=>{ tlCar=v; renderTimeline(); });

  const list = src.filter(p=>tlCar==='전체' || (p.car_model||'(미지정)')===tlCar);
  const cars = [...new Set(list.map(p=>p.car_model||'(미지정)'))];
  $('stTotal').textContent = list.length;
  $('stCar').textContent = cars.length;
  let sop90=0; cars.forEach(c=>{ const s=schedOf(c).start.sop; if(s){ const d=daysUntil(s); if(d>=0&&d<=90) sop90++; } });
  $('stSop').textContent = sop90;

  const card=$('tlCard'); card.innerHTML='';
  if(!list.length){ card.innerHTML='<div class="empty">해당 조건의 데이터가 없습니다.</div>'; return; }

  cars.forEach(cm=>{
    const parts=list.filter(p=>(p.car_model||'(미지정)')===cm);
    const col=getColor(cm);
    const { html, nx, done } = flowHtml(cm, parts, 'big');
    const sups=[...new Set(parts.map(p=>p.supplier_name).filter(Boolean))].join('/');
    const open=!!tlOpen[cm];

    const row=document.createElement('div');
    row.className='crow'+(open?' open':'');
    row.innerHTML=`
      <div class="chead">
        <div class="cbar" style="background:${col}"></div>
        <div class="cinfo">
          <div class="cm"><span class="tri">▶</span>${esc(cm)}</div>
          <div class="meta">${parts.length}개 · ${esc(sups||'-')}</div>
          <div class="nx${done?' done':''}">${esc(nx)}</div>
        </div>
        <div class="cflow">${html}</div>
      </div>
      <div class="cdetail"><table class="ptable"><tbody></tbody></table></div>`;

    row.querySelector('.chead').addEventListener('click', e=>{
      if(e.target.closest('[data-a]')) return;      // 날짜 클릭은 토글 안 함
      tlOpen[cm]=!tlOpen[cm]; renderTimeline();
    });

    const tb=row.querySelector('.ptable tbody');
    parts.forEach(p=>{
      const isSel = selPid===p.id;
      const cur = curStageOf(p.car_model);
      const stepKey = (p.step||'').toLowerCase().replace(' ','');
      const sk = STAGES.find(s=>s.n.toLowerCase()===stepKey) || STAGES.find(s=>s.k===cur.key) || STAGES[1];
      const [bg,fg]=STAGE_SOFT[sk.k]||STAGE_SOFT.none;
      const ckHtml = hasCk ? CKS.map(c=>{
        const d=toDate(p[c.k]);
        return `<span class="ck ${d?'on':'off'}">${c.n}${d?' '+md(d):''}</span>`;
      }).join('') : '';
      const nIss = stageIssues(p).length;
      const nPic = photosOf(p.id).length;

      const tr=document.createElement('tr');
      tr.className='prow'+(isSel?' sel':'');
      tr.innerHTML=`
        <td class="ptri">${isSel?'▼':'▶'}</td>
        <td class="pno">${esc(p.part_number||'-')}</td>
        <td class="pnm">${esc(p.part_name||'-')}</td>
        <td class="psup">${esc(p.supplier_name||'')}</td>
        <td><span class="tstep" style="background:${bg};color:${fg}">${esc(p.step||sk.n)}</span></td>
        <td class="pchain">${p.delivery?'🔗 '+esc(p.delivery):''}</td>
        <td class="pck">${ckHtml}</td>
        <td class="prec">${nIss?`<span class="iss-tag">이슈 ${nIss}</span>`:''}${nPic?` <span class="iss-tag">📷${nPic}</span>`:''}</td>`;
      tr.addEventListener('click', ()=>{ selPid = isSel?null:p.id; renderTimeline(); });
      tb.appendChild(tr);

      if(isSel){
        const ep=document.createElement('tr');
        const td=document.createElement('td');
        td.colSpan=8; td.style.padding='0';
        td.appendChild(buildPanel(p, col));
        ep.appendChild(td); tb.appendChild(ep);
      }
    });

    card.appendChild(row);
  });
}

// ════════ 확장 패널 (세로 5컬럼) ════════
function buildPanel(p, col){
  const { nodes } = nodesOf(p.car_model);
  const cur = curStageOf(p.car_model);
  const sopD = (()=>{ const s=schedOf(p.car_model).start.sop; const d=daysUntil(s); return d===null?'':(d<=0?'SOP 완료':`SOP까지 D-${d}`); })();
  const nxt = nodes.find(n=>n.start && n.start>today);
  const nxtD = nxt ? `${nxt.n}까지 D-${daysUntil(nxt.start)}` : '';

  // 단계 컬럼
  const cols = STAGES.map(s=>{
    const nd = nodes.find(n=>n.k===s.k);
    const skip = !nd.start;
    let badge='', bcls='';
    if(skip){ badge='생략'; bcls='skip'; }
    else {
      const d=daysUntil(nd.start), de=daysUntil(nd.end);
      if(d>0){ badge='D-'+d; bcls='wait'; }
      else if(de<0){ badge='완료'; bcls='done'; }
      else { badge='진행 중'; bcls='ing'; }
    }
    const txt = p[s.k+'_issue']||'';
    const pics = photosOf(p.id, s.k);
    const thumbs = pics.length ? `<div class="scol-atts">${pics.map(a=>`<span class="att-wrap">${attachHtml(a,'sm')}<button class="att-del" data-a="delpic" data-id="${a.id}" title="첨부 삭제">&times;</button></span>`).join('')}</div>` : '';
    return `<div class="scol${skip?' skip':''}" id="sc-${p.id}-${s.k}" data-drop="proj" data-dropid="${p.id}" data-dropstage="${s.k}">
      <div class="scol-head">
        <div class="scol-top">
          <span class="scol-name" style="background:${s.c};">${s.n}</span>
          <span class="scol-badge ${bcls}">${badge}</span>
        </div>
        <div class="scol-date">시작 <b>${nd.start?ymdS(nd.start):'—'}</b>
          <button class="btn-xs" style="padding:1px 6px;" data-a="sched" data-car="${attr(p.car_model)}" data-k="${s.k}" title="차종 공통 일정 수정"><i class="ti ti-pencil"></i></button>
        </div>
      </div>
      ${thumbs}
      <div class="scol-body">
        <textarea class="scol-ta" id="ta-${p.id}-${s.k}" readonly placeholder="${skip?'생략 단계':'기록 없음'}">${esc(txt)}</textarea>
      </div>
      <div class="scol-foot" id="ft-${p.id}-${s.k}">
        <button class="btn-xs" data-a="big" data-p="${p.id}" data-k="${s.k}" title="크게 보기"><i class="ti ti-arrows-diagonal"></i></button>
        <button class="btn-xs" data-a="pic" data-p="${p.id}" data-k="${s.k}" title="사진/파일"><i class="ti ti-paperclip"></i></button>
        <button class="btn-xs" data-a="link" data-p="${p.id}" data-k="${s.k}" title="링크 첨부"><i class="ti ti-link"></i></button>
        <span class="spacer"></span>
        <button class="btn-xs" data-a="edit" data-p="${p.id}" data-k="${s.k}">수정</button>
      </div>
    </div>`;
  }).join('');

  // 체크포인트 칩
  const ckRow = hasCk ? CKS.map(c=>{
    const d=toDate(p[c.k]);
    return `<span class="ck ${d?'on':'off'}" style="cursor:pointer;font-size:10.5px;padding:3px 9px;"
             data-a="ck" data-p="${p.id}" data-f="${c.k}">${c.n}${d?' '+ymdS(d):' 미실시'}</span>`;
  }).join('') : '';

  const pics = photosOf(p.id).filter(a=>!a.stage);
  const photoHtml = pics.map(a=>`<div class="photo-item${isExternal(a)?' is-link':''}">${attachHtml(a,'lg')
    }<button class="photo-del" data-a="delpic" data-id="${a.id}">✕</button></div>`).join('')
    + `<div class="photo-add" data-a="pic" data-p="${p.id}"><i class="ti ti-camera-plus"></i>사진/파일</div>`
    + `<div class="photo-add" data-a="link" data-p="${p.id}"><i class="ti ti-link"></i>링크</div>`;

  const el=document.createElement('div');
  el.className='ep';
  el.innerHTML=`
    <div class="ep-head">
      <div class="ep-badge" style="background:${col};">${esc(p.car_model)}</div>
      <div>
        <div><span class="ep-title">${esc(p.part_name||'-')}</span> <span class="ep-no">${esc(p.part_number||'')}</span></div>
        <div class="ep-meta">${esc(p.supplier_name||'-')} · Vol <b>${esc(p.volume||'-')}</b>${p.customer?` · 고객사 <b>${esc(p.customer)}</b>`:''}</div>
      </div>
      ${p.delivery?`<span class="ep-chain">🔗 ${esc(p.delivery)}</span>`:''}
      ${sopD?`<span class="ep-dday sop">${esc(sopD)}</span>`:''}
      ${nxtD&&nxtD!==sopD?`<span class="ep-dday next">${esc(nxtD)}</span>`:''}
      <div class="ep-btns">
        <button class="btn-xs" data-a="editbasic" data-p="${p.id}"><i class="ti ti-pencil"></i> 기본정보</button>
        <button class="btn-xs danger" data-a="delproj" data-p="${p.id}">삭제</button>
      </div>
    </div>
    ${ckRow?`<div class="sec-title">체크포인트</div><div style="padding:0 18px 2px;display:flex;gap:6px;flex-wrap:wrap;">${ckRow}</div>`:''}
    <div class="sec-title">단계별 일정 · 이슈 · 품질 이력</div>
    <div class="stage-cols">${cols}</div>
    <div class="sec-title">사진 / 첨부 (단계 미지정)</div>
    <div class="photo-grid" data-drop="proj" data-dropid="${p.id}">${photoHtml}</div>
    <div style="height:14px"></div>`;
  return el;
}

// ════════════════════════════════════════════════════════════════
//  BOM
// ════════════════════════════════════════════════════════════════
function bomRows(){ return boms.filter(b=>b.car_model===bomCur).sort((a,b)=>(a.sort_order||0)-(b.sort_order||0)); }
function bomHasChild(rows,i){ return i+1<rows.length && rows[i+1].level>rows[i].level; }
function bomHL(s,q){
  s=esc(s||''); if(!q) return s;
  const i=s.toLowerCase().indexOf(q.toLowerCase());
  if(i<0) return s;
  return s.slice(0,i)+'<span class="hl">'+s.slice(i,i+q.length)+'</span>'+s.slice(i+q.length);
}
// 협력사 목록 (건수 많은 순)
function bomSuppliers(){
  const m={};
  boms.forEach(b=>{ const s=(b.supplier||'').trim(); if(s) m[s]=(m[s]||0)+1; });
  return Object.keys(m).sort((a,b)=>m[b]-m[a]||a.localeCompare(b,'ko')).map(n=>({ name:n, cnt:m[n] }));
}
// 협력사 고르는 패널
function renderSupPicker(){
  const btn=$('bomSupBtn'), list=$('bomSupList');
  $('bomSupLabel').textContent = bomSup || '전체';
  btn.classList.toggle('on', !!bomSup);
  const q=($('bomSupFind').value||'').trim().toLowerCase();
  const all=bomSuppliers().filter(s=>!q || s.name.toLowerCase().includes(q));
  let h=`<div class="sup-opt${bomSup?'':' on'}" data-sup=""><span class="n">전체</span><span class="c">${boms.length}</span></div>`;
  if(!all.length) h+='<div class="sup-empty">그런 이름의 업체가 없습니다</div>';
  all.forEach(s=>{
    h+=`<div class="sup-opt${bomSup===s.name?' on':''}" data-sup="${attr(s.name)}">
          <span class="n">${bomHL(s.name,q)}</span><span class="c">${s.cnt}</span></div>`;
  });
  list.innerHTML=h;
}
function renderBOM(){
  // ── 차종 칩 (전체 포함) ──
  const chips=$('bomChips'); chips.innerHTML='';
  const cars=[...new Set(boms.map(b=>b.car_model))];
  [{k:'전체',n:boms.length}, ...cars.map(k=>({k, n:boms.filter(b=>b.car_model===k).length}))].forEach(({k,n})=>{
    const c=document.createElement('div');
    c.className='chip'+(k===bomCur?' on':'');
    c.innerHTML=`${esc(k)}<span class="c">${n}</span>`;
    c.onclick=()=>{ bomCur=k; bomExp={}; renderBOM(); };
    chips.appendChild(c);
  });
  renderSupPicker();

  const panel=$('bomPanel');
  if(!hasBom){ panel.innerHTML='<div class="empty">bom 테이블이 없습니다. <code>migration.sql</code> 을 먼저 실행해 주세요.</div>'; $('bomCnt').innerHTML=''; return; }
  if(!boms.length){ panel.innerHTML='<div class="empty">BOM 데이터가 없습니다.</div>'; $('bomCnt').innerHTML=''; return; }

  const q=($('bomSearch').value||'').trim();
  const ql=q.toLowerCase();
  // 협력사를 골랐거나 / 검색어가 있거나 / 차종이 전체면 → 트리 대신 평면 목록
  const flat = !!bomSup || !!q || bomCur==='전체';

  const inCar = b => bomCur==='전체' || b.car_model===bomCur;
  const hit   = b => !q || [b.part_no,b.part_name,b.supplier,b.plant,b.remark]
                            .some(v=>v && String(v).toLowerCase().includes(ql));

  // ── 평면 목록 : 차종별로 묶어서 보여준다 ──
  if(flat){
    const rows=boms.filter(b=>inCar(b) && (!bomSup || (b.supplier||'').trim()===bomSup) && hit(b));
    const carsIn=[...new Set(rows.map(r=>r.car_model))];
    $('bomCnt').innerHTML = bomSup
      ? `<b>${esc(bomSup)}</b> · ${carsIn.length}개 차종 · <b>${rows.length}</b>개 품목`
      : `<b>${rows.length}</b>개 품목 · ${carsIn.length}개 차종`;
    if(!rows.length){ panel.innerHTML='<div class="empty">조건에 맞는 품목이 없습니다.</div>'; return; }

    let body='';
    carsIn.forEach(cm=>{
      const sub=rows.filter(r=>r.car_model===cm).sort((a,b)=>(a.sort_order||0)-(b.sort_order||0));
      body+=`<tr class="carhead"><td colspan="8">${esc(cm)} · ${sub.length}개</td></tr>`;
      sub.forEach(r=>{
        const nc = r.nc==='New' ? '<span class="badge b-new">New</span>' : (r.nc?'<span class="badge b-cov">C/over</span>':'');
        const mb = r.mb==='Make' ? '<span class="badge b-make">Make</span>' : (r.mb==='Buy'?'<span class="badge b-buy">Buy</span>':'');
        body+=`<tr>
          <td class="bcar">${esc(r.car_model)}</td>
          <td class="bpno">${bomHL(r.part_no,q)}</td>
          <td><span class="bname">${bomHL(r.part_name,q)}${
            r.variant?` <span class="tw">· ${esc(r.variant)}</span>`:''}</span></td>
          <td>${nc}</td><td>${mb}</td>
          <td class="dim">${esc(r.plant||'')}</td>
          <td>${bomHL(r.supplier||'',q)}</td>
          <td class="dim">${esc(r.remark||'')}</td></tr>`;
      });
    });
    panel.innerHTML=`<table class="bom">
      <thead><tr><th style="width:84px">차종</th><th style="width:132px">Part No.</th><th>Part Name</th>
        <th style="width:62px">구분</th><th style="width:58px">M/B</th><th style="width:86px">공장</th>
        <th style="width:120px">협력사</th><th style="width:92px">비고</th></tr></thead>
      <tbody>${body}</tbody></table>`;
    return;
  }

  // ── 트리 : 한 차종을 고르고 검색어가 없을 때 ──
  const rows=bomRows();
  $('bomCnt').innerHTML=`총 <b>${rows.length}</b>개`;
  let visible=[], hideAbove=Infinity;
  rows.forEach((r,i)=>{
    if(r.level>hideAbove) return;
    hideAbove=Infinity;
    if(bomHasChild(rows,i)&&!bomExp[i]) hideAbove=r.level;
    visible.push(i);
  });

  let body='';
  visible.forEach(i=>{
    const r=rows[i], kid=bomHasChild(rows,i), open=!!bomExp[i];
    const indent=(r.level-1)*16;
    const tog=kid?`<span class="tog" data-a="bomtog" data-i="${i}">${open?'−':'+'}</span>`:'<span class="tog leaf"></span>';
    const nc = r.nc==='New' ? '<span class="badge b-new">New</span>' : (r.nc?'<span class="badge b-cov">C/over</span>':'');
    const mb = r.mb==='Make' ? '<span class="badge b-make">Make</span>' : (r.mb==='Buy'?'<span class="badge b-buy">Buy</span>':'');
    body += `<tr class="${r.level===1?'lv1':''}">
      <td class="bpno">${esc(r.part_no||'')}</td>
      <td><div class="namecell" style="padding-left:${indent}px">${tog}<span class="bname">${esc(r.part_name||'')}${
        r.variant&&r.level===1?` <span class="tw">· ${esc(r.variant)}</span>`:''}</span></div></td>
      <td>${nc}</td><td>${mb}</td>
      <td class="dim">${esc(r.plant||'')}</td>
      <td class="sup-cell" data-a="bomsup" data-sup="${attr((r.supplier||'').trim())}">${esc(r.supplier||'')}</td>
      <td class="dim">${esc(r.remark||'')}</td></tr>`;
  });
  panel.innerHTML=`<table class="bom">
    <thead><tr><th style="width:132px">Part No.</th><th>Part Name</th><th style="width:62px">구분</th>
      <th style="width:58px">M/B</th><th style="width:86px">공장</th><th style="width:120px">협력사</th><th style="width:92px">비고</th></tr></thead>
    <tbody>${body}</tbody></table>`;
}

// ════════════════════════════════════════════════════════════════
//  To-Do
// ════════════════════════════════════════════════════════════════
function renderTodos(){
  const wrap=$('todoTableWrap');
  let items=todos;
  if(todoFilter==='active') items=todos.filter(t=>!t.done);
  else if(todoFilter==='done') items=todos.filter(t=>t.done);
  if(!items.length){ wrap.innerHTML='<div class="empty">등록된 이슈가 없습니다. 위에서 추가하세요.</div>'; return; }

  let rows='';
  items.forEach((t,idx)=>{
    const dd=t.due_date?daysUntil(toDate(t.due_date)):null;
    const over=dd!==null&&dd<0&&!t.done;
    const atts=attachments.filter(a=>a.todo_id===t.id);
    const rm=atts.map(a=>`<span class="att-wrap">${attachHtml(a,'sm')
      }<button class="att-del" data-a="delpic" data-id="${a.id}" title="첨부 삭제">✕</button></span>`).join('');
    rows+=`<tr class="trow${t.done?' done':''}" data-id="${t.id}"
        data-drop="todo" data-dropid="${t.id}" data-dropname="${attr(t.title||t.content||'이 이슈')}">
      <td class="c-no">${idx+1}</td>
      <td class="c-check"><button class="todo-check${t.done?' on':''}" data-a="toggle">${t.done?'✓':''}</button></td>
      <td class="c-title" data-a="tedit" data-f="title">${esc(t.title||t.content||'')}</td>
      <td class="c-date" ${hasOpenDate?'data-a="tedit" data-f="open_date"':''}>${
        hasOpenDate ? (t.open_date?slash(t.open_date):`<span class="ph">${slash(t.created_at)}</span>`)
                    : `<span class="ph">${slash(t.created_at)}</span>`}</td>
      <td class="c-action"><div class="action-box" data-a="tedit" data-f="action_plan">${
        esc(t.action_plan||'').replace(/\n/g,'<br>')||'<span class="ph">클릭하여 입력</span>'}</div></td>
      <td class="c-due" data-a="tedit" data-f="due_date"><span class="${over?'due-over':''}">${
        t.due_date?slash(t.due_date):'<span class="ph">-</span>'}</span>${
        dd!==null&&!t.done&&t.due_date?`<div class="due-dday ${over?'over':''}">D${dd>=0?'-'+dd:'+'+(-dd)}</div>`:''}</td>
      <td class="c-resp" data-a="tedit" data-f="resp">${esc(t.resp||'')||'<span class="ph">-</span>'}</td>
      <td class="c-prio"><select class="prio-sel" data-a="tprio">
        <option value="high" ${t.priority==='high'?'selected':''}>높음</option>
        <option value="normal" ${(!t.priority||t.priority==='normal')?'selected':''}>보통</option>
        <option value="low" ${t.priority==='low'?'selected':''}>낮음</option></select></td>
      <td class="c-remark"><div class="remark-atts">${rm}</div>
        <button class="btn-xs" data-a="tattach">+ 첨부</button>
        <button class="btn-xs" data-a="tlink">+ 링크</button>
        <div class="drop-hint">끌어넣거나 Ctrl+V</div></td>
      <td class="c-del"><button class="todo-del" data-a="tdel" title="이슈 행 전체 삭제">✕</button></td></tr>`;
  });
  wrap.innerHTML=`<table class="todo-table">
    <thead><tr><th>No.</th><th>완료</th><th>Title</th><th>Date</th><th>Action Plan</th><th>Due date</th>
      <th>Resp.</th><th>Priority</th><th>Remarks</th><th></th></tr></thead>
    <tbody>${rows}</tbody></table>`;
}

// ════════════════════════════════════════════════════════════════
//  편집 — 프로젝트 / 일정 / 이슈
// ════════════════════════════════════════════════════════════════
async function updateProject(pid, patch){
  showLoading('저장 중...');
  const { error } = await sb.from('projects').update(patch).eq('id', pid);
  hideLoading();
  if(error){ alert('저장 실패: '+error.message); return false; }
  Object.assign(projects.find(x=>x.id===pid), patch);
  return true;
}
// 차종 일정 수정 (car_schedules 없으면 projects 전체에 반영)
async function editSchedule(car, k){
  const cur = ymd(schedOf(car).start[k]);
  const stage = STAGES.find(s=>s.k===k);
  const v = askDate(`${car} · ${stage.n} 시작일\n(일정은 차종 공통입니다)`, cur);
  if(v===undefined) return;
  showLoading('저장 중...');
  let error=null;
  if(hasSched){
    const row = Object.assign({ car_model:car }, schedMap[car]||{});
    row[k+'_start']=v; row[k+'_skip']=(v===null);
    const res = await sb.from('car_schedules').upsert(row, { onConflict:'car_model' }).select();
    error=res.error;
    if(!error){ schedMap[car]=res.data[0]; schedules=schedules.filter(s=>s.car_model!==car).concat(res.data[0]); }
  } else {
    const patch={}; patch[k+'_start']=v; patch[k+'_skip']=(v===null);
    const res = await sb.from('projects').update(patch).eq('car_model', car);
    error=res.error;
    if(!error) projects.filter(p=>p.car_model===car).forEach(p=>Object.assign(p, patch));
  }
  hideLoading();
  if(error){ alert('저장 실패: '+error.message); return; }
  renderAll();
}
// 체크포인트 날짜
async function editCk(pid, field){
  const p=projects.find(x=>x.id===pid); if(!p) return;
  const c=CKS.find(x=>x.k===field);
  const v=askDate(`${p.part_name} · ${c.n} 완료일`, clean(p[field]));
  if(v===undefined) return;
  if(await updateProject(pid, { [field]:v })) renderAll();
}
// 단계 이슈 편집 (인라인)
const issDraft={};
function startEdit(pid,k){
  const col=$(`sc-${pid}-${k}`), ta=$(`ta-${pid}-${k}`), ft=$(`ft-${pid}-${k}`);
  if(!col||!ta||col.classList.contains('editing')) return;
  issDraft[pid+'-'+k]=ta.value;
  col.classList.add('editing');
  ta.removeAttribute('readonly'); ta.focus();
  ft.querySelector('[data-a="edit"]').outerHTML=
    `<button class="btn-xs" data-a="cancel" data-p="${pid}" data-k="${k}" title="Esc">취소</button>
     <button class="btn-xs solid" data-a="save" data-p="${pid}" data-k="${k}" title="Ctrl+Enter">저장</button>`;
}
async function saveIssue(pid,k){
  const ta=$(`ta-${pid}-${k}`); if(!ta) return;
  if(await updateProject(pid, { [k+'_issue']:ta.value })) renderAll();
}
function cancelIssue(pid,k){
  const ta=$(`ta-${pid}-${k}`);
  if(ta) ta.value=issDraft[pid+'-'+k]||'';
  renderAll();
}
// 확대 편집
function openBig(pid,k){
  const p=projects.find(x=>x.id===pid); if(!p) return;
  const s=STAGES.find(x=>x.k===k);
  bigCtx={pid,k};
  $('bigStage').textContent=s.n; $('bigStage').style.background=s.c;
  $('bigWho').textContent=`${p.car_model} · ${p.part_name||''}`;
  $('bigTa').value=p[k+'_issue']||'';
  bigSnap=$('bigTa').value;
  loadSize($('bigBox'),'big');
  $('bigOverlay').classList.add('on');
  setTimeout(()=>$('bigTa').focus(),60);
}
async function saveBig(){
  if(!bigCtx) return;
  const { pid,k } = bigCtx;
  if(await updateProject(pid, { [k+'_issue']:$('bigTa').value })){
    bigSnap=$('bigTa').value; closeBig(true); renderAll();
  }
}
async function deleteProject(pid){
  const p=projects.find(x=>x.id===pid); if(!p) return;
  if(!confirm(`'${p.car_model} / ${p.part_name}' 부품을 삭제하시겠습니까?`)) return;
  showLoading('삭제 중...');
  const { error } = await sb.from('projects').delete().eq('id', pid);
  hideLoading();
  if(error){ alert('삭제 실패: '+error.message); return; }
  projects=projects.filter(x=>x.id!==pid);
  if(selPid===pid) selPid=null;
  renderAll();
}

// ── 모달 ──
// 사용자가 바꾼 창 크기를 기억했다가 다시 열 때 복원
function loadSize(el, key){
  el.style.width=''; el.style.height='';
  try{
    const s=JSON.parse(localStorage.getItem('size_'+key)||'null');
    if(s && s.w>300 && s.h>200){ el.style.width=s.w+'px'; el.style.height=s.h+'px'; }
  }catch(e){}
}
function saveSize(el, key){
  try{ localStorage.setItem('size_'+key, JSON.stringify({ w:el.offsetWidth, h:el.offsetHeight })); }catch(e){}
}
// 저장하지 않은 수정이 있는지 판별
let modalSnap=null, bigSnap=null;
function snapFields(){ return [...document.querySelectorAll('#modalFields input, #modalFields textarea')].map(e=>e.value).join('\u0001'); }
function modalDirty(){ return modalSnap!==null && snapFields()!==modalSnap; }

function openModal(title, fieldsHtml, cb, lg){
  $('modalTitle').textContent=title;
  $('modalFields').innerHTML=fieldsHtml;
  const box=$('modalBox');
  box.classList.toggle('lg', !!lg);
  loadSize(box, lg?'modal_lg':'modal');
  modalCallback=cb;
  modalSnap=snapFields();
  $('modalOverlay').classList.add('on');
}
function closeModal(){ $('modalOverlay').classList.remove('on'); modalCallback=null; modalSnap=null; modalTodoId=null; }
// 바깥 클릭 / ESC — 수정 중이면 먼저 물어본다
function tryCloseModal(){
  if(modalDirty()){
    if(confirm('저장하지 않은 수정이 있습니다.\n\n[확인] 저장하고 닫기\n[취소] 계속 편집')){
      if(modalCallback) modalCallback();
    }
    return;
  }
  closeModal();
}
// 취소 버튼 — 수정 중이면 버릴지 확인
function cancelModal(){
  if(modalDirty() && !confirm('수정한 내용을 버리고 닫을까요?')) return;
  closeModal();
}
// ── Enter 로 저장 ──
// 한 줄 입력 : Enter 로 바로 저장
// 여러 줄 입력 : Enter 는 줄바꿈, Ctrl+Enter(Mac 은 ⌘+Enter)로 저장
function initEnterToSave(){
  const withMod = e => e.ctrlKey || e.metaKey;

  // 수정창 안의 모든 입력칸
  $('modalFields').addEventListener('keydown', e=>{
    if(e.key!=='Enter') return;
    const multiline = e.target.tagName==='TEXTAREA';
    if(multiline && !withMod(e)) return;        // 줄바꿈은 그대로
    e.preventDefault();
    if(modalCallback) modalCallback();
  });

  // 단계 이슈 확대 편집창
  $('bigTa').addEventListener('keydown', e=>{
    if(e.key==='Enter' && withMod(e)){ e.preventDefault(); saveBig(); }
  });

  // 단계 카드 안에서 바로 쓰는 경우
  document.addEventListener('keydown', e=>{
    const ta=e.target;
    if(!ta || !ta.classList || !ta.classList.contains('scol-ta')) return;
    const m=/^ta-(\d+)-(\w+)$/.exec(ta.id||'');
    if(!m) return;
    if(e.key==='Enter' && withMod(e)){ e.preventDefault(); saveIssue(Number(m[1]), m[2]); }
    else if(e.key==='Escape'){ e.preventDefault(); e.stopPropagation(); cancelIssue(Number(m[1]), m[2]); }
  });
}

// 배경(바깥 여백)을 '눌렀다 뗀' 경우에만 닫는다.
// 창 안에서 드래그를 시작해 바깥에서 손을 떼면 click 의 target 이 배경이 되는데,
// 이건 글자 선택이지 닫으려는 동작이 아니므로 무시한다.
function onBackdropClick(overlayId, onClose){
  const ov=$(overlayId); let downOnBackdrop=false;
  ov.addEventListener('mousedown', e=>{ downOnBackdrop = (e.target===ov); });
  ov.addEventListener('click', e=>{
    const ok = (e.target===ov) && downOnBackdrop;
    downOnBackdrop=false;
    if(ok) onClose();
  });
}
// 확대 편집창 닫기
function closeBig(force){
  if(!force && bigSnap!==null && $('bigTa').value!==bigSnap){
    if(confirm('저장하지 않은 수정이 있습니다.\n\n[확인] 저장하고 닫기\n[취소] 계속 편집')) saveBig();
    return;
  }
  $('bigOverlay').classList.remove('on'); bigCtx=null; bigSnap=null;
}
function fieldHtml(k,label,val,ph){
  return `<div class="modal-field"><label class="modal-label">${label}</label>
    <input class="modal-input" data-k="${k}" value="${attr(val||'')}" ${ph?`placeholder="${attr(ph)}"`:''}></div>`;
}
function openBasicModal(pid){
  const p=projects.find(x=>x.id===pid); if(!p) return;
  const f=[['car_model','차종'],['supplier_name','협력사'],['part_name','부품명'],['part_number','부품번호'],
           ['step','현재 Step (Proto/P1/P2/M/SOP)'],['volume','Volume'],['delivery','공급망 (예: 원진→대전→경주)'],
           ['customer','고객사'],['issue_group','이슈 그룹 (같은 이슈 묶음, 예: G2)']]
          .filter(([k])=> hasCk || (k!=='step' && k!=='issue_group'));
  openModal('기본 정보 수정', f.map(([k,l])=>fieldHtml(k,l,p[k])).join(''), async()=>{
    const u={}; document.querySelectorAll('#modalFields .modal-input').forEach(i=>u[i.dataset.k]=i.value.trim()||null);
    if(await updateProject(pid,u)){ closeModal(); renderAll(); }
  });
}
function openNewModal(){
  const html = `
    ${fieldHtml('car_model','차종 *','','예: RG3 HEV')}
    ${fieldHtml('supplier_name','협력사','')}
    ${fieldHtml('part_name','부품명','')}
    ${fieldHtml('part_number','부품번호','')}
    ${hasCk?fieldHtml('step','현재 Step','','Proto / P1 / P2 / M / SOP'):''}
    ${fieldHtml('volume','Volume','')}
    ${fieldHtml('delivery','공급망','예: 원진→대전→경주')}
    ${fieldHtml('customer','고객사','')}
    <div class="modal-section">차종 일정 (YYYY-MM-DD · 이미 있는 차종이면 비워두세요)</div>
    ${STAGES.map(s=>`<div class="modal-row">
        <input class="modal-input" data-sched="${s.k}" placeholder="${s.n} 시작일">
      </div>`).join('')}`;
  openModal('신규 부품 등록', html, async()=>{
    const u={ sort_order:projects.length };
    document.querySelectorAll('#modalFields [data-k]').forEach(i=>{ u[i.dataset.k]=i.value.trim()||null; });
    if(!u.car_model){ alert('차종은 필수입니다.'); return; }
    const sched={};
    document.querySelectorAll('#modalFields [data-sched]').forEach(i=>{
      const v=i.value.trim(); if(v){ if(!/^\d{4}-\d{2}-\d{2}$/.test(v)){ sched.__bad=true; return; } sched[i.dataset.sched+'_start']=v; }
    });
    if(sched.__bad){ alert('일정 날짜 형식: YYYY-MM-DD'); return; }
    showLoading('등록 중...');
    const { data, error } = await sb.from('projects').insert(u).select();
    if(error){ hideLoading(); alert('등록 실패: '+error.message); return; }
    projects.push(data[0]); getColor(data[0].car_model);
    if(Object.keys(sched).length){
      if(hasSched){
        const row=Object.assign({ car_model:u.car_model, sort_order:schedules.length }, schedMap[u.car_model]||{}, sched);
        STAGES.forEach(s=>{ row[s.k+'_skip'] = !row[s.k+'_start']; });
        const r2=await sb.from('car_schedules').upsert(row,{ onConflict:'car_model' }).select();
        if(!r2.error){ schedMap[u.car_model]=r2.data[0]; schedules=schedules.filter(s=>s.car_model!==u.car_model).concat(r2.data[0]); }
      } else {
        await sb.from('projects').update(sched).eq('id', data[0].id);
        Object.assign(data[0], sched);
      }
    }
    hideLoading();
    tlOpen[u.car_model]=true; selPid=data[0].id;
    closeModal(); renderAll();
  });
}

// ── 파일 업로드 ──
// 파일 하나 업로드 (압축 → 용량확인 → Storage → attachments)
async function uploadOne(file, pid, tid, stage, label, ptask){
  const before=file.size;
  file = await shrinkImage(file);
  if(file.size>MAX_UPLOAD){
    throw new Error(`"${file.name}" 이(가) 너무 큽니다 (${fmtSize(file.size)}).\n`
      + `직접 올릴 수 있는 한도는 ${fmtSize(MAX_UPLOAD)} 입니다.\n\n`
      + `사내 드라이브(OneDrive/SharePoint)에 올리신 뒤 "+ 링크" 로 주소를 등록하세요.`);
  }
  showLoading(`업로드 중...${label||''}` + (before!==file.size ? `  (${fmtSize(before)} → ${fmtSize(file.size)})` : ''));
  const ext=(file.name.split('.').pop()||'bin');
  const folder = pid?`proj_${pid}`:`todo_${tid}`;
  const path=`${folder}/${Date.now()}_${Math.random().toString(36).slice(2,7)}.${ext}`;
  const up=await sb.storage.from('photos').upload(path,file);
  if(up.error) throw up.error;
  const { data:url } = sb.storage.from('photos').getPublicUrl(path);
  const rec={ file_url:url.publicUrl, file_name:file.name };
  if(pid) rec.project_id=pid;
  if(tid) rec.todo_id=tid;
  if(stage) rec.stage=stage;
  if(ptask) rec.ptask_id=ptask;
  const { data, error } = await sb.from('attachments').insert(rec).select();
  if(error) throw error;
  attachments.push(data[0]);
}
// 여러 개 한 번에
async function uploadFiles(files, pid, tid, stage, ptask){
  const list=[...files].filter(Boolean);
  if(!list.length) return;
  showLoading('업로드 중...');
  let ok=0;
  for(let i=0;i<list.length;i++){
    try{ await uploadOne(list[i], pid, tid, stage, list.length>1?` (${i+1}/${list.length})`:'', ptask); ok++; }
    catch(e){ hideLoading(); alert(e.message||e); break; }
  }
  hideLoading();
  if(ok) renderAll();
}
function addFile(pid, tid, stage, ptask){
  const inp=document.createElement('input'); inp.type='file'; inp.multiple=true;
  inp.onchange=()=>uploadFiles(inp.files, pid, tid, stage, ptask);
  inp.click();
}

// ════ 끌어넣기 / 붙여넣기 ════
// 드롭 대상: [data-drop="todo|proj"] [data-dropid] [data-dropstage]
let hoverDrop=null;          // 마우스가 올라가 있는 드롭 대상
let modalTodoId=null;        // 편집창이 열려 있는 이슈
function dropCtxOf(el){
  const t = el && el.closest ? el.closest('[data-drop]') : null;
  if(!t) return null;
  const id=Number(t.dataset.dropid);
  if(t.dataset.drop==='ptask') return { ptask:true, pid:id, el:t, name:'이 항목' };
  return t.dataset.drop==='todo'
    ? { tid:id, el:t, name:t.dataset.dropname||'이 이슈' }
    : { pid:id, stage:t.dataset.dropstage||null, el:t, name:t.dataset.dropname||'이 부품' };
}
function pasteName(type){
  const d=new Date(), p=n=>String(n).padStart(2,'0');
  const ext=(type||'image/png').split('/')[1].replace('jpeg','jpg');
  return `붙여넣기_${d.getFullYear()}${p(d.getMonth()+1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.${ext}`;
}
function initDropPaste(){
  document.addEventListener('mouseover', e=>{
    const c=dropCtxOf(e.target);
    if(c) hoverDrop=c;
  });
  // 브라우저가 파일을 열어버리지 않도록 전역에서 막는다
  document.addEventListener('dragover', e=>{
    if(!e.dataTransfer || ![...e.dataTransfer.types].includes('Files')) return;
    e.preventDefault();
    const c=dropCtxOf(e.target);
    document.querySelectorAll('.drop-on').forEach(x=>x.classList.remove('drop-on'));
    if(c) c.el.classList.add('drop-on');
  });
  document.addEventListener('dragleave', e=>{
    if(e.relatedTarget) return;
    document.querySelectorAll('.drop-on').forEach(x=>x.classList.remove('drop-on'));
  });
  document.addEventListener('drop', e=>{
    if(!e.dataTransfer || !e.dataTransfer.files || !e.dataTransfer.files.length) return;
    e.preventDefault();
    document.querySelectorAll('.drop-on').forEach(x=>x.classList.remove('drop-on'));
    const c=dropCtxOf(e.target);
    if(!c){ alert('이슈 행 위나 단계 카드 위에 놓아주세요.'); return; }
    if(c.ptask){ pjUpload(e.dataTransfer.files); return; }
    uploadFiles(e.dataTransfer.files, c.pid||null, c.tid||null, c.stage||null);
  });
  // 붙여넣기 — 편집창이 열려 있으면 그 이슈로, 아니면 마우스가 올라가 있는 곳으로
  document.addEventListener('paste', e=>{
    const files=e.clipboardData && e.clipboardData.files;
    if(!files || !files.length) return;        // 글자 붙여넣기는 그대로 둔다
    // 부품 상세 창이 열려 있으면 고른 항목으로 (위에 다른 편집창이 없을 때)
    const pjOn = $('pjOverlay').classList.contains('on') && !$('modalOverlay').classList.contains('on') && pj.act;
    const c = modalTodoId ? { tid:modalTodoId } : pjOn ? { ptask:true } : hoverDrop;
    if(!c){ alert('붙여넣을 위치에 마우스를 올린 뒤 Ctrl+V 하세요.\n(이슈 행 또는 단계 카드)'); return; }
    e.preventDefault();
    const list=[...files].map(f=>f.name && f.name!=='image.png' ? f : new File([f], pasteName(f.type), { type:f.type }));
    if(c.ptask){ pjUpload(list); return; }
    uploadFiles(list, c.pid||null, c.tid||null, c.stage||null);
  });
}
// ── 외부 링크 첨부 (OneDrive / SharePoint / Google Drive …) ──
function addLink(pid, tid, stage, ptask){
  openModal('링크 첨부',
    `${fieldHtml('name','표시할 이름','','예: JG 공정감사 결과')}
     <div class="modal-field"><label class="modal-label">주소 (URL)<span class="req">*</span></label>
       <textarea class="modal-input" data-k="url" style="min-height:84px;font-size:12px;"
         placeholder="https://... (사내 드라이브에서 '링크 복사'한 주소를 붙여넣으세요)"></textarea></div>
     <div style="font-size:11px;color:var(--muted);line-height:1.6;">
       주소는 화면에 보이지 않습니다. 위에 적은 이름만 표시되고, 누르면 새 탭에서 열립니다.<br>
       OneDrive·SharePoint 는 공유 범위를 <b>조직 내 모든 사용자</b>로 잡아두셔야 팀원이 열 수 있습니다.</div>`,
    async()=>{
      const get=k=>{ const el=document.querySelector(`#modalFields [data-k="${k}"]`); return el?el.value.trim():''; };
      const url=get('url');
      if(!url){ alert('주소를 입력하세요.'); return; }
      if(!/^https?:\/\//i.test(url)){ alert('주소는 http:// 또는 https:// 로 시작해야 합니다.'); return; }
      const rec={ file_url:url, file_name:get('name') || linkSource(url) };
      if(pid) rec.project_id=pid;
      if(tid) rec.todo_id=tid;
      if(stage) rec.stage=stage;
      if(ptask) rec.ptask_id=ptask;
      showLoading('저장 중...');
      const { data, error } = await sb.from('attachments').insert(rec).select();
      hideLoading();
      if(error){ alert('저장 실패: '+error.message); return; }
      attachments.push(data[0]); closeModal(); renderAll();
    });
}
// 첨부 하나를 화면에 그리는 공통 조각
function attachHtml(a, size){
  const url=attr(a.file_url), nm=esc(a.file_name||'첨부');
  if(isExternal(a)){
    const src=esc(linkSource(a.file_url));
    if(size==='sm') return `<a href="${url}" target="_blank" rel="noopener" class="rm-file" title="${nm} · ${src}"><i class="ti ti-link"></i></a>`;
    return `<a href="${url}" target="_blank" rel="noopener" class="file-chip link-chip" title="${nm} · ${src}">
              <i class="ti ti-link"></i><span>${nm}</span><span class="src">${src}</span></a>`;
  }
  if(isImg(a.file_name||a.file_url)){
    return size==='sm'
      ? `<img class="rm-thumb" src="${url}" data-a="view" data-url="${url}">`
      : `<img src="${url}" data-a="view" data-url="${url}">`;
  }
  return size==='sm'
    ? `<a href="${url}" target="_blank" rel="noopener" class="rm-file" title="${nm}"><i class="ti ti-file"></i></a>`
    : `<a href="${url}" target="_blank" rel="noopener" class="file-chip"><i class="ti ti-file"></i><span>${nm}</span></a>`;
}
async function deleteAttachment(id){
  const a=attachments.find(x=>x.id===id);
  const what=a ? (isExternal(a)?'링크':'첨부파일')+` "${a.file_name||''}"` : '첨부';
  if(!confirm(`${what} 를 삭제할까요?\n\n(이슈 내용은 지워지지 않습니다)`)) return;
  showLoading('삭제 중...');
  const { error } = await sb.from('attachments').delete().eq('id', id);
  hideLoading();
  if(error){ alert('삭제 실패: '+error.message); return; }
  attachments=attachments.filter(a=>a.id!==id);
  renderAll();
}

// ── To-Do 편집 ──
async function addTodo(){
  const inp=$('todoInput'), v=inp.value.trim(); if(!v) return;
  showLoading('추가 중...');
  const { data, error } = await sb.from('todos').insert({ title:v, content:v, sort_order:todos.length }).select();
  hideLoading();
  if(error){ alert('추가 실패: '+error.message); return; }
  todos.push(data[0]); inp.value=''; renderTodos();
}
async function updateTodo(id,patch){
  const { error } = await sb.from('todos').update(patch).eq('id', id);
  if(error){ alert('저장 실패: '+error.message); return; }
  Object.assign(todos.find(x=>x.id===id), patch);
  renderTodos();
}
async function toggleTodo(id){ const t=todos.find(x=>x.id===id); await updateTodo(id,{ done:!t.done }); }
async function deleteTodo(id){
  const t=todos.find(x=>x.id===id);
  const n=attachments.filter(a=>a.todo_id===id).length;
  if(!confirm(`이슈 "${(t&&(t.title||t.content))||''}" 를 통째로 삭제합니다.\n`
            + `Action Plan 과 첨부${n?` ${n}건`:''}도 함께 사라집니다.\n\n정말 삭제할까요?`)) return;
  const { error } = await sb.from("todos").delete().eq('id', id);
  if(error){ alert(error.message); return; }
  todos=todos.filter(x=>x.id!==id); renderTodos();
}
function openTodoEdit(id, field){
  const t=todos.find(x=>x.id===id); if(!t) return;
  modalTodoId=id;        // 편집창이 열려 있는 동안 Ctrl+V 는 이 이슈로 첨부
  const labels={ title:'Title', action_plan:'Action Plan',
                 open_date:'Date — 이슈 발생/기록일', due_date:'Due date — 완료 목표일', resp:'책임자(Resp.)' };
  const isDate = field==='due_date' || field==='open_date';
  let val=t[field]||'';
  if(isDate) val=slash(val);
  const multi = field==='action_plan';
  openModal(labels[field]+' 수정',
    multi ? `<div class="modal-field"><textarea class="modal-input" id="tv" style="line-height:1.85;font-size:13.5px;">${esc(val)}</textarea></div>
             <div class="resize-hint">Ctrl+Enter 로 저장 · Ctrl+V 로 사진 첨부 · 모서리를 끌면 창 크기가 바뀌고 기억됩니다</div>`
          : `<input class="modal-input" id="tv" value="${attr(val)}" ${isDate?'placeholder="2026/10/01"':''}>`
            + (isDate?'<div class="resize-hint" style="text-align:left;">2026/10/01 형식. 연도를 빼고 10/01 만 적으면 올해로 들어갑니다. 비우면 지워집니다.</div>':''),
    async()=>{
      let v=$('tv').value;
      if(field!=='action_plan') v=v.trim();
      if(isDate){
        const r=parseDateInput(v);
        if(r===undefined){ alert('날짜 형식이 올바르지 않습니다.\n예: 2026/10/01 또는 10/01'); return; }
        v=r;
      }
      await updateTodo(id,{ [field]:v }); closeModal();
    }, multi);
  setTimeout(()=>{ const el=$('tv'); if(el) el.focus(); },70);
}

// ════════════════════════════════════════════════════════════════
//  이벤트 위임
// ════════════════════════════════════════════════════════════════
function onBodyClick(e){
  // 사진 보기 / 날짜 필터 칩은 어디서든
  const dfc=e.target.closest('.dfchip');
  if(dfc){ dfClick(dfc); return; }

  const el=e.target.closest('[data-a]');
  if(!el) return;
  const a=el.dataset.a;
  const pid=el.dataset.p?Number(el.dataset.p):null;
  const k=el.dataset.k;

  if(a==='view'){ viewImg(el.dataset.url); return; }
  if(a==='bomtog'){ const i=Number(el.dataset.i); bomExp[i]=!bomExp[i]; renderBOM(); return; }
  // 표 안의 협력사 이름을 누르면 그 업체로 바로 묶어본다
  if(a==='bomsup'){
    const s=el.dataset.sup; if(!s) return;
    bomSup=s; bomCur='전체'; $('bomSearch').value=''; renderBOM(); return;
  }
  if(a==='sched'){ e.stopPropagation(); editSchedule(el.dataset.car, k); return; }
  if(a==='ck'){ editCk(pid, el.dataset.f); return; }
  if(a==='edit'){ startEdit(pid,k); return; }
  if(a==='save'){ saveIssue(pid,k); return; }
  if(a==='cancel'){ cancelIssue(pid,k); return; }
  if(a==='big'){ openBig(pid,k); return; }
  if(a==='pic'){ addFile(pid,null,k||null); return; }
  if(a==='link'){ addLink(pid,null,k||null); return; }
  if(a==='delpic'){ deleteAttachment(Number(el.dataset.id)); return; }
  if(a==='editbasic'){ openBasicModal(pid); return; }
  if(a==='delproj'){ deleteProject(pid); return; }

  // To-Do
  const tr=el.closest('tr[data-id]');
  if(tr){
    const tid=Number(tr.dataset.id);
    if(a==='toggle'){ toggleTodo(tid); return; }
    if(a==='tdel'){ deleteTodo(tid); return; }
    if(a==='tattach'){ addFile(null,tid); return; }
    if(a==='tlink'){ addLink(null,tid); return; }
    // 글자를 드래그로 선택한 직후의 클릭은 편집창을 열지 않는다 (복사하려던 동작)
    if(a==='tedit'){ if(hasSelection()) return; openTodoEdit(tid, el.dataset.f); return; }
  }
}

// ════════════════════════════════════════════════════════════════
//  init
// ════════════════════════════════════════════════════════════════
function switchView(v){
  curView=v;
  document.querySelectorAll('#nav a').forEach(a=>a.classList.toggle('on', a.dataset.v===v));
  document.querySelectorAll('.view').forEach(x=>x.classList.remove('on'));
  $('view-'+v).classList.add('on');
}
function init(){
  $('todayBadge').textContent=`${today.getFullYear()}년 ${today.getMonth()+1}월 ${today.getDate()}일`;

  if(typeof SUPABASE_URL==='undefined' || typeof SUPABASE_ANON_KEY==='undefined' || !SUPABASE_ANON_KEY){
    $('banner').classList.add('on'); setConn('err','설정 필요'); hideLoading(); return;
  }
  sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  document.querySelectorAll('#nav a').forEach(a=>a.addEventListener('click',()=>switchView(a.dataset.v)));
  $('newBtn').addEventListener('click', openNewModal);
  $('modalSaveBtn').addEventListener('click', ()=>{ if(modalCallback) modalCallback(); });
  $('modalCancelBtn').addEventListener('click', cancelModal);
  // 바깥 클릭으로 닫기 — 단, 창 안에서 시작한 드래그(글자 선택)는 닫지 않는다
  onBackdropClick('modalOverlay', tryCloseModal);
  $('bigCancel').addEventListener('click', ()=>{
    if(bigSnap!==null && $('bigTa').value!==bigSnap && !confirm('수정한 내용을 버리고 닫을까요?')) return;
    closeBig(true);
  });
  $('bigSave').addEventListener('click', saveBig);
  onBackdropClick('bigOverlay', ()=>closeBig(false));
  onBackdropClick('viewer', ()=>$('viewer').classList.remove('on'));
  // 모달 크기를 바꾸면 기억해둔다
  document.addEventListener('mouseup', ()=>{
    const mb=$('modalBox'), bb=$('bigBox');
    if($('modalOverlay').classList.contains('on')) saveSize(mb, mb.classList.contains('lg')?'modal_lg':'modal');
    if($('bigOverlay').classList.contains('on')) saveSize(bb, 'big');
    if($('pjOverlay').classList.contains('on')) saveSize($('pjBox'), 'pj');
  });

  // HOME 표
  $('gSearch').addEventListener('input', renderMain);
  $('gExpand').addEventListener('click', ()=>{ gClosed={}; saveClosed(); renderMain(); });
  $('gCollapse').addEventListener('click', ()=>{
    gClosed={}; projects.forEach(p=>{ gClosed[p.car_model||'(미지정)']=true; }); saveClosed(); renderMain();
  });
  $('gScroll').addEventListener('click', onMainClick);
  // 부품 상세 창
  $('pjBox').addEventListener('click', onPjClick);
  $('pjBox').addEventListener('change', e=>{
    if(e.target.id==='pjShowAll'){ pj.showAll=e.target.checked; renderPj(); }
  });
  $('pjBox').addEventListener('keydown', e=>{
    if(e.target.id==='pjResult' && e.key==='Enter' && (e.ctrlKey||e.metaKey)){ e.preventDefault(); saveResult(); }
  });
  onBackdropClick('pjOverlay', closePj);

  $('bomSearch').addEventListener('input', renderBOM);
  // 협력사 고르기
  $('bomSupBtn').addEventListener('click', e=>{
    e.stopPropagation();
    const p=$('bomSupPanel'); const open=p.classList.toggle('on');
    if(open){ $('bomSupFind').value=''; renderSupPicker(); setTimeout(()=>$('bomSupFind').focus(),30); }
  });
  $('bomSupFind').addEventListener('input', renderSupPicker);
  $('bomSupFind').addEventListener('keydown', e=>{
    if(e.key==='Escape'){ $('bomSupPanel').classList.remove('on'); return; }
    if(e.key!=='Enter') return;
    const first=$('bomSupList').querySelector('.sup-opt[data-sup]:not([data-sup=""])');
    if(first) first.click();
  });
  $('bomSupList').addEventListener('click', e=>{
    const o=e.target.closest('.sup-opt'); if(!o) return;
    bomSup = o.dataset.sup || null;
    $('bomSupPanel').classList.remove('on');
    renderBOM();
  });
  document.addEventListener('click', e=>{
    if(!e.target.closest('.sup-picker')) $('bomSupPanel').classList.remove('on');
  });
  $('bomExpand').addEventListener('click', ()=>{ const rows=bomRows(); bomExp={}; rows.forEach((r,i)=>{ if(bomHasChild(rows,i)) bomExp[i]=true; }); renderBOM(); });
  $('bomCollapse').addEventListener('click', ()=>{ bomExp={}; renderBOM(); });

  $('todoAddBtn').addEventListener('click', addTodo);
  $('todoInput').addEventListener('keydown', e=>{ if(e.key==='Enter') addTodo(); });
  document.querySelectorAll('#view-todo .chip[data-filter]').forEach(f=>f.addEventListener('click',()=>{
    document.querySelectorAll('#view-todo .chip[data-filter]').forEach(x=>x.classList.remove('on'));
    f.classList.add('on'); todoFilter=f.dataset.filter; renderTodos();
  }));
  $('todoTableWrap').addEventListener('change', e=>{
    const sel=e.target.closest('.prio-sel'); if(!sel) return;
    const tr=e.target.closest('tr[data-id]');
    updateTodo(Number(tr.dataset.id), { priority:sel.value });
  });

  document.body.addEventListener('click', onBodyClick);
  initDropPaste();
  initEnterToSave();
  document.addEventListener('keydown', e=>{
    if(e.key!=='Escape') return;
    if($('viewer').classList.contains('on')){ $('viewer').classList.remove('on'); return; }
    if($('modalOverlay').classList.contains('on')){ tryCloseModal(); return; }
    if($('bigOverlay').classList.contains('on')){ closeBig(false); return; }
    if($('pjOverlay').classList.contains('on')) closePj();
  });

  loadAll().then(hideLoading, hideLoading);
}
window.addEventListener('DOMContentLoaded', init);
