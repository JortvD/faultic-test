import { useState, type FormEvent } from 'react';
import { ArrowLeft, ContactRound, Package, Plus, Search, Trash2 } from 'lucide-react';
import { message, type Contact, type ContactInput } from './data';
import { useWorkspaceApi } from './workspace-session';
import { Empty, ErrorNotice, Link, navigate } from './ui';

export function AddressBook({ contacts }: { contacts: Contact[] }) {
  const [search, setSearch] = useState('');
  const query = search.trim().toLowerCase();
  const filtered = [...contacts].sort((a, b) => a.name.localeCompare(b.name)).filter(contact =>
    [contact.name, contact.city, contact.address, contact.email, contact.phone].join(' ').toLowerCase().includes(query));
  return <>
    <header className="page-heading"><div><h1>Address book</h1><p>Save frequent recipients and reuse their delivery details.</p></div>
      <Link className="button primary" href="/contacts/new"><Plus size={17}/> Add contact</Link>
    </header>
    <section className="panel">
      <div className="filters"><label className="search-field"><Search size={17}/><input aria-label="Search contacts" placeholder="Search recipients or locations" value={search} onChange={event => setSearch(event.target.value)}/></label>
        <span className="muted" role="status">{filtered.length} {filtered.length === 1 ? 'contact' : 'contacts'}</span>
      </div>
      {!filtered.length ? <Empty title={query ? 'No matching contacts' : 'No saved contacts'}>{query ? 'Try a different search.' : 'Add a recipient to use their address on a shipment.'}</Empty>
        : <div className="table-scroll"><table><thead><tr><th scope="col">Recipient</th><th scope="col">Destination</th><th scope="col">Contact details</th><th scope="col">Shipment</th></tr></thead>
          <tbody>{filtered.map(contact => <tr key={contact.id}><td><Link className="table-link" href={'/contacts/' + contact.id}>{contact.name}</Link></td><td><strong>{contact.city}</strong><div className="cell-sub">{contact.address}</div></td>
            <td>{contact.email || contact.phone || '—'}{contact.email && contact.phone && <div className="cell-sub">{contact.phone}</div>}</td>
            <td><Link className="button secondary" href={'/shipments/new?contact=' + contact.id}><Package size={15}/> Ship to contact</Link></td></tr>)}</tbody>
        </table></div>}
    </section>
  </>;
}

const blankContact: ContactInput = { name: '', city: '', address: '', email: '', phone: '' };

export function ContactForm({ contact, onSave, onRemove, onReload }: {
  contact?: Contact; onSave: (contact: Contact) => void; onRemove: (id: number) => void; onReload: () => Promise<void>;
}) {
  const api = useWorkspaceApi();
  const [input, setInput] = useState<ContactInput>(contact ?? blankContact);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fields: { key: keyof ContactInput; label: string; limit: number; optional?: boolean; type?: string }[] = [
    { key: 'name', label: 'Recipient name', limit: 100 },
    { key: 'city', label: 'Destination city and region', limit: 100 },
    { key: 'address', label: 'Street address and postal code', limit: 240 },
    { key: 'email', label: 'Email address', limit: 254, type: 'email', optional: true },
    { key: 'phone', label: 'Phone number', limit: 48, type: 'tel', optional: true },
  ];
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const result = await api<Contact>(contact ? '/contacts/' + contact.id : '/contacts', {
        method: contact ? 'PUT' : 'POST', body: JSON.stringify({ ...input, version: contact?.version }),
      });
      onSave(result); navigate('/contacts');
    } catch (failure) { setError(message(failure)); }
    finally { setBusy(false); }
  }
  async function remove() {
    if (!contact) return;
    setBusy(true); setError('');
    try {
      await api('/contacts/' + contact.id, { method: 'DELETE', body: JSON.stringify({ version: contact.version }) });
      onRemove(contact.id); navigate('/contacts');
    } catch (failure) { setError(message(failure)); }
    finally { setBusy(false); }
  }
  return <>
    <Link className="back-link" href="/contacts"><ArrowLeft size={16}/> Address book</Link>
    <header className="page-heading"><div><h1>{contact ? contact.name : 'Add contact'}</h1><p>Save delivery details for future shipments.</p></div></header>
    <form className="panel form-card profile-form" onSubmit={save}>
      <div className="form-title"><ContactRound size={20}/><h2>Recipient details</h2></div>
      {fields.map(({ key, label, limit, optional, type }) => <label key={key}>{label}{optional ? ' (optional)' : ''}<input type={type ?? 'text'} maxLength={limit} required={!optional} value={input[key]} onChange={event => setInput({ ...input, [key]: event.target.value })}/></label>)}
      <ErrorNotice>{error}</ErrorNotice>
      <div className="page-actions"><button className="button primary" disabled={busy || confirm}>{busy ? 'Working…' : 'Save contact'}</button>
        {contact && !confirm && <button className="button secondary" type="button" disabled={busy} onClick={() => setConfirm(true)}><Trash2 size={16}/> Delete contact</button>}
        {contact && error && <button className="button secondary" type="button" disabled={busy} onClick={() => void onReload().then(() => setError('')).catch(failure => setError(message(failure)))}>Reload contact</button>}
      </div>
      {confirm && <div className="confirmation"><p>Delete this saved contact? Existing shipment addresses will stay in their shipment records.</p>
        <div className="page-actions"><button className="button danger" type="button" disabled={busy} onClick={() => void remove()}>Confirm deletion</button><button className="button secondary" type="button" disabled={busy} onClick={() => setConfirm(false)}>Keep contact</button></div>
      </div>}
    </form>
  </>;
}
