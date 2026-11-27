# Fieldline Logistics

Fieldline is a shipping operations workspace with a React and TypeScript frontend, a Rust (Axum) API, and SQLite storage.

## Run the app

```sh
docker compose up -d --build --wait
curl -fsS http://127.0.0.1:18084/readyz
```

Open http://127.0.0.1:18084. For a new account, copy the signup verification code from the local Mailpit inbox at http://127.0.0.1:18096. You can start with sample shipments, contacts, and a dispatch record, or select **Explore demo workspace** for temporary access. Existing accounts can still sign in with their current credentials. A demo session expires after 24 hours. Account owners can update their profile and change their password, which revokes existing sessions. Each account or demo session has its own shipment records. The `fieldline` Compose volume stores accounts, sessions, and shipments across restarts.

### Develop locally

With Rust 1.100 and Node.js 24 installed, run `npm --prefix web ci` and `cargo run --locked`. For native signup, run `docker compose up -d mailpit` and start Rust with `FIELDLINE_CAPTURE_SMTP_URL=smtp://127.0.0.1:18125`. Run `npm --prefix web run dev` in another terminal and open the Vite URL. To serve a production frontend directly from Rust, run `npm --prefix web run build` before starting the backend and open http://127.0.0.1:18084.

| Variable | Default | Purpose |
| --- | --- | --- |
| `FIELDLINE_PORT` | `18084` | Compose loopback port |
| `FIELDLINE_LISTEN` | `127.0.0.1:18084` | Native API bind address |
| `FIELDLINE_DB` | `data/fieldline.sqlite` | Native SQLite file |
| `FIELDLINE_DIST` | `web/dist` | Native frontend build directory |
| `FIELDLINE_ORIGIN` | Incoming host | Set to the external origin, without a trailing slash, when using a TLS reverse proxy |
| `FIELDLINE_SECURE_COOKIES` | Enabled for HTTPS origins | Set to `1` to require HTTPS session cookies |
| `FIELDLINE_TRUSTED_PROXIES` | Empty | Comma-separated CIDRs for reverse proxies that append the actual address of their peer to `X-Forwarded-For` |
| `FIELDLINE_SMTP_URL` | Unset | SMTP relay URL for outbound signup mail, Use `smtps://` or `smtp://…?tls=required` and keep credentials outside the repository. |
| `FIELDLINE_SMTP_FROM` | Unset | Sender address for the configured SMTP relay |
| `FIELDLINE_CAPTURE_SMTP_URL` | `smtp://mailpit:1025` in Compose | Development inbox for loopback signup |
| `FIELDLINE_MAIL_PORT` | `18096` | Compose Mailpit inbox loopback port |
| `FIELDLINE_MAIL_SMTP_PORT` | `18125` | Compose Mailpit SMTP loopback port for native development |

For an external deployment, set the public origin and configure an outbound SMTP relay. Restrict direct backend access to your proxy and trust only its actual addresses. Fieldline uses the nearest address outside the trusted proxy networks as the client address. Authenticated API writes require `X-Fieldline-Workspace` with the workspace ID from `GET /api/me`.

## Shipping workflows

- Compare estimates for domestic and international parcels. Rates use the greater of actual and dimensional weight, rounded up to the next half kilogram. All fees are estimates in USD, and transit times use calendar days.
- Create and edit draft or ready shipments. Record ready, pick-up, in-transit, exception, delivery, or cancellation milestones. The server enforces the allowed transitions and rejects changes based on a stale shipment version.
- Save and search recipient details in the address book, autofill a shipment, or duplicate an existing shipment as a new draft.
- Dispatch up to 100 ready shipments from the same origin via the same carrier. A dispatch records the pickup and updates the whole batch atomically. Open its saved manifest to review or print the handoff.
- Triage the exception inbox by reason, overdue status, or shipment details. Record a new milestone to resume transit or confirm delivery.
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
npm --prefix web exec -- playwright install chromium
npm --prefix web run test:browser -- http://127.0.0.1:18084
```

The smoke and browser scripts use the local Mailpit API for signup. Set `FIELDLINE_TEST_MAIL_URL` if its development inbox uses a different port. Run them against a development instance with disposable data.

## Historical Faultic fixture

The original static storefront is available at `9854074`. To replay the original regressions, compare that revision against pinned baseline `2708008588822df5a74957c97f97834e70eb6927`, using the static fixture and local path `/`.

| Check | Selector | Baseline text |
| --- | --- | --- |
| Checkout call to action | `#checkout` | Checkout |
| Shipping charge display | `#shipping-status` | Free shipping |
