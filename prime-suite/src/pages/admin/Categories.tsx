import { useState } from 'react';
import { api, type Category } from '../../api';
import { ErrorBox, Icon, Loading, Toggle, confirmAction, useData, useToast } from '../../components/ui';
import { PALETTE } from './moduleForm';

export default function Categories() {
  const toast = useToast();
  const { data, error, reload } = useData(() => api.get<Category[]>('/api/admin/categories'));
  const [name, setName] = useState('');

  async function save(c: Category, patch: Partial<Category>) {
    try {
      await api.put(`/api/admin/categories/${c.id}`, { ...c, ...patch });
      reload();
    } catch (e: any) {
      toast(e.message, true);
    }
  }
  async function create() {
    if (!name.trim()) return;
    await api.post('/api/admin/categories', { name, order: (data?.length || 0), color: PALETTE[(data?.length || 0) % PALETTE.length] });
    setName('');
    toast('Categoría creada');
    reload();
  }
  async function remove(c: Category) {
    if (!confirmAction(`¿Eliminar ${c.name}? Sus aplicaciones quedarán sin categoría.`)) return;
    await api.del(`/api/admin/categories/${c.id}`);
    reload();
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Categorías</h1>
          <span className="muted small">Agrupan las aplicaciones en el selector: Analytics, People, Security…</span>
        </div>
        <div className="row">
          <input className="input" style={{ width: 220 }} placeholder="Nueva categoría" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && create()} aria-label="Nombre de la nueva categoría" />
          <button className="btn primary" onClick={create}><Icon.plus /> Añadir</button>
        </div>
      </div>
      <ErrorBox error={error} />
      {!data && !error && <Loading />}
      {data && (
        <div className="card flat table-wrap">
          <table className="table">
            <thead><tr><th>Orden</th><th>Nombre</th><th>Color</th><th>Visible</th><th></th></tr></thead>
            <tbody>
              {data.map((c) => (
                <tr key={c.id}>
                  <td style={{ width: 100 }}><input className="input" type="number" defaultValue={c.order} onBlur={(e) => Number(e.target.value) !== c.order && save(c, { order: Number(e.target.value) })} aria-label="Orden" /></td>
                  <td><input className="input" defaultValue={c.name} onBlur={(e) => e.target.value !== c.name && save(c, { name: e.target.value })} aria-label="Nombre" /></td>
                  <td><div className="row" style={{ gap: 6 }}>{PALETTE.map((p) => <button key={p} className={`swatch ${c.color === p ? 'on' : ''}`} style={{ background: p }} aria-label={`Color ${p}`} onClick={() => save(c, { color: p })} />)}</div></td>
                  <td><Toggle on={c.enabled} onChange={(v) => save(c, { enabled: v })} label={`Visible ${c.name}`} /></td>
                  <td><button className="icon-btn" aria-label="Eliminar" onClick={() => remove(c)}><Icon.trash /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
