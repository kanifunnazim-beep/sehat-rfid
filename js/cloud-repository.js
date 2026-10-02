'use strict';
// SDK diinjeksikan agar kontrak async dapat diuji tanpa kredensial pengguna.
function createCloudRepository(sdk,config,hooks){
 const allowedUid='FgQtDdYxbJUO1rSl6NhZfROvMKe2';
 const app=sdk.initializeApp(config),auth=sdk.getAuth(app),database=sdk.getDatabase(app);
 let user=null,ready=false,connected=false,epoch=0,unsubscribe=[],connectionLoaded=false,deniedMessage='';
 const pendingIds=new Set();let latestRecords=[];
 const defaults={facility:'SEHAT RFID',address:'Layanan Pengukuran Pasien'};
 function status(state,message=''){hooks.onState({state,message,email:user?.email||'',connected});}
 function publishRecords(){hooks.onData('records',latestRecords.filter(r=>!pendingIds.has(r.id)));}
 function deliver(name,value){if(name==='records'){latestRecords=normalize.records(value);publishRecords();}else hooks.onData(name,normalize[name](value));}
 function stop(){unsubscribe.forEach(off=>off());unsubscribe=[];ready=false;}
 function requireReady(){if(!user||user.uid!==allowedUid||!ready)throw Error('Login dan tunggu data selesai dimuat.');if(!connected)throw Error('Firebase offline. Tunggu koneksi kembali sebelum menyimpan.');}
 function validPatient(p){return p&&typeof p.id==='string'&&typeof p.uid==='string'&&typeof p.name==='string'&&Number.isInteger(p.age)&&['Laki-laki','Perempuan'].includes(p.sex)&&typeof p.category==='string';}
 function validRecord(r){return r&&typeof r.id==='string'&&validPatient(r.patient)&&typeof r.measuredAt==='string'&&Number.isFinite(Date.parse(r.measuredAt))&&['weight','height','pulse','temperature'].every(k=>typeof r.values?.[k]==='number'&&Number.isFinite(r.values[k]));}
 const normalize={patients:v=>Object.values(v||{}).filter(validPatient),records:v=>Object.values(v||{}).filter(validRecord).sort((a,b)=>b.measuredAt.localeCompare(a.measuredAt)),settings:v=>({facility:typeof v?.facility==='string'?v.facility:defaults.facility,address:typeof v?.address==='string'?v.address:defaults.address})};
 const connectionOff=sdk.onValue(sdk.ref(database,'.info/connected'),snap=>{connected=snap.val()===true;connectionLoaded=true;if(user&&ready)status(connected?'ready':'offline');});
 async function authChanged(nextUser){const ticket=++epoch;stop();user=nextUser;pendingIds.clear();latestRecords=[];hooks.onClear();if(!user){status('signed-out',deniedMessage);deniedMessage='';return;}if(user.uid!==allowedUid){deniedMessage='Akun ini belum diberi izin sebagai petugas.';status('error',deniedMessage);await sdk.signOut(auth);return;}status('loading','Memuat data Firebase…');
  const paths={patients:'patients',records:'measurements',settings:'settings'};
  try{
   const entries=await Promise.all(Object.entries(paths).map(async([name,path])=>[name,await sdk.get(sdk.ref(database,path))]));if(ticket!==epoch)return;
   for(const [name,snapshot] of entries)deliver(name,snapshot.val());
   // Subscription dibuat setelah semua pembacaan awal berhasil. Listener akan mengirim snapshot terbaru lagi.
   for(const [name,path] of Object.entries(paths)){unsubscribe.push(sdk.onValue(sdk.ref(database,path),snap=>{if(ticket===epoch)deliver(name,snap.val());},e=>{if(ticket===epoch){stop();status('error','Akses data ditolak. Periksa Rules atau masuk ulang. '+(e.code||''));}}));}
   ready=true;status(connected?'ready':'offline',connectionLoaded?'':'Menunggu koneksi Firebase…');
  }catch(e){if(ticket===epoch){stop();status('error','Gagal memuat database. Periksa Rules. '+(e.code||e.message));}}
 }
 const api={
  async init(){await sdk.setPersistence(auth,sdk.browserSessionPersistence);sdk.onAuthStateChanged(auth,authChanged);},
  async login(email,password){await sdk.signInWithEmailAndPassword(auth,email,password);},
  async logout(){await sdk.signOut(auth);},
  async upsertPatient(patient,isNew=false){requireReady();const cardSnap=await sdk.get(sdk.ref(database,'cards/'+patient.uid));const card=cardSnap.val();if(card&&card.patientId!==patient.id)throw Error('Kartu sudah terhubung ke pasien lain. Tap kembali.');if(isNew){const patientSnap=await sdk.get(sdk.ref(database,'patients/'+patient.id));if(patientSnap.exists())throw Error('Kartu sudah terdaftar. Tutup formulir dan tap kembali.');}
   requireReady();await sdk.update(sdk.ref(database),{['patients/'+patient.id]:patient,['cards/'+patient.uid]:{patientId:patient.id}});
  },
  async saveSession(record){requireReady();const existing=(await sdk.get(sdk.ref(database,'measurements/'+record.id))).val();if(existing){if(existing.patientId!==record.patientId||existing.measuredAt!==record.measuredAt||['weight','height','pulse','temperature'].some(k=>existing.values?.[k]!==record.values[k]))throw Error('ID sesi sudah digunakan oleh hasil lain.');pendingIds.delete(record.id);publishRecords();return;}requireReady();pendingIds.add(record.id);publishRecords();await sdk.update(sdk.ref(database),{['measurements/'+record.id]:{...record,receivedAt:sdk.serverTimestamp(),savedBy:user.uid},['sessions/'+record.id]:{id:record.id,patientId:record.patientId,status:'saved',source:record.source,measuredAt:record.measuredAt}});pendingIds.delete(record.id);publishRecords();},
  async saveSettings(settings){requireReady();await sdk.set(sdk.ref(database,'settings'),settings);},
  get ready(){return ready&&connected&&user?.uid===allowedUid;}
 };
 return api;
}
if(typeof module!=='undefined')module.exports={createCloudRepository};
