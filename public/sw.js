self.addEventListener('push', e => {
  const data = e.data ? e.data.json() : {};
  e.waitUntil(
    self.registration.showNotification(data.title || '🌸 MY FOTO', {
      body: data.body || 'มีข้อความใหม่ค่า',
      icon: 'https://em-content.zobj.net/source/apple/354/cherry-blossom_1f338.png',
      badge: 'https://em-content.zobj.net/source/apple/354/cherry-blossom_1f338.png',
      tag: 'myfoto-msg',
      renotify: true,
      vibrate: [200, 100, 200],
      data: { url: data.url || '/' }
    })
  );
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(clients.openWindow(e.notification.data.url || '/'));
});
