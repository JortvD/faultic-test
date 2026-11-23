# Faultic test storefront

A static storefront fixture with two intentional regressions. Preview it with  and open http://127.0.0.1:8000/.

## Compare revisions in Faultic

Add  to Faultic, create a Task for selected targets, and choose the  fixture. Track the  branch using a **Pinned** baseline of .

Add these browser checks with local path .

| Check | Selector | Expected text |
| --- | --- | --- |
| Checkout call to action |  | Checkout |
| Shipping charge display |  | Free shipping |

Both checks should pass on the baseline and fail on the current fixture. The current total stays at .00 even though the cart displays a shipping charge.
