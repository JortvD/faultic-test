export type Product = {
  sku: string;
  name: string;
  warehouse: string;
  stock: number;
  weekly: readonly number[];
  unitCents: number;
  reorderPoint: number;
  lotSize: number;
};
export type Scenario = 'steady' | 'promotion' | 'supplier';
export type Order = { id: number; day: number; units: number };
export type Policy = {
  horizon: number;
  scenario: Scenario;
  stock: number;
  reorderPoint: number;
  lotSize: number;
  leadTime: number;
  replenish: boolean;
  shortages: 'backorder' | 'lost';
};
export type Day = {
  day: number;
  opening: number;
  received: number;
  demand: number;
  shipped: number;
  backorder: number;
  lost: number;
  closing: number;
  immediate: number;
};
export type Receipt = Order & { source: 'planned' | 'reorder'; placed: number };
export type Forecast = {
  days: Day[];
  receipts: Receipt[];
  demand: number;
  fillRate: number;
  endingStock: number;
  endingBackorder: number;
  daysShort: number;
  carryingCents: number;
};

export const products: Product[] = [
  { sku: 'PK-240', name: 'Insulated packing kit', warehouse: 'North Harbor', stock: 730,
    weekly: [108, 115, 119, 124, 133, 82, 65], unitCents: 1240, reorderPoint: 460, lotSize: 520 },
  { sku: 'LBL-18', name: 'Thermal label roll', warehouse: 'Crossdock East', stock: 550,
    weekly: [72, 64, 87, 78, 89, 49, 42], unitCents: 350, reorderPoint: 290, lotSize: 390 },
  { sku: 'CR-60', name: 'Collapsible freight crate', warehouse: 'South Yard', stock: 310,
    weekly: [43, 49, 38, 44, 61, 27, 19], unitCents: 3750, reorderPoint: 190, lotSize: 240 },
];

export const scenarios: Record<Scenario, { name: string; description: string }> = {
  steady: { name: 'Steady demand', description: 'A recurring weekly demand pattern.' },
  promotion: { name: 'Promotional surge', description: 'Demand rises from day 5 through day 10.' },
  supplier: { name: 'Supplier delays', description: 'Automatic orders take three extra days to arrive.' },
};

export function defaultPolicy(product: Product): Policy {
  return { horizon: 28, scenario: 'steady', stock: product.stock, reorderPoint: product.reorderPoint,
    lotSize: product.lotSize, leadTime: 5, replenish: true, shortages: 'backorder' };
}

export function initialOrders(product: Product): Order[] {
  return [{ id: 1, day: 5, units: Math.ceil(product.lotSize / 2) }];
}

function demandFor(product: Product, scenario: Scenario, day: number) {
  const base = product.weekly[(day - 1) % product.weekly.length];
  return Math.round(base * (scenario === 'promotion' && day >= 5 && day <= 10 ? 1.65 : 1));
}

export function simulate(product: Product, policy: Policy, orders: Order[]): Forecast {
  const receipts: Receipt[] = orders.map(order => ({ ...order, day: order.day + 1, source: 'planned', placed: 0 }));
  const days: Day[] = [];
  let stock = policy.stock;
  let backorder = 0;
  let nextReorder = -1;
  const leadTime = policy.leadTime + (policy.scenario === 'supplier' ? 3 : 0);
  for (let day = 1; day <= policy.horizon; day++) {
    const opening = stock;
    const received = receipts.reduce((total, receipt) => total + (receipt.day === day ? receipt.units : 0), 0);
    stock += received;
    const catchup = Math.min(stock, backorder);
    stock -= catchup;
    backorder -= catchup;

    const demand = demandFor(product, policy.scenario, day);
    const immediate = Math.min(demand, stock);
    const unmet = demand - immediate;
    const lost = policy.shortages === 'lost' ? unmet : 0;
    stock -= immediate;
    backorder += unmet - lost;
    days.push({ day, opening, received, demand, shipped: catchup + immediate, backorder, lost, closing: stock, immediate });

    const arriving = receipts.reduce((total, receipt) => total + (receipt.day > day ? receipt.units : 0), 0);
    if (policy.replenish && stock + arriving - backorder <= policy.reorderPoint) {
      receipts.push({ id: nextReorder--, placed: day, day: day + leadTime, units: policy.lotSize, source: 'reorder' });
    }
  }

  const demand = days.reduce((total, day) => total + day.demand, 0);
  const immediate = days.reduce((total, day) => total + day.immediate, 0);
  return {
    days,
    receipts: receipts.sort((a, b) => a.day - b.day || a.id - b.id),
    demand: immediate,
    fillRate: demand === 0 ? 1 : immediate / demand,
    endingStock: stock,
    endingBackorder: backorder,
    daysShort: days.filter(day => day.immediate < day.demand).length,
    carryingCents: Math.round(days.reduce((total, day) => total + day.closing, 0) / days.length * product.unitCents),
  };
}
