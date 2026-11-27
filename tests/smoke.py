"""Exercise Fieldline's API against a running development instance."""

import http.cookiejar
import json
import sys
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from urllib.error import HTTPError
from urllib.request import HTTPCookieProcessor, Request, build_opener

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:18084"


class Client:
    def __init__(self):
        self.browser = build_opener(HTTPCookieProcessor(http.cookiejar.CookieJar()))

    def request(self, path, *, method="GET", body=None, expect=200, origin=None):
        headers = {"Accept": "application/json"}
        if origin:
            headers["Origin"] = origin
        if body is not None:
            headers["Content-Type"] = "application/json"
        request = Request(
            BASE + path,
            data=None if body is None else json.dumps(body).encode(),
            headers=headers,
            method=method,
        )
        try:
            response = self.browser.open(request, timeout=10)
        except HTTPError as error:
            response = error
        with response:
            data = response.read()
            wanted = expect if isinstance(expect, tuple) else (expect,)
            assert response.status in wanted, (path, method, expect, response.status, data)
            return json.loads(data) if data and response.headers.get_content_type() == "application/json" else data


def main():
    public = Client()
    assert public.request("/readyz")["version"]
    assert b"Fieldline Logistics" in public.request("/shipments/new")
    public.request("/api/shipments", expect=401)
    public.request("/api/auth/demo", method="POST", origin="https://example.invalid", expect=403)

    owner, other, second_session = Client(), Client(), Client()
    credentials = {"email": f"smoke-{uuid.uuid4().hex}@example.com", "password": "a-world-of-boxes"}
    profile = {"name": "API smoke test", "company": "Fieldline verification", "sample": False}
    owner.request("/api/auth/register", method="POST", body={**profile, **credentials}, origin=BASE)
    assert owner.request("/api/me")["email"] == credentials["email"]
    other.request("/api/auth/register", method="POST", body={**profile, **credentials, "email": f"second-{uuid.uuid4().hex}@example.com"})
    second_session.request("/api/auth/login", method="POST", body=credentials)
    assert owner.request("/api/shipments") == []

    contact_input = {"name": "Private recipient", "city": "Toronto, ON", "address": "229 Private Way",
                     "email": "receiver@example.com", "phone": "416 555 0100"}
    contact = owner.request("/api/contacts", method="POST", body=contact_input, expect=201)
    assert owner.request("/api/contacts") == [contact]
    assert other.request("/api/contacts") == []
    contact_path = f"/api/contacts/{contact['id']}"
    other.request(contact_path, method="PUT", body=contact, expect=404)
    edited_contact = owner.request(contact_path, method="PUT", body={**contact, "phone": ""})
    owner.request(contact_path, method="DELETE", body={"version": contact["version"]}, expect=409)
    assert edited_contact["phone"] == ""

    lane = {"origin": "Chicago, IL", "destination": "Toronto, ON", "international": True,
            "weightKg": 2, "lengthCm": 50, "widthCm": 40, "heightCm": 30}
    quotes = owner.request("/api/quotes", method="POST", body=lane)
    assert len(quotes) == 2
    assert all(q["carrier"]["international"] and q["chargeableKg"] == 12 for q in quotes)
    assert quotes == sorted(quotes, key=lambda quote: quote["costCents"])
    details = {**lane, "reference": "SMOKE-1", "recipient": "Private recipient",
               "deliveryAddress": "229 Private Way", "carrier": quotes[0]["carrier"]["id"],
               "shipDate": datetime.now(timezone.utc).date().isoformat()}
    shipment = owner.request("/api/shipments", method="POST", body=details, expect=201)
    assert shipment["status"] == "draft" and shipment["costCents"] == quotes[0]["costCents"]
    path = "/api/shipments/" + shipment["tracking"]
    tracking = "/api/tracking/" + shipment["tracking"].lower()
    other.request(path, expect=404)
    assert other.request("/api/shipments") == []
    public.request(tracking, expect=404)
    invalid = {"status": "delivered", "note": "Never dispatched", "location": "Toronto", "version": shipment["version"]}
    owner.request(path + "/events", method="POST", body=invalid, expect=409)
    edited = owner.request(path, method="PUT", body={**details, "reference": "SMOKE-EDIT", "version": shipment["version"]})
    assert edited["reference"] == "SMOKE-EDIT"
    owner.request(path, method="PUT", body={**details, "version": shipment["version"]}, expect=409)
    shipment = edited
    for status in ["ready", "in_transit", "exception", "in_transit", "delivered"]:
        shipment = owner.request(path + "/events", method="POST", body={
            "status": status, "note": "Private warehouse note\nCall the carrier.", "location": "Private depot",
            "version": shipment["version"], "reason": "customs_hold" if status == "exception" else None,
        })
        if status == "exception":
            assert shipment["events"][-1]["reason"] == "customs_hold"
    assert owner.request(path)["status"] == "delivered"
    snapshot = public.request(tracking)
    assert snapshot["status"] == "delivered" and len(snapshot["milestones"]) == 5
    assert set(snapshot) == {"tracking", "status", "eta", "milestones"}
    assert all(set(event) == {"status", "at"} for event in snapshot["milestones"])
    owner.request(path + "/events", method="POST", body={**invalid, "version": shipment["version"]}, expect=409)
    owner.request(contact_path, method="DELETE", body={"version": edited_contact["version"]}, expect=204)
    assert owner.request("/api/contacts") == []
    assert owner.request(path)["deliveryAddress"] == contact_input["address"]

    def ready_shipment(client, reference, origin=lane["origin"]):
        record = client.request("/api/shipments", method="POST", body={**details, "reference": reference, "origin": origin}, expect=201)
        return client.request("/api/shipments/" + record["tracking"] + "/events", method="POST",
                              body={"status": "ready", "version": record["version"], "note": "Packed", "location": origin})

    def dispatch_item(record):
        return {key: record[key] for key in ["tracking", "version"]}

    first = ready_shipment(owner, "MANIFEST-1")
    second = ready_shipment(owner, "MANIFEST-2")
    mixed = ready_shipment(owner, "MANIFEST-MIXED", "Detroit, MI")
    foreign = ready_shipment(other, "MANIFEST-FOREIGN")
    batch = {"reference": "Pickup 501", "notes": "Dock 4", "shipments": [dispatch_item(first), dispatch_item(second)]}
    for bad, code in [(mixed, 422), (foreign, 404), (first, 422), ({**second, "version": 1}, 409)]:
        owner.request("/api/manifests", method="POST", body={**batch, "shipments": [dispatch_item(first), dispatch_item(bad)]}, expect=code)
        assert owner.request("/api/shipments/" + first["tracking"])["status"] == "ready"
        assert owner.request("/api/manifests") == []

    def dispatch(client):
        return client.request("/api/manifests", method="POST", body=batch, expect=(201, 409))

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(dispatch, (owner, second_session)))
    winners = [result for result in results if "manifest" in result]
    assert len(winners) == 1, results
    manifest = winners[0]["manifest"]
    assert manifest["reference"] == "Pickup 501" and len(manifest["shipments"]) == 2
    assert owner.request("/api/manifests") == [manifest]
    manifest_path = "/api/manifests/" + manifest["id"]
    assert owner.request(manifest_path) == manifest
    other.request(manifest_path, expect=404)
    public.request(manifest_path, expect=401)
    for record in [first, second]:
        dispatched = owner.request("/api/shipments/" + record["tracking"])
        assert dispatched["status"] == "in_transit" and dispatched["manifest"] == manifest["id"]
        assert dispatched["version"] == record["version"] + 1
    assert owner.request("/api/shipments/" + mixed["tracking"])["status"] == "ready"

    owner.request("/api/me", method="PATCH", body={"name": "Updated", "company": "Updated workspace"})

    next_password = "ship-with-a-new-secret"
    owner.request("/api/auth/password", method="POST", body={"currentPassword": credentials["password"], "newPassword": next_password}, expect=204)
    owner.request("/api/me", expect=401)
    second_session.request("/api/me", expect=401)
    owner.request("/api/auth/login", method="POST", body=credentials, expect=401)
    owner.request("/api/auth/login", method="POST", body={**credentials, "password": next_password})
    assert owner.request("/api/me")["name"] == "Updated"
    assert owner.request(path)["status"] == "delivered"
    assert owner.request(manifest_path) == manifest
    owner.request("/api/auth/logout", method="POST", expect=204)
    owner.request("/api/me", expect=401)

    demo = Client()
    assert demo.request("/api/auth/demo", method="POST")["demo"]
    assert len(demo.request("/api/shipments")) == 36
    assert len(demo.request("/api/contacts")) == 6
    assert len(demo.request("/api/manifests")) == 1
    print("Passed: auth, session revocation, account isolation, quotes, shipment lifecycle, address book, concurrent dispatch, tracking privacy, and demo.")


if __name__ == "__main__":
    main()
