import { useMemo, useRef, useState, type FormEvent } from 'react';
import { Activity, Boxes, ClipboardList, Download, PackagePlus, RotateCcw, Warehouse } from 'lucide-react';
import { defaultPolicy, initialOrders, products, scenarios, simulate, type Day, type Forecast, type Order, type Policy, type Product, type Receipt } from './inventory-model';
import { Empty } from './ui';
import './inventory.css';

const units = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const percent = (fraction: number) => Math.round(fraction * 1000) / 10 + '%';

function Metric({ title, value, baseline }: { title: string; value: string; baseline: string }) {
  return <div className="panel inventory-metric"><span>{title}</span><strong>{value}</strong><small>Baseline {baseline}</small></div>;
}

function AppliedNumber({ label, value, min, max, onCommit }: {
  label: string; value: number; min: number; max: number; onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  function apply() {
    const input = Number.parseInt(draft, 10);
    const applied = Number.isFinite(input) ? Math.max(min, Math.min(input, max)) : value;
    setDraft(String(applied));
    onCommit(applied);
  }
  return <label>{label}<input type="number" min={min} max={max} value={draft} onChange={event => setDraft(event.target.value)}
    onBlur={apply} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }}/></label>;
}

function PolicyForm({ policy, setPolicy }: { policy: Policy; setPolicy: (value: Policy) => void }) {
  return <section className="panel form-card inventory-policy">
    <div className="inventory-section-title"><Warehouse size={19}/><h2>Stock policy</h2></div>
    <div className="form-grid">
      <AppliedNumber label="Opening stock" value={policy.stock} min={0} max={20_000} onCommit={stock => setPolicy({ ...policy, stock })}/>
      <label>Unfilled orders
        <select value={policy.shortages} onChange={event => setPolicy({ ...policy, shortages: event.target.value as Policy['shortages'] })}>
          <option value="backorder">Carry into next day</option><option value="lost">Treat as lost sales</option>
        </select>
      </label>
    </div>
    <label className="check-inline"><input type="checkbox" checked={policy.replenish}
      onChange={event => setPolicy({ ...policy, replenish: event.target.checked })}/> Simulate automatic purchase orders</label>
    <fieldset disabled={!policy.replenish}>
      <div className="form-grid">
        <AppliedNumber label="Reorder point" value={policy.reorderPoint} min={0} max={10_000} onCommit={reorderPoint => setPolicy({ ...policy, reorderPoint })}/>
        <AppliedNumber label="Purchase lot size" value={policy.lotSize} min={1} max={20_000} onCommit={lotSize => setPolicy({ ...policy, lotSize })}/>
        <AppliedNumber label="Supplier lead time (days)" value={policy.leadTime} min={1} max={30} onCommit={leadTime => setPolicy({ ...policy, leadTime })}/>
      </div>
      <p className="muted">Order a lot when on-hand stock plus inbound units, minus backlog, reaches the reorder point.</p>
    </fieldset>
  </section>;
}

function OrderEditor({ value, onSave, onCancel, horizon }: {
  value: Order; onSave: (order: Order) => void; onCancel: () => void; horizon: number;
}) {
  const [day, setDay] = useState(String(value.day));
  const [quantity, setQuantity] = useState(String(value.units));
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSave({ ...value, day: Number(day), units: Number(quantity) });
  }
  return <form className="inventory-order-editor" aria-label="Planned receipt" onSubmit={submit}>
    <div className="form-grid">
      <label>Arrival day<input type="number" required min={1} max={horizon} value={day} onChange={event => setDay(event.target.value)}/></label>
      <label>Units<input type="number" required min={1} max={20_000} value={quantity} onChange={event => setQuantity(event.target.value)}/></label>
    </div>
    <div className="page-actions">
      <button className="button primary">Save receipt</button>
      <button className="button secondary" type="button" onClick={onCancel}>Cancel</button>
    </div>
  </form>;
}

function PlannedReceipts({ orders, onOrders, horizon }: { orders: Order[]; onOrders: (orders: Order[]) => void; horizon: number }) {
  const [editing, setEditing] = useState<Order>();
  const nextId = useRef(10);
  function save(order: Order) {
    onOrders(orders.some(item => item.id === order.id)
      ? orders.map(item => item.id === order.id ? order : item)
      : [...orders, order]);
    setEditing(undefined);
  }
  return <section className="panel form-card">
    <div className="inventory-section-row">
      <div className="inventory-section-title"><PackagePlus size={19}/><h2>Planned receipts</h2></div>
      <button type="button" className="button secondary" disabled={orders.length >= 20}
        onClick={() => setEditing({ id: nextId.current++, day: 1, units: 100 })}>Add receipt</button>
    </div>
    {editing && <OrderEditor key={editing.id} value={editing} onSave={save} onCancel={() => setEditing(undefined)} horizon={horizon}/>}
    {orders.length ? <ul className="inventory-order-list">
      {[...orders].sort((a, b) => a.day - b.day || a.id - b.id).map(order => <li key={order.id}>
        <div><strong>{units.format(order.units)} units</strong><small>Day {order.day}{order.day > horizon ? ' · outside horizon' : ''}</small></div>
        <div className="page-actions">
          <button type="button" className="button secondary" aria-label={'Edit receipt for day ' + order.day} onClick={() => setEditing(order)}>Edit</button>
          <button type="button" className="button secondary" aria-label={'Remove receipt for day ' + order.day}
            onClick={() => { onOrders(orders.filter(item => item.id !== order.id)); if (editing?.id === order.id) setEditing(undefined); }}>Remove</button>
        </div>
      </li>)}
    </ul> : <p className="muted">Add an inbound shipment to include it in the forecast.</p>}
  </section>;
}

function Projection({ forecast, baseline, selected, onDay, reorderPoint }: {
  forecast: Forecast; baseline: Forecast; selected: number; onDay: (day: number) => void; reorderPoint: number;
}) {
  const maximum = Math.max(1, reorderPoint, ...forecast.days.map(entry => entry.closing), ...baseline.days.map(entry => entry.closing));
  const current = forecast.days[selected - 1];
  const original = baseline.days[selected - 1];
  return <section className="panel inventory-chart">
    <div className="panel-heading"><div><h2>Inventory projection</h2><p>Compare end-of-day stock against the baseline and reorder point.</p></div><Activity size={19}/></div>
    <div className="inventory-chart-scroll">
      <div className="inventory-plot" style={{ gridTemplateColumns: 'repeat(' + forecast.days.length + ', minmax(18px, 1fr))', minWidth: forecast.days.length * 19 }} aria-hidden="true">
        <div className="inventory-limit" style={{ bottom: (reorderPoint / maximum * 100) + '%' }}/>
        {forecast.days.map((day, index) => <div className={'inventory-bar-group' + (day.day === selected ? ' selected' : '')} key={day.day}
          onClick={() => onDay(day.day)} title={'Day ' + day.day + ' · ' + day.closing + ' units on hand'}>
          <i className="inventory-bar baseline" style={{ height: (baseline.days[index].closing / maximum * 100) + '%' }}/>
          <i className={'inventory-bar current' + (day.immediate < day.demand ? ' shortage' : '')}
            style={{ height: (day.closing / maximum * 100) + '%' }}/>
          {(index === 0 || (index + 1) % 7 === 0) && <span>{day.day}</span>}
        </div>)}
      </div>
    </div>
    <div className="inventory-legend"><span><i/> Current plan</span><span><i/> Baseline</span><span><i/> Reorder point</span></div>
    <div className="inventory-scrubber">
      <label>Inspect day<input type="range" min={1} max={forecast.days.length} value={selected} aria-valuetext={'Day ' + selected}
        onChange={event => onDay(event.target.valueAsNumber)}/></label>
      <dl>
        <div><dt>Day</dt><dd>{selected}</dd></div>
        <div><dt>On hand</dt><dd>{units.format(current.closing)}</dd></div>
        <div><dt>Baseline on hand</dt><dd>{units.format(original.closing)}</dd></div>
        <div><dt>Demand</dt><dd>{units.format(current.demand)}</dd></div>
        <div><dt>Received</dt><dd>{units.format(current.received)}</dd></div>
      </dl>
    </div>
  </section>;
}

function InboundSchedule({ receipts, horizon }: { receipts: Receipt[]; horizon: number }) {
  const [withinHorizon, setWithinHorizon] = useState(false);
  const visible = withinHorizon ? receipts.filter(receipt => receipt.day <= horizon) : receipts;
  return <section className="panel">
    <div className="panel-heading">
      <div><h2>Inbound schedule</h2><p>Planned receipts and orders generated by the selected policy.</p></div>
      <label className="check-inline"><input type="checkbox" checked={withinHorizon} onChange={event => setWithinHorizon(event.target.checked)}/> Within horizon</label>
    </div>
    {visible.length ? <div className="table-scroll inventory-inbound"><table>
      <thead><tr><th scope="col">Source</th><th scope="col">Order placed</th><th scope="col">Arrival</th><th scope="col">Quantity</th></tr></thead>
      <tbody>{visible.map(receipt => <tr key={receipt.id}>
        <td>{receipt.source === 'reorder' ? 'Automatic reorder' : 'Planned receipt'}</td>
        <td>{receipt.placed ? 'Day ' + receipt.placed : 'Before forecast'}</td>
        <td>Day {receipt.day}{receipt.day > horizon && <small className="inventory-outside"> Outside horizon</small>}</td>
        <td>{units.format(receipt.units)}</td>
      </tr>)}</tbody>
    </table></div> : <Empty title="No inbound receipts">Adjust stock policy or add a planned receipt.</Empty>}
  </section>;
}

function exportDays(sku: string, days: Day[]) {
  const headings = 'Day,Opening stock,Demand,Received,Shipped,Backorder,Lost sales,Closing stock';
  const content = [headings, ...days.map(day => [day.day, day.opening, day.demand, day.received, day.shipped, day.backorder, day.lost, day.closing].join(','))].join('\n');
  const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'inventory-' + sku + '.csv';
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function DailyLedger({ sku, days, selected, onDay }: { sku: string; days: Day[]; selected: number; onDay: (day: number) => void }) {
  const [exceptionsOnly, setExceptionsOnly] = useState(false);
  const visible = exceptionsOnly ? days.filter(day => day.immediate < day.demand || day.backorder > 0) : days;
  return <section className="panel">
    <div className="panel-heading">
      <div><h2>Daily stock ledger</h2><p>Follow each day’s orders, receipts, shipments, and closing stock.</p></div>
      <button className="button secondary" type="button" onClick={() => exportDays(sku, days)}><Download size={16}/> Export ledger</button>
    </div>
    <div className="inventory-ledger-controls"><label className="check-inline"><input type="checkbox" checked={exceptionsOnly}
      onChange={event => setExceptionsOnly(event.target.checked)}/> Only shortage days</label><span className="muted" role="status">{visible.length} days</span></div>
    {visible.length ? <div className="table-scroll inventory-ledger"><table>
      <thead><tr><th scope="col">Day</th><th scope="col">Opening</th><th scope="col">Demand</th><th scope="col">Received</th><th scope="col">Shipped</th>
        <th scope="col">Backlog</th><th scope="col">Lost sales</th><th scope="col">Closing</th></tr></thead>
      <tbody>{visible.map(day => <tr key={day.day} className={day.day === selected ? 'inventory-active-row' : undefined}>
        <th scope="row"><button type="button" className="inventory-day-link" onClick={() => onDay(day.day)}>Day {day.day}</button></th>
        {[day.opening, day.demand, day.received, day.shipped, day.backorder, day.lost, day.closing].map((value, index) => <td key={index}>{units.format(value)}</td>)}
      </tr>)}</tbody>
    </table></div> : <Empty title="No shortage days">The plan covers every delivery day in this forecast.</Empty>}
  </section>;
}

export function InventorySimulator() {
  const [product, setProduct] = useState<Product>(products[0]);
  const [policy, setPolicy] = useState(() => defaultPolicy(products[0]));
  const [orders, setOrders] = useState(() => initialOrders(products[0]));
  const [selectedDay, setSelectedDay] = useState(1);
  const [resetVersion, setResetVersion] = useState(0);
  const forecast = useMemo(() => simulate(product, policy, orders), [product, policy, orders]);
  const baseline = useMemo(() => simulate(product, { ...defaultPolicy(product), horizon: policy.horizon }, initialOrders(product)), [product, policy.horizon]);
  const day = Math.min(selectedDay, policy.horizon);

  function reset(next: Product) {
    setProduct(next);
    setPolicy(defaultPolicy(next));
    setOrders(initialOrders(next));
    setSelectedDay(1);
    setResetVersion(version => version + 1);
  }

  return <>
    <header className="page-heading">
      <div><h1>Inventory simulator</h1><p>Test how demand, supplier lead times, and reorder policies affect warehouse stock.</p></div>
      <button type="button" className="button secondary" onClick={() => reset(product)}><RotateCcw size={16}/> Reset plan</button>
    </header>
    <section className="panel form-card inventory-scenario">
      <div className="inventory-section-title"><Boxes size={20}/><h2>Forecast scenario</h2></div>
      <div className="inventory-config">
        <label>Product<select value={product.sku} onChange={event => reset(products.find(item => item.sku === event.target.value) ?? products[0])}>
          {products.map(item => <option key={item.sku} value={item.sku}>{item.name} · {item.sku}</option>)}
        </select><small>{product.warehouse}</small></label>
        <label>Demand and supply<select value={policy.scenario} onChange={event => setPolicy({ ...policy, scenario: event.target.value as Policy['scenario'] })}>
          {Object.entries(scenarios).map(([key, scenario]) => <option key={key} value={key}>{scenario.name}</option>)}
        </select><small>{scenarios[policy.scenario].description}</small></label>
        <label>Forecast horizon<select value={policy.horizon} onChange={event => setPolicy({ ...policy, horizon: Number(event.target.value) })}>
          {[14, 28, 42].map(days => <option key={days} value={days}>{days} days</option>)}
        </select></label>
      </div>
    </section>
    <div className="inventory-metrics">
      <Metric title="Projected demand" value={units.format(forecast.demand)} baseline={units.format(baseline.demand)}/>
      <Metric title="Same-day fill rate" value={percent(forecast.fillRate)} baseline={percent(baseline.fillRate)}/>
      <Metric title="Shortage days" value={units.format(forecast.daysShort)} baseline={units.format(baseline.daysShort)}/>
      <Metric title="Average stock value" value={usd.format(forecast.carryingCents / 100)} baseline={usd.format(baseline.carryingCents / 100)}/>
    </div>
    <div className="inventory-layout">
      <Projection forecast={forecast} baseline={baseline} selected={day} onDay={setSelectedDay} reorderPoint={policy.reorderPoint}/>
      <div className="inventory-control-stack" key={resetVersion}>
        <PolicyForm policy={policy} setPolicy={setPolicy}/>
        <PlannedReceipts orders={orders} onOrders={setOrders} horizon={policy.horizon}/>
      </div>
    </div>
    <section className="panel inventory-outcome">
      <ClipboardList size={20}/>
      <div><h2>At the end of the forecast</h2><p>{units.format(forecast.endingStock)} units remain on hand and {units.format(forecast.endingBackorder)} units remain on backorder.</p></div>
    </section>
    <InboundSchedule receipts={forecast.receipts} horizon={policy.horizon}/>
    <DailyLedger sku={product.sku} days={forecast.days} selected={day} onDay={setSelectedDay}/>
    <p className="muted">This simulation uses sample products and a steady-demand baseline.</p>
  </>;
}
