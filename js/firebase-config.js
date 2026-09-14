// firebase-config.js ── 雲端設定。
// null = 尚未設定雲端，APP 用「本機模式」跑（資料只存在這台裝置）。
// Roseline 建好 Firebase 專案後，把控制台給的 firebaseConfig 貼進來取代 null。
// 這些值是「公開金鑰」，設計上就是要放在前端程式裡，放進公開倉庫沒問題；
// 真正的保護靠 Firestore 安全規則（只有登入者本人能讀寫自己的資料）。
export const firebaseConfig = null;
