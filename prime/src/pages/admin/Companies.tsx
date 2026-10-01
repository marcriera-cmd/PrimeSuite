import { useState, type FormEvent } from 'react';
import { api, type AdminModule, type Company } from '../../api';
import { useSession } from '../../session';
import { AppIcon, ErrorBox, Icon, Loading, Modal, confirmAction, useData, useToast } from '../../components/ui';

export default function Companies() {
  const { me } = useSession();
  const { data, error, reload } = useData(() => Promise.all([api.get<Company[]>('/api/admin/companies'), api.get<AdminModule[]>('/api/admin/modules')]));
  const [edit, setEdit] = useState<Company | 'new' | null>(null);
  const companies = data?.[0] || [];
  const modules = data?.[1] || [];

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Empresas</h1>
          <span className="muted small">Cada empresa es un tenant: sus usuarios, grupos y las aplicaciones que tiene contratadas.</span>
        </div>
        {me?.isSuper && <button className="btn primary" onClick={() => setEdit('new')}><Icon.plus /> Nueva empresa</button>}
      </div>
      <ErrorBox error={error} />
      {!data && !error && <Loading />}
      {data && (
        <div className="card flat table-wrap">
          <table className="table">
            <thead><tr><th>Empresa</th><th>Código</th><th>CIF</th><th>Email</th><th>Usuarios</th><th>Aplicaciones</th></tr></thead>
            <tbody>
              {companies.map((c) => (
                <tr key={c.id} className={me?.isSuper ? 'clickable' : ''} onClick={() => me?.isSuper && setEdit(c)}>
                  <td><b>{c.name}</b></td>
                  <td className="mono">{c.code}</td>
                  <td>{c.taxId || '—'}</td>
                  <td>{c.email || '—'}</td>
                  <td>{c.userCount}</td>
                  <td>{c.enabledModules.length}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {edit && <CompanyModal company={edit === 'new' ? null : edit} modules={modules} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />}
    </>
  );
}

function CompanyModal({ company, modules, onClose, onSaved }: { company: Company | null; modules: AdminModule[]; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ name: company?.name || '', code: company?.code || '', taxId: company?.taxId || '', email: company?.email || '', enabledModules: company?.enabledModules || [] });
  const [error, setError] = useState<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      if (company) await api.put(`/api/admin/companies/${company.id}`, f);
      else await api.post('/api/admin/companies', f);
      toast('Empresa guardada');
      onSaved();
    } catch (err: any) {
      setError(err.message);
    }
  }
  async function remove() {
    if (!company || !confirmAction(`¿Eliminar ${company.name}?`)) return;
    try {
      await api.del(`/api/admin/companies/${company.id}`);
      toast('Empresa eliminada');
      onSaved();
    } catch (err: any) {
      setError(err.message);
    }
  }
  const toggle = (id: string) => setF({ ...f, enabledModules: f.enabledModules.includes(id) ? f.enabledModules.filter((x) => x !== id) : [...f.enabledModules, id] });
  return (
    <Modal title={company ? company.name : 'Nueva empresa'} onClose={onClose} wide>
      <form className="col" style={{ gap: 14 }} onSubmit={submit}>
        <ErrorBox error={error} />
        <div className="grid-2">
          <label className="field">Nombre<input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required /></label>
          <label className="field">Código (tenant)<span className="hint">Se envía a las apps como claim "tenant"</span><input className="input mono" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toLowerCase() })} pattern="[a-z0-9\-]{2,32}" required /></label>
          <label className="field">CIF<input className="input" value={f.taxId} onChange={(e) => setF({ ...f, taxId: e.target.value })} /></label>
          <label className="field">Email de contacto<input className="input" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></label>
        </div>
        <div className="field">Aplicaciones contratadas
          <div className="grid-2" style={{ gap: 8 }}>
            {modules.map((m) => (
              <label key={m.id} className="check" style={{ padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 10 }}>
                <input type="checkbox" checked={f.enabledModules.includes(m.id)} onChange={() => toggle(m.id)} />
                <AppIcon initials={m.initials} color={m.color} size={26} /> <span className="small">{m.name}</span>
              </label>
            ))}
          </div>
        </div>
        <div className="row">
          <button className="btn primary">Guardar</button>
          {company && <button type="button" className="btn danger" onClick={remove}><Icon.trash /> Eliminar</button>}
        </div>
      </form>
    </Modal>
  );
}
