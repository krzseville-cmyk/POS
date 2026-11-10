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
- **Print** on a receipt uses Android printing (any installed print service, or Save as PDF), or a **Bluetooth thermal printer** (58 mm or 80 mm, ESC/POS). Pair the printer in the phone's Bluetooth settings, then pick it in Settings → Receipt printer; receipts can print automatically after each sale. Receipts, readings, payment slips and statements all print. ₱ prints as "P" because these printers only have plain letters.
- **Scan** next to the search box (and the SKU field) opens the camera barcode scanner. It uses Google's scanner in Google Play services, so the app needs no camera permission (phones without Google Play, such as newer Huawei models, can't use it).
- **Back** closes an open popup, then returns to the register, then leaves the app.
- **Google auto-backup:** data is backed up to the phone's Google account (when backup is on in the phone's settings, usually once a day on Wi-Fi while charging) and restored when the app is reinstalled or moved to a new phone. It is not live sync between phones. Export a JSON backup now and then as an extra copy.

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
- **Sizes, add-ons and photos** – give a product sizes (e.g. Small/Medium/Large, each with its own price) and add-ons (e.g. extra shot). Tapping it opens a picker; sizes share the product's stock. Product photos are shrunk to small thumbnails to save space.
- **Cost, profit and deliveries** – set a cost price per product to see margin, cost of goods, gross profit and margin % in Reports (profit is figured without VAT). Record deliveries (stock in) with quantity, unit cost, supplier and invoice/DR number; stock goes up and the cost becomes the average of what's on hand and the delivery. Suppliers are listed with their delivery totals.
- **Charts** – Reports shows net sales by day (by month for long ranges) and by hour of day, with hover/tap details and a table view.
- **Login, users and roles** – the first time the app opens it asks for the store name and an owner account (name + 4–8 digit PIN), and shows a one-time recovery code; after that everyone picks their name and enters their PIN to open the app. "Forgot PIN?" uses the recovery code to set a new owner PIN (a new code is then shown), and owners can make a new code in Settings. After 5 wrong tries the login waits 30 seconds. The last owner can't be deleted, so login is always on. Tap **Log out** (next to your name at the top) to return to the login screen; a sale in progress stays in the cart. Add cashiers and more owners in Settings → Users & PINs. Cashiers can sell, hold sales, handle customers and utang payments, run shifts and X-readings; only the owner can edit products and prices, do refunds, run Z-readings, and open Reports and Settings. PINs are stored only as SHA-256 hashes. Receipts show the cashier.
- **Shifts and cash drawer** – open a shift with the starting cash, record cash in/out (payouts, added change), and close it by counting the drawer to see if it is over or short. An option can require an open shift before selling.
- **X- and Z-readings** – X-reading shows totals so far (for the open shift, or since the last Z) without closing anything. Z-reading (owner) closes the totals, numbers each Z, and keeps a running grand total. Both list receipt numbers, gross, discounts, SC/PWD, VAT breakdown, refunds, payments by method and, for shifts, the expected cash.
- **Held sales** – park an order with an optional note and recall it later; held sales are saved on the device.
- **Customers, utang and points** – attach a customer to a sale; pay with Utang (credit) or loyalty Points. Customers earn 1 point per ₱100 by default and 1 point is worth ₱1 (both set in Settings). Record utang payments (with a printable slip) and print a statement of account.
- **Settings** – store name, address, VAT Reg. TIN, receipt footer, VAT rate, whether prices include VAT, currency symbol (Philippine peso ₱ by default) and low-stock level; export all data as JSON, import a JSON backup, or reset.

The app starts with no products: add your own in Products (the register links there when the list is empty). Installs that still have the old sample products (Espresso, Latte, etc.) have them removed once, except any that were sold, held, restocked or renamed.

Data is saved in the browser's `localStorage`, so it stays on the device you use. Money is stored as integer cents to avoid rounding errors. Data saved by earlier versions loads without changes. Refunds are counted on the day they are made.
