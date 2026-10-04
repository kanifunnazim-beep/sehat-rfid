'use strict';
// Basis aturan dokumen pengguna; klasifikasi awal, bukan diagnosis klinis.
const ExpertSystem=(()=>{
 const version='pdf-rules-imtu-v2';
 const imtu=typeof IMTUReference!=='undefined'?IMTUReference:typeof require==='function'?require('./imtu-reference.js'):null;
 const combinations=[['N','N','N'],['L','N','N'],['H','N','N'],['N','L','N'],['N','H','N'],['N','N','L'],['N','N','H'],['L','L','N'],['L','H','N'],['H','L','N'],['H','H','N'],['L','N','L'],['L','N','H'],['H','N','L'],['H','N','H'],['N','L','L'],['N','L','H'],['N','H','L'],['N','H','H'],['L','L','L'],['L','L','H'],['L','H','L'],['L','H','H'],['H','L','L'],['H','L','H'],['H','H','L'],['H','H','H']];
 const rules=combinations.map((facts,i)=>({id:'D'+String(i+1).padStart(3,'0'),facts,key:i===0?'K1':i<7?'K2':'K3'}));
 const outputs={K1:{label:'Disarankan',direction:'Lanjut Pelayanan Gizi'},K2:{label:'Disarankan dengan Syarat',direction:'Lanjut dengan Catatan'},K3:{label:'Sangat Tidak Disarankan',direction:'Pemeriksaan Lanjutan Sesuai Klaster, kemudian Pelayanan Gizi'}};
 function infer(patient,values){
  const result={version,status:'incomplete',ruleId:null,key:null,bmi:null,facts:[],notes:[],direction:'Lengkapi penilaian bersama petugas sebelum menentukan pengarahan.',label:'Belum dapat disimpulkan'};
  const age=Number(patient.age);
  if(!Number.isInteger(age)||age<0||age>120||!['weight','height','pulse','temperature'].every(k=>typeof values[k]==='number'&&Number.isFinite(values[k])&&values[k]>0)){result.notes.push('Umur atau hasil pengukuran tidak valid.');return result;}
  const bmi=values.weight/(values.height/100)**2;result.bmi=bmi;
  const classify=(x,lo,hi)=>x<lo?'L':x>hi?'H':'N';
  let pulse=null;
  if(age>=7){const lo=age<=10?70:60,hi=age<=10?120:100;pulse=classify(values.pulse,lo,hi);result.facts.push({code:'P001',name:'Denyut nadi',state:pulse,label:pulse==='N'?'Normal':pulse==='L'?'Di bawah rentang (bradikardia menurut PDF)':'Di atas rentang (takikardia menurut PDF)',range:`${lo}–${hi} bpm`});}
  else{result.facts.push({code:'P001',name:'Denyut nadi',state:null,label:'Belum dinilai',range:'PDF tidak memuat batas usia di bawah 7 tahun'});result.notes.push('Rentang denyut nadi usia di bawah 7 tahun belum tersedia pada PDF.');}
  const temp=values.temperature<35.5?'L':values.temperature>=38?'H':'N';result.facts.push({code:'P002',name:'Suhu tubuh',state:temp,label:temp==='N'?'Normal':temp==='L'?'Di bawah rentang suhu PDF':'Di atas rentang suhu PDF',range:'35,5 ≤ suhu < 38 °C'});
  let bmiState=null,bmiLabel=null,bmiRange=null;
  if(patient.category==='Ibu hamil'){result.notes.push('IMT dari berat saat hamil tidak digunakan untuk klasifikasi dewasa. Diperlukan data sebelum hamil dan aturan khusus kehamilan.');}
  else if(age<18){
   const months=patient.ageMonths;
   if(!Number.isInteger(months)||Math.floor(months/12)!==age){result.notes.push('Lengkapi umur tahun dan bulan saat pemeriksaan untuk menilai IMT/U.');}
   else if(months<61){result.notes.push('Tabel yang diberikan dimulai pada 5 tahun 1 bulan. IMT/U usia ini belum dinilai.');}
   else if(!['Laki-laki','Perempuan'].includes(patient.sex)){result.notes.push('Jenis kelamin diperlukan untuk memilih tabel IMT/U.');}
   else if(!imtu){result.notes.push('Tabel IMT/U belum termuat. Muat ulang halaman.');}
   else{
    const row=imtu[patient.sex==='Laki-laki'?'boys':'girls'][months-imtu.firstMonth];
    if(row){
     const [sd3,sd2,,,sd1plus,sd2plus]=row;
     bmiState=classify(bmi,sd2,sd1plus);
     bmiLabel=bmi<sd3?'Sangat kurus':bmi<sd2?'Kurus':bmi<=sd1plus?'Normal':bmi<=sd2plus?'Gizi lebih':'Obesitas';
     bmiRange=`${sd2}–${sd1plus} kg/m² (-2 SD hingga +1 SD), ${age} th ${months%12} bln`;
     result.imtu={ageMonths:months,sex:patient.sex,category:bmiLabel,normalMin:sd2,normalMax:sd1plus,reference:'WHO 2007 / tabel IMT-U dokumen pengguna',method:'Perbandingan ambang tabel bulanan; bukan perhitungan z-score numerik'};
    }
   }
  }
  else{bmiState=classify(bmi,18.5,22.9);}
  result.facts.push({code:'P003',name:age<18?'IMT/U':'IMT',state:bmiState,label:bmiLabel||(bmiState===null?'Belum dinilai':bmiState==='N'?'Normal':bmiState==='L'?'IMT kurang':'IMT lebih'),range:bmiRange||(bmiState===null?'Referensi tambahan diperlukan':'18,5–22,9 kg/m² (PDF)')});
  if(pulse!==null&&bmiState!==null){const rule=rules.find(r=>r.facts.every((f,i)=>f===[pulse,temp,bmiState][i]));if(rule){Object.assign(result,{status:'matched',ruleId:rule.id,key:rule.key,...outputs[rule.key]});}}
  if(['Ibu nifas','Ibu menyusui','Peserta KB'].includes(patient.category))result.notes.push('PDF tidak memuat aturan khusus kategori ini; hasil mengikuti aturan umum dan perlu ditinjau petugas.');
  result.notes.push('Klasifikasi awal berdasarkan aturan PDF pengguna; bukan diagnosis atau penentu kelayakan pelayanan. Konfirmasi oleh petugas.');
  return result;
 }
 function diagnosis(result){
  if(result.status!=='matched')return 'Belum dapat disimpulkan';
  const names={P001:{L:'Bradikardia',H:'Takikardia'},P002:{L:'Suhu rendah',H:'Suhu tinggi'},P003:{L:'IMT kurang',H:'IMT lebih'}};
  const abnormal=result.facts.filter(f=>f.state==='L'||f.state==='H').map(f=>names[f.code][f.state]);
  return abnormal.length?abnormal.join(', '):'Parameter dalam rentang normal';
 }
 function guidance(result){
  if(result.status!=='matched')return result.direction;
  if(result.key==='K1')return 'Lanjut ke Poli Gizi untuk pelayanan gizi.';
  if(result.key==='K2'){
   const bmiAbnormal=result.facts.some(f=>f.code==='P003'&&['L','H'].includes(f.state));
   return 'Lakukan pengukuran ulang denyut nadi dan suhu tubuh.'+(bmiAbnormal?' Periksa ulang berat badan dan tinggi badan serta penilaian IMT.':'')+' Jika hasil pengukuran ulang normal, lanjut ke Poli Gizi. Jika hasil tetap tidak normal, lakukan pemeriksaan di klaster 3. Setelah kondisi ditangani atau dinyatakan stabil, lanjut ke Poli Gizi.';
  }
  return 'Lakukan pemeriksaan lanjutan sesuai klaster. Setelah kondisi ditangani atau dinyatakan stabil oleh petugas, lanjut ke Poli Gizi.';
 }
 return {infer,rules,version,diagnosis,guidance};
})();
if(typeof module!=='undefined')module.exports=ExpertSystem;
