import { useMemo, useRef, useState, type FormEvent } from 'react';
import { Clock3, MapPin, PackagePlus, Route as RouteIcon, Truck, Warehouse } from 'lucide-react';
import { baseFleet, clockTime, depot, objectives, planDispatch, routePosition, scenarios, type Fleet, type Plan, type Point, type Stop, type Strategy } from './planner-model';
import { Empty, ErrorNotice } from './ui';
import './planner.css';

const colors = ['#467351', '#356e87', '#a96030', '#79598b'];
const strategies = Object.keys(objectives) as Strategy[];
type Scenario = keyof typeof scenarios;
const MAX_STOPS = 16;
const number = (value: number) => new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(value);
const toMinutes = (value: string): number => {
  const [hour, minute] = value.split(':').map(Number);
  return hour * 60 + minute;
};

function MapLeg({ from, to, color }: { from: Point; to: Point; color: string }) {
  const x = to.x - from.x;
  const y = to.y - from.y;
  return <i className="planner-leg" style={{ left: from.x + '%', top: from.y + '%', width: Math.hypot(x, y) + '%', transform: 'rotate(' + Math.atan2(y, x) + 'rad)', background: color }} />;
}

function NetworkMap({ plan, fleet, truck, time, onTime, onStop }: {
  plan: Plan; fleet: Fleet; truck: number; time: number; onTime: (time: number) => void; onStop: (stop: Stop) => void;
}) {
  const position = routePosition(plan.routes[truck], fleet, time);
  return <section className="panel planner-map-panel">
    <div className="panel-heading"><div><h2>Route schematic</h2><p>Choose a stop to adjust its location or time window.</p></div><RouteIcon size={19}/></div>
    <div className="planner-map">
      <div className="planner-water" aria-hidden="true"/>
      {plan.routes.map(route => {
        const positions = [depot, ...route.visits.map(visit => visit.stop), depot];
        return route.visits.length > 0 && <div className="planner-legs" key={route.truck} style={{ opacity: route.truck === truck ? 1 : 0.33 }}>
          {positions.slice(1).map((to, index) => <MapLeg key={index} from={positions[index]} to={to} color={colors[route.truck]}/>)}
        </div>;
      })}
      <span className="planner-depot" style={{ left: depot.x + '%', top: depot.y + '%' }} title="Dispatch depot" aria-label="Dispatch depot" role="img"><Warehouse size={18}/></span>
      {plan.routes.flatMap(route => route.visits.map((visit, index) => <button type="button"
        key={visit.stop.id} className="planner-pin" style={{ left: visit.stop.x + '%', top: visit.stop.y + '%', background: colors[route.truck] }}
        title={visit.stop.name + ' · truck ' + (route.truck + 1)} aria-label={'Edit stop ' + visit.stop.name}
        onClick={() => onStop(visit.stop)}>{index + 1}</button>))}
      {plan.unassigned.map(stop => <button type="button" key={stop.id} className="planner-pin unassigned-pin" style={{ left: stop.x + '%', top: stop.y + '%' }}
        title={stop.name + ' · unassigned'} aria-label={'Edit unassigned stop ' + stop.name} onClick={() => onStop(stop)}>?</button>)}
      {plan.routes[truck].visits.length > 0 && <span className="planner-vehicle" aria-hidden="true" style={{
        left: position.point.x + '%', top: position.point.y + '%', background: colors[truck],
      }}><Truck size={13}/></span>}
    </div>
    <div className="planner-map-key"><span><Warehouse size={16}/> Depot</span>{plan.routes.filter(route => route.visits.length).map(route =>
      <span key={route.truck}><i style={{ background: colors[route.truck] }}/> Truck {route.truck + 1}</span>)}</div>
    <div className="planner-replay">
      <label>Preview time <input type="range" min={fleet.start} max={plan.finish} value={time} disabled={plan.finish === fleet.start}
        aria-valuetext={clockTime(time)} onChange={event => onTime(event.target.valueAsNumber)}/></label>
      <p><strong>{clockTime(time)}</strong><span>Truck {truck + 1} · {position.detail}</span></p>
    </div>
  </section>;
}

function FleetControls({ fleet, update }: { fleet: Fleet; update: (fleet: Fleet) => void }) {
  return <section className="panel form-card">
    <div className="form-title"><Truck size={20}/><h2>Fleet settings</h2></div>
    <div className="form-grid">
      <label>Available trucks<select value={fleet.trucks} onChange={event => update({ ...fleet, trucks: Number(event.target.value) })}>
        {[1, 2, 3, 4].map(trucks => <option key={trucks} value={trucks}>{trucks}</option>)}
      </select></label>
      <label>Capacity per truck<select value={fleet.capacity} onChange={event => update({ ...fleet, capacity: Number(event.target.value) })}>
        {[260, 360, 540, 720, 900].map(capacity => <option key={capacity} value={capacity}>{capacity} kg</option>)}
      </select></label>
      <label>First departure<input type="time" value={clockTime(fleet.start)} onChange={event => {
        if (event.target.value) update({ ...fleet, start: toMinutes(event.target.value) });
      }}/></label>
      <label>Shift length<select value={fleet.shift} onChange={event => update({ ...fleet, shift: Number(event.target.value) })}>
        {[180, 240, 360, 480, 600].map(duration => <option key={duration} value={duration}>{duration / 60} hours</option>)}
      </select></label>
      <label>Average road speed<select value={fleet.speed} onChange={event => update({ ...fleet, speed: Number(event.target.value) })}>
        {[25, 35, 45, 55, 65].map(speed => <option key={speed} value={speed}>{speed} km/h</option>)}
      </select></label>
    </div>
    <label className="check-inline"><input type="checkbox" checked={fleet.returnToDepot}
      onChange={event => update({ ...fleet, returnToDepot: event.target.checked })}/> Return trucks to depot</label>
  </section>;
}

function StopEditor({ stop, save, remove, close }: { stop: Stop; save: (stop: Stop) => void; remove?: () => void; close: () => void }) {
  const [input, setInput] = useState(stop);
  const [error, setError] = useState('');
  const fields = [
    { key: 'kg', label: 'Load (kg)', min: 1, max: 2500 },
    { key: 'service', label: 'Service time (min)', min: 1, max: 180 },
    { key: 'x', label: 'Map position east (%)', min: 5, max: 95 },
    { key: 'y', label: 'Map position south (%)', min: 5, max: 95 },
  ] as const;
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!input.name.trim()) { setError('Enter a stop name.'); return; }
    if (![input.earliest, input.latest].every(Number.isFinite) || input.earliest > input.latest) {
      setError('Choose a service window that ends after it opens.'); return;
    }
    save({ ...input, name: input.name.trim() });
  }
  return <form className="panel form-card" onSubmit={submit} aria-label="Stop details">
    <div className="form-title"><MapPin size={18}/><h2>{remove ? 'Edit stop' : 'Add stop'}</h2></div>
    <label>Stop name<input required maxLength={70} value={input.name} onChange={event => setInput({ ...input, name: event.target.value })}/></label>
    <div className="form-grid">
      <label>Window opens<input required type="time" value={Number.isFinite(input.earliest) ? clockTime(input.earliest) : ''} onChange={event => setInput({ ...input, earliest: toMinutes(event.target.value) })}/></label>
      <label>Window closes<input required type="time" value={Number.isFinite(input.latest) ? clockTime(input.latest) : ''} onChange={event => setInput({ ...input, latest: toMinutes(event.target.value) })}/></label>
      {fields.map(({ key, label, min, max }) => <label key={key}>{label}<input required type="number" min={min} max={max}
        value={Number.isFinite(input[key]) ? input[key] : ''} onChange={event => setInput({ ...input, [key]: event.target.valueAsNumber })}/></label>)}
    </div>
    <ErrorNotice>{error}</ErrorNotice>
    <div className="page-actions"><button className="button primary">Save stop</button><button type="button" className="button secondary" onClick={close}>Dismiss</button>
      {remove && <button type="button" className="button secondary" onClick={remove}>Remove stop</button>}</div>
  </form>;
}

function Schedule({ plan, fleet, truck, choose }: { plan: Plan; fleet: Fleet; truck: number; choose: (truck: number) => void }) {
  const route = plan.routes[truck];
  return <section className="panel">
    <div className="panel-heading"><div><h2>Truck schedule</h2><p>Service times, load, and delivery windows for each run.</p></div><Clock3 size={19}/></div>
    <div className="planner-tabs" role="group" aria-label="Select truck">
      {plan.routes.map(item => <button className={'button secondary ' + (item.truck === truck ? 'planner-selected' : '')} type="button" key={item.truck}
        aria-pressed={item.truck === truck} onClick={() => choose(item.truck)}><i style={{ background: colors[item.truck] }}/> Truck {item.truck + 1}</button>)}
    </div>
    {!route.visits.length ? <Empty title="No stops assigned">Try a different planning objective or adjust fleet capacity.</Empty> : <>
      <div className="planner-truck-summary">
        <span><strong>{number(route.kg)} / {number(fleet.capacity)} kg</strong><small>Loaded</small></span>
        <span><strong>{number(route.km)} km</strong><small>Road distance</small></span>
        <span><strong>{route.wait} min</strong><small>Waiting time</small></span>
        <span><strong>{clockTime(route.finish)}</strong><small>{fleet.returnToDepot ? 'Back at depot' : 'Last stop completed'}</small></span>
      </div>
      <div className="table-scroll"><table>
        <thead><tr><th scope="col">Stop</th><th scope="col">Window</th><th scope="col">Arrival</th><th scope="col">Service</th><th scope="col">Departure</th><th scope="col">Status</th></tr></thead>
        <tbody>{route.visits.map(visit => <tr key={visit.stop.id}>
          <td><strong>{visit.stop.name}</strong><div className="cell-sub">{number(visit.legKm)} km · {visit.stop.kg} kg</div></td>
          <td>{clockTime(visit.stop.earliest)} – {clockTime(visit.stop.latest)}</td>
          <td>{clockTime(visit.arrival)}</td><td>{clockTime(visit.serviceStart)}</td><td>{clockTime(visit.departure)}</td>
          <td>{visit.late ? <span className="badge exception">{visit.late} min late</span> : <span className="badge delivered">On time</span>}</td>
        </tr>)}</tbody>
      </table></div>
    </>}
  </section>;
}

export function DispatchPlanner() {
  const [scenario, setScenario] = useState<Scenario>('harbor');
  const [stops, setStops] = useState<Stop[]>(scenarios.harbor.roads);
  const [fleet, setFleet] = useState(baseFleet);
  const [strategy, setStrategy] = useState<Strategy>('delivery');
  const [selectedTruck, setSelectedTruck] = useState(0);
  const [previewTime, setPreviewTime] = useState(baseFleet.start);
  const [editor, setEditor] = useState<Stop>();
  const nextId = useRef(100);
  const plans = useMemo(() => strategies.map(key => ({ key, plan: planDispatch(stops, fleet, key) })), [stops, fleet]);
  const plan = plans.find(item => item.key === strategy)!.plan;
  const truck = Math.min(selectedTruck, plan.routes.length - 1);
  const time = Math.max(fleet.start, Math.min(previewTime, plan.finish));
  const totalLoad = stops.reduce((total, stop) => total + stop.kg, 0);

  function loadScenario(value: Scenario) {
    setScenario(value); setStops(scenarios[value].roads); setFleet(baseFleet); setEditor(undefined); setSelectedTruck(0); setPreviewTime(baseFleet.start);
  }
  function addStop() {
    setEditor({ id: nextId.current++, name: '', kg: 100, service: 15, earliest: 510, latest: 660, x: 48, y: 56 });
  }
  function saveStop(stop: Stop) {
    setStops(current => current.some(item => item.id === stop.id) ? current.map(item => item.id === stop.id ? stop : item) : [...current, stop]);
    setEditor(undefined);
  }
  return <>
    <header className="page-heading">
      <div><h1>Dispatch planner</h1><p>Compare delivery routes by capacity, time windows, and truck availability.</p></div>
      <div className="page-actions planner-header-actions"><label>Scenario<select value={scenario} onChange={event => loadScenario(event.target.value as Scenario)}>
        {Object.entries(scenarios).map(([key, config]) => <option key={key} value={key}>{config.title}</option>)}
      </select></label><button className="button secondary" type="button" onClick={() => loadScenario(scenario)}>Reset scenario</button></div>
    </header>
    <section className="planner-options" aria-label="Compare planning objectives">
      {plans.map(({ key, plan: candidate }) => <button type="button" key={key} aria-pressed={key === strategy}
        className={'panel planner-option ' + (key === strategy ? 'planner-selected' : '')} onClick={() => setStrategy(key)}>
        <strong>{objectives[key]}</strong>
        <span>Distance <b>{number(candidate.km)} km</b></span><span>Late stops <b>{candidate.late}</b></span>
        <span>Unassigned <b>{candidate.unassigned.length}</b></span><span>Fleet finished <b>{clockTime(candidate.finish)}</b></span>
      </button>)}
    </section>

    <div className="planner-grid">
      <NetworkMap plan={plan} fleet={fleet} truck={truck} time={time} onTime={setPreviewTime} onStop={setEditor}/>
      <div className="planner-controls">
        <FleetControls fleet={fleet} update={setFleet}/>
        {editor ? <StopEditor key={editor.id} stop={editor} save={saveStop} close={() => setEditor(undefined)}
          remove={stops.some(stop => stop.id === editor.id) ? () => { setStops(stops.filter(stop => stop.id !== editor.id)); setEditor(undefined); } : undefined}/> :
          <section className="panel form-card">
            <div className="planner-stops-heading"><div><h2>Delivery stops</h2><p className="muted">{stops.length} stops · {number(totalLoad)} kg planned</p></div>
              <button className="button secondary" type="button" onClick={addStop} disabled={stops.length >= MAX_STOPS}><PackagePlus size={16}/> Add stop</button></div>
            <div className="planner-stop-list">
              {stops.map(stop => <button type="button" key={stop.id} onClick={() => setEditor(stop)}>
                <span>{stop.name}</span><small>{stop.kg} kg</small>
              </button>)}
            </div>
          </section>}
      </div>
    </div>

    {(plan.unassigned.length > 0 || plan.overtime > 0) && <section className="panel form-card planner-review">
      <h2>Dispatch review</h2>
      {plan.unassigned.length > 0 && <p>{plan.unassigned.length} stops exceed available capacity: {plan.unassigned.map(stop => stop.name).join(', ')}.</p>}
      {plan.overtime > 0 && <p>Scheduled overtime across the fleet: {plan.overtime} min.</p>}
    </section>}
    <Schedule plan={plan} fleet={fleet} truck={truck} choose={setSelectedTruck}/>
    <p className="muted">Planning estimates use the scenario’s schematic distances and your fleet settings.</p>
  </>;
}
