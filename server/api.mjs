import {randomBytes,createHash,timingSafeEqual} from 'node:crypto';
import {DURATION,plan,tally,deadline,ranking} from '../public/game-core.js';
const token=()=>randomBytes(24).toString('hex');const hash=s=>createHash('sha256').update(String(s)).digest('hex');
function fail(message,status=400){throw Object.assign(new Error(message),{status})}
function equal(a,b){const x=Buffer.from(String(a)),y=Buffer.from(String(b));return x.length===y.length&&timingSafeEqual(x,y)}
export function createApi(store,{password,clock=Date.now}={}){
 const get=k=>store.get(k,{type:'json'});const put=(k,v,o)=>store.setJSON(k,v,o);
 const all=async prefix=>{let blobs=[],cursor;do{const page=await store.list({prefix,...cursor?{cursor}:{}});blobs.push(...page.blobs);cursor=page.cursor}while(cursor);return blobs};
 const records=async prefix=>{const keys=await all(prefix);const arr=[];for(let i=0;i<keys.length;i+=20)arr.push(...await Promise.all(keys.slice(i,i+20).map(x=>get(x.key))));return arr.filter(Boolean)};
 const events=async(r,p)=>records(`events/${r.id}/${r.round.id}/${p.id}/`);
 const players=async r=>records(`players/${r.id}/`);
 function phase(r,now){if(r.closed)return 'closed';if(r.stretchUntil&&now<r.stretchUntil)return 'stretch';if(!r.round)return 'lobby';if(r.round.number%4===0&&r.restedAfter!==r.round.number&&now>=r.round.end+15000&&now<r.round.end+75000)return 'stretch';return now<r.round.start?'countdown':now<r.round.end?'playing':'results'}
 async function authenticate(r,b){if(b.role==='teacher'){if(!equal(hash(b.token||''),r.hostHash))fail('선생님 인증이 필요합니다.',403);return null}if(!/^[a-f0-9]{16}$/.test(b.playerId||''))fail('다시 입장해 주세요.',403);const p=await get(`players/${r.id}/${b.playerId}`);if(!p||!equal(p.tokenHash,hash(b.token||'')))fail('입장 정보가 일치하지 않습니다.',403);return p}
 const publicRoom=(r,now)=>({code:r.code,id:r.id,settings:r.settings,phase:phase(r,now),round:r.round,completed:r.completed,stretchUntil:Math.max(r.stretchUntil||0,r.round?.number%4===0&&r.restedAfter!==r.round.number&&now>=r.round.end+15000?r.round.end+75000:0),serverNow:now,expires:r.expires});
 return async function action(b){const now=clock();if(typeof b!=='object'||!b)fail('잘못된 요청입니다.');const code=String(b.code||'');if(!/^\d{2}$/.test(code))fail('방 코드는 숫자 두 자리로 입력해 주세요.');const key='rooms/'+code;
 if(b.action==='create'){
  if(!password||password.length<8)fail('먼저 Netlify 환경변수 TEACHER_PASSWORD를 8자 이상으로 설정해 주세요.',503);
  if(!equal(b.password||'',password))fail('교사용 비밀번호가 맞지 않습니다.',403);
  const prior=await store.getWithMetadata(key,{type:'json'});if(prior&&prior.data.expires>now&&!prior.data.closed)fail('사용 중인 방 코드입니다. 다른 번호를 골라 주세요.',409);
  const secret=token(),r={id:randomBytes(12).toString('hex'),code,hostHash:hash(secret),expires:now+6*3600000,settings:{mode:'ko',kind:'word',level:0},round:null,completed:0,stretchUntil:0};
  const saved=await put(key,r,prior?{onlyIfMatch:prior.etag}:{onlyIfNew:true});if(!saved.modified)fail('방이 방금 만들어졌습니다. 다른 번호를 골라 주세요.',409);
  return {token:secret,role:'teacher',...publicRoom(r,now)};
 }
 const entry=await store.getWithMetadata(key,{type:'json'}),r=entry?.data;if(!r||r.expires<=now||r.closed)fail('열린 방을 찾을 수 없습니다. 선생님께 방 코드를 확인해 주세요.',404);
 if(b.action==='join'){
  if(['playing','countdown','stretch'].includes(phase(r,now)))fail('진행 중인 판이 끝나면 입장할 수 있어요. 잠시 기다려 주세요.',409);
  const nickname=String(b.nickname||'').trim().normalize('NFC');if(!/^[\p{L}\p{N} _-]{1,12}$/u.test(nickname))fail('닉네임은 한글·영문·숫자 등 1~12자로 입력해 주세요.');
  const list=await players(r);if(list.length>=40)fail('한 방은 40명까지 참여할 수 있습니다.');
  const id=hash(nickname.toLocaleLowerCase()).slice(0,16),secret=token();const p={id,nickname,tokenHash:hash(secret),joined:now};const saved=await put(`players/${r.id}/${id}`,p,{onlyIfNew:true});if(!saved.modified)fail('같은 닉네임이 있어요. 다른 닉네임을 골라 주세요.',409);
  return {token:secret,playerId:id,nickname,role:'student',...publicRoom(r,now)};
 }
 const p=await authenticate(r,b);const current=phase(r,now);
 if(b.action==='host'){
  if(b.role!=='teacher')fail('선생님만 변경할 수 있습니다.',403);
  if(b.command==='close'){r.closed=true;r.expires=now}
  else if(b.command==='settings'){
   if(['playing','countdown','stretch'].includes(current))fail('이번 판이 끝난 후 설정할 수 있어요.',409);
   if(!['ko','en'].includes(b.mode)||!['word','sentence'].includes(b.kind)||!Number.isInteger(b.level)||b.level<0||b.level>10)fail('설정 값이 올바르지 않습니다.');r.settings={mode:b.mode,kind:b.kind,level:b.level};
  }else if(b.command==='start'){
   if(['playing','countdown','stretch'].includes(current))fail('아직 진행 중입니다.',409);
   if(r.round&&now>=r.round.end){const done=r.round.number;r.completed=Math.max(r.completed,done)}
   if(r.completed>0&&r.completed%4===0&&r.restedAfter!==r.completed&&!(r.round?.number%4===0&&now>=r.round.end+75000)){r.stretchUntil=now+60000;r.restedAfter=r.completed}
   else{if(!(await players(r)).length)fail('학생이 한 명 이상 입장한 뒤 시작해 주세요.');const n=(r.round?.number||0)+1;r.round={...r.settings,id:randomBytes(8).toString('hex'),number:n,seed:token(),start:now+5000,end:now+5000+DURATION};r.stretchUntil=0}
  }else if(b.command==='stretch'){
   if(['playing','countdown'].includes(current))fail('판이 끝난 뒤 쉬는 시간을 시작할 수 있어요.',409);
   r.stretchUntil=now+60000;if(r.round){r.completed=Math.max(r.completed,r.round.number);if(r.completed%4===0)r.restedAfter=r.completed}
  }else fail('지원하지 않는 명령입니다.');
  const saved=await put(key,r,{onlyIfMatch:entry.etag});if(!saved.modified)fail('다른 창에서 변경했어요. 새로고침 후 다시 시도해 주세요.',409);return publicRoom(r,now);
 }
 if(b.action==='status'){
  const result=publicRoom(r,now);
  if(current==='lobby'||current==='results'||b.role==='teacher')result.players=(await players(r)).map(x=>({id:x.id,nickname:x.nickname}));
  if(p&&r.round){result.targets=plan(r.round,p.id);result.events=await events(r,p)}
  return result;
 }
 if(b.action==='hit'){
  if(!p||current!=='playing')fail('지금은 입력할 수 없습니다.',409);
  const elapsed=now-r.round.start,targets=plan(r.round,p.id),target=targets.find(x=>x.id===b.target);if(!target||target.spawn>elapsed)fail('아직 등장하지 않은 운석입니다.');
  const previous=await events(r,p);if(previous.some(x=>x.target===target.id&&x.ok))fail('이미 맞힌 운석입니다.',409);
  if(elapsed>deadline(target,targets,previous))fail('운석이 이미 지나갔어요.',409);
  const input=String(b.text||'').normalize('NFC');if(input.length>120)fail('입력 길이를 확인해 주세요.');const ok=input===target.text;
  const latest=Math.max(0,...previous.filter(e=>e.ok).map(e=>e.at));const minimum=Math.max(target.spawn,latest)+Math.max(450,target.text.length*30);
  if(ok&&elapsed<minimum)fail('너무 빠른 입력입니다. 직접 타이핑해 주세요.',429);
  const e={target:target.id,at:elapsed,ok};const saved=await put(`events/${r.id}/${r.round.id}/${p.id}/${target.id}-${ok?'hit':'wrong'}`,e,{onlyIfNew:true});
  if(!saved.modified&&ok)fail('이미 처리한 입력입니다.',409);
  const updated=saved.modified?[...previous,e]:previous;return {ok,event:e,events:updated,stats:tally(targets,updated,elapsed),serverNow:now};
 }
 if(b.action==='rank'){
  if(!r.round||now<r.round.end)fail('게임이 끝나면 순위를 볼 수 있어요.',409);
  const list=await players(r);const rows=[];
  for(let i=0;i<list.length;i+=8)rows.push(...await Promise.all(list.slice(i,i+8).map(async who=>{
   if(who.joined>r.round.start)return null;
   const k=`results/${r.id}/${r.round.id}/${who.id}`;let summary=await get(k);if(!summary){summary={id:who.id,nickname:who.nickname,...tally(plan(r.round,who.id),await events(r,who),DURATION)};await put(k,summary,{onlyIfNew:true})}return summary;
  })));
  return {rows:ranking(rows.filter(Boolean)),serverNow:now};
 }
 fail('지원하지 않는 요청입니다.');
 };
}
export function response(error){return {message:error.status?error.message:'서버 연결에 문제가 있어요. 잠시 후 다시 시도해 주세요.'}}
