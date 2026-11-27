import { useEffect, useState, type FormEvent } from 'react';
import { Box, CircleCheck, Globe, MapPin, PackageSearch, ShieldCheck } from 'lucide-react';
import { api, ApiError, dateTime, day, message, statuses, type Account, type Tracking } from './data';
import { Badge, Brand, ErrorNotice, HeroGraphic, Link, navigate, StatusIcon } from './ui';
import { useWorkspaceApi } from './workspace-session';

export function Access({ register, next, onAccess }: { register: boolean; next: string; onAccess: (account: Account) => void }) {
  const [name, setName] = useState('');
  const [company, setCompany] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [sample, setSample] = useState(true);
  const [codeRequested, setCodeRequested] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  async function authenticate(action: 'login' | 'register' | 'register/verify' | 'demo') {
    setBusy(action); setError('');
    try {
      if (action === 'register') {
        await api('/auth/register', { method: 'POST', body: JSON.stringify({ email }) });
        setCodeRequested(true);
        setCode('');
        return;
      }
      const account = await api<Account>('/auth/' + action, {
        method: 'POST',
        body: action === 'demo' ? undefined : JSON.stringify(
          action === 'register/verify' ? { name, company, email, password, sample, code } : { email, password },
        ),
      });
      onAccess(account);
      navigate(action === 'demo' ? '/' : next, true);
    } catch (failure) { setError(message(failure)); }
    finally { setBusy(''); }
  }
  return <main className="access">
    <section className="access-main">
      <header><Link href="/" aria-label="Fieldline home"><Brand/></Link><Link className="tracking-link" href="/track"><PackageSearch size={17}/> Track shipment</Link></header>
      <div className="access-content">
        <div className="access-icon"><ShieldCheck size={23}/></div>
        <h1>{register ? 'Create your workspace' : 'Sign in to Fieldline'}</h1>
        <p>{register ? 'Set up your shipping operations workspace.' : 'Manage shipments, rates, and delivery activity.'}</p>
        <form onSubmit={event => { event.preventDefault(); void authenticate(register ? codeRequested ? 'register/verify' : 'register' : 'login'); }}>
          {register && <div className="form-grid"><label>Full name<input value={name} onChange={event => setName(event.target.value)} required autoComplete="name" maxLength={80}/></label><label>Workspace name<input value={company} onChange={event => setCompany(event.target.value)} required autoComplete="organization" maxLength={100}/></label></div>}
          <label>Email address<input required type="email" value={email} onChange={event => setEmail(event.target.value)} autoComplete="email" readOnly={codeRequested} maxLength={254} placeholder="you@company.com"/></label>
          <label>Password<input required type="password" value={password} onChange={event => setPassword(event.target.value)} autoComplete={register ? 'new-password' : 'current-password'} minLength={register ? 12 : undefined} maxLength={128} placeholder={register ? 'At least 12 characters' : 'Enter your password'}/></label>
          {register && <label className="check-inline"><input type="checkbox" checked={sample} onChange={event => setSample(event.target.checked)}/> Add sample data to explore the workspace</label>}
          {codeRequested && <>
            <p className="muted" role="status">Check your inbox for a verification code. It expires in ten minutes.</p>
            <label>Verification code<input required value={code} maxLength={16} autoComplete="one-time-code" pattern="[A-Fa-f0-9]{16}" onChange={event => setCode(event.target.value.trim())}/></label>
          </>}
          <ErrorNotice>{error}</ErrorNotice>
          <button className="button primary" disabled={!!busy}>{busy && busy !== 'demo' ? 'Working…' : register ? codeRequested ? 'Verify and create workspace' : 'Send verification code' : 'Sign in'}</button>
          {codeRequested && <div className="page-actions">
            <button className="button secondary" type="button" disabled={!!busy} onClick={() => void authenticate('register')}>Resend code</button>
            <button className="button secondary" type="button" disabled={!!busy} onClick={() => { setCodeRequested(false); setCode(''); setError(''); }}>Change email</button>
          </div>}
        </form>
        {!register && <button className="button secondary demo-button" disabled={!!busy} onClick={() => void authenticate('demo')}>{busy === 'demo' ? 'Preparing workspace…' : 'Explore demo workspace'}</button>}
        <p className="access-switch">{register ? 'Already have a workspace?' : 'New to Fieldline?'} <Link href={register ? '/login' : '/register'}>{register ? 'Sign in' : 'Create an account'}</Link></p>
      </div>
      <footer>Fieldline Logistics</footer>
    </section>
    <aside className="access-art">
      <div className="access-art-copy"><span className="hero-kicker"><span/> FIELDLINE LOGISTICS</span><h2>Shipping operations in one workspace.</h2><p>Create shipments, compare service estimates, and keep customers up to date through delivery.</p></div>
      <HeroGraphic/>
      <div className="access-art-footer"><span><Box size={17}/> Shipment management</span><span><CircleCheck size={17}/> Delivery visibility</span></div>
    </aside>
  </main>;
}

export function PublicTracking({ search, account }: { search: string; account: Account | null }) {
  const requested = new URLSearchParams(search).get('number')?.trim() ?? '';
  const [number, setNumber] = useState(requested);
  const [result, setResult] = useState<Tracking>();
  const [pending, setPending] = useState(Boolean(requested));
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!requested) return;
    const controller = new AbortController();
    api<Tracking>('/tracking/' + encodeURIComponent(requested), { signal: controller.signal })
      .then(setResult).catch(failure => {
        if (!controller.signal.aborted) setError(failure instanceof ApiError && failure.status === 404 ? 'No public shipment matches that tracking number.' : message(failure));
      }).finally(() => { if (!controller.signal.aborted) setPending(false); });
    return () => controller.abort();
  }, [requested, attempt]);
  function lookup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = number.trim().toUpperCase();
    if (!input) return;
    if (input !== requested) navigate('/track?number=' + encodeURIComponent(input));
    else { setPending(true); setError(''); setResult(undefined); setAttempt(value => value + 1); }
  }
  return <main className="tracking-page">
    <header><Link href="/" aria-label="Fieldline home"><Brand/></Link><Link className="button secondary" href={account ? '/' : '/login'}>{account ? 'Back to workspace' : 'Workspace sign in'}</Link></header>
    <section className="tracking-intro"><span className="access-icon"><PackageSearch size={23}/></span><h1>Track a shipment</h1><p>Enter your Fieldline tracking number to see delivery milestones.</p>
      <form onSubmit={lookup}><label>Tracking number<input required maxLength={64} autoComplete="off" value={number} onChange={event => setNumber(event.target.value)} placeholder="FL-…"/></label><button className="button primary" disabled={pending}>{pending ? 'Checking…' : 'Track shipment'}</button></form>
      <ErrorNotice>{error}</ErrorNotice>
    </section>
    {result && <section className="panel form-card tracking-result"><div className="panel-heading"><div><h2>{result.tracking}</h2><p>{['delivered', 'cancelled'].includes(result.status) ? 'Final shipment status' : 'Estimated delivery ' + day(result.eta)}</p></div><Badge status={result.status}/></div>
      <ol className="timeline">{[...result.milestones].reverse().map((event, index) => <li key={event.at + index}><StatusIcon status={event.status}/><div><strong>{statuses[event.status]}</strong><time dateTime={event.at}>{dateTime(event.at)}</time></div></li>)}</ol>
    </section>}
    <footer><Globe size={16}/> Fieldline Logistics <MapPin size={16}/></footer>
  </main>;
}

export function Settings({ account, onSave, onPasswordChange }: { account: Account; onSave: (account: Account) => void; onPasswordChange: () => void }) {
  const api = useWorkspaceApi();
  const [name, setName] = useState(account.name);
  const [company, setCompany] = useState(account.company);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); setBusy(true); setSaved(false);
    try { onSave(await api<Account>('/me', { method: 'PATCH', body: JSON.stringify({ name, company }) })); setSaved(true); }
    catch (failure) { setError(message(failure)); }
    finally { setBusy(false); }
  }
  return <><header className="page-heading"><div><h1>Settings</h1><p>Manage your profile and workspace identity.</p></div></header>
    <form className="panel form-card profile-form" onSubmit={save}>
      <div className="form-title"><ShieldCheck size={20}/><h2>Workspace profile</h2></div>
      <label>Full name<input required maxLength={80} value={name} onChange={event => { setName(event.target.value); setSaved(false); }}/></label>
      <label>Workspace name<input required maxLength={100} value={company} onChange={event => { setCompany(event.target.value); setSaved(false); }}/></label>
      {account.demo ? <p className="muted">This demo workspace expires 24 hours after creation.</p> : <label>Account email<input readOnly value={account.email}/></label>}
      <ErrorNotice>{error}</ErrorNotice>{saved && <p role="status" className="success"><CircleCheck size={16}/> Profile updated.</p>}
      <button className="button primary" disabled={busy}>{busy ? 'Saving…' : 'Save profile'}</button>
    </form>
    {!account.demo && <PasswordForm onChange={onPasswordChange}/>}
  </>;
}

function PasswordForm({ onChange }: { onChange: () => void }) {
  const api = useWorkspaceApi();
  const [currentPassword, setCurrent] = useState('');
  const [newPassword, setNew] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function change(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (newPassword !== confirm) { setError('The new passwords do not match.'); return; }
    setBusy(true); setError('');
    try {
      await api('/auth/password', { method: 'POST', body: JSON.stringify({ currentPassword, newPassword }) });
      onChange();
    } catch (failure) { setError(message(failure)); setBusy(false); }
  }
  return <form className="panel form-card profile-form" onSubmit={change}>
    <div className="form-title"><ShieldCheck size={20}/><h2>Change password</h2></div>
    <p className="muted">Changing your password signs you out of all sessions.</p>
    <label>Current password<input type="password" required maxLength={128} autoComplete="current-password" value={currentPassword} onChange={event => setCurrent(event.target.value)}/></label>
    <label>New password<input type="password" required minLength={12} maxLength={128} autoComplete="new-password" value={newPassword} onChange={event => setNew(event.target.value)}/></label>
    <label>Confirm new password<input type="password" required minLength={12} maxLength={128} autoComplete="new-password" value={confirm} onChange={event => setConfirm(event.target.value)}/></label>
    <ErrorNotice>{error}</ErrorNotice>
    <button className="button primary" disabled={busy}>{busy ? 'Updating…' : 'Change password'}</button>
  </form>;
}
