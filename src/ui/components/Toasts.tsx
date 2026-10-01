import { Icon } from './Icon';
import { useStore } from '../store';

const WORD = { info: 'NOTE', success: 'DONE', error: 'ERROR' } as const;

export function Toasts() {
  const { toasts, dismissToast, storageOk } = useStore();
  return (
    <div className="toasts" aria-live="polite" aria-atomic="false">
      {!storageOk && (
        <div className="toast toast-info" role="status">
          <span className="toast-tag">NOTE</span>
          <span>Browser storage is unavailable, so this session will not be remembered. Use Export JSON to keep it.</span>
        </div>
      )}
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind}`} role={t.kind === 'error' ? 'alert' : 'status'}>
          <span className="toast-tag">{WORD[t.kind]}</span>
          <span>{t.text}</span>
          <button type="button" className="toast-x" onClick={() => dismissToast(t.id)} aria-label="Dismiss message">
            <Icon name="x" size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
