// firebase-config.js ── 雲端設定。
// 這些值是「公開金鑰」，設計上就是要放在前端程式裡，放進公開倉庫沒問題；
// 真正的保護靠 Firestore 安全規則（只有登入者本人能讀寫自己的資料）。
// 若要暫時切回本機模式，把下面整個物件改成 null 即可。
export const firebaseConfig = {
  apiKey: "AIzaSyBgGpI1c1Rey83N-oDiTkz3NXMgjezDFh8",
  authDomain: "pig-calorie.firebaseapp.com",
  projectId: "pig-calorie",
  storageBucket: "pig-calorie.firebasestorage.app",
  messagingSenderId: "356057650045",
  appId: "1:356057650045:web:f285e2be2c645e25e57214",
};
