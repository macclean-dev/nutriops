// Hook leve de notificações no browser — extraído de controls.jsx pra que o
// resto de controls.jsx (que é pesado) possa ser lazy-loaded.

import { useCallback, useEffect, useState } from 'react';

export function useBrowserNotifications(turns, activeTenantId) {
  const [permission, setPermission] = useState(() =>
    'Notification' in window ? Notification.permission : 'unavailable'
  );

  const request = async () => {
    if (!('Notification' in window)) return;
    const result = await Notification.requestPermission();
    setPermission(result);
  };

  const notify = useCallback((title, body, onClick) => {
    if (permission !== 'granted') return;
    const n = new Notification(title, { body, icon: '/favicon.ico', badge: '/favicon.ico' });
    if (onClick) n.onclick = onClick;
  }, [permission]);

  useEffect(() => {
    if (permission !== 'granted' || !turns?.length) return;
    const jobs = [];
    const now = new Date();

    for (const turn of turns) {
      const [sh, sm] = turn.start.split(':').map(Number);
      const [eh, em] = turn.end.split(':').map(Number);
      const startMs = new Date(now.getFullYear(), now.getMonth(), now.getDate(), sh, sm, 0).getTime() - Date.now();
      const remMs   = new Date(now.getFullYear(), now.getMonth(), now.getDate(), eh, em - 5 < 0 ? em + 55 : em - 5, 0).getTime() - Date.now();

      if (startMs > 0) {
        const t = setTimeout(() => {
          notify(`Turno ${turn.name} iniciado — NutriOPS`, 'Hora de registrar as temperaturas.');
        }, startMs);
        jobs.push(t);
      }
      if (remMs > 0) {
        const t = setTimeout(() => {
          notify(`5 min para o turno ${turn.name} encerrar`, 'Verifique se todos os registros foram feitos.');
        }, remMs);
        jobs.push(t);
      }
    }
    return () => jobs.forEach(clearTimeout);
  }, [permission, turns, notify]);

  return { permission, request, notify };
}
