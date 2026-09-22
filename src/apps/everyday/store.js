'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const FILE = path.join(__dirname, '..', '..', '..', 'data', 'everyday.json');
const DEFAULT_PROFILE = { name:'나', focus_title:'물리학 공부', study_brightness:80, relax_brightness:35, sleep_brightness:15, focus_minutes:25, open_notepad:true };
function read() {
  if (!fs.existsSync(FILE)) return { revision:0, profile:{...DEFAULT_PROFILE}, session:null };
  const data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  return { revision:Number(data.revision)||0, profile:{...DEFAULT_PROFILE,...data.profile}, session:data.session || null };
}
function save(data) {
  data.revision++;
  fs.writeFileSync(FILE+'.tmp', JSON.stringify(data,null,2)+'\n');
  fs.renameSync(FILE+'.tmp', FILE);
  return snapshot();
}
function sessionView(session, now=Date.now()) {
  if (!session) return null;
  const elapsed = session.elapsed_ms + (session.running_since ? Math.max(0,now-session.running_since) : 0);
  const remaining = Math.max(0,session.duration_ms-elapsed);
  return {...session, remaining_ms:remaining, elapsed_ms:Math.min(elapsed,session.duration_ms), status:remaining===0?'completed':session.status};
}
function snapshot() { const data=read(); return {...data, session:sessionView(data.session)}; }
function updateProfile(input) {
  const data=read(), profile={...data.profile};
  for (const [key,value] of Object.entries(input || {})) {
    if (!Object.hasOwn(DEFAULT_PROFILE,key)) throw new Error('지원하지 않는 개인 설정입니다.');
    if (['name','focus_title'].includes(key)) {
      if (typeof value!=='string' || !value.trim() || value.length>(key==='name'?30:80)) throw new Error('이름과 활동 제목의 길이를 확인해 주세요.');
      profile[key]=value.trim();
    } else if (key==='open_notepad') {
      if (typeof value!=='boolean') throw new Error('메모장 설정은 true/false여야 합니다.');
      profile[key]=value;
    } else {
      const min=key==='focus_minutes'?1:1, max=key==='focus_minutes'?180:100;
      if (!Number.isInteger(value)||value<min||value>max) throw new Error(`${key}: ${min}~${max} 사이 정수를 입력해 주세요.`);
      profile[key]=value;
    }
  }
  data.profile=profile; return save(data);
}
function pause(data) {
  const s=data.session;
  if (!s) return;
  const view=sessionView(s);
  s.elapsed_ms=view.elapsed_ms; s.running_since=null;
  s.status=view.status==='completed'?'completed':'paused';
}
function commit(effect, location) {
  const data=read();
  if (effect==='start') {
    data.session={id:crypto.randomUUID(),activity:'study',title:data.profile.focus_title,status:'active',duration_ms:data.profile.focus_minutes*60000,elapsed_ms:0,running_since:Date.now(),location,started_at:new Date().toISOString(),handoffs:[]};
  } else if (effect==='resume') {
    const s=data.session;
    if (!s || sessionView(s).status==='completed') throw new Error('이어갈 활동이 없습니다.');
    if (s.location!==location) s.handoffs.push({from:s.location,to:location,at:new Date().toISOString()});
    s.handoffs=s.handoffs.slice(-30); s.location=location;
    if (!s.running_since) s.running_since=Date.now();
    s.status='active';
  } else if (effect==='pause') pause(data);
  else return snapshot();
  return save(data);
}
function sessionControl(action) {
  const data=read();
  if (!data.session) throw new Error('진행 중인 활동이 없습니다.');
  if (action==='pause') pause(data);
  else if (action==='finish') {pause(data);data.session.status='completed';data.session.elapsed_ms=data.session.duration_ms;}
  else throw new Error('지원하지 않는 활동 동작입니다.');
  return save(data);
}
module.exports={DEFAULT_PROFILE,snapshot,updateProfile,commit,sessionControl,sessionView};
