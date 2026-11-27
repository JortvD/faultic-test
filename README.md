# Fieldline Logistics

Fieldline is a shipping operations workspace with a React and TypeScript frontend, a Rust (Axum) API, and SQLite storage.

## Run the app

```sh
docker compose up -d --build --wait
curl -fsS http://127.0.0.1:18084/readyz
```

Open http://127.0.0.1:18084. Create an account with or without sample shipments, or select **Explore demo workspace**. A demo session expires after 24 hours. Account owners can update their profile and change their password, which revokes existing sessions. Each account or demo session has its own shipment records. The `fieldline` Compose volume stores accounts, sessions, and shipments across restarts.

### Develop locally

With Rust 1.100 and Node.js 24 installed, run `npm --prefix web ci` and `cargo run --locked`. Run `npm --prefix web run dev` in another terminal and open the Vite URL. To serve a production frontend directly from Rust, run `npm --prefix web run build` before starting the backend and open http://127.0.0.1:18084.

| Variable | Default | Purpose |
| --- | --- | --- |
| `FIELDLINE_PORT` | `18084` | Compose loopback port |
| `FIELDLINE_LISTEN` | `127.0.0.1:18084` | Native API bind address |
| `FIELDLINE_DB` | `data/fieldline.sqlite` | Native SQLite file |
| `FIELDLINE_DIST` | `web/dist` | Native frontend build directory |
| `FIELDLINE_ORIGIN` | Incoming host | Set to the external origin, without a trailing slash, when using a TLS reverse proxy |
| `FIELDLINE_SECURE_COOKIES` | Enabled for HTTPS origins | Set to `1` to require HTTPS session cookies |

## Shipping workflows

- Compare estimates for domestic and international parcels. Rates use the greater of actual and dimensional weight, rounded up to the next half kilogram. All fees are estimates in USD, and transit times use calendar days.
- Create and edit draft or ready shipments. Record ready, pick-up, in-transit, exception, delivery, or cancellation milestones. The server enforces the allowed transitions and rejects changes based on a stale shipment version.
- Filter shipments by reference, recipient, route, carrier, status, and overdue status. Export matching rows as CSV and print internal shipping labels.
- Review activity, exceptions, on-time delivery, and estimated freight costs by carrier.
- After a shipment leaves draft, share its tracking link with customers. Public tracking exposes its status, ETA, and milestone timestamps. Recipient details, addresses, and internal notes require the owning account.

Carrier services and quotes use a built-in sample catalog. Operators enter milestones directly. The app accepts no payments and does not purchase postage or message carriers.

## Verification

```sh
cargo fmt --check
cargo clippy --locked --all-targets -- -D warnings
npm --prefix web run build
python3 tests/smoke.py http://127.0.0.1:18084
```

The smoke script creates and modifies two test accounts. Use a development instance.

## Historical Faultic fixture

The original static storefront is available at `9854074`. To replay the original regressions, compare that revision against pinned baseline `2708008588822df5a74957c97f97834e70eb6927`, using the static fixture and local path `/`.

| Check | Selector | Baseline text |
| --- | --- | --- |
| Checkout call to action | `#checkout` | Checkout |
| Shipping charge display | `#shipping-status` | Free shipping |
