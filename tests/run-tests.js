'use strict';
// Never let tests reset a user's actual preferences or activity history.
const fs=require('fs'),path=require('path'),os=require('os');
const {spawnSync}=require('child_process');
const root=path.join(__dirname,'..'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'reality-test-'));
try{
  for(const file of ['src','public','integrations','server.js','test.js','tests'])fs.cpSync(path.join(root,file),path.join(temp,file),{recursive:true});
  fs.mkdirSync(path.join(temp,'data'));
  const env={...process.env,REALITY_LIVE:'0',PC_ADAPTER_DRY_RUN:'1'};
  for(const key of ['OPENAI_API_KEY','HA_URL','HA_TOKEN'])delete env[key];
  for(const suite of ['test.js','tests/everyday.test.js','tests/v1.5.test.js','tests/v1.6.test.js','tests/v1.7.test.js','tests/v1.7.1.test.js','tests/v1.8.test.js','tests/v1.8.1.test.js','tests/v1.8.2.test.js','tests/v1.8.2-process-crash.test.js','tests/v1.8.2.1.test.js']){
    const result=spawnSync(process.execPath,[suite],{cwd:temp,env,stdio:'inherit',timeout:90000});
    if(result.status!==0){process.exitCode=1;break;}
  }
}finally{fs.rmSync(temp,{recursive:true,force:true});}
