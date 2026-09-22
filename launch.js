'use strict';
const {spawn}=require('child_process');
const {resolveApp}=require('./src/app-registry');
const mcpAccess=require('./src/mcp-access');
const args=process.argv.slice(2), live=args.includes('--live');
if(Number(process.versions.node.split('.')[0])<22){console.error('Node.js 22 이상이 필요합니다. Node.js 설치 후 다시 실행해 주세요.');process.exit(1);}
process.env.REALITY_LIVE=live?'1':'0';
process.env.PC_ADAPTER_DRY_RUN=live&&process.platform==='win32'?'0':'1';
let server;
try{server=require('./server').server;}catch(e){console.error('시작하지 못했습니다: '+e.message);process.exit(1);}
const port=Number(process.env.PORT||3000);
if(!Number.isInteger(port)||port<1024||port>65535){console.error('PORT는 1024~65535 정수여야 합니다.');process.exit(1);}
server.on('error',error=>{console.error(error.code==='EADDRINUSE'?'이미 실행 중이거나 3000 포트를 사용 중입니다. 기존 실행 창을 닫거나 PORT 값을 변경해 주세요.':error.message);process.exitCode=1;});
server.listen(port,'127.0.0.1',()=>{
  const url=`http://127.0.0.1:${port}`;
  console.log(`\nReality Layer 1.8.1 · External Runtime\n${live?'실제 연결 모드: 연결한 기기가 실제로 동작합니다.':'체험 모드: 모든 기기 동작은 가상입니다.'}\n\n브라우저 주소: ${url}\nMCP endpoint: ${url}/mcp\nMCP Bearer token: ${mcpAccess.token}\n\n이 토큰은 외부 Agent 연결용 비밀값입니다. 다른 사람에게 공유하지 마세요.\n이 창을 열어 두세요. 종료하려면 Ctrl+C를 누르세요.\n`);
  if(!args.includes('--no-open')){
    let command,openArgs=[url];
    if(process.platform==='win32'){
      const edge=resolveApp('edge');
      command=edge?.executable||'explorer.exe';
    }else command=process.platform==='darwin'?'open':'xdg-open';
    const child=spawn(command,openArgs,{stdio:'ignore',detached:true,shell:false});
    child.on('error',()=>console.log('위 주소를 브라우저에 직접 입력해 주세요.'));child.unref();
  }
});
