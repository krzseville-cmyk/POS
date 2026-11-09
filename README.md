# Simple POS

A lightweight point-of-sale web app. Plain HTML, CSS and JavaScript — no build step, no server, no dependencies.

## Run it

Open `index.html` in a browser, or serve the folder:

```sh
python3 -m http.server 8000
# then visit http://localhost:8000
```

## Android app

The `android/` folder is an Android app (Kotlin, Android 8.0+) that runs this same POS full screen. The web files in the repository root are copied into the app on every build, so there is only one copy of the POS code to maintain.

Inside the app:
- **Export JSON / CSV** opens Android's save screen so you choose where the file goes.
- **Import JSON** opens Android's file picker.
- **Print** on a receipt uses Android printing (any installed print service, or Save as PDF).
- **Back** closes an open popup, then returns to the register, then leaves the app.
- Data is stored on the device and is kept between launches. Uninstalling the app deletes it, so export a backup first.

Build it (needs JDK 17+ and the Android SDK, e.g. from Android Studio):

```sh
cd android
./gradlew assembleDebug
# APK: android/app/build/outputs/apk/debug/app-debug.apk
```

Or open the `android` folder in Android Studio and press Run. To install the APK on a phone, copy it over and open it (allow "Install unknown apps" when asked).

## Features

- **Register** – product grid with category filters and search; press Enter with a SKU to add it (works with USB barcode scanners). Cart with quantity controls, % or fixed discount, and tax.
- **Checkout** – cash (quick-tender buttons for peso bills, change calculation), card, GCash, Maya or QR Ph (with optional reference number). Split one sale across several methods; card and e-wallet parts can't be more than the amount due, and change comes from cash.
- **VAT (Philippines)** – 12% VAT by default, with prices that already include VAT (can be switched to VAT added on top). Each product is VATable, VAT-exempt or zero-rated. Receipts show VATable sales, VAT, VAT-exempt and zero-rated sales, with V/E/Z after each item, plus the store address and VAT Reg. TIN if set.
- **Senior citizen / PWD discount** – removes VAT from VATable items, then takes 20% off (it replaces any other discount). The name and ID number are required and printed on the receipt with a signature line.
- **Products** – add, edit and delete products; stock is decremented on each sale and the register blocks selling more than is in stock. Products at or below the low-stock level are highlighted, counted on the Products tab, and can be filtered.
- **Sales** – sales history with today's count, net revenue, average ticket and refunds; reopen any receipt.
- **Refunds & voids** – refund some or all items on a receipt (a full refund voids the sale), choosing which of the sale's payment methods the money goes back through. The amount is each item's share of the paid total, including discount and tax, and items can optionally go back into stock. Refunds appear on the receipt and in the sale's status.
- **Reports** – pick a date range (today, 7 days, 30 days, all time or custom) to see sales, gross, discounts, SC/PWD discounts, VAT, refunds and net revenue, a VAT summary, and breakdowns by payment method, category, top products and day. Export sales or line items as CSV.
- **Users, PINs and roles** – add an owner in Settings to turn on PIN login. Cashiers can sell, hold sales, handle customers and utang payments, run shifts and X-readings; only the owner can edit products and prices, do refunds, run Z-readings, and open Reports and Settings. PINs are stored only as SHA-256 hashes. Receipts show the cashier.
- **Shifts and cash drawer** – open a shift with the starting cash, record cash in/out (payouts, added change), and close it by counting the drawer to see if it is over or short. An option can require an open shift before selling.
- **X- and Z-readings** – X-reading shows totals so far (for the open shift, or since the last Z) without closing anything. Z-reading (owner) closes the totals, numbers each Z, and keeps a running grand total. Both list receipt numbers, gross, discounts, SC/PWD, VAT breakdown, refunds, payments by method and, for shifts, the expected cash.
- **Held sales** – park an order with an optional note and recall it later; held sales are saved on the device.
- **Customers, utang and points** – attach a customer to a sale; pay with Utang (credit) or loyalty Points. Customers earn 1 point per ₱100 by default and 1 point is worth ₱1 (both set in Settings). Record utang payments (with a printable slip) and print a statement of account.
- **Settings** – store name, address, VAT Reg. TIN, receipt footer, VAT rate, whether prices include VAT, currency symbol (Philippine peso ₱ by default) and low-stock level; export all data as JSON, import a JSON backup, or reset.

Data is saved in the browser's `localStorage`, so it stays on the device you use. Money is stored as integer cents to avoid rounding errors. Data saved by earlier versions loads without changes. Refunds are counted on the day they are made.
