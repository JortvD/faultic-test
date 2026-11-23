# Faultic test storefront

A static storefront fixture with two intentional regressions. Preview it with `python3 -m http.server 8000` and open http://127.0.0.1:8000/.

## Compare revisions in Faultic

Add `JortvD/faultic-test` to Faultic, create a Task for selected targets, and choose the `static` fixture. Track the `main` branch using a **Pinned** baseline of `2708008588822df5a74957c97f97834e70eb6927`.

Add these browser checks with local path `/`.

| Check | Selector | Expected text |
| --- | --- | --- |
| Checkout call to action | `#checkout` | Checkout |
| Shipping charge display | `#shipping-status` | Free shipping |

Both checks should pass on the baseline and fail on the current fixture. The current total stays at $52.00 even though the cart displays a shipping charge.
