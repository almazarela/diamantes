// Zarela: recibe avisos push aunque la página esté cerrada
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("push", (e) => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch (_) {}
  e.waitUntil((async () => {
    // si la página está abierta y a la vista, ella misma avisa con su sonido
    const ws = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    if (ws.some((w) => w.visibilityState === "visible")) return;
    // agrupa como WhatsApp: si ya hay un aviso de la misma conversación, pasa a «N mensajes de Juana»
    const tag = d.tag || "zarela";
    let n = 1;
    try { const previos = await self.registration.getNotifications({ tag }); if (previos.length) n = ((previos[0].data && previos[0].data.n) || 1) + 1; } catch (_) {}
    const quien = d.titulo || "Zarela";
    const agrupable = /^(chat|dm)/.test(tag);
    await self.registration.showNotification(n > 1 && agrupable ? n + " mensajes de " + quien : quien, {
      body: d.cuerpo || "", icon: "icon-192.png", badge: "badge-96.png", vibrate: d.urgente ? [600, 200, 600, 200, 600, 200, 900] : [120, 60, 120],
      tag, renotify: true, requireInteraction: !!d.urgente, data: { url: d.url || "./", n },
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
