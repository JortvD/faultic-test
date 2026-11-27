export type Status = 'draft' | 'ready' | 'in_transit' | 'exception' | 'delivered' | 'cancelled';

export const statuses: Record<Status, string> = {
  draft: 'Draft', ready: 'Ready to ship', in_transit: 'In transit',
  exception: 'Exception', delivered: 'Delivered', cancelled: 'Cancelled',
};

export const transitions: Record<Status, Status[]> = {
  draft: ['ready', 'cancelled'], ready: ['in_transit', 'cancelled'],
  in_transit: ['in_transit', 'exception', 'delivered'], exception: ['in_transit', 'exception', 'delivered'],
  delivered: [], cancelled: [],
};

export interface Account {
  id: number;
  name: string;
  company: string;
  email: string;
  demo: boolean;
}

export interface Lane {
  origin: string;
  destination: string;
  international: boolean;
  weightKg: number;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
}

export interface ShipmentInput extends Lane {
  reference: string;
  recipient: string;
  deliveryAddress: string;
  carrier: string;
  shipDate: string;
}

export const exceptionReasons = {
  address_issue: 'Address issue',
  delivery_attempt: 'Delivery attempt failed',
  carrier_delay: 'Carrier delay',
  customs_hold: 'Customs hold',
  damage: 'Reported damage',
  other: 'Other',
} as const;

export type ExceptionReason = keyof typeof exceptionReasons;

export interface ShipmentEvent {
  status: Status;
  at: string;
  location: string;
  note: string;
  reason?: ExceptionReason;
}

export interface Shipment extends ShipmentInput {
  tracking: string;
  status: Status;
  version: number;
  eta: string;
  createdAt: string;
  costCents: number;
  chargeableKg: number;
  manifest?: string | null;
  events: ShipmentEvent[];
}

export interface Tracking {
  tracking: string;
  status: Status;
  eta: string;
  milestones: Pick<ShipmentEvent, 'status' | 'at'>[];
}

export interface Carrier {
  id: string;
  name: string;
  service: string;
  mode: string;
  days: number;
  maxKg: number;
  international: boolean;
}

export interface Quote {
  carrier: Carrier;
  days: number;
  costCents: number;
  chargeableKg: number;
}

export interface ContactInput {
  name: string;
  city: string;
  address: string;
  email: string;
  phone: string;
}

export interface Contact extends ContactInput {
  id: number;
  version: number;
}

export interface Manifest {
  id: string;
  reference: string;
  notes: string;
  carrier: string;
  origin: string;
  dispatchedAt: string;
  dispatchedBy: string;
  shipments: Pick<Shipment, 'tracking' | 'reference' | 'destination' | 'weightKg'>[];
}

export interface DispatchResult {
  manifest: Manifest;
  shipments: Shipment[];
}

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch('/api' + path, {
    ...init,
    headers: { Accept: 'application/json', ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...init.headers },
  });
  if (!response.ok) {
    if (response.status === 401 && !path.startsWith('/auth/')) window.dispatchEvent(new Event('fieldline-session-expired'));
    const error = await response.json().catch(() => null);
    throw new ApiError(response.status, error?.message ?? (response.status === 422 ? 'Check the form values and try again.' : 'The request could not be completed.'));
  }
  return response.status === 204 ? undefined as T : await response.json() as T;
}

export const money = (cents: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
export const today = () => new Date().toISOString().slice(0, 10);
export const day = (value: string) => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(value));
export const dateTime = (value: string) => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(value));
export const message = (error: unknown) => error instanceof Error ? error.message : 'Unexpected error.';
export const carrierName = (carriers: Carrier[], id: string) => carriers.find(carrier => carrier.id === id)?.name ?? id;
export const active = (shipment: Shipment) => ['ready', 'in_transit', 'exception'].includes(shipment.status);
export const overdue = (shipment: Shipment) => active(shipment) && shipment.eta < today();
export const onTime = (shipment: Shipment) => (shipment.events.find(event => event.status === 'delivered')?.at.slice(0, 10) ?? '9999-12-31') <= shipment.eta;
export const latest = (shipment: Shipment) => shipment.events[shipment.events.length - 1];
export const blankLane: Lane = { origin: '', destination: '', international: false, weightKg: 5, lengthCm: 35, widthCm: 25, heightCm: 20 };

export function downloadShipments(shipments: Shipment[], carriers: Carrier[], filename = 'fieldline-shipments.csv') {
  const escape = (input: string | number) => {
    const value = String(input);
    const safe = /^[\s\uFEFF]*[=+@-]|^[\t\r\n]/.test(value) ? "'" + value : value;
    return '"' + safe.replaceAll('"', '""') + '"';
  };
  const rows = shipments.map(shipment => [
    shipment.tracking, shipment.reference, shipment.recipient, shipment.origin, shipment.destination,
    carrierName(carriers, shipment.carrier), statuses[shipment.status], shipment.shipDate,
    shipment.eta, shipment.weightKg, (shipment.costCents / 100).toFixed(2),
  ]);
  const content = [['Tracking', 'Reference', 'Recipient', 'Origin', 'Destination', 'Carrier', 'Status', 'Ship date', 'ETA', 'Weight (kg)', 'Estimated cost (USD)'], ...rows]
    .map(row => row.map(escape).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8;' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
