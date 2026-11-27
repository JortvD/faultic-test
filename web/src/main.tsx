import { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AlertTriangle, BarChart3, Bell, Calculator, ChevronDown, CircleHelp, ClipboardList, ContactRound, Globe2, LayoutDashboard, LogOut, Menu, Package, Search, Settings2, Truck, X } from 'lucide-react';
import { Access, PublicTracking, Settings } from './access';
import { Dashboard, Analytics } from './dashboard';
import { AddressBook, ContactForm } from './contacts';
import { ExceptionInbox } from './exceptions';
import { DispatchQueue, ManifestDetail } from './dispatch';
import { api, ApiError, message, type Account, type Carrier, type Contact, type Shipment } from './data';
import { CarrierDirectory, RateCalculator, ShipmentDetail, ShipmentForm, ShipmentIndex, ShippingLabel } from './shipments';
import { Brand, Empty, ErrorNotice, Link, navigate } from './ui';
import { announceSessionChange, bindWorkspace, sessionChangedKey, WorkspaceApi } from './workspace-session';
import './styles.css';

const navigation = [
  { name: 'Overview', href: '/', icon: LayoutDashboard },
  { name: 'Shipments', href: '/shipments', icon: Package },
  { name: 'Dispatch', href: '/dispatch', icon: ClipboardList },
  { name: 'Exceptions', href: '/exceptions', icon: AlertTriangle },
  { name: 'Address book', href: '/contacts', icon: ContactRound },
  { name: 'Rate calculator', href: '/rates', icon: Calculator },
  { name: 'Carriers', href: '/carriers', icon: Truck },
  { name: 'Analytics', href: '/analytics', icon: BarChart3 },
];

function App() {
  const [route, setRoute] = useState(() => window.location.pathname + window.location.search);
  const [account, setAccount] = useState<Account | null>();
  const [accessError, setAccessError] = useState('');
  const [sessionAttempt, setSessionAttempt] = useState(0);
  const accountId = useRef<number | null>(null);
  accountId.current = account?.id ?? null;
  useEffect(() => {
    function change() { setRoute(window.location.pathname + window.location.search); }
    function recheck() {
      accountId.current = null;
      setAccount(undefined);
      setAccessError('');
      setSessionAttempt(value => value + 1);
    }
    function onStorage(event: StorageEvent) { if (event.key === sessionChangedKey) recheck(); }
    function onConflict(event: Event) {
      if ((event as CustomEvent<number>).detail === accountId.current) recheck();
    }
    function onPageShow(event: PageTransitionEvent) { if (event.persisted) recheck(); }
    window.addEventListener('popstate', change);
    window.addEventListener('storage', onStorage);
    window.addEventListener('pageshow', onPageShow);
    window.addEventListener(sessionChangedKey, onConflict);
    return () => {
      window.removeEventListener('popstate', change);
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('pageshow', onPageShow);
      window.removeEventListener(sessionChangedKey, onConflict);
    };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    api<Account>('/me', { signal: controller.signal }).then(current => {
      if (!controller.signal.aborted) setAccount(current);
    }).catch(failure => {
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
    const name = navigation.find(item => item.href === path || (item.href !== '/' && path.startsWith(item.href + '/')))?.name
      ?? (path === '/track' ? 'Track shipment' : path === '/settings' ? 'Settings' : path.startsWith('/shipments') ? 'Shipments' : 'Workspace');
    document.title = name + ' · Fieldline Logistics';
  }, [path]);
  if (path === '/track') return <PublicTracking key={route} search={search} account={account ?? null}/>;
  if (accessError) return <main className="standalone"><Brand/><ErrorNotice>{accessError}</ErrorNotice>
    <button className="button primary" onClick={() => { setAccessError(''); setSessionAttempt(attempt => attempt + 1); }}>Retry</button></main>;
  if (account === undefined) return <main className="standalone" role="status"><Brand/>Loading workspace…</main>;
  if (!account) return <Access key={path === '/register' ? 'register' : 'login'} register={path === '/register'} next={path.startsWith('//') || ['/login', '/register'].includes(path) ? '/' : route} onAccess={current => { setAccount(current); announceSessionChange(); }}/>;
  return <Workspace key={account.id} account={account} path={path} search={search} onAccount={setAccount}/>;
}

function Workspace({ account, path, search, onAccount }: { account: Account; path: string; search: string; onAccount: (account: Account | null) => void }) {
  const api = useMemo(() => bindWorkspace(account.id), [account.id]);
  const [shipments, setShipments] = useState<Shipment[]>();
  const [carriers, setCarriers] = useState<Carrier[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
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
    const options = { signal: controller.signal };
    Promise.all([api<Shipment[]>('/shipments', options), api<Carrier[]>('/carriers', options), api<Contact[]>('/contacts', options)])
      .then(([records, services, addressBook]) => { setShipments(records); setCarriers(services); setContacts(addressBook); })
      .catch(failure => {
        if (controller.signal.aborted) return;
        setLoadError(message(failure));
      });
    return () => controller.abort();
  }, [api, attempt]);

  function saveShipments(records: Shipment[]) {
    const updated = new Map(records.map(record => [record.tracking, record]));
    setShipments(previous => {
      const existing = previous ?? [];
      const known = new Set(existing.map(record => record.tracking));
      return [...records.filter(record => !known.has(record.tracking)), ...existing.map(record => updated.get(record.tracking) ?? record)];
    });
  }
  function saveShipment(record: Shipment) { saveShipments([record]); }
  function saveContact(contact: Contact) {
    setContacts(previous => [...previous.filter(item => item.id !== contact.id), contact]);
  }
  async function reloadContacts() { setContacts(await api<Contact[]>('/contacts')); }
  async function reloadShipments() { setShipments(await api<Shipment[]>('/shipments')); }
  function endSession() {
    onAccount(null);
    announceSessionChange();
    navigate('/login', true);
  }
  async function signOut() {
    setSigningOut(true); setSessionError('');
    try { await api('/auth/logout', { method: 'POST' }); endSession(); }
    catch (failure) { setSessionError(message(failure)); setSigningOut(false); }
  }
  const shipPath = path.match(/^\/shipments\/(FL-[A-F0-9]{20})(?:\/(edit|label))?$/);
  const displayPath = navigation.find(item => item.href === path || (item.href !== '/' && path.startsWith(item.href + '/')))?.name ?? (path === '/settings' ? 'Settings' : 'Overview');
  const alerts = shipments?.filter(shipment => shipment.status === 'exception').length ?? 0;
  const initials = account.name.trim().split(/\s+/).slice(0, 2).map(name => Array.from(name)[0]?.toUpperCase()).join('');
  const query = new URLSearchParams(search);
  let content;
  if (loadError) content = <section className="panel form-card"><ErrorNotice>{loadError}</ErrorNotice><button className="button secondary" onClick={() => { setLoadError(''); setAttempt(attempt + 1); }}>Retry</button></section>;
  else if (!shipments) content = <div className="panel form-card" role="status">Loading shipments…</div>;
  else if (path === '/' || path === '/login' || path === '/register') content = <Dashboard {...{ account, shipments, carriers }}/>;
  else if (path === '/settings') content = <Settings account={account} onSave={onAccount} onPasswordChange={endSession}/>;
  else if (path === '/rates') content = <RateCalculator/>;
  else if (path === '/exceptions') content = <ExceptionInbox {...{ shipments, carriers }}/>;
  else if (path === '/dispatch') content = <DispatchQueue {...{ shipments, carriers }} onDispatch={saveShipments} onReload={reloadShipments}/>;
  else if (/^\/dispatch\/MF-[A-F0-9]{20}$/.test(path)) content = <ManifestDetail key={path} id={path.slice('/dispatch/'.length)} carriers={carriers}/>;
  else if (path === '/contacts') content = <AddressBook contacts={contacts}/>;
  else if (path === '/contacts/new' || /^\/contacts\/[0-9]+$/.test(path)) {
    const contact = contacts.find(item => item.id === Number(path.slice('/contacts/'.length)));
    if (path === '/contacts/new' || contact) content = <ContactForm key={path + (contact?.version ?? '')} contact={contact} onSave={saveContact} onRemove={id => setContacts(previous => previous.filter(item => item.id !== id))} onReload={reloadContacts}/>;
  }
  else if (path === '/carriers') content = <CarrierDirectory {...{ shipments, carriers }}/>;
  else if (path === '/analytics') content = <Analytics {...{ shipments, carriers }}/>;
  else if (path === '/shipments') content = <ShipmentIndex key={search} {...{ shipments, carriers, query }}/>;
  else if (path === '/shipments/new') content = <ShipmentForm key={path + search} source={shipments.find(item => item.tracking === query.get('copy'))} {...{ carriers, contacts, query }} onSave={saveShipment}/>;
  else if (shipPath) {
    const shipment = shipments.find(record => record.tracking === shipPath[1]);
    if (shipment && shipPath[2] === 'edit' && ['draft', 'ready'].includes(shipment.status)) {
      content = <ShipmentForm key={path + shipment.version} existing={shipment} {...{ carriers, contacts, query }} onSave={saveShipment}/>;
    } else if (shipment && shipPath[2] === 'label' && shipment.status !== 'cancelled') {
      content = <ShippingLabel shipment={shipment}/>;
    } else if (shipment) {
      content = <ShipmentDetail key={shipment.tracking + shipment.version} shipment={shipment} carriers={carriers} onSave={saveShipment} onRefresh={async () => saveShipment(await api<Shipment>('/shipments/' + shipment.tracking))}/>;
    }
  }
  if (!content) content = <section className="panel"><Empty title={shipPath ? 'Shipment not found' : 'Page not found'}><Link className="button secondary" href="/shipments">View shipments</Link></Empty></section>;
  return <WorkspaceApi.Provider value={api}><div className="workspace">
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
          <Link className="icon-button notification" aria-label={alerts + ' shipments need attention. View exceptions'} title="View exceptions" href="/exceptions"><Bell size={20}/>{alerts > 0 && <span/>}</Link>
          <Link href="/settings" className="account-avatar top-avatar" aria-label="Account settings">{initials}</Link>
        </div>
      </header>
      <main id="workspace-content" className="workspace-content"><ErrorNotice>{sessionError}</ErrorNotice>{content}</main>
    </div>
  </div></WorkspaceApi.Provider>;
}

createRoot(document.getElementById('root')!).render(<App/>);
