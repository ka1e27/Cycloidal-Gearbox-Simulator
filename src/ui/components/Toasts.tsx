import { Icon } from './Icon';
import { useStore } from '../store';

export function Toasts() {
  const { toasts, dismissToast, storageOk } = useStore();
  return (
    <div className="toasts" aria-live="polite" aria-atomic="false">
      {!storageOk && (
        <div className="toast toast-info" role="status">
          <Icon name="info" size={17} />
          <span>Browser storage is unavailable, so this session will not be remembered. Use Export JSON to keep it.</span>
        </div>
      )}
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind}`} role={t.kind === 'error' ? 'alert' : 'status'}>
          <Icon name={t.kind === 'error' ? 'x-circle' : t.kind === 'success' ? 'check-circle' : 'info'} size={17} />
          <span>{t.text}</span>
          <button type="button" className="toast-x" onClick={() => dismissToast(t.id)} aria-label="Dismiss message">
            <Icon name="x" size={15} />
          </button>
        </div>
      ))}
    </div>
  );
}
