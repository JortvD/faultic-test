use axum::{
    Json,
    extract::{Path, State},
    http::StatusCode,
};
use chrono::{Duration, NaiveDate, Utc};
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};

use crate::{
    App,
    auth::SignedIn,
    store::{Error, Result, random, required},
};

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
enum Status {
    Draft,
    Ready,
    InTransit,
    Exception,
    Delivered,
    Cancelled,
}

impl Status {
    fn allows(self, next: Self) -> bool {
        use Status::*;
        matches!(
            (self, next),
            (Draft, Ready | Cancelled)
                | (Ready, InTransit | Cancelled)
                | (InTransit, InTransit | Exception | Delivered)
                | (Exception, InTransit | Exception | Delivered)
        )
    }
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Route {
    origin: String,
    destination: String,
    #[serde(default)]
    international: bool,
    weight_kg: f64,
    length_cm: f64,
    width_cm: f64,
    height_cm: f64,
}

impl Route {
    fn validate(&mut self) -> Result<()> {
        self.origin = required(
            &self.origin,
            100,
            "Enter an origin of up to 100 characters.",
        )?;
        self.destination = required(
            &self.destination,
            100,
            "Enter a destination of up to 100 characters.",
        )?;
        if self.origin.eq_ignore_ascii_case(&self.destination) {
            return Err(Error::invalid("Origin and destination must differ."));
        }
        if !(0.1..=1000.0).contains(&self.weight_kg)
            || [self.length_cm, self.width_cm, self.height_cm]
                .iter()
                .any(|value| !(1.0..=300.0).contains(value))
        {
            return Err(Error::invalid(
                "Use 0.1–1,000 kg and dimensions between 1 and 300 cm.",
            ));
        }
        Ok(())
    }
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Details {
    reference: String,
    recipient: String,
    delivery_address: String,
    carrier: String,
    ship_date: NaiveDate,
    #[serde(flatten)]
    route: Route,
}

impl Details {
    fn validate(&mut self, prior_ship_date: Option<NaiveDate>) -> Result<Quote> {
        self.reference = required(
            &self.reference,
            64,
            "Enter a reference of up to 64 characters.",
        )?;
        self.recipient = required(
            &self.recipient,
            100,
            "Enter a recipient of up to 100 characters.",
        )?;
        self.delivery_address = required(
            &self.delivery_address,
            240,
            "Enter a delivery address of up to 240 characters.",
        )?;
        self.route.validate()?;
        let today = Utc::now().date_naive();
        if Some(self.ship_date) != prior_ship_date
            && (self.ship_date < today || self.ship_date > today + Duration::days(365))
        {
            return Err(Error::invalid(
                "Choose a ship date between today and one year from now.",
            ));
        }
        let carrier = CARRIERS
            .iter()
            .find(|carrier| carrier.id == self.carrier)
            .ok_or_else(|| Error::invalid("Select a listed carrier service."))?;
        carrier
            .quote(&self.route)
            .ok_or_else(|| Error::invalid("The selected service cannot carry this parcel."))
    }
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Event {
    status: Status,
    at: String,
    location: String,
    note: String,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Shipment {
    tracking: String,
    status: Status,
    version: u32,
    created_at: String,
    eta: NaiveDate,
    cost_cents: u64,
    chargeable_kg: f64,
    #[serde(flatten)]
    details: Details,
    events: Vec<Event>,
}

#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Carrier {
    id: &'static str,
    name: &'static str,
    service: &'static str,
    mode: &'static str,
    days: i64,
    max_kg: f64,
    international: bool,
    #[serde(skip)]
    base_cents: u64,
    #[serde(skip)]
    unit_cents: u64,
}

const CARRIERS: [Carrier; 4] = [
    Carrier {
        id: "atlas",
        name: "Atlas Freight",
        service: "Ground Standard",
        mode: "Road",
        days: 4,
        max_kg: 150.0,
        international: false,
        base_cents: 850,
        unit_cents: 145,
    },
    Carrier {
        id: "swift",
        name: "Swift Air",
        service: "Air Express",
        mode: "Air",
        days: 2,
        max_kg: 70.0,
        international: true,
        base_cents: 2400,
        unit_cents: 480,
    },
    Carrier {
        id: "meridian",
        name: "Meridian Cargo",
        service: "Consolidated Freight",
        mode: "Road",
        days: 6,
        max_kg: 1000.0,
        international: true,
        base_cents: 6900,
        unit_cents: 95,
    },
    Carrier {
        id: "relay",
        name: "Relay Parcel",
        service: "Priority Parcel",
        mode: "Road",
        days: 3,
        max_kg: 30.0,
        international: false,
        base_cents: 1250,
        unit_cents: 225,
    },
];

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Quote {
    carrier: Carrier,
    days: i64,
    cost_cents: u64,
    chargeable_kg: f64,
}

impl Carrier {
    fn quote(self, route: &Route) -> Option<Quote> {
        let dimensional_weight = route.length_cm * route.width_cm * route.height_cm / 5000.0;
        let chargeable_kg = (route.weight_kg.max(dimensional_weight) * 2.0).ceil() / 2.0;
        if chargeable_kg > self.max_kg || (route.international && !self.international) {
            return None;
        }
        let surcharge = if route.international { 1650 } else { 0 };
        Some(Quote {
            carrier: self,
            days: self.days + if route.international { 2 } else { 0 },
            cost_cents: self.base_cents
                + (self.unit_cents as f64 * chargeable_kg).ceil() as u64
                + surcharge,
            chargeable_kg,
        })
    }
}

fn now() -> String {
    Utc::now().to_rfc3339()
}

fn insert(
    db: &Connection,
    owner: i64,
    details: Details,
    quote: Quote,
    status: Status,
    created_at: String,
) -> Result<Shipment> {
    let mut random_bytes = [0; 10];
    random(&mut random_bytes)?;
    let eta = details.ship_date + Duration::days(quote.days);
    let shipment = Shipment {
        tracking: format!("FL-{}", hex::encode_upper(random_bytes)),
        status,
        version: 1,
        eta,
        cost_cents: quote.cost_cents,
        chargeable_kg: quote.chargeable_kg,
        events: vec![Event {
            status,
            at: created_at.clone(),
            location: details.route.origin.clone(),
            note: "Shipment created.".to_owned(),
        }],
        details,
        created_at,
    };
    db.execute(
        "INSERT INTO shipments VALUES (?1, ?2, ?3)",
        params![shipment.tracking, owner, serde_json::to_string(&shipment)?],
    )?;
    Ok(shipment)
}

fn lookup(db: &Connection, owner: i64, tracking: &str) -> Result<Shipment> {
    let data: String = db
        .query_row(
            "SELECT data FROM shipments WHERE tracking = ?1 AND account_id = ?2",
            params![tracking, owner],
            |row| row.get(0),
        )
        .optional()?
        .ok_or_else(Error::missing)?;
    Ok(serde_json::from_str(&data)?)
}

fn save(db: &Connection, owner: i64, shipment: &Shipment) -> Result<()> {
    db.execute(
        "UPDATE shipments SET data = ?1 WHERE tracking = ?2 AND account_id = ?3",
        params![serde_json::to_string(shipment)?, shipment.tracking, owner],
    )?;
    Ok(())
}

pub async fn list(
    State(app): State<App>,
    SignedIn(account): SignedIn,
) -> Result<Json<Vec<Shipment>>> {
    let db = app.store.lock()?;
    let mut statement =
        db.prepare("SELECT data FROM shipments WHERE account_id = ?1 ORDER BY rowid DESC")?;
    let rows = statement.query_map([account.id], |row| row.get::<_, String>(0))?;
    let mut shipments = Vec::new();
    for row in rows {
        shipments.push(serde_json::from_str(&row?)?);
    }
    Ok(Json(shipments))
}

pub async fn detail(
    State(app): State<App>,
    SignedIn(account): SignedIn,
    Path(tracking): Path<String>,
) -> Result<Json<Shipment>> {
    let db = app.store.lock()?;
    Ok(Json(lookup(&db, account.id, &tracking)?))
}

pub async fn create(
    State(app): State<App>,
    SignedIn(account): SignedIn,
    Json(mut input): Json<Details>,
) -> Result<(StatusCode, Json<Shipment>)> {
    let quote = input.validate(None)?;
    let mut db = app.store.lock()?;
    let tx = db.transaction()?;
    let total: u32 = tx.query_row(
        "SELECT count(*) FROM shipments WHERE account_id = ?1",
        [account.id],
        |row| row.get(0),
    )?;
    if total >= 2000 {
        return Err(Error::conflict(
            "This workspace has reached its 2,000 shipment limit.",
        ));
    }
    let shipment = insert(&tx, account.id, input, quote, Status::Draft, now())?;
    tx.commit()?;
    Ok((StatusCode::CREATED, Json(shipment)))
}

#[derive(Deserialize)]
pub struct Edit {
    version: u32,
    #[serde(flatten)]
    details: Details,
}

pub async fn edit(
    State(app): State<App>,
    SignedIn(account): SignedIn,
    Path(tracking): Path<String>,
    Json(mut input): Json<Edit>,
) -> Result<Json<Shipment>> {
    let db = app.store.lock()?;
    let mut shipment = lookup(&db, account.id, &tracking)?;
    if shipment.version != input.version {
        return Err(Error::conflict(
            "This shipment changed. Reload it before editing.",
        ));
    }
    if !matches!(shipment.status, Status::Draft | Status::Ready) {
        return Err(Error::conflict(
            "Only draft and ready shipments can be edited.",
        ));
    }
    let quote = input.details.validate(Some(shipment.details.ship_date))?;
    shipment.eta = input.details.ship_date + Duration::days(quote.days);
    shipment.cost_cents = quote.cost_cents;
    shipment.chargeable_kg = quote.chargeable_kg;
    shipment.details = input.details;
    shipment.version += 1;
    save(&db, account.id, &shipment)?;
    Ok(Json(shipment))
}

#[derive(Deserialize)]
pub struct StatusUpdate {
    version: u32,
    status: Status,
    location: String,
    note: String,
}

pub async fn update_status(
    State(app): State<App>,
    SignedIn(account): SignedIn,
    Path(tracking): Path<String>,
    Json(input): Json<StatusUpdate>,
) -> Result<Json<Shipment>> {
    let location = required(
        &input.location,
        100,
        "Enter an event location of up to 100 characters.",
    )?;
    let note = required(
        &input.note,
        400,
        "Enter an event note of up to 400 characters.",
    )?;
    let db = app.store.lock()?;
    let mut shipment = lookup(&db, account.id, &tracking)?;
    if shipment.version != input.version {
        return Err(Error::conflict(
            "This shipment changed. Reload it before adding an event.",
        ));
    }
    if !shipment.status.allows(input.status) {
        return Err(Error::conflict(
            "That status change is unavailable for this shipment.",
        ));
    }
    if shipment.events.len() >= 100 {
        return Err(Error::conflict(
            "This shipment has reached its 100 event limit.",
        ));
    }
    shipment.status = input.status;
    shipment.version += 1;
    shipment.events.push(Event {
        status: input.status,
        at: now(),
        location,
        note,
    });
    save(&db, account.id, &shipment)?;
    Ok(Json(shipment))
}

pub async fn carriers(SignedIn(_): SignedIn) -> Json<[Carrier; 4]> {
    Json(CARRIERS)
}

pub async fn quotes(
    SignedIn(_): SignedIn,
    Json(mut route): Json<Route>,
) -> Result<Json<Vec<Quote>>> {
    route.validate()?;
    let mut quotes: Vec<_> = CARRIERS
        .iter()
        .filter_map(|carrier| carrier.quote(&route))
        .collect();
    quotes.sort_by_key(|quote| quote.cost_cents);
    Ok(Json(quotes))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Tracking {
    tracking: String,
    status: Status,
    eta: NaiveDate,
    milestones: Vec<Milestone>,
}

#[derive(Serialize)]
struct Milestone {
    status: Status,
    at: String,
}

pub async fn public_tracking(
    State(app): State<App>,
    Path(tracking): Path<String>,
) -> Result<Json<Tracking>> {
    let tracking = tracking.trim().to_ascii_uppercase();
    let data: String = app
        .store
        .lock()?
        .query_row(
            "SELECT s.data FROM shipments s JOIN accounts a ON a.id = s.account_id
         WHERE s.tracking = ?1 AND (a.demo = 0 OR a.created_at + 86400 > unixepoch())",
            [&tracking],
            |row| row.get(0),
        )
        .optional()?
        .ok_or_else(Error::missing)?;
    let shipment: Shipment = serde_json::from_str(&data)?;
    if shipment.status == Status::Draft {
        return Err(Error::missing());
    }
    let milestones = shipment
        .events
        .into_iter()
        .filter(|event| event.status != Status::Draft)
        .map(|event| Milestone {
            status: event.status,
            at: event.at,
        })
        .collect();
    Ok(Json(Tracking {
        tracking,
        status: shipment.status,
        eta: shipment.eta,
        milestones,
    }))
}

pub fn seed(db: &Connection, owner: i64) -> Result<()> {
    let today = Utc::now();
    let lanes = [
        (
            "Los Angeles, CA",
            "Austin, TX",
            "Evergreen Supply",
            "4201 South Congress Ave",
        ),
        (
            "Chicago, IL",
            "Brooklyn, NY",
            "Northstar Goods",
            "28 Jay Street",
        ),
        (
            "Seattle, WA",
            "Denver, CO",
            "Peak Outdoor Co.",
            "1500 Wynkoop Street",
        ),
        (
            "Dallas, TX",
            "Miami, FL",
            "Mariner Studio",
            "2850 NW 5th Avenue",
        ),
        (
            "Boston, MA",
            "Toronto, ON",
            "Common Ground",
            "215 Spadina Avenue",
        ),
        (
            "Atlanta, GA",
            "Portland, OR",
            "Juniper Market",
            "1120 SE Madison Street",
        ),
    ];
    let recent = [
        Status::InTransit,
        Status::Delivered,
        Status::Exception,
        Status::Ready,
        Status::InTransit,
        Status::Draft,
    ];
    for index in (0..36).rev() {
        let (origin, destination, recipient, address) = lanes[index % lanes.len()];
        let age = (index / 3 + usize::from(index > 22)) as i64;
        let created = today - Duration::days(age) - Duration::minutes(index as i64 * 71);
        let international = index % lanes.len() == 4;
        let delivery_status = recent.get(index).copied().unwrap_or(match index % 13 {
            0 | 4 => Status::InTransit,
            2 => Status::Exception,
            6 => Status::Ready,
            _ => Status::Delivered,
        });
        let status = if age < 3 && index >= recent.len() && delivery_status == Status::Delivered {
            Status::InTransit
        } else {
            delivery_status
        };
        let carrier = if international {
            CARRIERS[1]
        } else {
            CARRIERS[index % CARRIERS.len()]
        };
        let details = Details {
            reference: format!("SO-{}", 4839 - index),
            recipient: recipient.into(),
            delivery_address: address.into(),
            carrier: carrier.id.into(),
            ship_date: created.date_naive(),
            route: Route {
                origin: origin.into(),
                destination: destination.into(),
                international,
                weight_kg: 4.0 + index as f64 % 16.0,
                length_cm: 40.0,
                width_cm: 28.0,
                height_cm: 22.0,
            },
        };
        let quote = carrier
            .quote(&details.route)
            .ok_or_else(|| Error::internal("demo shipment exceeds carrier limits"))?;
        let mut shipment = insert(
            db,
            owner,
            details,
            quote,
            Status::Draft,
            created.to_rfc3339(),
        )?;
        let progression: &[Status] = match status {
            Status::Draft => &[],
            Status::Ready => &[Status::Ready],
            Status::InTransit => &[Status::Ready, Status::InTransit],
            Status::Exception => &[Status::Ready, Status::InTransit, Status::Exception],
            Status::Delivered => &[Status::Ready, Status::InTransit, Status::Delivered],
            Status::Cancelled => &[Status::Cancelled],
        };
        for (step, &milestone) in progression.iter().enumerate() {
            let (location, note) = match milestone {
                Status::Ready => (origin, "Packed and ready for handoff."),
                Status::InTransit => (origin, "Picked up by the carrier."),
                Status::Exception => (
                    destination,
                    "Delivery attempt delayed. Confirm access instructions.",
                ),
                Status::Delivered => (destination, "Delivered to the recipient."),
                _ => (origin, "Shipment cancelled."),
            };
            let at = if index == 1 && milestone == Status::Delivered {
                today - Duration::minutes(6)
            } else {
                created
                    + Duration::minutes((step + 1) as i64 * 31)
                    + if milestone == Status::Delivered {
                        Duration::days(age.min(if index % 5 == 0 {
                            carrier.days + 1
                        } else {
                            carrier.days - 1
                        }))
                    } else {
                        Duration::zero()
                    }
            };
            shipment.events.push(Event {
                status: milestone,
                at: at.min(today).to_rfc3339(),
                location: location.into(),
                note: note.into(),
            });
        }
        shipment.status = status;
        shipment.version += progression.len() as u32;
        save(db, owner, &shipment)?;
    }
    Ok(())
}
