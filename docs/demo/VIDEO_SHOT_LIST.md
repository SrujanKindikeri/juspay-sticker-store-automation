# Screen-Recording Video Shot List (5–7 Minutes, No Narration)

- **Format**: Screen recording only (1920x1080, 30/60 fps)
- **Audio**: Off (no voice narration, no background music)
- **Camera**: Off (no presenter webcam)
- **Target Duration**: ~5 minutes 45 seconds (within 5–7 minute window)
- **On-Screen Disclaimer**: Visible in Checkout, Payment Gateway, and Footer (`Educational payment simulation — no real money transferred.`)

---

| Step | Time Window | Screen / URL | Actions to Perform Slowly & Clearly | Key Visual Cue for Viewer |
| :---: | :---: | :--- | :--- | :--- |
| **1** | `0:00 – 0:30` | Homepage (`http://localhost:3001/`) | Load homepage, pause 3s on Stickora hero banner, scroll smoothly down through Featured Stickers, Best Sellers, New Arrivals, and Footer. | **Stickora — Premium Vinyl Stickers** branding & disclaimer in footer. |
| **2** | `0:30 – 1:05` | Product Catalogue (`http://localhost:3001/products`) | Click **All Stickers**, click 2 category pills (e.g., `Gaming`, `Quotes`), type `Cat` in search bar and submit, clear search to view all 12 items. | Live category filtering & keyword search results. |
| **3** | `1:05 – 1:35` | Product Details (`http://localhost:3001/products/STK-001`) | Open **Cyberpunk Neon Cat**, pause to show size (`3x3 inches`), material (`Holographic Die-Cut Vinyl`), stock badge, and price (`₹99.00`). | Product specifications & in-stock badge. |
| **4** | `1:35 – 2:05` | Add Stickers to Cart | Click **Add to Cart** on `STK-001`, visit `/products`, click **Add to Cart +** on `STK-002` (**Coffee First, Code Later** `₹89.00`). Hover/show cart count badge (`2`). | Cart badge updates to `2`. |
| **5** | `2:05 – 2:45` | Shopping Cart (`http://localhost:3001/cart`) | Open `/cart`. Click `+` on `STK-001` (`Qty: 2`), show immediate subtotal (`₹287.00`) + shipping (`₹50.00`) update and Free Delivery progress bar (`₹499` threshold). Click `−` back to `1` (`₹188.00 + ₹50.00 = ₹238.00`). | Two-column cart, live price calculation & shipping banner. |
| **6** | `2:45 – 3:30` | Delivery Checkout (`http://localhost:3001/checkout`) | Click **Proceed to Checkout**. Pause briefly showing product thumbnails in sticky Order Summary (`₹238.00`). Fill simulated delivery form:<br/>- Name: `Ananya Verma`<br/>- Mobile: `9876543210`<br/>- Email: `ananya.verma@example.com`<br/>- Address: `42 Indiranagar 100 Feet Road`<br/>- City: `Bengaluru`, State: `Karnataka`, PIN: `560038` | Apple-inspired 2-column checkout, validation, and **Educational payment simulation** notice. |
| **7** | `3:30 – 3:45` | Place Order Action | Click **Place Order (Pending Payment)**. Let the loading state show briefly and wait for automatic redirect to `/payment?order_id=STK-ORD-...`. | Order created in PostgreSQL (`PENDING_PAYMENT`) + redirect to JUSPAY Gateway. |
| **8** | `3:45 – 4:25` | JUSPAY Payment Selection (`/payment?order_id=...`) | Pause 3s showing **JUSPAY Payment Gateway**, **Simulated Sandbox** badge, **Stickora** merchant summary, Order ID (`STK-ORD-...`), and exact total (`₹238.00`). Toggle briefly across **UPI** and **Net Banking** tabs to show supported methods, return to **Card**, use simulated test card (`4111 2222 3333 4444`, `12/28`, `123`, `ANANYA VERMA`), click **Continue to Payment • ₹238.00**. | Sandbox notice (`Educational payment simulation — no real money transferred.`) & payment method options. |
| **9** | `4:25 – 4:50` | OTP Verification (`/payment` Step 2) | Pause 3s on JUSPAY 6-digit OTP verification card showing Transaction ID, Payment Reference, timer (`5:00`), and Simulation OTP helper. Click **Autofill OTP**, then click **Verify & Complete Payment**. | Cryptographic OTP verification step & processing animation. |
| **10** | `4:50 – 5:10` | Successful Payment Processing | Let processing spinner transition cleanly to the backend-verified **Payment Successful** screen (`● PAYMENT: SUCCESS`, `● ORDER: PAID`). | Verified backend settlement badges. |
| **11** | `5:10 – 5:45` | Order Confirmation Receipt | Scroll smoothly through the full receipt: Transaction ID, Order ID, Payment Reference, Amount Paid (`₹238.00 INR`), Method (`CARD`), Timestamp, Delivery Address, and Purchased Products. Click **Download Receipt** briefly to show file download. | Complete verified receipt & `.txt` receipt download. |
| **12** | `5:45 – 6:30` | GitHub Repo & Test Results | Switch to browser tab showing `https://github.com/SrujanKindikeri/juspay-sticker-store-automation` (`README.md`), then switch to VS Code / PowerShell terminal showing passing `pytest` (`77 passed`) and `npx playwright test` (`59 passed`) output. | Clean repository documentation & passing automated suites. |
