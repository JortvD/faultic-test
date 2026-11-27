import { useState } from 'react';
import { Activity, AlertTriangle, CalendarDays, CircleCheck, ClipboardList, Package, Plus, Search, Truck } from 'lucide-react';
import { active, carrierName, dateTime, day, latest, money, onTime, overdue, statuses, today, type Account, type Carrier, type Shipment, type Status } from './data';
import { Badge, Empty, HeroGraphic, Link, StatusIcon } from './ui';

const tableStatuses: Status[] = ['draft', 'ready', 'in_transit', 'exception', 'delivered', 'cancelled'];

export function ShipmentTable({ shipments, carriers, dashboard = false }: { shipments: Shipment[]; carriers: Carrier[]; dashboard?: boolean }) {
  if (!shipments.length) return <Empty title={dashboard ? 'No shipments yet' : 'No matching shipments'}>
    {dashboard ? <Link className="button primary" href="/shipments/new"><Plus size={16}/> Create your first shipment</Link> : 'Adjust your filters or create a shipment.'}
  </Empty>;
  return <div className="table-scroll"><table>
    <thead><tr><th scope="col">Shipment</th><th scope="col">Route</th><th scope="col">Carrier</th><th scope="col">Status</th><th scope="col">Est. delivery</th>{!dashboard && <th scope="col">Estimate</th>}</tr></thead>
    <tbody>{shipments.map(shipment => <tr key={shipment.tracking}>
      <td><Link className="table-link" href={'/shipments/' + shipment.tracking}>{shipment.reference}</Link><div className="cell-sub">{shipment.recipient}</div></td>
      <td><strong>{shipment.destination}</strong><div className="cell-sub">From {shipment.origin}</div></td>
      <td>{carrierName(carriers, shipment.carrier)}</td>
      <td><Badge status={shipment.status}/></td>
      <td><strong>{day(shipment.eta)}</strong>{overdue(shipment) && <div className="cell-sub overdue">Overdue</div>}</td>
      {!dashboard && <td>{money(shipment.costCents)}</td>}
    </tr>)}</tbody>
  </table></div>;
}

function Metrics({ shipments }: { shipments: Shipment[] }) {
  const delivered = shipments.filter(shipment => shipment.status === 'delivered');
  const rate = delivered.length ? Math.round(delivered.filter(onTime).length / delivered.length * 100) : null;
  const counts = [
    { label: 'Total shipments', value: shipments.length, icon: Package, hint: 'All workspace shipments', tone: 'sage', href: '/shipments' },
    { label: 'In transit', value: shipments.filter(s => s.status === 'in_transit').length, icon: Truck, hint: 'On the way to recipients', tone: 'blue', href: '/shipments?status=in_transit' },
    { label: 'Delivered on time', value: rate === null ? '—' : rate + '%', icon: CircleCheck, hint: delivered.length ? delivered.length + ' completed deliveries' : 'No completed deliveries', tone: 'sage', href: '/analytics' },
    { label: 'Exceptions', value: shipments.filter(s => s.status === 'exception').length, icon: AlertTriangle, hint: 'Shipments needing attention', tone: 'amber', href: '/shipments?status=exception' },
  ];
  return <div className="metrics">{counts.map(({ icon: Icon, ...metric }) => <Link href={metric.href} key={metric.label} className="metric panel">
    <div className="metric-top"><span>{metric.label}</span><span className={'metric-icon ' + metric.tone}><Icon size={18}/></span></div>
    <strong>{metric.value}</strong><small>{metric.hint}</small>
  </Link>)}</div>;
}

function dailyVolumes(shipments: Shipment[], range: number) {
  const end = new Date(today());
  return Array.from({ length: range }, (_, index) => {
    const date = new Date(end);
    date.setUTCDate(date.getUTCDate() + index - range + 1);
    const key = date.toISOString().slice(0, 10);
    const created = shipments.filter(shipment => shipment.createdAt.slice(0, 10) === key);
    return { key, volume: created.length, delivered: created.filter(shipment => shipment.status === 'delivered').length };
  });
}

function Volume({ shipments }: { shipments: Shipment[] }) {
  const [range, setRange] = useState(7);
  const dates = dailyVolumes(shipments, range);
  const max = Math.max(4, Math.ceil(Math.max(...dates.map(item => item.volume)) / 4) * 4);
  return <section className="panel volume">
    <div className="panel-heading"><div><h2>Shipment volume</h2><p>Shipments created by day and how many are now delivered.</p></div>
      <label className="select-compact"><CalendarDays size={15}/><select aria-label="Shipment volume date range" value={range} onChange={event => setRange(Number(event.target.value))}><option value="7">Last 7 days</option><option value="14">Last 14 days</option><option value="30">Last 30 days</option></select></label>
    </div>
    <div className="chart" role="img" aria-label={dates.map(item => day(item.key) + ': ' + item.volume + ' shipments, ' + item.delivered + ' delivered').join('. ')}>
      <div className="chart-labels" aria-hidden="true">{[max, max * .75, max * .5, max * .25, 0].map(value => <span key={value}>{value}</span>)}</div>
      <div className="chart-plot" aria-hidden="true">
        <div className="chart-lines"><i/><i/><i/><i/><i/></div>
        <div className="chart-bars">{dates.map((item, index) => <div className="chart-column" key={item.key} title={day(item.key) + ' · ' + item.volume + ' created · ' + item.delivered + ' delivered'}>
          <div className="chart-bar" style={{ height: (item.volume ? item.volume / max * 100 : 1) + '%' }}><i style={{ height: (item.volume ? item.delivered / item.volume * 100 : 0) + '%' }}/></div>
          {(range === 7 || index % (range === 14 ? 2 : 5) === 0 || index === range - 1) && <span>{day(item.key)}</span>}
        </div>)}</div>
      </div>
    </div>
    <div className="legend"><span><i/> Created</span><span><i/> Delivered</span></div>
  </section>;
}

function ActivityPanel({ shipments }: { shipments: Shipment[] }) {
  const events = shipments.flatMap(shipment => shipment.events.map(event => ({ ...event, tracking: shipment.tracking, reference: shipment.reference })))
    .sort((first, second) => second.at.localeCompare(first.at)).slice(0, 4);
  return <section className="panel activity-panel">
    <div className="panel-heading"><div><h2>Recent activity</h2><p>Latest updates across your network.</p></div><Activity size={19}/></div>
    {events.length ? <div className="activity-list">{events.map((event, index) => <Link key={event.tracking + index} href={'/shipments/' + event.tracking} className="activity-item">
      <StatusIcon status={event.status}/><span><strong>{statuses[event.status]}</strong><small>{event.reference} · {event.location}</small></span><time dateTime={event.at}>{dateTime(event.at)}</time>
    </Link>)}</div> : <Empty title="No recent activity">Shipment events will appear here.</Empty>}
  </section>;
}

export function Dashboard({ account, shipments, carriers }: { account: Account; shipments: Shipment[]; carriers: Carrier[] }) {
  const exceptions = shipments.filter(shipment => shipment.status === 'exception').length;
  const late = shipments.filter(overdue).length;
  return <>
    <section className="hero">
      <div className="hero-content"><div className="hero-kicker"><span/> OPERATIONS OVERVIEW</div><h1>Hello, {account.name.split(' ')[0]}.</h1>
        <p>{activeCount(shipments) ? `${activeCount(shipments)} active shipments across your network.` : 'Plan, dispatch, and track freight from one workspace.'}</p>
        <div className="hero-actions"><Link className="button hero-button" href="/shipments/new"><Plus size={17}/> New shipment</Link>
          <Link href="/shipments?status=exception" className="button hero-secondary"><AlertTriangle size={16}/> {exceptions} {exceptions === 1 ? 'exception' : 'exceptions'}</Link></div>
      </div><HeroGraphic/>
    </section>
    <Metrics shipments={shipments}/>
    <div className="dashboard-grid"><Volume shipments={shipments}/><ActivityPanel shipments={shipments}/></div>
    {late > 0 && <Link className="alert-strip" href="/shipments?overdue=1"><AlertTriangle size={18}/><strong>{late} overdue {late === 1 ? 'shipment' : 'shipments'}</strong><span>Review overdue shipments</span></Link>}
    <section className="panel shipments-panel">
      <div className="panel-heading"><div><h2>Recent shipments</h2><p>Review your latest bookings and delivery progress.</p></div><Link className="button secondary" href="/shipments">View all shipments</Link></div>
      <ShipmentTable shipments={shipments.slice(0, 6)} carriers={carriers} dashboard/>
    </section>
  </>;
}

const activeCount = (shipments: Shipment[]) => shipments.filter(active).length;

export function ShipmentFilters({ search, setSearch, status, setStatus, carrier, setCarrier, onlyOverdue, setOnlyOverdue, carriers }: {
  search: string; setSearch: (value: string) => void; status: string; setStatus: (value: string) => void;
  carrier: string; setCarrier: (value: string) => void; onlyOverdue: boolean; setOnlyOverdue: (value: boolean) => void; carriers: Carrier[];
}) {
  return <div className="filters">
    <label className="search-field"><Search size={17}/><input aria-label="Search shipments" placeholder="Search reference, recipient, or route" value={search} onChange={event => setSearch(event.target.value)}/></label>
    <select aria-label="Filter by status" value={status} onChange={event => setStatus(event.target.value)}><option value="">All statuses</option>{tableStatuses.map(key => <option value={key} key={key}>{statuses[key]}</option>)}</select>
    <select aria-label="Filter by carrier" value={carrier} onChange={event => setCarrier(event.target.value)}><option value="">All carriers</option>{carriers.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</select>
    <label className="check-inline"><input type="checkbox" checked={onlyOverdue} onChange={event => setOnlyOverdue(event.target.checked)}/> Overdue only</label>
  </div>;
}

export function Analytics({ shipments, carriers }: { shipments: Shipment[]; carriers: Carrier[] }) {
  const [period, setPeriod] = useState('all');
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - Number(period === 'all' ? 0 : period) + 1);
  const selected = period === 'all' ? shipments : shipments.filter(shipment => shipment.createdAt.slice(0, 10) >= cutoff.toISOString().slice(0, 10));
  const total = selected.filter(shipment => shipment.status !== 'cancelled').reduce((sum, shipment) => sum + shipment.costCents, 0);
  return <>
    <header className="page-heading"><div><h1>Analytics</h1><p>Track delivery performance and estimated freight spend.</p></div>
      <select aria-label="Analytics date range" value={period} onChange={event => setPeriod(event.target.value)}><option value="all">All time</option><option value="7">Last 7 days</option><option value="30">Last 30 days</option></select>
    </header>
    <Metrics shipments={selected}/>
    <div className="dashboard-grid"><Volume shipments={selected}/><section className="panel spend-panel"><div className="panel-heading"><div><h2>Estimated freight spend</h2><p>Based on shipment quotes, excluding cancellations.</p></div><ClipboardList size={20}/></div><strong className="spend-total">{money(total)}</strong>
      <div className="spend-items">{carriers.map(carrier => {
        const cost = selected.filter(shipment => shipment.carrier === carrier.id && shipment.status !== 'cancelled').reduce((sum, shipment) => sum + shipment.costCents, 0);
        return <div key={carrier.id}><span>{carrier.name}</span><strong>{money(cost)}</strong></div>;
      })}</div></section></div>
    <section className="panel"><div className="panel-heading"><div><h2>Carrier performance</h2><p>On-time performance uses delivered shipments with recorded milestones.</p></div></div>
      <div className="table-scroll"><table><thead><tr><th>Carrier</th><th>Shipments</th><th>Delivered</th><th>On time</th><th>Open exceptions</th></tr></thead><tbody>
        {carriers.map(carrier => {
          const assigned = selected.filter(shipment => shipment.carrier === carrier.id);
          const delivered = assigned.filter(shipment => shipment.status === 'delivered');
          return <tr key={carrier.id}><td><strong>{carrier.name}</strong></td><td>{assigned.length}</td><td>{delivered.length}</td><td>{delivered.length ? Math.round(delivered.filter(onTime).length / delivered.length * 100) + '%' : '—'}</td><td>{assigned.filter(shipment => shipment.status === 'exception').length}</td></tr>;
        })}
      </tbody></table></div>
    </section>
  </>;
}
