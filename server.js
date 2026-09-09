// License server for LINE OA Auto Calculator V7
// Node.js 18+
// npm i express cors
const express=require('express');
const cors=require('cors');
const fs=require('fs');
const path=require('path');
const app=express();
app.use(cors());
app.use(express.json());

const PORT=process.env.PORT||3000;
const ADMIN_TOKEN=process.env.ADMIN_TOKEN||'CHANGE_THIS_ADMIN_TOKEN';
const DB=path.join(__dirname,'licenses.json');
function load(){try{return JSON.parse(fs.readFileSync(DB,'utf8'));}catch{return {};}}
function save(db){fs.writeFileSync(DB,JSON.stringify(db,null,2));}
function auth(req,res,next){const h=req.headers.authorization||'';if(h!==`Bearer ${ADMIN_TOKEN}`)return res.status(401).json({ok:false,error:'unauthorized'});next();}
app.get('/',(req,res)=>res.json({ok:true,name:'LINE OA Auto Calculator License Server'}));
app.post('/api/check',(req,res)=>{
 const key=String(req.body?.key||'').trim(); const db=load(); const x=db[key];
 const active=!!x && !x.revoked && (!x.expiresAt||new Date(x.expiresAt)>new Date());
 res.json({ok:true,active,key:active?key:undefined,expiresAt:x?.expiresAt||null});
});
app.get('/api/admin/licenses',auth,(req,res)=>res.json({ok:true,licenses:load()}));
app.post('/api/admin/licenses',auth,(req,res)=>{
 const key=String(req.body?.key||'').trim(); if(!key)return res.status(400).json({ok:false,error:'key required'});
 const db=load();db[key]={revoked:false,createdAt:new Date().toISOString(),expiresAt:req.body?.expiresAt||null,note:String(req.body?.note||'')};save(db);
 res.json({ok:true,key,license:db[key]});
});
app.post('/api/admin/licenses/:key/revoke',auth,(req,res)=>{
 const db=load();if(!db[req.params.key])return res.status(404).json({ok:false,error:'not found'});
 db[req.params.key].revoked=true;db[req.params.key].revokedAt=new Date().toISOString();save(db);res.json({ok:true});
});
app.post('/api/admin/licenses/:key/unrevoke',auth,(req,res)=>{
 const db=load();if(!db[req.params.key])return res.status(404).json({ok:false,error:'not found'});
 db[req.params.key].revoked=false;delete db[req.params.key].revokedAt;save(db);res.json({ok:true});
});
app.delete('/api/admin/licenses/:key',auth,(req,res)=>{
 const db=load();if(!db[req.params.key])return res.status(404).json({ok:false,error:'not found'});
 delete db[req.params.key];save(db);res.json({ok:true});
});
app.listen(PORT,()=>console.log(`License server listening on :${PORT}`));
