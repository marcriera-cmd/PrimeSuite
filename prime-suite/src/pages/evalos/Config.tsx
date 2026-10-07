// Atajos de Evalos · Configuración: cadena de conexión a la BD de Evalos 8 y correspondencia de tablas.
import { useEffect, useState, type ReactNode } from 'react';
import { api, fmtDate, type EvalosConfigView, type EvalosDetect, type EvalosMapping } from '../../api';
import { ErrorBox, Icon, Loading, Toggle, useToast } from '../../components/ui';

interface TestResult { ok: boolean; ms: number; info: { engine: string; server?: string; database?: string; version?: string }; departments: number | null; mappingError: string | null }

const EXAMPLE = 'Server=sqlserver.empresa.com,1433;Database=EVALOS8;User Id=atajos;Password=********;Encrypt=true;TrustServerCertificate=true';

export default function EvalosConfig({ onSaved }: { onSaved: () => void }) {
  const toast = useToast();
  const [companyId, setCompanyId] = useState<string>('');
  const [cfg, setCfg] = useState<EvalosConfigView | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [engine, setEngine] = useState<'mssql' | 'demo'>('mssql');
  const [conn, setConn] = useState('');
  const [showConn, setShowConn] = useState(false);
  const [mapping, setMapping] = useState<EvalosMapping | null>(null);
  const [uppercase, setUppercase] = useState(true);
  const [busy, setBusy] = useState<'' | 'test' | 'detect' | 'save' | 'schema'>('');
  const [err, setErr] = useState<string | null>(null);
  const [test, setTest] = useState<TestResult | null>(null);
  const [detect, setDetect] = useState<EvalosDetect | null>(null);

  useEffect(() => {
    setCfg(null);
    setLoadErr(null);
    api.get<EvalosConfigView>(`/api/evalos/config${companyId ? `?companyId=${encodeURIComponent(companyId)}` : ''}`)
      .then((c) => {
        setCfg(c);
        setEngine(c.engine);
        setMapping(c.mapping);
        setUppercase(c.uppercase);
        setConn('');
        setTest(null);
        setDetect(null);
        setErr(null);
      })
      .catch((e) => setLoadErr(e.message));
  }, [companyId]);

  if (loadErr) return <ErrorBox error={loadErr} />;
  if (!cfg || !mapping) return <Loading />;

  const payload = () => ({ companyId: cfg.companyId, engine, connectionString: engine === 'mssql' ? conn.trim() || undefined : undefined, mapping, uppercase });

  async function run<T>(kind: 'test' | 'detect' | 'save' | 'schema', fn: () => Promise<T>) {
    setBusy(kind);
    setErr(null);
    try {
      return await fn();
    } catch (e: any) {
      setErr(e.message);
      return null;
    } finally {
      setBusy('');
    }
  }
  const doTest = () => run('test', async () => { setTest(null); setTest(await api.post<TestResult>('/api/evalos/config/test', payload())); });
  const doDetect = () => run('detect', async () => {
    const d = await api.post<EvalosDetect>('/api/evalos/config/detect', payload());
    setDetect(d);
    setMapping(d.mapping);
    toast('Tablas detectadas: revisa la correspondencia y guarda');
  });
  const doSchema = () => run('schema', async () => {
    const s = await api.post<{ database?: string; tables: { topic?: string }[] }>('/api/evalos/config/schema', payload());
    const blob = new Blob([JSON.stringify(s, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `evalos-esquema-${(s.database || 'bd').replace(/[^A-Za-z0-9_-]+/g, '_')}-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast(`Esquema exportado · ${s.tables.length} tablas (${s.tables.filter((x) => x.topic).length} relacionadas con Atajos)`);
  });
  const doSave = () => run('save', async () => {
    const saved = await api.put<EvalosConfigView>('/api/evalos/config', payload());
    setCfg({ ...cfg, ...saved });
    setConn('');
    const us = saved.userSync;
    if (us && us.failed.length) {
      setErr(`Configuración guardada, pero no se pudo dar de alta en Evalos 8 a ${us.failed.length} usuario(s): ${us.failed.slice(0, 3).map((f) => `${f.email} (${f.error})`).join('; ')}`);
    } else {
      toast(us && us.created ? `Configuración guardada · ${us.created} usuario(s) dados de alta en Evalos 8` : 'Configuración guardada');
    }
    onSaved();
  });

  const setDep = (p: Partial<EvalosMapping['departments']>) => setMapping({ ...mapping, departments: { ...mapping.departments, ...p } });
  const setEmp = (p: Partial<EvalosMapping['employees']>) => setMapping({ ...mapping, employees: { ...mapping.employees, ...p } });
  const his = mapping.departmentHistory;
  const setHis = (p: Partial<NonNullable<EvalosMapping['departmentHistory']>> | null) =>
    setMapping({ ...mapping, departmentHistory: p === null ? null : { table: '', department: '', ...(his || {}), ...p } });

  // Columnas conocidas (tras "Detectar") para sugerirlas en los campos.
  const colsOf = (table?: string) => detect?.candidates.find((t) => t.name.toUpperCase() === (table || '').toUpperCase())?.columns.map((c) => c.name) || [];
  const tables = detect?.candidates.map((t) => t.name) || [];
  const canSave = engine === 'demo' || cfg.hasConnection || !!conn.trim();

  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="row wrap" style={{ justifyContent: 'space-between' }}>
        <div className="col" style={{ gap: 2 }}>
          <h2>Configuración</h2>
          <span className="xs muted">Conexión directa a la base de datos de Evalos 8 de <b>{cfg.companyName}</b>. Atajos de Evalos no usa servicios web.</span>
        </div>
        {cfg.companies && (
          <label className="field" style={{ minWidth: 240 }}>Empresa
            <select className="select" value={cfg.companyId} onChange={(e) => setCompanyId(e.target.value)}>
              {cfg.companies.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.code})</option>)}
            </select>
          </label>
        )}
      </div>

      <ErrorBox error={err} />

      <Section title="Base de datos" subtitle="Cada empresa usa su propia base de datos de Evalos 8.">
        <div className="viewseg" role="group" aria-label="Origen de datos" style={{ alignSelf: 'flex-start' }}>
          <button className={engine === 'mssql' ? 'on' : ''} aria-pressed={engine === 'mssql'} onClick={() => setEngine('mssql')}>SQL Server</button>
          <button className={engine === 'demo' ? 'on' : ''} aria-pressed={engine === 'demo'} onClick={() => setEngine('demo')}>Demostración</button>
        </div>

        {engine === 'mssql' ? (
          <>
            <label className="field">Cadena de conexión a la base de datos de Evalos 8
              <span className="hint">
                Formato ADO.NET, el mismo que usa Evalos 8 en su web.config.
                {cfg.hasConnection ? ' Déjala vacía para mantener la guardada.' : ''}
              </span>
              <div className="row" style={{ gap: 6 }}>
                <input
                  className="input mono grow"
                  type={showConn ? 'text' : 'password'}
                  value={conn}
                  onChange={(e) => setConn(e.target.value)}
                  placeholder={cfg.hasConnection ? `Guardada: ${cfg.connHint || '••••••••'}` : EXAMPLE}
                  autoComplete="off"
                  spellCheck={false}
                  aria-label="Cadena de conexión"
                />
                <button type="button" className="icon-btn" style={{ border: '1px solid var(--line)' }} onClick={() => setShowConn((v) => !v)} aria-label={showConn ? 'Ocultar' : 'Mostrar'} title={showConn ? 'Ocultar' : 'Mostrar'}>
                  {showConn ? <Icon.eyeOff /> : <Icon.eye />}
                </button>
              </div>
            </label>
            <div className="alert info xs" style={{ lineHeight: 1.55 }}>
              La cadena se guarda <b>cifrada</b> en el servidor y nunca vuelve al navegador. El servidor de base de datos debe ser accesible desde Prime Suite
              (en Netlify, por Internet). Recomendado: un usuario de SQL Server propio para Atajos de Evalos, con permisos solo sobre las tablas que se usan.
              <br />Ejemplo: <span className="mono">{EXAMPLE}</span>
            </div>
          </>
        ) : (
          <div className="alert info small">Modo demostración: datos ficticios guardados en Prime Suite, para probar Atajos de Evalos sin una base de datos real.</div>
        )}

        <div className="row wrap">
          <button className="btn" onClick={doTest} disabled={!!busy || (engine === 'mssql' && !cfg.hasConnection && !conn.trim())}>
            {busy === 'test' ? 'Probando…' : 'Probar conexión'}
          </button>
          {engine === 'demo' && (
            <button className="btn ghost" disabled={!!busy} onClick={() => run('save', async () => { await api.post('/api/evalos/config/reset-demo', { companyId: cfg.companyId }); toast('Datos de demostración restablecidos'); })}>
              Restablecer datos de demostración
            </button>
          )}
        </div>
        {test && (
          <div className={`alert ${test.mappingError ? 'warn' : 'ok'} small`} style={{ lineHeight: 1.55 }}>
            <b>Conexión correcta</b> ({test.ms} ms) · {[test.info.server, test.info.database].filter(Boolean).join(' / ')}
            {test.info.version && <><br /><span className="xs">{test.info.version}</span></>}
            {test.departments !== null && <><br />Se leen {test.departments} departamentos con la correspondencia actual.</>}
            {test.mappingError && <><br />La conexión funciona, pero la tabla de departamentos no: {test.mappingError}</>}
          </div>
        )}
      </Section>

      {engine === 'mssql' && (
        <Section
          title="Tablas de Evalos"
          subtitle="Dónde están los datos en la base de datos de Evalos 8. Pulsa Detectar para rellenarlo automáticamente y revísalo."
          action={
            <div className="row" style={{ gap: 6 }}>
              <button className="btn sm ghost" onClick={doSchema} disabled={!!busy || (!cfg.hasConnection && !conn.trim())} title="Descarga la estructura de todas las tablas (sin datos) para preparar el mapeo de Calendarios y Correcciones">
                {busy === 'schema' ? 'Exportando…' : 'Exportar esquema'}
              </button>
              <button className="btn sm" onClick={doDetect} disabled={!!busy || (!cfg.hasConnection && !conn.trim())}>{busy === 'detect' ? 'Detectando…' : 'Detectar'}</button>
            </div>
          }
        >
          {detect?.warnings.length ? <div className="alert warn small">{detect.warnings.map((w, i) => <div key={i}>{w}</div>)}</div> : null}
          <datalist id="ev-tables">{tables.map((t) => <option key={t} value={t} />)}</datalist>

          <Group label="Departamentos" hint="Tabla maestra de departamentos (Configuración › Organización › Departamentos)">
            <Ident label="Tabla" value={mapping.departments.table} onChange={(v) => setDep({ table: v })} list="ev-tables" />
            <Ident label="Columna código" value={mapping.departments.code} onChange={(v) => setDep({ code: v })} options={colsOf(mapping.departments.table)} />
            <Ident label="Columna descripción" value={mapping.departments.description} onChange={(v) => setDep({ description: v })} options={colsOf(mapping.departments.table)} />
          </Group>

          <Group label="Personal" hint="Ficha de empleados: se usa para contar y listar los empleados de cada departamento">
            <Ident label="Tabla" value={mapping.employees.table} onChange={(v) => setEmp({ table: v })} list="ev-tables" />
            <Ident label="Código" value={mapping.employees.code} onChange={(v) => setEmp({ code: v })} options={colsOf(mapping.employees.table)} />
            <Ident label="Nombre" value={mapping.employees.name} onChange={(v) => setEmp({ name: v })} options={colsOf(mapping.employees.table)} />
            <Ident label="Departamento" value={mapping.employees.department} onChange={(v) => setEmp({ department: v })} options={colsOf(mapping.employees.table)} />
            <Ident label="Fecha de baja" value={mapping.employees.endDate} onChange={(v) => setEmp({ endDate: v })} options={colsOf(mapping.employees.table)} optional />
          </Group>

          <Group label="Histórico de departamentos" hint="Solo en instalaciones con históricos. Impide eliminar departamentos que aparecen en algún tramo.">
            <Ident label="Tabla" value={his?.table || ''} onChange={(v) => setHis(v ? { table: v } : null)} list="ev-tables" optional />
            <Ident label="Columna departamento" value={his?.department || ''} onChange={(v) => setHis({ department: v })} options={colsOf(his?.table)} optional disabled={!his?.table} />
          </Group>
        </Section>
      )}

      <Section title="Opciones">
        <div className="row" style={{ gap: 12 }}>
          <Toggle on={uppercase} onChange={setUppercase} label="Guardar en mayúsculas" />
          <div className="col" style={{ gap: 0 }}>
            <span className="small" style={{ fontWeight: 600 }}>Guardar códigos y descripciones en mayúsculas</span>
            <span className="xs muted">Como hace Evalos 8 al grabar desde su propia interfaz.</span>
          </div>
        </div>
      </Section>

      <div className="row wrap" style={{ justifyContent: 'space-between' }}>
        <span className="xs muted">{cfg.updatedAt ? `Última modificación: ${fmtDate(cfg.updatedAt)}${cfg.updatedBy ? ` · ${cfg.updatedBy}` : ''}` : 'Sin configurar todavía'}</span>
        <button className="btn primary" onClick={doSave} disabled={!!busy || !canSave}>{busy === 'save' ? 'Guardando…' : 'Guardar configuración'}</button>
      </div>
    </div>
  );
}

function Section({ title, subtitle, action, children }: { title: string; subtitle?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="card" style={{ gap: 14 }}>
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <div className="col grow" style={{ gap: 2 }}>
          <h3>{title}</h3>
          {subtitle && <span className="xs muted">{subtitle}</span>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function Group({ label, hint, children }: { label: string; hint: string; children: ReactNode }) {
  return (
    <div className="col" style={{ gap: 8, paddingTop: 12, borderTop: '1px solid var(--line-2)' }}>
      <div className="col" style={{ gap: 0 }}>
        <span className="small" style={{ fontWeight: 700 }}>{label}</span>
        <span className="xs muted">{hint}</span>
      </div>
      <div className="ev-idents">{children}</div>
    </div>
  );
}

function Ident({ label, value, onChange, list, options, optional, disabled }: { label: string; value: string; onChange: (v: string) => void; list?: string; options?: string[]; optional?: boolean; disabled?: boolean }) {
  const id = `ev-opt-${label.normalize('NFD').replace(/[^A-Za-z0-9]+/g, '-')}-${Math.abs(hash(String(options?.join(','))))}`;
  return (
    <label className="field">
      <span>{label}{optional && <span className="hint"> · opcional</span>}</span>
      <input className="input mono" value={value} onChange={(e) => onChange(e.target.value.trim())} list={list || (options?.length ? id : undefined)} spellCheck={false} disabled={disabled} placeholder={optional ? '—' : undefined} />
      {!!options?.length && !list && <datalist id={id}>{options.map((o) => <option key={o} value={o} />)}</datalist>}
    </label>
  );
}

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}
