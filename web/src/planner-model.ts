export type Point = { x: number; y: number };
export type Stop = Point & { id: number; name: string; kg: number; service: number; earliest: number; latest: number };
export type Fleet = { trucks: number; capacity: number; start: number; shift: number; speed: number; returnToDepot: boolean };
export type Strategy = 'delivery' | 'distance' | 'balance';

export type Visit = {
  stop: Stop;
  arrival: number;
  serviceStart: number;
  departure: number;
  legKm: number;
  late: number;
};
export type Route = {
  truck: number;
  visits: Visit[];
  km: number;
  kg: number;
  finish: number;
  wait: number;
  overtime: number;
  late: number;
};
export type Plan = {
  routes: Route[];
  unassigned: Stop[];
  km: number;
  late: number;
  overtime: number;
  finish: number;
};

export const depot: Point = { x: 19, y: 53 };
export const baseFleet: Fleet = { trucks: 3, capacity: 540, start: 480, shift: 480, speed: 45, returnToDepot: true };
export const scenarios = {
  harbor: {
    title: 'Harbor deliveries',
    roads: [
      { id: 1, name: 'Market Hall', x: 36, y: 23, kg: 145, service: 15, earliest: 495, latest: 550 },
      { id: 2, name: 'Beacon Pharmacy', x: 50, y: 13, kg: 90, service: 10, earliest: 505, latest: 565 },
      { id: 3, name: 'North Pier', x: 76, y: 24, kg: 200, service: 25, earliest: 510, latest: 615 },
      { id: 4, name: 'Eastbank Warehouse', x: 85, y: 54, kg: 225, service: 20, earliest: 535, latest: 675 },
      { id: 5, name: 'Southgate Grocer', x: 64, y: 77, kg: 155, service: 15, earliest: 540, latest: 685 },
      { id: 6, name: 'Foundry Studios', x: 35, y: 79, kg: 125, service: 15, earliest: 600, latest: 720 },
      { id: 7, name: 'River Terminal', x: 64, y: 47, kg: 180, service: 18, earliest: 510, latest: 635 },
    ],
  },
  morning: {
    title: 'Morning rush',
    roads: [
      { id: 1, name: 'Bakery Exchange', x: 24, y: 24, kg: 160, service: 21, earliest: 490, latest: 525 },
      { id: 2, name: 'Orchard Produce', x: 49, y: 18, kg: 155, service: 20, earliest: 490, latest: 535 },
      { id: 3, name: 'Civic Center', x: 55, y: 42, kg: 105, service: 16, earliest: 540, latest: 575 },
      { id: 4, name: 'Juniper School', x: 79, y: 67, kg: 185, service: 20, earliest: 545, latest: 580 },
      { id: 5, name: 'Elm Street Market', x: 42, y: 79, kg: 135, service: 15, earliest: 545, latest: 595 },
      { id: 6, name: 'Ferry Landing', x: 81, y: 25, kg: 210, service: 16, earliest: 525, latest: 595 },
    ],
  },
} satisfies Record<string, { title: string; roads: Stop[] }>;

export const objectives: Record<Strategy, string> = {
  delivery: 'Protect delivery windows',
  distance: 'Minimize road distance',
  balance: 'Balance truck workloads',
};

function distance(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y) * 0.65;
}

function schedule(stops: Stop[], truck: number, fleet: Fleet): Route {
  let position = depot;
  let clock = fleet.start;
  let km = 0;
  let wait = 0;
  const visits = stops.map(stop => {
    const legKm = distance(position, stop);
    const arrival = clock + Math.ceil(60 * legKm / fleet.speed);
    const serviceStart = Math.max(arrival, stop.earliest);
    const departure = serviceStart + stop.service;
    wait += serviceStart - arrival;
    km += legKm;
    position = stop;
    clock = departure;
    return { stop, arrival, serviceStart, departure, legKm, late: Math.max(0, serviceStart - stop.latest) };
  });
  if (fleet.returnToDepot && visits.length) {
    const returnKm = distance(position, depot);
    km += returnKm;
    clock += Math.ceil(60 * returnKm / fleet.speed);
  }
  return {
    truck, visits, km, wait, finish: clock,
    kg: stops.reduce((total, stop) => total + stop.kg, 0),
    overtime: Math.max(0, clock - fleet.start - fleet.shift),
    late: visits.reduce((total, visit) => total + visit.late, 0),
  };
}

function score(route: Route, fleet: Fleet, strategy: Strategy) {
  const work = route.finish - fleet.start;
  switch (strategy) {
    case 'delivery': return 14 * route.late + 6 * route.overtime + route.km + work * 0.15;
    case 'distance': return 2 * route.late + 4 * route.overtime + route.km * 3;
    case 'balance': return 9 * route.late + 6 * route.overtime + (work / fleet.shift) ** 2 * 140 + route.km;
  }
}

export function planDispatch(stops: Stop[], fleet: Fleet, strategy: Strategy): Plan {
  const routes = Array.from({ length: fleet.trucks }, (_, truck) => schedule([], truck, fleet));
  const sequence = [...stops].sort((a, b) => strategy === 'distance'
    ? b.kg - a.kg || a.latest - b.latest
    : a.latest - b.latest || b.kg - a.kg);
  const unassigned: Stop[] = [];
  for (const stop of sequence) {
    let best: { route: Route; delta: number } | undefined;
    for (const existing of routes) {
      if (existing.kg + stop.kg > fleet.capacity) continue;
      const order = existing.visits.map(visit => visit.stop);
      for (let index = 0; index <= order.length; index++) {
        const next = schedule([...order.slice(0, index), stop, ...order.slice(index)], existing.truck, fleet);
        const delta = score(next, fleet, strategy) - score(existing, fleet, strategy);
        if (!best || delta < best.delta) best = { route: next, delta };
      }
    }
    if (best) routes[best.route.truck] = best.route;
    else unassigned.push(stop);
  }

  return {
    routes, unassigned,
    km: Math.max(0, ...routes.map(route => route.km)),
    late: routes.reduce((total, route) => total + route.visits.filter(visit => visit.late > 0).length, 0),
    overtime: routes.reduce((total, route) => total + route.overtime, 0),
    finish: Math.max(fleet.start, ...routes.map(route => route.finish)),
  };
}

export function clockTime(minutes: number) {
  const day = Math.floor(minutes / 1440);
  const hour = Math.floor(minutes / 60) % 24;
  const minute = minutes % 60;
  return String(hour).padStart(2, '0') + ':' + String(minute).padStart(2, '0') + (day ? ' +' + day + 'd' : '');
}

function interpolate(from: Point, to: Point, elapsed: number, duration: number): Point {
  const fraction = duration ? Math.max(0, Math.min(elapsed / duration, 1)) : 1;
  return { x: from.x + (to.x - from.x) * fraction, y: from.y + (to.y - from.y) * fraction };
}

export function routePosition(route: Route, fleet: Fleet, time: number): { point: Point; detail: string } {
  let point = depot;
  let departure = fleet.start;
  for (const visit of route.visits) {
    if (time < visit.arrival) {
      return { point: interpolate(point, visit.stop, time - departure, visit.arrival - departure), detail: 'Driving to ' + visit.stop.name };
    }
    if (time < visit.departure) {
      return { point: visit.stop, detail: (time < visit.serviceStart ? 'Waiting at ' : 'Servicing ') + visit.stop.name };
    }
    point = visit.stop;
    departure = visit.departure;
  }
  if (!route.visits.length) return { point: depot, detail: 'At depot' };
  if (!fleet.returnToDepot) return { point, detail: 'Run complete' };
  if (time < route.finish) {
    return { point: interpolate(point, depot, time - departure, route.finish - departure), detail: 'Returning to depot' };
  }
  return { point: depot, detail: 'Back at depot' };
}
