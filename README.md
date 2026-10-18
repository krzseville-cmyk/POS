# Simple POS

A lightweight point-of-sale web app. Plain HTML, CSS and JavaScript — no build step, no server, no dependencies.

## Run it

Open `index.html` in a browser, or serve the folder:

```sh
python3 -m http.server 8000
# then visit http://localhost:8000
```

## Features

- **Register** – product grid with category filters and search; press Enter with a SKU to add it (works with USB barcode scanners). Cart with quantity controls, % or fixed discount, and tax.
- **Checkout** – cash (with quick-tender buttons and change calculation) or card; printable receipt.
- **Products** – add, edit and delete products; stock is decremented on each sale and the register blocks selling more than is in stock.
- **Sales** – sales history with today's count, revenue and average ticket; reopen any receipt.
- **Settings** – store name, tax rate and currency symbol; export all data as JSON or reset.

Data is saved in the browser's `localStorage`, so it stays on the device you use. Money is stored as integer cents to avoid rounding errors.
