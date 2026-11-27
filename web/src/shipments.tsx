import { useState, type FormEvent } from 'react';
import { ArrowLeft, Clipboard, Download, MapPin, Package, Plane, Plus, Printer, Truck } from 'lucide-react';
import { api, blankLane, carrierName, dateTime, day, downloadShipments, exceptionReasons, message, money, overdue, statuses, today, transitions, type Carrier, type Contact, type ExceptionReason, type Lane, type Quote, type Shipment, type ShipmentInput, type Status } from './data';
import { ShipmentFilters, ShipmentTable } from './dashboard';
import { Badge, Empty, ErrorNotice, Link, navigate, StatusIcon } from './ui';

export function ShipmentIndex({ shipments, carriers, query }: { shipments: Shipment[]; carriers: Carrier[]; query: URLSearchParams }) {
  const [search, setSearch] = useState(query.get('q') ?? '');
  const [status, setStatus] = useState(query.get('status') ?? '');
  const [carrier, setCarrier] = useState('');
  const [onlyOverdue, setOnlyOverdue] = useState(query.get('overdue') === '1');
  const [sort, setSort] = useState('newest');
  const [page, setPage] = useState(0);
  const filtered = shipments.filter(shipment => {
    const text = [shipment.tracking, shipment.reference, shipment.recipient, shipment.origin, shipment.destination].join(' ').toLowerCase();
    return text.includes(search.trim().toLowerCase()) && (!status || status === shipment.status) &&
      (!carrier || carrier === shipment.carrier) && (!onlyOverdue || overdue(shipment));
  }).sort((first, second) => sort === 'eta' ? first.eta.localeCompare(second.eta) : second.createdAt.localeCompare(first.createdAt));
  const pageSize = 12;
  const last = Math.max(0, Math.ceil(filtered.length / pageSize) - 1);
  const current = Math.min(page, last);
  function filter<T>(setter: (value: T) => void) {
    return (value: T) => { setter(value); setPage(0); };
  }

  return <>
    <header className="page-heading"><div><h1>Shipments</h1><p>Book shipments, manage dispatch, and monitor delivery.</p></div>
      <div className="page-actions"><button className="button secondary" disabled={!filtered.length} onClick={() => downloadShipments(filtered, carriers)}><Download size={17}/> Export CSV</button><Link className="button primary" href="/shipments/new"><Plus size={17}/> New shipment</Link></div>
    </header>
    <section className="panel">
      <ShipmentFilters {...{ search, status, carrier, onlyOverdue, carriers }} setSearch={filter(setSearch)} setStatus={filter(setStatus)} setCarrier={filter(setCarrier)} setOnlyOverdue={filter(setOnlyOverdue)}/>
      <div className="table-toolbar"><span role="status">{filtered.length} {filtered.length === 1 ? 'shipment' : 'shipments'}</span>
        <select aria-label="Sort shipments" value={sort} onChange={event => filter(setSort)(event.target.value)}><option value="newest">Newest first</option><option value="eta">Earliest ETA</option></select>
      </div>
      <ShipmentTable shipments={filtered.slice(current * pageSize, (current + 1) * pageSize)} carriers={carriers}/>
      {last > 0 && <div className="pagination"><span>Page {current + 1} of {last + 1}</span><button className="button secondary" disabled={current === 0} onClick={() => setPage(current - 1)}>Previous</button><button className="button secondary" disabled={current === last} onClick={() => setPage(current + 1)}>Next</button></div>}
    </section>
  </>;
}

function LaneFields<T extends Lane>({ lane, setLane }: { lane: T; setLane: (lane: T) => void }) {
  const dimensions: { key: 'lengthCm' | 'widthCm' | 'heightCm'; label: string }[] = [{ key: 'lengthCm', label: 'Length (cm)' }, { key: 'widthCm', label: 'Width (cm)' }, { key: 'heightCm', label: 'Height (cm)' }];
  return <>
    <div className="form-grid">
      <label>Origin<input required maxLength={100} placeholder="Los Angeles, CA" value={lane.origin} onChange={event => setLane({ ...lane, origin: event.target.value })}/></label>
      <label>Destination<input required maxLength={100} placeholder="Austin, TX" value={lane.destination} onChange={event => setLane({ ...lane, destination: event.target.value })}/></label>
    </div>
    <div className="form-grid dimensions">
      <label>Weight (kg)<input required type="number" min=".1" max="1000" step="any" value={Number.isNaN(lane.weightKg) ? '' : lane.weightKg} onChange={event => setLane({ ...lane, weightKg: event.target.valueAsNumber })}/></label>
      {dimensions.map(({ key, label }) => <label key={key}>{label}<input required type="number" min="1" max="300" step="any" value={Number.isNaN(lane[key]) ? '' : lane[key]} onChange={event => setLane({ ...lane, [key]: event.target.valueAsNumber })}/></label>)}
    </div>
    <label className="check-inline"><input type="checkbox" checked={lane.international} onChange={event => setLane({ ...lane, international: event.target.checked })}/> International shipment</label>
  </>;
}

function initialInput(existing: Shipment | undefined, source: Shipment | undefined, contact: Contact | undefined, query: URLSearchParams): ShipmentInput {
  const original = existing ?? source;
  if (original) {
    const { reference, recipient, deliveryAddress, carrier, shipDate, origin, destination, international, weightKg, lengthCm, widthCm, heightCm } = original;
    return { reference: existing ? reference : '', recipient, deliveryAddress, carrier, shipDate: existing ? shipDate : today(),
      origin, destination, international, weightKg, lengthCm, widthCm, heightCm };
  }
  const dimensions = (key: 'weightKg' | 'lengthCm' | 'widthCm' | 'heightCm') => Number(query.get(key)) || blankLane[key];
  return { origin: query.get('origin') ?? '', destination: contact?.city ?? query.get('destination') ?? '',
    international: query.get('international') === 'true', weightKg: dimensions('weightKg'),
    lengthCm: dimensions('lengthCm'), widthCm: dimensions('widthCm'), heightCm: dimensions('heightCm'),
    carrier: query.get('carrier') ?? '', reference: '', recipient: contact?.name ?? '', deliveryAddress: contact?.address ?? '', shipDate: today() };
}

export function ShipmentForm({ existing, source, carriers, contacts, query, onSave }: {
  existing?: Shipment; source?: Shipment; carriers: Carrier[]; contacts: Contact[]; query: URLSearchParams; onSave: (shipment: Shipment) => void;
}) {
  const [contactId, setContactId] = useState(() => contacts.find(contact => contact.id === Number(query.get('contact')))?.id ?? 0);
  const [input, setInput] = useState(() => initialInput(existing, source, contacts.find(contact => contact.id === contactId), query));
  const [estimate, setEstimate] = useState<Quote[]>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  function field(key: keyof ShipmentInput, value: string) {
    setInput(current => ({ ...current, [key]: value }));
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const action = (event.nativeEvent as SubmitEvent).submitter?.getAttribute('value') ?? 'save';
    setBusy(action); setError('');
    try {
      if (action === 'estimate') {
        setEstimate(await api<Quote[]>('/quotes', { method: 'POST', body: JSON.stringify(input) }));
      } else {
        const shipment = await api<Shipment>(existing ? '/shipments/' + existing.tracking : '/shipments', {
          method: existing ? 'PUT' : 'POST', body: JSON.stringify({ ...input, version: existing?.version }),
        });
        onSave(shipment); navigate('/shipments/' + shipment.tracking);
      }
    } catch (failure) { setError(message(failure)); }
    finally { setBusy(''); }
  }
  const estimated = estimate?.find(quote => quote.carrier.id === input.carrier);
  return <>
    <Link href={existing ? '/shipments/' + existing.tracking : '/shipments'} className="back-link"><ArrowLeft size={16}/> {existing ? existing.reference : 'Shipments'}</Link>
    <header className="page-heading"><div><h1>{existing ? 'Edit shipment' : 'New shipment'}</h1><p>Enter the delivery details and choose a carrier service.</p></div></header>
    <form onSubmit={submit} className="form-layout" id="shipment-form">
      <fieldset disabled={!!busy} className="form-stack">
        <section className="panel form-card"><div className="form-title"><MapPin size={20}/><h2>Route and parcel</h2></div>
          <LaneFields lane={input} setLane={value => { setInput(value); setEstimate(undefined); }}/>
        </section>
        <section className="panel form-card"><div className="form-title"><Package size={20}/><h2>Shipment details</h2></div>
          {!!contacts.length && <label>Autofill from address book<select value={contactId} onChange={event => {
            const id = Number(event.target.value);
            const contact = contacts.find(item => item.id === id);
            setContactId(id);
            if (contact) {
              setInput(current => ({ ...current, recipient: contact.name, destination: contact.city, deliveryAddress: contact.address }));
              setEstimate(undefined);
            }
          }}><option value={0}>Enter delivery details manually</option>{[...contacts].sort((a, b) => a.name.localeCompare(b.name)).map(contact => <option key={contact.id} value={contact.id}>{contact.name} · {contact.city}</option>)}</select></label>}
          <div className="form-grid">
            <label>Shipment reference<input required autoComplete="off" maxLength={64} placeholder="SO-4840" value={input.reference} onChange={event => field('reference', event.target.value)}/></label>
            <label>Ship date<input required type="date" min={existing && existing.shipDate < today() ? existing.shipDate : today()} value={input.shipDate} onChange={event => field('shipDate', event.target.value)}/></label>
            <label>Recipient<input required maxLength={100} placeholder="Acme Supply Co." value={input.recipient} onChange={event => field('recipient', event.target.value)}/></label>
            <label>Delivery address<input required maxLength={240} placeholder="Street address and postal code" value={input.deliveryAddress} onChange={event => field('deliveryAddress', event.target.value)}/></label>
          </div>
        </section>
      </fieldset>
      <section className="panel form-card side-form">
        <div className="form-title"><Truck size={20}/><h2>Carrier service</h2></div>
        <label>Service<select required disabled={!!busy} value={input.carrier} onChange={event => field('carrier', event.target.value)}><option value="">Select a carrier</option>{carriers.map(carrier => <option value={carrier.id} key={carrier.id}>{carrier.name} · {carrier.service}</option>)}</select></label>
        <button className="button secondary" type="submit" value="estimate" formNoValidate disabled={!!busy}>{busy === 'estimate' ? 'Checking rates…' : 'Check estimated rates'}</button>
        {estimate && (!estimate.length ? <p className="muted">No listed service supports this parcel.</p> : <div className="rate-mini">{estimate.map(quote => <button className={quote.carrier.id === input.carrier ? 'chosen' : ''} key={quote.carrier.id} type="button" disabled={!!busy} onClick={() => field('carrier', quote.carrier.id)}><span>{quote.carrier.name}<small>{quote.days} calendar days</small></span><strong>{money(quote.costCents)}</strong></button>)}</div>)}
        {estimated && <p className="muted">Billed weight estimate: {estimated.chargeableKg} kg.</p>}
        {existing && existing.shipDate < today() && <p className="muted">You can keep the previous ship date or choose a future date.</p>}
        <ErrorNotice>{error}</ErrorNotice>
        <button className="button primary" type="submit" value="save" disabled={!!busy}>{busy === 'save' ? 'Saving…' : existing ? 'Save changes' : 'Create draft shipment'}</button>
      </section>
    </form>
  </>;
}

export function RateCalculator() {
  const [lane, setLane] = useState(blankLane);
  const [results, setResults] = useState<Quote[]>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function quote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError('');
    try { setResults(await api<Quote[]>('/quotes', { method: 'POST', body: JSON.stringify(lane) })); }
    catch (failure) { setError(message(failure)); }
    finally { setBusy(false); }
  }
  return <>
    <header className="page-heading"><div><h1>Rate calculator</h1><p>Compare estimated prices and transit times by parcel and service.</p></div></header>
    <div className="form-layout equal">
      <form className="panel form-card" onSubmit={quote}><div className="form-title"><Package size={20}/><h2>Parcel details</h2></div>
        <fieldset disabled={busy}><LaneFields lane={lane} setLane={value => { setLane(value); setResults(undefined); }}/></fieldset>
        <ErrorNotice>{error}</ErrorNotice><button className="button primary" disabled={busy}>{busy ? 'Calculating…' : 'Compare rates'}</button>
      </form>
      <section className="panel form-card"><div className="form-title"><Truck size={20}/><h2>Available services</h2></div>
        {!results || !results.length ? <Empty title={results ? 'No services available' : 'No quotes yet'}>{results ? 'Try different parcel details.' : 'Enter parcel details to compare services.'}</Empty> :
          <><p className="muted">Estimates in USD use the greater of actual or dimensional weight.</p><div className="quote-list">{results.map(quote => {
            const params = new URLSearchParams(Object.entries({ ...lane, carrier: quote.carrier.id }).map(([key, value]) => [key, String(value)]));
            return <div className="quote" key={quote.carrier.id}><div><strong>{quote.carrier.name}</strong><small>{quote.carrier.service} · {quote.days} calendar days · {quote.chargeableKg} kg</small></div>
              <div><strong>{money(quote.costCents)}</strong><Link className="button secondary" href={'/shipments/new?' + params}>Use rate</Link></div></div>;
          })}</div></>}
      </section>
    </div>
  </>;
}

export function CarrierDirectory({ carriers, shipments }: { carriers: Carrier[]; shipments: Shipment[] }) {
  return <><header className="page-heading"><div><h1>Carriers</h1><p>Browse your service catalog and assigned shipments.</p></div><Link className="button primary" href="/rates">Compare rates</Link></header>
    <div className="carrier-grid">{carriers.map(carrier => {
      const count = shipments.filter(shipment => shipment.carrier === carrier.id).length;
      const Icon = carrier.mode === 'Air' ? Plane : Truck;
      return <section className="panel form-card" key={carrier.id}><div className="form-title"><span className="metric-icon sage"><Icon size={20}/></span><div><h2>{carrier.name}</h2><p>{carrier.service}</p></div></div>
        <dl className="detail-grid"><div><dt>Transit estimate</dt><dd>{carrier.days} domestic calendar days</dd></div><div><dt>Coverage</dt><dd>{carrier.international ? 'Domestic and international' : 'Domestic'}</dd></div><div><dt>Maximum billable weight</dt><dd>{carrier.maxKg} kg</dd></div><div><dt>Workspace shipments</dt><dd>{count}</dd></div></dl>
      </section>;
    })}</div>
  </>;
}

export function ShipmentDetail({ shipment, carriers, onSave, onRefresh }: { shipment: Shipment; carriers: Carrier[]; onSave: (shipment: Shipment) => void; onRefresh: () => Promise<void> }) {
  const [status, setStatus] = useState<Status>(transitions[shipment.status][0] ?? shipment.status);
  const [location, setLocation] = useState('');
  const [note, setNote] = useState('');
  const [reason, setReason] = useState<ExceptionReason>('other');
  const [error, setError] = useState('');
  const [copy, setCopy] = useState('');
  const [busy, setBusy] = useState(false);
  const path = '/shipments/' + shipment.tracking;
  const trackingPath = '/track?number=' + shipment.tracking;
  const allowed = transitions[shipment.status];
  async function update(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      onSave(await api<Shipment>(path + '/events', { method: 'POST', body: JSON.stringify({ version: shipment.version, status, location, note, reason: status === 'exception' ? reason : undefined }) }));
    } catch (failure) { setError(message(failure)); }
    finally { setBusy(false); }
  }
  async function copyTracking() {
    try { await navigator.clipboard.writeText(locationOrigin() + trackingPath); setCopy('Tracking link copied.'); }
    catch { setCopy('Open public tracking to copy its address.'); }
  }
  return <>
    <Link className="back-link" href="/shipments"><ArrowLeft size={16}/> Shipments</Link>
    <header className="page-heading"><div><div className="title-line"><h1>{shipment.reference}</h1><Badge status={shipment.status}/></div><p>{shipment.tracking}</p></div>
      <div className="page-actions">
        {['draft', 'ready'].includes(shipment.status) && <Link className="button secondary" href={path + '/edit'}>Edit shipment</Link>}
        <Link className="button secondary" href={'/shipments/new?copy=' + shipment.tracking}>Duplicate shipment</Link>
        {shipment.status !== 'cancelled' && <Link className="button secondary" href={path + '/label'}><Printer size={17}/> Shipping label</Link>}
      </div>
    </header>
    <div className="form-layout equal">
      <div className="form-stack">
        <section className="panel form-card"><div className="form-title"><MapPin size={20}/><h2>Route and delivery</h2></div>
          <dl className="detail-grid">
            <div><dt>Origin</dt><dd>{shipment.origin}</dd></div><div><dt>Destination</dt><dd>{shipment.destination}</dd></div>
            <div><dt>Recipient</dt><dd>{shipment.recipient}</dd></div><div><dt>Delivery address</dt><dd>{shipment.deliveryAddress}</dd></div>
            <div><dt>Carrier</dt><dd>{carrierName(carriers, shipment.carrier)}</dd></div><div><dt>Estimated charge</dt><dd>{money(shipment.costCents)}</dd></div>
            <div><dt>Ship date</dt><dd>{day(shipment.shipDate)}</dd></div><div><dt>Estimated delivery</dt><dd>{day(shipment.eta)}{overdue(shipment) && <span className="overdue"> · Overdue</span>}</dd></div>
            <div><dt>Parcel dimensions</dt><dd>{shipment.lengthCm} × {shipment.widthCm} × {shipment.heightCm} cm</dd></div><div><dt>Actual / billable weight</dt><dd>{shipment.weightKg} kg / {shipment.chargeableKg} kg</dd></div>
          </dl>
          {shipment.manifest && <Link className="back-link" href={'/dispatch/' + shipment.manifest}>View dispatch manifest</Link>}
          {shipment.status !== 'draft' && <div className="page-actions"><Link className="button secondary" href={trackingPath}>Public tracking</Link><button type="button" className="button secondary" onClick={copyTracking}><Clipboard size={16}/> Copy tracking link</button><span className="muted" role="status">{copy}</span></div>}
        </section>
        {!!allowed.length && <form className="panel form-card" onSubmit={update}>
          <div className="form-title"><Plus size={20}/><h2>Record shipment event</h2></div>
          <div className="form-grid">
            <label>Shipment status<select value={status} onChange={event => setStatus(event.target.value as Status)}>{allowed.map(value => <option value={value} key={value}>{statuses[value]}</option>)}</select></label>
            <label>Event location<input required maxLength={100} placeholder="Austin, TX" value={location} onChange={event => setLocation(event.target.value)}/></label>
          </div>
          {status === 'exception' && <label>Exception reason<select value={reason} onChange={event => setReason(event.target.value as ExceptionReason)}>{Object.entries(exceptionReasons).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>}
          <label>Event note<textarea required maxLength={400} placeholder="Add a note for your operations team" value={note} onChange={event => setNote(event.target.value)}/></label>
          <ErrorNotice>{error}</ErrorNotice>
          <div className="page-actions"><button className="button primary" disabled={busy}>{busy ? 'Saving…' : 'Record event'}</button>
            {error && <button type="button" className="button secondary" onClick={() => void onRefresh().then(() => setError('')).catch(failure => setError(message(failure)))}>Reload shipment</button>}
          </div>
        </form>}
      </div>
      <section className="panel form-card"><div className="form-title"><Package size={20}/><h2>Shipment timeline</h2></div>
        <ol className="timeline">{[...shipment.events].reverse().map((event, index) => <li key={event.at + index}>
          <StatusIcon status={event.status}/><div><strong>{statuses[event.status]}</strong><time dateTime={event.at}>{dateTime(event.at)} · {event.location}</time><p>{event.reason && <strong>{exceptionReasons[event.reason]}</strong>}{event.note}</p></div>
        </li>)}</ol>
      </section>
    </div>
  </>;
}

const locationOrigin = () => window.location.origin;

export function ShippingLabel({ shipment }: { shipment: Shipment }) {
  return <>
    <div className="page-actions label-controls"><Link className="back-link" href={'/shipments/' + shipment.tracking}><ArrowLeft size={16}/> {shipment.reference}</Link><button className="button primary" onClick={() => window.print()}><Printer size={17}/> Print label</button></div>
    <article className="shipping-label" aria-label="Internal shipping label">
      <div className="label-head"><strong>fieldline.</strong><span>INTERNAL SHIPPING LABEL</span></div>
      <div className="label-address"><small>SHIP TO</small><h1>{shipment.recipient}</h1><p>{shipment.deliveryAddress}<br/>{shipment.destination}</p></div>
      <div className="label-address"><small>ORIGIN</small><p>{shipment.origin}</p></div>
      <div className="label-track"><small>FIELDLINE TRACKING</small><strong>{shipment.tracking}</strong><span>{shipment.reference} · {shipment.weightKg} kg</span></div>
    </article>
  </>;
}
