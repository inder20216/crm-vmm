import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { vmm } from '../api/vmm';

const TYPE_LABELS = { superadmin: 'Super Admin', admin: 'Admin', user: 'Agent', facilitymanager: 'Facility Manager', ho: 'HO' };
const TYPE_COLORS = { superadmin: '#4f46e5', admin: '#7c3aed', user: '#0ea5e9', facilitymanager: '#16a34a', ho: '#f59e0b' };

function Badge({ value, colorMap, labelMap }) {
  const color = colorMap[value] || '#64748b';
  return (
    <span style={{
      background: color + '18', color, border: `1px solid ${color}40`,
      borderRadius: 20, padding: '2px 10px', fontSize: 11, fontWeight: 600, letterSpacing: .3,
    }}>
      {labelMap?.[value] || value}
    </span>
  );
}

const EMPTY_FORM = { name: '', ms_email: '', type: 'user', status: 'active' };

export default function UserManagement() {
  const { currentUser } = useAuth();
  const [users,   setUsers]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal,   setModal]   = useState(null);   // null | 'add' | 'edit'
  const [form,    setForm]    = useState(EMPTY_FORM);
  const [saving,  setSaving]  = useState(false);
  const [toast,   setToast]   = useState('');
  const [confirm, setConfirm] = useState(null);  // { userId, action }

  const showToast = (msg, type = 'ok') => {
    setToast({ msg, type });
    setTimeout(() => setToast(''), 3200);
  };

  const load = () => {
    setLoading(true);
    vmm.listUsers()
      .then(r => setUsers(r.users || []))
      .catch(() => showToast('Failed to load users', 'err'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const openAdd = () => { setForm(EMPTY_FORM); setModal('add'); };
  const openEdit = (u) => {
    setForm({ name: u.name, ms_email: u.ms_email, role: u.role, status: u.status, id: u.id });
    setModal('edit');
  };
  const closeModal = () => { setModal(null); setForm(EMPTY_FORM); };

  const handleSave = async () => {
    if (!form.name.trim() || !form.ms_email.trim()) {
      showToast('Name and email are required', 'err'); return;
    }
    setSaving(true);
    try {
      if (modal === 'add') {
        await vmm.createUser({ name: form.name.trim(), email: form.ms_email.trim().toLowerCase(), type: form.type });
        showToast('User added successfully');
      } else {
        await vmm.updateUser({ id: form.id, name: form.name.trim(), email: form.ms_email.trim().toLowerCase(), type: form.type, status: form.status });
        showToast('User updated');
      }
      closeModal();
      load();
    } catch {
      showToast('Save failed — check details and try again', 'err');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleStatus = async (u) => {
    const next = u.status === 'active' ? 'inactive' : 'active';
    try {
      await vmm.updateUser({ id: u.id, name: u.name, ms_email: u.ms_email, role: u.role, status: next });
      showToast(next === 'inactive' ? 'User deactivated' : 'User activated');
      load();
    } catch {
      showToast('Failed to update status', 'err');
    }
    setConfirm(null);
  };

  const handleDelete = async (id) => {
    try {
      await vmm.deleteUser({ id });
      showToast('User deleted');
      load();
    } catch {
      showToast('Failed to delete user', 'err');
    }
    setConfirm(null);
  };

  const s = {
    page:       { padding: '28px 32px', fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", maxWidth: 900 },
    header:     { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 },
    title:      { fontSize: 22, fontWeight: 800, color: '#1e1b4b', margin: 0 },
    sub:        { fontSize: 13, color: '#64748b', marginTop: 4 },
    addBtn:     { background: '#7c3aed', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 20px', fontWeight: 700, fontSize: 13, cursor: 'pointer' },
    card:       { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, overflow: 'hidden' },
    table:      { width: '100%', borderCollapse: 'collapse' },
    th:         { padding: '11px 16px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: '#64748b', letterSpacing: .6, textTransform: 'uppercase', background: '#f8fafc', borderBottom: '1px solid #e2e8f0' },
    td:         { padding: '13px 16px', fontSize: 13, color: '#1e293b', borderBottom: '1px solid #f1f5f9' },
    nameCell:   { fontWeight: 600, color: '#1e1b4b' },
    emailCell:  { color: '#64748b', fontSize: 12 },
    actionBtn:  (color) => ({ background: 'none', border: `1px solid ${color}`, borderRadius: 6, padding: '4px 10px', fontSize: 11, fontWeight: 600, color, cursor: 'pointer' }),
    // Modal
    overlay:    { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' },
    modalBox:   { background: '#fff', borderRadius: 14, padding: '28px 32px', width: 400, boxShadow: '0 20px 60px rgba(0,0,0,.2)' },
    modalTitle: { fontSize: 17, fontWeight: 800, color: '#1e1b4b', marginBottom: 20 },
    label:      { fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6 },
    input:      { width: '100%', border: '1px solid #d1d5db', borderRadius: 8, padding: '9px 12px', fontSize: 13, boxSizing: 'border-box', outline: 'none' },
    select:     { width: '100%', border: '1px solid #d1d5db', borderRadius: 8, padding: '9px 12px', fontSize: 13, background: '#fff', cursor: 'pointer', boxSizing: 'border-box' },
    row:        { marginBottom: 16 },
    actions:    { display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 24 },
    cancelBtn:  { background: '#f1f5f9', color: '#64748b', border: 'none', borderRadius: 8, padding: '9px 18px', fontWeight: 600, fontSize: 13, cursor: 'pointer' },
    saveBtn:    { background: '#7c3aed', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 22px', fontWeight: 700, fontSize: 13, cursor: 'pointer' },
    toast:      (type) => ({
      position: 'fixed', bottom: 24, right: 24, zIndex: 2000,
      background: type === 'err' ? '#fee2e2' : '#dcfce7',
      color: type === 'err' ? '#b91c1c' : '#15803d',
      border: `1px solid ${type === 'err' ? '#fca5a5' : '#86efac'}`,
      borderRadius: 10, padding: '12px 20px', fontWeight: 600, fontSize: 13,
      boxShadow: '0 4px 16px rgba(0,0,0,.12)',
    }),
    confirmBox: { background: '#fff', borderRadius: 12, padding: '24px 28px', width: 340, boxShadow: '0 20px 60px rgba(0,0,0,.2)' },
    confirmMsg: { fontSize: 14, color: '#374151', marginBottom: 20, lineHeight: 1.5 },
    confirmBtns:{ display: 'flex', gap: 10, justifyContent: 'flex-end' },
    dangerBtn:  { background: '#ef4444', color: '#fff', border: 'none', borderRadius: 7, padding: '8px 18px', fontWeight: 700, fontSize: 13, cursor: 'pointer' },
    warnBtn:    { background: '#f59e0b', color: '#fff', border: 'none', borderRadius: 7, padding: '8px 18px', fontWeight: 700, fontSize: 13, cursor: 'pointer' },
  };

  return (
    <div style={s.page}>
      {/* Toast */}
      {toast && <div style={s.toast(toast.type)}>{toast.msg}</div>}

      {/* Header */}
      <div style={s.header}>
        <div>
          <h1 style={s.title}>User Management</h1>
          <div style={s.sub}>Manage CRM access — Admin sees all, Agent sees Inbox &amp; Search only</div>
        </div>
        <button style={s.addBtn} onClick={openAdd}>+ Add User</button>
      </div>

      {/* Table */}
      <div style={s.card}>
        {loading ? (
          <div style={{ padding: 32, textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>Loading users…</div>
        ) : users.length === 0 ? (
          <div style={{ padding: 32, textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>No users found. Add one to get started.</div>
        ) : (
          <table style={s.table}>
            <thead>
              <tr>
                <th style={s.th}>Name</th>
                <th style={s.th}>Microsoft Email</th>
                <th style={s.th}>Type</th>
                <th style={s.th}>Status</th>
                <th style={s.th}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map(u => (
                <tr key={u.id} style={{ opacity: u.status === 'inactive' ? .55 : 1 }}>
                  <td style={{ ...s.td, ...s.nameCell }}>
                    {u.name}
                    {u.ms_email === currentUser?.email && (
                      <span style={{ marginLeft: 6, fontSize: 10, background: '#7c3aed18', color: '#7c3aed', borderRadius: 10, padding: '1px 6px', fontWeight: 700 }}>You</span>
                    )}
                  </td>
                  <td style={{ ...s.td, ...s.emailCell }}>{u.ms_email}</td>
                  <td style={s.td}>
                    <Badge value={u.type || u.role} colorMap={TYPE_COLORS} labelMap={TYPE_LABELS} />
                  </td>
                  <td style={s.td}>
                    <Badge
                      value={u.status}
                      colorMap={{ active: '#16a34a', inactive: '#94a3b8' }}
                      labelMap={{ active: 'Active', inactive: 'Inactive' }}
                    />
                  </td>
                  <td style={s.td}>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button style={s.actionBtn('#7c3aed')} onClick={() => openEdit(u)}>Edit</button>
                      {u.ms_email !== currentUser?.email && (
                        <button
                          style={s.actionBtn(u.status === 'active' ? '#f59e0b' : '#16a34a')}
                          onClick={() => setConfirm({ user: u, action: 'toggle' })}
                        >
                          {u.status === 'active' ? 'Deactivate' : 'Activate'}
                        </button>
                      )}
                      {u.ms_email !== currentUser?.email && (
                        <button style={s.actionBtn('#ef4444')} onClick={() => setConfirm({ user: u, action: 'delete' })}>Delete</button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Add / Edit Modal */}
      {modal && (
        <div style={s.overlay} onClick={closeModal}>
          <div style={s.modalBox} onClick={e => e.stopPropagation()}>
            <div style={s.modalTitle}>{modal === 'add' ? 'Add New User' : 'Edit User'}</div>

            <div style={s.row}>
              <label style={s.label}>Full Name *</label>
              <input style={s.input} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Rahul Sharma" />
            </div>
            <div style={s.row}>
              <label style={s.label}>Microsoft Email *</label>
              <input style={s.input} type="email" value={form.ms_email} onChange={e => setForm(f => ({ ...f, ms_email: e.target.value }))} placeholder="agent@openmind.in" />
              <span style={{ fontSize: 11, color: '#94a3b8', marginTop: 4, display: 'block' }}>Must match the account they use to sign in to Microsoft</span>
            </div>
            <div style={s.row}>
              <label style={s.label}>Type</label>
              <select style={s.select} value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}>
                <option value="user">Agent — Inbox &amp; Search only</option>
                <option value="admin">Super Admin — Full access</option>
                <option value="facilitymanager">Facility Manager</option>
                <option value="ho">HO</option>
              </select>
            </div>
            {modal === 'edit' && (
              <div style={s.row}>
                <label style={s.label}>Status</label>
                <select style={s.select} value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </div>
            )}

            <div style={s.actions}>
              <button style={s.cancelBtn} onClick={closeModal} disabled={saving}>Cancel</button>
              <button style={s.saveBtn} onClick={handleSave} disabled={saving}>
                {saving ? 'Saving…' : modal === 'add' ? 'Add User' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm dialog */}
      {confirm && (
        <div style={s.overlay} onClick={() => setConfirm(null)}>
          <div style={s.confirmBox} onClick={e => e.stopPropagation()}>
            <div style={s.confirmMsg}>
              {confirm.action === 'delete'
                ? `Delete ${confirm.user.name}? This cannot be undone.`
                : confirm.user.status === 'active'
                  ? `Deactivate ${confirm.user.name}? They will lose CRM access immediately.`
                  : `Reactivate ${confirm.user.name}? They will regain access.`}
            </div>
            <div style={s.confirmBtns}>
              <button style={s.cancelBtn} onClick={() => setConfirm(null)}>Cancel</button>
              {confirm.action === 'delete'
                ? <button style={s.dangerBtn} onClick={() => handleDelete(confirm.user.id)}>Delete</button>
                : <button style={confirm.user.status === 'active' ? s.warnBtn : s.saveBtn} onClick={() => handleToggleStatus(confirm.user)}>
                    {confirm.user.status === 'active' ? 'Deactivate' : 'Activate'}
                  </button>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
