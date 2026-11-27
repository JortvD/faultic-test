import type { AnchorHTMLAttributes, ReactNode } from 'react';
import { AlertCircle, ArrowDownRight, Box, Layers3, Package, PackageCheck } from 'lucide-react';
import { statuses, type Status } from './data';

export function navigate(path: string, replace = false) {
  if (replace) window.history.replaceState(null, '', path);
  else window.history.pushState(null, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
  window.scrollTo(0, 0);
}

export function Link({ href, children, onClick, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  return <a {...props} href={href} onClick={event => {
    onClick?.(event);
    if (!event.defaultPrevented && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && !props.target) {
      event.preventDefault();
      navigate(href);
    }
  }}>{children}</a>;
}

export function Brand({ light = false }: { light?: boolean }) {
  return <div className={light ? 'brand brand-light' : 'brand'}><span className="brand-mark"><Layers3 size={22} strokeWidth={2.2} /></span><span>fieldline<span className="brand-period">.</span></span></div>;
}

export function Badge({ status }: { status: Status }) {
  return <span className={'badge ' + status}><span />{statuses[status]}</span>;
}

export function ErrorNotice({ children }: { children: ReactNode }) {
  return children ? <div role="alert" className="error"><AlertCircle size={17} />{children}</div> : null;
}

export function Empty({ title, children }: { title: string; children: ReactNode }) {
  return <div className="empty"><div className="empty-icon"><Box size={24}/></div><h3>{title}</h3><div>{children}</div></div>;
}

export function StatusIcon({ status }: { status: Status }) {
  const Icon = status === 'exception' ? AlertCircle : status === 'delivered' ? PackageCheck : Package;
  return <span className={'status-icon ' + status}><Icon size={17} /></span>;
}

export function HeroGraphic() {
  return <div className="hero-graphic" aria-hidden="true">
    <div className="hero-grid"/>
    <div className="route-path route-path-one"/><div className="route-path route-path-two"/>
    <div className="graphic-station station-origin"/><div className="graphic-station station-end"/>
    <div className="graphic-card">
      <div className="graphic-card-top"><Package size={19}/><span>FIELDLINE FREIGHT</span></div>
      <div className="graphic-line"/><div className="graphic-line short"/>
      <div className="graphic-card-bottom"><span className="barcode"/><ArrowDownRight size={19}/></div>
    </div>
    <div className="graphic-marker"><span/> IN TRANSIT</div>
  </div>;
}
