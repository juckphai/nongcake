// service-worker.js
// ปรับปรุงให้รองรับ Firebase + Offline เต็มรูปแบบ และแก้ปัญหาการเชื่อมต่อ Database
const staticCacheName = 'account-app-static-v77149'; // อัพเดทเวอร์ชัน Cache เป็น v129
const dynamicCacheName = 'account-app-dynamic-v41779';

// ไฟล์ที่ต้อง cache ตั้งแต่ตอน install
const assets = [
  './',
  './index.html',
  './manifest.json',
  './style.css',
  './script.js',
  './192.png',
  './512.png',

  // ไลบรารีภายนอก (เพื่อใช้งาน offline)
  'https://cdnjs.cloudflare.com/ajax/libs/PapaParse/5.3.2/papaparse.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js',
  'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js',

  // ⭐⭐⭐ สำคัญมาก — Firebase SDK ต้อง cache ไม่งั้น offline ใช้ไม่ได้ ⭐⭐⭐
  'https://www.gstatic.com/firebasejs/10.8.0/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth-compat.js',
  'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore-compat.js',
];

// 1) INSTALL — cache ไฟล์ทั้งหมด
self.addEventListener('install', evt => {
  console.log('SW installing…');
  evt.waitUntil(
    caches.open(staticCacheName)
      .then(cache => cache.addAll(assets))
      .catch(err => console.error("CACHE ERROR:", err))
  );
  self.skipWaiting();
});

// 2) ACTIVATE — ลบ cache เก่า
self.addEventListener('activate', evt => {
  console.log('SW activated.');
  evt.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.filter(k => k !== staticCacheName && k !== dynamicCacheName)
            .map(k => caches.delete(k))
      );
    })
  );
  self.clients.claim();
});

// 3) FETCH — cache-first logic + dynamic cache
self.addEventListener('fetch', evt => {

  // ✅✅✅ ส่วนที่เพิ่มใหม่: ปล่อยผ่าน Firebase/Google API ไม่ให้ Service Worker เข้าไปยุ่ง
  if (evt.request.url.includes('firestore.googleapis.com') || 
      evt.request.url.includes('googleapis.com') ||
      evt.request.url.includes('identitytoolkit')) {
      return; // ปล่อยให้โหลดสดๆ ผ่าน Network โดยตรง
  }
  // ✅✅✅ จบส่วนที่เพิ่มใหม่

  // ป้องกัน error จาก chrome-extension หรือ request แปลกๆ
  if (!evt.request.url.startsWith('http')) return;

  evt.respondWith(
    caches.match(evt.request).then(cacheRes => {
      if (cacheRes) {
        return cacheRes; // 👍 โหลดจาก cache ก่อน
      }

      // ถ้าไม่มีใน cache → ดึงจาก network
      return fetch(evt.request)
        .then(networkRes => {
          // cache เฉพาะ response ปกติ
          if (networkRes && networkRes.status === 200) {
            caches.open(dynamicCacheName).then(cache => {
              // ใช้ request ไม่ใช่ request.url (สำคัญ)
              cache.put(evt.request, networkRes.clone());
            });
          }
          return networkRes;
        })
        .catch(() => {
          // ถ้า offline และไม่มี cache → ส่ง index.html แทน
          if (evt.request.destination === 'document') {
            return caches.match('./index.html');
          }
        });
    })
  );
});
