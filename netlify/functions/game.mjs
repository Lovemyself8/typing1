import {getStore} from '@netlify/blobs';
import {createApi,response} from '../../server/api.mjs';
export default async function(request){
 const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'};
 if(request.method!=='POST')return new Response(JSON.stringify({message:'POST 요청만 가능합니다.'}),{status:405,headers});
 const origin=request.headers.get('origin');if(origin&&new URL(origin).host!==new URL(request.url).host)return new Response('{}',{status:403,headers});
 try{const raw=await request.text();if(raw.length>4096)return new Response('{}',{status:413,headers});const body=JSON.parse(raw);
 const store=getStore({name:'space-typing-v1',consistency:'strong'});
 const result=await createApi(store,{password:process.env.TEACHER_PASSWORD})(body);return new Response(JSON.stringify(result),{headers});
 }catch(error){console.error('game-api',error.status||500);return new Response(JSON.stringify(response(error)),{status:error.status||500,headers})}
}
