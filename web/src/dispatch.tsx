import { useEffect, useState, type FormEvent } from 'react';
import { ArrowLeft, ClipboardList, Printer, Search, Truck } from 'lucide-react';
import { carrierName, dateTime, message, type Carrier, type DispatchResult, type Manifest, type Shipment } from './data';
import { useWorkspaceApi } from './workspace-session';
import { Empty, ErrorNotice, Link, navigate } from './ui';

const dispatchKey = (shipment: Shipment) => JSON.stringify([shipment.carrier, shipment.origin]);
const maxBatch = 100;

export function DispatchQueue({ shipments, carriers, onDispatch, onReload }: {
  shipments: Shipment[]; carriers: Carrier[]; onDispatch: (shipments: Shipment[]) => void; onReload: () => Promise<void>;
}) {
  const api = useWorkspaceApi();
  const ready = shipments.filter(shipment => shipment.status === 'ready');
  const groups = new Map(ready.map(shipment => [dispatchKey(shipment), shipment]));
  const [group, setGroup] = useState('');
  const [selected, setSelected] = useState<Record<string, number>>({});
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [historyVersion, setHistoryVersion] = useState(0);
  const candidates = ready.filter(shipment => dispatchKey(shipment) === group);
  const entries = Object.entries(selected);

  function toggle(shipment: Shipment, checked: boolean) {
    const next = { ...selected };
    if (checked) next[shipment.tracking] = shipment.version;
    else delete next[shipment.tracking];
    setSelected(next);
  }
  async function dispatch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setPending(true); setError('');
    try {
      const result = await api<DispatchResult>('/manifests', {
        method: 'POST', body: JSON.stringify({ reference, notes, shipments: entries.map(([tracking, version]) => ({ tracking, version })) }),
      });
      onDispatch(result.shipments);
      navigate('/dispatch/' + result.manifest.id);
    } catch (failure) { setError(message(failure)); }
    finally { setPending(false); }
  }
  async function reload() {
    setPending(true);
    try { await onReload(); setSelected({}); setGroup(''); setError(''); setHistoryVersion(version => version + 1); }
    catch (failure) { setError(message(failure)); }
    finally { setPending(false); }
  }

  return <>
    <header className="page-heading"><div><h1>Dispatch</h1><p>Hand ready shipments to a carrier and record the pickup.</p></div><Link className="button secondary" href="/shipments?status=ready">View ready shipments</Link></header>
    <form className="panel form-card dispatch-form" onSubmit={dispatch}>
      <div className="form-title"><Truck size={20}/><h2>Create a dispatch manifest</h2></div>
      {ready.length === 0 ? <Empty title="No shipments ready for dispatch">Record a ready-to-ship event on a draft shipment to add it to this queue.</Empty> : <>
        <label>Pickup lane<select value={groups.has(group) ? group : ''} onChange={event => { setGroup(event.target.value); setSelected({}); }} disabled={pending} required>
          <option value="">Select a carrier and origin</option>{Array.from(groups, ([key, shipment]) => <option key={key} value={key}>{carrierName(carriers, shipment.carrier)} · {shipment.origin}</option>)}
        </select></label>
        {!!candidates.length && <>
          <div className="dispatch-selection"><p className="muted" role="status">{entries.length} of {candidates.length} selected (maximum {maxBatch})</p>
            <div className="page-actions"><button className="button secondary" type="button" disabled={pending} onClick={() => setSelected(Object.fromEntries(candidates.slice(0, maxBatch).map(shipment => [shipment.tracking, shipment.version])))}>Select {candidates.length > maxBatch ? 'first 100' : 'all'}</button>
            <button className="button secondary" type="button" disabled={!entries.length || pending} onClick={() => setSelected({})}>Clear selection</button></div></div>
          <div className="table-scroll"><table><thead><tr><th scope="col">Select</th><th scope="col">Shipment</th><th scope="col">Destination</th><th scope="col">Weight</th></tr></thead>
            <tbody>{candidates.map(shipment => {
              const checked = Object.hasOwn(selected, shipment.tracking);
              return <tr key={shipment.tracking}><td><input aria-label={'Select shipment ' + shipment.reference} type="checkbox" checked={checked} disabled={pending || !checked && entries.length >= maxBatch} onChange={event => toggle(shipment, event.target.checked)}/></td>
                <td><Link className="table-link" href={'/shipments/' + shipment.tracking}>{shipment.reference}</Link></td><td>{shipment.destination}</td><td>{shipment.weightKg} kg</td></tr>;
            })}</tbody>
          </table></div>
          <div className="form-grid"><label>Pickup reference<input required maxLength={100} value={reference} onChange={event => setReference(event.target.value)} placeholder="Carrier confirmation or dock appointment"/></label>
            <label>Pickup notes (optional)<input maxLength={400} value={notes} onChange={event => setNotes(event.target.value)} placeholder="Add a handoff note"/></label></div>
        </>}
      </>}
      <ErrorNotice>{error}</ErrorNotice>
      <div className="page-actions">
        {!!candidates.length && <button className="button primary" disabled={!entries.length || pending}>{pending ? 'Working…' : 'Record dispatch'}</button>}
        <button className="button secondary" type="button" disabled={pending} onClick={() => void reload()}>Refresh queue</button>
      </div>
    </form>
    <ManifestHistory key={historyVersion} carriers={carriers}/>
  </>;
}

function ManifestHistory({ carriers }: { carriers: Carrier[] }) {
  const api = useWorkspaceApi();
  const [manifests, setManifests] = useState<Manifest[]>();
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [search, setSearch] = useState('');
  useEffect(() => {
    const connection = new AbortController();
    api<Manifest[]>('/manifests', { signal: connection.signal }).then(setManifests).catch(failure => {
      if (!connection.signal.aborted) setError(message(failure));
    });
    return () => connection.abort();
  }, [api, attempt]);
  const filtered = manifests?.filter(manifest => [manifest.id, manifest.reference, manifest.origin, carrierName(carriers, manifest.carrier)].join(' ').toLowerCase().includes(search.trim().toLowerCase()));
  return <section className="panel">
    <div className="panel-heading"><div><h2>Dispatch history</h2><p>Review and print recorded carrier handoffs.</p></div><ClipboardList size={20}/></div>
    {!!manifests?.length && <div className="filters"><label className="search-field"><Search size={17}/><input aria-label="Search manifests" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search manifests, origins, or carriers"/></label></div>}
    {error ? <div className="form-card"><ErrorNotice>{error}</ErrorNotice><button className="button secondary" onClick={() => { setError(''); setAttempt(value => value + 1); }}>Retry</button></div>
      : !filtered ? <p className="list-message" role="status">Loading dispatch history…</p>
      : !filtered.length ? <Empty title={search.trim() ? 'No matching manifests' : 'No dispatches recorded'}>{search.trim() ? 'Try a different search.' : 'Recorded manifests appear here.'}</Empty>
      : <div className="table-scroll"><table><thead><tr><th scope="col">Pickup reference</th><th scope="col">Carrier and origin</th><th scope="col">Dispatched</th><th scope="col">Shipments</th></tr></thead>
        <tbody>{filtered.map(manifest => <tr key={manifest.id}><td><Link className="table-link" href={'/dispatch/' + manifest.id}>{manifest.reference}</Link><div className="cell-sub">{manifest.id}</div></td>
          <td><strong>{carrierName(carriers, manifest.carrier)}</strong><div className="cell-sub">{manifest.origin}</div></td><td>{dateTime(manifest.dispatchedAt)}</td><td>{manifest.shipments.length}</td></tr>)}</tbody>
      </table></div>}
  </section>;
}

export function ManifestDetail({ id, carriers }: { id: string; carriers: Carrier[] }) {
  const api = useWorkspaceApi();
  const [manifest, setManifest] = useState<Manifest>();
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const connection = new AbortController();
    api<Manifest>('/manifests/' + id, { signal: connection.signal }).then(setManifest).catch(failure => {
      if (!connection.signal.aborted) setError(message(failure));
    });
    return () => connection.abort();
  }, [api, id, attempt]);
  return <>
    <div className="page-actions label-controls"><Link className="back-link" href="/dispatch"><ArrowLeft size={16}/> Dispatch</Link>
      {manifest && <button className="button primary" onClick={() => window.print()}><Printer size={17}/> Print manifest</button>}
    </div>
    {error ? <div className="panel form-card"><ErrorNotice>{error}</ErrorNotice><button className="button secondary" onClick={() => { setError(''); setAttempt(value => value + 1); }}>Retry</button></div>
      : !manifest ? <p role="status">Loading manifest…</p> : <article className="panel form-card manifest-record">
        <header><p className="muted">Dispatch manifest · {manifest.id}</p><h1>{manifest.reference}</h1></header>
        <dl className="detail-grid"><div><dt>Carrier</dt><dd>{carrierName(carriers, manifest.carrier)}</dd></div><div><dt>Origin</dt><dd>{manifest.origin}</dd></div>
          <div><dt>Dispatched</dt><dd>{dateTime(manifest.dispatchedAt)}</dd></div><div><dt>Recorded by</dt><dd>{manifest.dispatchedBy}</dd></div>
          <div><dt>Total actual weight</dt><dd>{new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 }).format(manifest.shipments.reduce((total, shipment) => total + shipment.weightKg, 0))} kg</dd></div>
          <div><dt>Shipments</dt><dd>{manifest.shipments.length}</dd></div>
        </dl>
        {manifest.notes && <div className="manifest-notes"><h2>Pickup notes</h2><p>{manifest.notes}</p></div>}
        <div className="table-scroll"><table><thead><tr><th scope="col">Shipment</th><th scope="col">Tracking number</th><th scope="col">Destination</th><th scope="col">Weight</th></tr></thead>
          <tbody>{manifest.shipments.map(shipment => <tr key={shipment.tracking}><td><Link className="table-link" href={'/shipments/' + shipment.tracking}>{shipment.reference}</Link></td>
            <td>{shipment.tracking}</td><td>{shipment.destination}</td><td>{shipment.weightKg} kg</td></tr>)}</tbody>
        </table></div>
      </article>}
  </>;
}
