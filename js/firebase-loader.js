import {firebaseConfig} from './firebase-config.js';
try {
 const base='https://www.gstatic.com/firebasejs/12.19.0/';
 const modules=await Promise.all(['firebase-app.js','firebase-auth.js','firebase-database.js'].map(path=>import(base+path)));
 await window.initializeCloud(Object.assign({},...modules),firebaseConfig);
} catch(error) {
 window.cloudStartupError('Layanan belum dapat dimuat. Pastikan internet aktif, lalu muat ulang. '+(error.code||''));
 console.error('Firebase initialization failed',error);
}
