import { useState } from 'react';
import { AlertTriangle, CalendarClock, Search } from 'lucide-react';
import { carrierName, dateTime, day, exceptionReasons, latest, overdue, type Carrier, type Shipment } from './data';
import { Empty, Link } from './ui';

export function ExceptionInbox({ shipments, carriers }: { shipments: Shipment[]; carriers: Carrier[] }) {
  const [query, setQuery] = useState('');
  const [reason, setReason] = useState('');
  const [onlyOverdue, setOnlyOverdue] = useState(false);
  const open = shipments.filter(shipment => shipment.status === 'exception');
  const late = open.filter(overdue);
  const filtered = open.filter(shipment => {
    const text = [shipment.reference, shipment.tracking, shipment.destination, shipment.origin, shipment.recipient].join(' ').toLowerCase();
    return text.includes(query.trim().toLowerCase()) && (!reason || (latest(shipment).reason ?? 'other') === reason)
      && (!onlyOverdue || overdue(shipment));
  }).sort((first, second) => Number(overdue(second)) - Number(overdue(first)) || latest(first).at.localeCompare(latest(second).at));
  return <>
    <header className="page-heading"><div><h1>Exceptions</h1><p>Triage shipments that need an operations update.</p></div><Link className="button secondary" href="/shipments?overdue=1">View all overdue shipments</Link></header>
    <div className="exception-summary"><span className="panel"><AlertTriangle size={19}/><strong>{open.length}</strong> open {open.length === 1 ? 'exception' : 'exceptions'}</span>
      <span className="panel"><CalendarClock size={19}/><strong>{late.length}</strong> past estimated delivery</span></div>
    <section className="panel">
      <div className="filters"><label className="search-field"><Search size={17}/><input aria-label="Search exceptions" placeholder="Search shipment or route" value={query} onChange={event => setQuery(event.target.value)}/></label>
        <select aria-label="Filter by exception reason" value={reason} onChange={event => setReason(event.target.value)}><option value="">All reasons</option>
          {Object.entries(exceptionReasons).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
        <label className="check-inline"><input type="checkbox" checked={onlyOverdue} onChange={event => setOnlyOverdue(event.target.checked)}/> Overdue only</label>
      </div>
      {filtered.length ? <div className="table-scroll"><table><thead><tr><th scope="col">Shipment</th><th scope="col">Exception</th><th scope="col">Last reported</th><th scope="col">Estimated delivery</th></tr></thead>
        <tbody>{filtered.map(shipment => {
          const event = latest(shipment);
          return <tr key={shipment.tracking}><td><Link className="table-link" href={'/shipments/' + shipment.tracking}>{shipment.reference}</Link><div className="cell-sub">{carrierName(carriers, shipment.carrier)} · {shipment.destination}</div></td>
            <td><strong>{exceptionReasons[event.reason ?? 'other']}</strong><div className="cell-sub issue-note">{event.note}</div></td><td>{dateTime(event.at)}<div className="cell-sub">{event.location}</div></td>
            <td>{day(shipment.eta)}{overdue(shipment) && <div className="cell-sub overdue">Overdue</div>}</td></tr>;
        })}</tbody>
      </table></div> : <Empty title={open.length ? 'No matching exceptions' : 'No open exceptions'}>{open.length ? 'Adjust your filters.' : 'New shipment exceptions will appear here.'}</Empty>}
    </section>
  </>;
}
