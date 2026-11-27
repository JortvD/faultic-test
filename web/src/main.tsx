import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BarChart3, Bell, Calculator, ChevronDown, CircleHelp, Globe2, LayoutDashboard, LogOut, Menu, Package, Search, Settings2, Truck, X } from 'lucide-react';
import { Access, PublicTracking, Settings } from './access';
import { Dashboard, Analytics } from './dashboard';
import { api, ApiError, message, type Account, type Carrier, type Shipment } from './data';
import { CarrierDirectory, RateCalculator, ShipmentDetail, ShipmentForm, ShipmentIndex, ShippingLabel } from './shipments';
import { Brand, Empty, ErrorNotice, Link, navigate } from './ui';
import './styles.css';

const navigation = [
  { name: 'Overview', href: '/', icon: LayoutDashboard },
  { name: 'Shipments', href: '/shipments', icon: Package },
  { name: 'Rate calculator', href: '/rates', icon: Calculator },
  { name: 'Carriers', href: '/carriers', icon: Truck },
  { name: 'Analytics', href: '/analytics', icon: BarChart3 },
];

function App() {
  const [route, setRoute] = useState(() => window.location.pathname + window.location.search);
  const [account, setAccount] = useState<Account | null>();
  const [accessError, setAccessError] = useState('');
  const [sessionAttempt, setSessionAttempt] = useState(0);
  useEffect(() => {
    function change() { setRoute(window.location.pathname + window.location.search); }
    window.addEventListener('popstate', change);
    return () => window.removeEventListener('popstate', change);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    api<Account>('/me', { signal: controller.signal }).then(setAccount).catch(failure => {
      if (controller.signal.aborted) return;
      if (failure instanceof ApiError && failure.status === 401) setAccount(null);
      else setAccessError(message(failure));
    });
    return () => controller.abort();
  }, [sessionAttempt]);
  const queryStart = route.indexOf('?');
  const path = queryStart < 0 ? route : route.slice(0, queryStart);
  const search = queryStart < 0 ? '' : route.slice(queryStart + 1);
  useEffect(() => {
    const name = navigation.find(item => item.href === path)?.name
      ?? (path === '/track' ? 'Track shipment' : path === '/settings' ? 'Settings' : path.startsWith('/shipments') ? 'Shipments' : 'Workspace');
    document.title = name + ' · Fieldline Logistics';
  }, [path]);
  if (path === '/track') return <PublicTracking key={route} search={search} account={account ?? null}/>;
  if (accessError) return <main className="standalone"><Brand/><ErrorNotice>{accessError}</ErrorNotice>
    <button className="button primary" onClick={() => { setAccessError(''); setSessionAttempt(attempt => attempt + 1); }}>Retry</button></main>;
  if (account === undefined) return <main className="standalone" role="status"><Brand/>Loading workspace…</main>;
  if (!account) return <Access key={path === '/register' ? 'register' : 'login'} register={path === '/register'} next={path.startsWith('//') || ['/login', '/register'].includes(path) ? '/' : route} onAccess={setAccount}/>;
  return <Workspace key={account.id} account={account} path={path} search={search} onAccount={setAccount}/>;
}

function Workspace({ account, path, search, onAccount }: { account: Account; path: string; search: string; onAccount: (account: Account | null) => void }) {
  const [shipments, setShipments] = useState<Shipment[]>();
  const [carriers, setCarriers] = useState<Carrier[]>([]);
  const [loadError, setLoadError] = useState('');
  const [sessionError, setSessionError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [signingOut, setSigningOut] = useState(false);
  useEffect(() => {
    if (!mobileOpen) return;
    function close(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      setMobileOpen(false);
      document.getElementById('open-workspace-menu')?.focus();
    }
    window.addEventListener('keydown', close);
    document.getElementById('close-workspace-menu')?.focus();
    return () => window.removeEventListener('keydown', close);
  }, [mobileOpen]);
  useEffect(() => {
    const controller = new AbortController();
    Promise.all([api<Shipment[]>('/shipments', { signal: controller.signal }), api<Carrier[]>('/carriers', { signal: controller.signal })])
      .then(([records, services]) => { setShipments(records); setCarriers(services); })
      .catch(failure => {
        if (controller.signal.aborted) return;
        if (failure instanceof ApiError && failure.status === 401) { onAccount(null); navigate('/login', true); }
        else setLoadError(message(failure));
      });
    return () => controller.abort();
  }, [attempt, onAccount]);

  function saveShipment(record: Shipment) {
    setShipments(previous => {
      if (!previous) return [record];
      return previous.some(shipment => shipment.tracking === record.tracking) ? previous.map(shipment => shipment.tracking === record.tracking ? record : shipment) : [record, ...previous];
    });
  }
  async function signOut() {
    setSigningOut(true); setSessionError('');
    try { await api('/auth/logout', { method: 'POST' }); onAccount(null); navigate('/login', true); }
    catch (failure) { setSessionError(message(failure)); setSigningOut(false); }
  }
  const shipPath = path.match(/^\/shipments\/(FL-[A-F0-9]{20})(?:\/(edit|label))?$/);
  const displayPath = navigation.find(item => item.href === path)?.name ?? (path === '/settings' ? 'Settings' : path.startsWith('/shipments') ? 'Shipments' : 'Overview');
  const alerts = shipments?.filter(shipment => shipment.status === 'exception').length ?? 0;
  const initials = account.name.trim().split(/\s+/).slice(0, 2).map(name => Array.from(name)[0]?.toUpperCase()).join('');
  const query = new URLSearchParams(search);
  let content;
  if (loadError) content = <section className="panel form-card"><ErrorNotice>{loadError}</ErrorNotice><button className="button secondary" onClick={() => { setLoadError(''); setAttempt(attempt + 1); }}>Retry</button></section>;
  else if (!shipments) content = <div className="panel form-card" role="status">Loading shipments…</div>;
  else if (path === '/' || path === '/login' || path === '/register') content = <Dashboard {...{ account, shipments, carriers }}/>;
  else if (path === '/settings') content = <Settings account={account} onSave={onAccount} onPasswordChange={() => { onAccount(null); navigate('/login', true); }}/>;
  else if (path === '/rates') content = <RateCalculator/>;
  else if (path === '/carriers') content = <CarrierDirectory {...{ shipments, carriers }}/>;
  else if (path === '/analytics') content = <Analytics {...{ shipments, carriers }}/>;
  else if (path === '/shipments') content = <ShipmentIndex key={search} {...{ shipments, carriers, query }}/>;
  else if (path === '/shipments/new') content = <ShipmentForm key={path + search} {...{ carriers, query }} onSave={saveShipment}/>;
  else if (shipPath) {
    const shipment = shipments.find(record => record.tracking === shipPath[1]);
    if (shipment && shipPath[2] === 'edit' && ['draft', 'ready'].includes(shipment.status)) {
      content = <ShipmentForm key={path + shipment.version} existing={shipment} {...{ carriers, query }} onSave={saveShipment}/>;
    } else if (shipment && shipPath[2] === 'label' && shipment.status !== 'cancelled') {
      content = <ShippingLabel shipment={shipment}/>;
    } else if (shipment) {
      content = <ShipmentDetail key={shipment.tracking + shipment.version} shipment={shipment} carriers={carriers} onSave={saveShipment} onRefresh={async () => saveShipment(await api<Shipment>('/shipments/' + shipment.tracking))}/>;
    }
  }
  if (!content) content = <section className="panel"><Empty title={shipPath ? 'Shipment not found' : 'Page not found'}><Link className="button secondary" href="/shipments">View shipments</Link></Empty></section>;
  return <div className="workspace">
    <a className="skip" href="#workspace-content">Skip to content</a>
    <aside className={'sidebar' + (mobileOpen ? ' is-open' : '')} aria-label="Workspace navigation">
      <div className="sidebar-brand"><Link href="/" aria-label="Fieldline overview" onClick={() => setMobileOpen(false)}><Brand/></Link><button id="close-workspace-menu" className="icon-button mobile-only" aria-label="Close menu" onClick={() => setMobileOpen(false)}><X size={22}/></button></div>
      <Link href="/settings" className="workspace-picker" onClick={() => setMobileOpen(false)}><span className="workspace-avatar"><Globe2 size={19}/></span><span><strong>{account.company}</strong><small>{account.demo ? 'Demo workspace' : 'Shipping workspace'}</small></span><ChevronDown size={15}/></Link>
      <nav className="nav">
        <div className="nav-label">OPERATIONS</div>
        {navigation.map(({ name, href, icon: Icon }) => {
          const selected = href === '/' ? ['/', '/login', '/register'].includes(path) : path === href || path.startsWith(href + '/');
          return <Link key={href} href={href} aria-current={selected ? 'page' : undefined} className={selected ? 'selected' : ''} onClick={() => setMobileOpen(false)}><Icon size={18}/>{name}</Link>;
        })}
        <div className="nav-label nav-gap">WORKSPACE</div>
        <Link href="/settings" className={path === '/settings' ? 'selected' : ''} aria-current={path === '/settings' ? 'page' : undefined} onClick={() => setMobileOpen(false)}><Settings2 size={18}/> Settings</Link>
        <Link href="/track" onClick={() => setMobileOpen(false)}><CircleHelp size={18}/> Public tracking</Link>
      </nav>
      <div className="sidebar-bottom"><div className="account-chip"><span className="account-avatar">{initials}</span><span><strong>{account.name}</strong><small>{account.demo ? 'Demo access' : 'Workspace owner'}</small></span><button type="button" className="icon-button" aria-label="Sign out" title="Sign out" disabled={signingOut} onClick={() => void signOut()}><LogOut size={17}/></button></div></div>
    </aside>
    {mobileOpen && <button className="scrim" aria-label="Close navigation" onClick={() => setMobileOpen(false)}/>}
    <div className="workspace-main">
      <header className="topbar"><div className="breadcrumbs"><button id="open-workspace-menu" className="icon-button mobile-only" aria-label="Open menu" aria-expanded={mobileOpen} onClick={() => setMobileOpen(!mobileOpen)}><Menu size={22}/></button><span>Workspace</span><i>/</i><strong>{displayPath}</strong></div>
        <div className="top-actions"><form className="top-search" onSubmit={event => {
          event.preventDefault(); navigate('/shipments?q=' + encodeURIComponent(searchText.trim()));
        }}><Search size={17}/><input aria-label="Search workspace shipments" placeholder="Search shipments" value={searchText} onChange={event => setSearchText(event.target.value)}/></form>
          <Link className="icon-button notification" aria-label={alerts + ' shipments need attention. View exceptions'} title="View exceptions" href="/shipments?status=exception"><Bell size={20}/>{alerts > 0 && <span/>}</Link>
          <Link href="/settings" className="account-avatar top-avatar" aria-label="Account settings">{initials}</Link>
        </div>
      </header>
      <main id="workspace-content" className="workspace-content"><ErrorNotice>{sessionError}</ErrorNotice>{content}</main>
    </div>
  </div>;
}

createRoot(document.getElementById('root')!).render(<App/>);
