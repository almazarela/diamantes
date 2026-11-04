// Zarela: recibe avisos push aunque la página esté cerrada
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("push", (e) => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch (_) {}
  e.waitUntil((async () => {
    // si la página está abierta y a la vista, ella misma avisa con su sonido
    const ws = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    if (ws.some((w) => w.visibilityState === "visible")) return;
    await self.registration.showNotification(d.titulo || "Zarela", {
      body: d.cuerpo || "", icon: "icon-192.png", badge: "badge-96.png", vibrate: d.urgente ? [600, 200, 600, 200, 600, 200, 900] : [120, 60, 120],
      tag: d.tag || "zarela", renotify: true, requireInteraction: !!d.urgente, data: { url: d.url || "./" },
    });
  })());
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || "./";
  e.waitUntil((async () => {
    const ws = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const w of ws) { if ("focus" in w) return w.focus(); }
    return self.clients.openWindow(url);
  })());
});
