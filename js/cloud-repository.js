'use strict';
const LIVE_DEVICE_ID='esp32-01';
const LIVE_OPERATOR_UID='FgQtDdYxbJUO1rSl6NhZfROvMKe2';
function validLivePatient(p){return !!p&&typeof p.id==='string'&&p.id===p.uid&&/^(?:[0-9A-F]{8}|[0-9A-F]{14}|[0-9A-F]{20})$/.test(p.uid)&&typeof p.name==='string'&&p.name.trim().length>0&&p.name.length<=80&&Number.isInteger(p.age)&&p.age>=0&&p.age<=120&&['Laki-laki','Perempuan'].includes(p.sex)&&['Umum','Ibu hamil','Ibu nifas','Ibu menyusui','Peserta KB'].includes(p.category)&&typeof p.createdAt==='string';}
function validLiveResult(r){return !!r&&r.source==='esp32'&&r.deviceId===LIVE_DEVICE_ID&&typeof r.sessionId==='string'&&r.sessionId.startsWith(LIVE_DEVICE_ID+'-')&&r.uid===r.patient?.uid&&validLivePatient(r.patient)&&Number.isFinite(r.measuredAtMs)&&r.measuredAtMs>1700000000000&&Number.isFinite(r.receivedAt)&&['weight','height','pulse','temperature'].every(k=>Number.isFinite(r.values?.[k])&&r.values[k]>0);}
function sameDeviceRecord(record,raw){return record&&record.source==='esp32'&&record.deviceId===raw.deviceId&&record.id===raw.sessionId&&record.patientId===raw.uid&&record.measuredAt===new Date(raw.measuredAtMs).toISOString()&&['weight','height','pulse','temperature'].every(k=>record.values?.[k]===raw.values[k]);}
function createCloudRepository(sdk,config,hooks){
 const app=sdk.initializeApp(config),auth=sdk.getAuth(app),database=sdk.getDatabase(app);
 let user=null,loaded=false,connected=false,epoch=0,unsub=[],latestRecords=[],denied='';
 const pendingIds=new Set();
 const paths={patients:'patients',records:'measurements',settings:'settings',live:'devices/'+LIVE_DEVICE_ID+'/live',raw:'deviceResults/'+LIVE_DEVICE_ID};
 const defaults={facility:'SEHAT RFID',address:'Layanan Pengukuran Pasien'};
 const status=(state,message='')=>hooks.onState({state,message,email:user?.email||'',connected});
 function publishRecords(){hooks.onData('records',latestRecords.filter(r=>!pendingIds.has(r.id)));}
 function deliver(name,value){
  if(name==='records'){latestRecords=Object.values(value||{}).filter(r=>r&&typeof r.id==='string'&&r.patient&&typeof r.patient.name==='string'&&r.values&&['weight','height','pulse','temperature'].every(k=>Number.isFinite(r.values[k]))&&Number.isFinite(Date.parse(r.measuredAt))).sort((a,b)=>b.measuredAt.localeCompare(a.measuredAt));publishRecords();}
  else if(name==='patients')hooks.onData(name,Object.values(value||{}).filter(validLivePatient));
  else if(name==='settings')hooks.onData(name,{facility:typeof value?.facility==='string'?value.facility:defaults.facility,address:typeof value?.address==='string'?value.address:defaults.address});
  else if(name==='raw')hooks.onData(name,Object.entries(value||{}).filter(([key,r])=>r?.sessionId===key&&validLiveResult(r)).map(([,r])=>r).sort((a,b)=>a.measuredAtMs-b.measuredAtMs));
  else hooks.onData(name,value);
 }
 function stop(){unsub.forEach(off=>off());unsub=[];loaded=false;}
 function requireReady(){if(!user||user.uid!==LIVE_OPERATOR_UID||!loaded)throw Error('Login dan tunggu database selesai dimuat.');if(!connected)throw Error('Offline. Tunggu koneksi kembali.');}
 sdk.onValue(sdk.ref(database,'.info/connected'),snap=>{connected=snap.val()===true;if(user&&loaded)status(connected?'ready':'offline');});
 async function authChanged(next){const ticket=++epoch;stop();user=next;pendingIds.clear();latestRecords=[];hooks.onClear();if(!user){status('signed-out',denied);denied='';return;}if(user.uid!==LIVE_OPERATOR_UID){denied='Akun ini belum diberi izin petugas.';status('error',denied);await sdk.signOut(auth);return;}status('loading','Memuat data dan koneksi perangkat…');
  try{const data=await Promise.all(Object.entries(paths).map(async([name,path])=>[name,await sdk.get(sdk.ref(database,path))]));if(ticket!==epoch)return;for(const [name,snap] of data)deliver(name,snap.val());
   for(const [name,path] of Object.entries(paths))unsub.push(sdk.onValue(sdk.ref(database,path),snap=>{if(ticket===epoch)deliver(name,snap.val());},e=>{if(ticket===epoch){stop();status('error','Gagal membaca data. Pastikan Rules versi perangkat sudah dipublish. '+(e.code||''));}}));
   loaded=true;status(connected?'ready':'offline');
  }catch(e){if(ticket===epoch){stop();status('error','Database belum dapat diakses. Publish database.rules.json versi ini. '+(e.code||e.message));}}
 }
 const api={
  async init(){await sdk.setPersistence(auth,sdk.browserSessionPersistence);sdk.onAuthStateChanged(auth,authChanged);},
  async login(email,password){await sdk.signInWithEmailAndPassword(auth,email,password);},async logout(){await sdk.signOut(auth);},get ready(){return !!(loaded&&connected&&user?.uid===LIVE_OPERATOR_UID);},
  async upsertPatient(patient,isNew=false){requireReady();if(!validLivePatient(patient))throw Error('Identitas tidak valid.');const existing=(await sdk.get(sdk.ref(database,'patients/'+patient.id))).val();if(isNew&&existing)throw Error('Kartu sudah terdaftar. Identitas akan dimuat ulang.');const card=(await sdk.get(sdk.ref(database,'cards/'+patient.uid))).val();if(card&&card.patientId!==patient.id)throw Error('Kartu terkait pasien lain.');requireReady();await sdk.update(sdk.ref(database),{['patients/'+patient.id]:patient,['cards/'+patient.uid]:{patientId:patient.id}});},
  async finalizeRaw(raw,expert){requireReady();if(!validLiveResult(raw))throw Error('Payload alat tidak valid.');const path='measurements/'+raw.sessionId;let existing=(await sdk.get(sdk.ref(database,path))).val();if(existing){if(!sameDeviceRecord(existing,raw))throw Error('ID sesi bertabrakan dengan hasil berbeda.');pendingIds.delete(raw.sessionId);publishRecords();return existing;}
   const card=(await sdk.get(sdk.ref(database,'cards/'+raw.uid))).val();if(card?.patientId!==raw.patient.id)throw Error('UID hasil tidak cocok dengan pasien terdaftar.');
   const record={id:raw.sessionId,deviceId:raw.deviceId,patientId:raw.uid,patient:raw.patient,values:raw.values,measuredAt:new Date(raw.measuredAtMs).toISOString(),source:'esp32',expert,receivedAt:sdk.serverTimestamp(),savedBy:user.uid};
   requireReady();pendingIds.add(record.id);publishRecords();
   try{await sdk.update(sdk.ref(database),{[path]:record,['sessions/'+record.id]:{id:record.id,deviceId:raw.deviceId,patientId:record.patientId,status:'saved',source:'esp32',measuredAt:record.measuredAt},['resultAcks/'+raw.deviceId+'/'+record.id]:{sessionId:record.id,uid:raw.uid,processedAt:sdk.serverTimestamp()}});}
   catch(error){existing=(await sdk.get(sdk.ref(database,path))).val();if(!sameDeviceRecord(existing,raw))throw error;pendingIds.delete(record.id);publishRecords();return existing;}
   pendingIds.delete(record.id);publishRecords();return record;
  },
  async saveSettings(settings){requireReady();await sdk.set(sdk.ref(database,'settings'),settings);}
 };return api;
}
if(typeof module!=='undefined')module.exports={createCloudRepository,validLivePatient,validLiveResult,sameDeviceRecord};
