import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import type { AppNotification } from '../lib/types';
import BrandMark from './BrandLogo';

export default function AppHeader() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const { data: unread } = useQuery({
    queryKey: ['notifications', 'unread-count'],
    queryFn: () => api<{ count: number }>('/notifications/unread-count'),
    refetchInterval: 60_000,
  });

  const { data: notifications } = useQuery({
    queryKey: ['notifications', 'list'],
    queryFn: () => api<AppNotification[]>('/notifications?limit=20'),
    enabled: open,
  });

  const readMutation = useMutation({
    mutationFn: (id: string) => api(`/notifications/${id}/read`, { method: 'POST', body: '{}' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  const readAllMutation = useMutation({
    mutationFn: () => api('/notifications/read-all', { method: 'POST', body: '{}' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const count = unread?.count ?? 0;

  return (
    <header className="app-header">
      <BrandMark size="sm" showWordmark />
      <div className="app-header-actions" ref={panelRef}>
        <button
          type="button"
          className="icon-btn notif-bell"
          aria-label="Notificaciones"
          onClick={() => setOpen((v) => !v)}
        >
          🔔
          {count > 0 && <span className="notif-badge">{count > 9 ? '9+' : count}</span>}
        </button>
        {open && (
          <div className="notif-panel">
            <div className="row-between">
              <strong>Notificaciones</strong>
              {count > 0 && (
                <button type="button" className="btn-link" onClick={() => readAllMutation.mutate()}>
                  Marcar leídas
                </button>
              )}
            </div>
            <div className="notif-list">
              {notifications?.length === 0 && <p className="hint">Sin notificaciones.</p>}
              {notifications?.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  className={`notif-item ${n.readAt ? '' : 'unread'}`}
                  onClick={() => {
                    if (!n.readAt) readMutation.mutate(n.id);
                    const url = (n.data?.url as string | undefined) ?? '/recurrentes';
                    setOpen(false);
                    navigate(url);
                  }}
                >
                  <strong>{n.title}</strong>
                  <span>{n.body}</span>
                </button>
              ))}
            </div>
            <Link to="/recurrentes" className="btn-link" onClick={() => setOpen(false)}>
              Ir a recurrentes →
            </Link>
          </div>
        )}
      </div>
    </header>
  );
}
