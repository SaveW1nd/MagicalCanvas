import React, { useState, useEffect } from 'react';

export const RenameModal: React.FC<{
  open: boolean; initial: string; label?: string;
  onSave: (v: string) => Promise<void> | void; onClose: () => void;
}> = ({ open, initial, label = '名称', onSave, onClose }) => {
  const [v, setV] = useState(initial);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) setV(initial); }, [open, initial]);
  if (!open) return null;
  const submit = async () => { if (!v.trim() || busy) return; setBusy(true); try { await onSave(v.trim()); onClose(); } finally { setBusy(false); } };
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }} onClick={onClose}>
      <div style={{ background: '#1e1e1e', color: '#eee', padding: 20, borderRadius: 12, width: 360, maxWidth: '90vw' }} onClick={e => e.stopPropagation()}>
        <div style={{ marginBottom: 10, fontWeight: 600 }}>重命名</div>
        <div style={{ fontSize: 12, opacity: .7, marginBottom: 6 }}>{label}</div>
        <input autoFocus value={v} onChange={e => setV(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') submit(); }}
          style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid #444', background: '#111', color: '#eee', boxSizing: 'border-box' }} />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button onClick={onClose} disabled={busy} style={{ padding: '6px 14px', borderRadius: 8, border: '1px solid #444', background: 'transparent', color: '#ccc', cursor: 'pointer' }}>取消</button>
          <button onClick={submit} disabled={busy || !v.trim()} style={{ padding: '6px 14px', borderRadius: 8, border: 'none', background: '#3b82f6', color: '#fff', cursor: 'pointer' }}>{busy ? '保存中…' : '确定'}</button>
        </div>
      </div>
    </div>
  );
};
