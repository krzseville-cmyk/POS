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
- **Checkout** – cash (with quick-tender buttons and change calculation) or card; printable receipt.
- **Products** – add, edit and delete products; stock is decremented on each sale and the register blocks selling more than is in stock. Products at or below the low-stock level are highlighted, counted on the Products tab, and can be filtered.
- **Sales** – sales history with today's count, net revenue, average ticket and refunds; reopen any receipt.
- **Refunds & voids** – refund some or all items on a receipt (a full refund voids the sale). The amount is each item's share of the paid total, including discount and tax, and items can optionally go back into stock. Refunds appear on the receipt and in the sale's status.
- **Reports** – pick a date range (today, 7 days, 30 days, all time or custom) to see sales, gross, discounts, tax, refunds and net revenue, broken down by payment method, category, top products and day. Export sales or line items as CSV.
- **Settings** – store name, tax rate, currency symbol and low-stock level; export all data as JSON, import a JSON backup, or reset.

Data is saved in the browser's `localStorage`, so it stays on the device you use. Money is stored as integer cents to avoid rounding errors. Data saved by earlier versions loads without changes. Refunds are counted on the day they are made.
