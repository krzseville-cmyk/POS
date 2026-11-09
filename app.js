'use strict';

// ---------- Constants ----------
const STORAGE_KEY = 'simple-pos-v1';

const PAYMENT_METHODS = [
  { id: 'cash', label: 'Cash' },
  { id: 'card', label: 'Card' },
  { id: 'gcash', label: 'GCash' },
  { id: 'maya', label: 'Maya' },
  { id: 'qrph', label: 'QR Ph' },
  // Only offered when a customer is on the sale.
  { id: 'credit', label: 'Utang', needsCustomer: true },
  { id: 'points', label: 'Points', needsCustomer: true },
];
// Ways a customer can pay off utang.
const COLLECTION_METHODS = ['cash', 'gcash', 'maya', 'qrph', 'card'];
const methodLabel = (id) => PAYMENT_METHODS.find((m) => m.id === id)?.label || (id === 'split' ? 'Split' : String(id ?? ''));

const VAT_TYPES = { vatable: 'VATable', exempt: 'VAT-exempt', zero: 'Zero-rated' };
const VAT_CODES = { vatable: 'V', exempt: 'E', zero: 'Z' };
// Senior citizen and PWD discount rate, fixed by law (RA 9994 and RA 10754).
const SC_RATE = 20;
const SC_LABELS = { sc: 'Senior citizen', pwd: 'PWD' };

const DEFAULT_SETTINGS = {
  storeName: 'My Store',
  storeAddress: '',
  tin: '',
  receiptFooter: 'Thank you!',
  taxRate: 12,
  pricesIncludeTax: true,
  currency: '₱',
  lowStock: 5,
  pointsPer: 10000, // centavos spent per loyalty point (₱100); 0 turns points off
  pointValue: 100, // centavos a point is worth when redeemed (₱1)
  requireShift: false,
};

const DEFAULT_STATE = {
  settings: { ...DEFAULT_SETTINGS },
  products: [
    { id: 'p1', name: 'Espresso', sku: '1001', category: 'Coffee', price: 12000, stock: 100, vat: 'vatable' },
    { id: 'p2', name: 'Cappuccino', sku: '1002', category: 'Coffee', price: 15000, stock: 100, vat: 'vatable' },
    { id: 'p3', name: 'Latte', sku: '1003', category: 'Coffee', price: 16000, stock: 100, vat: 'vatable' },
    { id: 'p4', name: 'Cold Brew', sku: '1004', category: 'Coffee', price: 15500, stock: 60, vat: 'vatable' },
    { id: 'p5', name: 'Green Tea', sku: '2001', category: 'Tea', price: 11000, stock: 80, vat: 'vatable' },
    { id: 'p6', name: 'Chai Latte', sku: '2002', category: 'Tea', price: 15000, stock: 80, vat: 'vatable' },
    { id: 'p7', name: 'Croissant', sku: '3001', category: 'Bakery', price: 9500, stock: 24, vat: 'vatable' },
    { id: 'p8', name: 'Blueberry Muffin', sku: '3002', category: 'Bakery', price: 11000, stock: 18, vat: 'vatable' },
    { id: 'p9', name: 'Bagel', sku: '3003', category: 'Bakery', price: 8500, stock: 4, vat: 'vatable' },
    { id: 'p10', name: 'Bottled Water', sku: '4001', category: 'Drinks', price: 3500, stock: 48, vat: 'vatable' },
    { id: 'p11', name: 'Orange Juice', sku: '4002', category: 'Drinks', price: 9000, stock: 30, vat: 'vatable' },
  ],
  sales: [],
  nextReceipt: 1001,
  users: [],
  shifts: [],
  zReadings: [],
  nextZ: 1,
  held: [],
  customers: [],
};

// ---------- Storage ----------
// Fills in missing fields so data saved by older versions (or imported files) keeps working.
function normalizeState(data) {
  if (!data || typeof data !== 'object' || !Array.isArray(data.products) || !Array.isArray(data.sales)) {
    throw new Error('Not a valid POS data file');
  }
  const saved = data.settings || {};
  const settings = { ...DEFAULT_SETTINGS, ...saved };
  // Older versions added tax on top of prices; keep that for their data until changed in Settings.
  if (data.settings && saved.pricesIncludeTax === undefined) settings.pricesIncludeTax = false;
  settings.pricesIncludeTax = Boolean(settings.pricesIncludeTax);
  settings.taxRate = Math.max(0, Number(settings.taxRate) || 0);
  settings.lowStock = Math.max(0, parseInt(settings.lowStock, 10) || 0);
  const products = data.products
    .filter((p) => p && p.id && p.name)
    .map((p) => ({
      ...p,
      id: String(p.id),
      name: String(p.name),
      sku: String(p.sku ?? ''),
      category: String(p.category || 'Uncategorized'),
      price: Math.max(0, Math.round(Number(p.price) || 0)),
      stock: Math.max(0, Math.round(Number(p.stock) || 0)),
      vat: VAT_TYPES[p.vat] ? p.vat : 'vatable',
    }));
  const sales = data.sales
    .filter((s) => s && s.id != null && Array.isArray(s.items))
    .map((s) => ({ ...s, refunds: Array.isArray(s.refunds) ? s.refunds : [] }));
  settings.pointsPer = Math.max(0, Math.round(Number(settings.pointsPer) || 0));
  settings.pointValue = Math.max(0, Math.round(Number(settings.pointValue) || 0));
  settings.requireShift = Boolean(settings.requireShift);
  const maxId = sales.reduce((m, s) => Math.max(m, Number(s.id) || 0), 0);
  const nextReceipt = Math.max(Number(data.nextReceipt) || 1001, maxId + 1);
  const list = (x) => (Array.isArray(x) ? x : []);
  const zReadings = list(data.zReadings);
  const customers = list(data.customers)
    .filter((c) => c && c.id && c.name)
    .map((c) => ({ ...c, phone: c.phone || '', points: Math.max(0, Number(c.points) || 0), ledger: list(c.ledger) }));
  return {
    ...data, settings, products, sales, nextReceipt,
    users: list(data.users).filter((u) => u && u.id && u.name && u.pinHash),
    shifts: list(data.shifts),
    zReadings,
    nextZ: Math.max(Number(data.nextZ) || 1, zReadings.reduce((m, z) => Math.max(m, z.no || 0), 0) + 1),
    held: list(data.held),
    customers,
  };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return normalizeState(JSON.parse(raw));
  } catch (e) {
    console.warn('Could not load saved data', e);
  }
  return normalizeState(structuredClone(DEFAULT_STATE));
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    toast('Could not save data on this device (storage may be full)');
  }
}

const state = loadState();
// Cart lines: { key, productId, variant, addons, qty }
let cart = [];
let activeCategory = 'All';

// ---------- Helpers ----------
const $ = (sel) => document.querySelector(sel);

// Money is stored as integer centavos to avoid floating point drift.
const toCents = (value) => Math.round(parseFloat(value || 0) * 100);
const money = (cents) => {
  const sign = cents < 0 ? '-' : '';
  const amount = (Math.abs(cents) / 100).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${sign}${state.settings.currency}${amount}`;
};
const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));
const uid = (prefix = 'p') => prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const findProduct = (id) => state.products.find((p) => p.id === id);
const isLowStock = (p) => p.stock <= state.settings.lowStock;
const sumBy = (arr, f) => arr.reduce((s, x) => s + f(x), 0);
// Local calendar date as YYYY-MM-DD (used for reports and date inputs).
const dateKey = (d) => {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};

function download(filename, text, type) {
  // Inside the Android app, browser downloads don't work; the app asks where to save instead.
  if (window.AndroidPOS) {
    window.AndroidPOS.saveFile(filename, text, type);
    return;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoking right away can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
}

// ---------- Totals (VAT, discounts, senior citizen / PWD) ----------
// Splits `amount` across `weights` in whole centavos, in proportion, never above a weight.
function allocate(amount, weights) {
  const total = weights.reduce((s, w) => s + w, 0);
  if (!total) return weights.map(() => 0);
  const exact = weights.map((w) => amount * w / total);
  const out = exact.map(Math.floor);
  let left = amount - out.reduce((s, x) => s + x, 0);
  exact
    .map((x, i) => [x - Math.floor(x), i])
    .sort((a, b) => b[0] - a[0])
    .forEach(([, i]) => {
      if (left > 0 && out[i] < weights[i]) { out[i]++; left--; }
    });
  return out;
}

/**
 * Works out a sale's totals the way a Philippine receipt shows them.
 * - Prices may include VAT (usual in the PH) or have VAT added on top.
 * - Items are VATable, VAT-exempt or zero-rated.
 * - Senior citizen / PWD: VAT is removed from VATable items, then 20% off.
 *   This replaces any other discount.
 * disc: { type: 'pct' | 'amt' | 'sc' | 'pwd', value } (value in % or centavos)
 */
function calcTotals(lines, disc, settings) {
  const rate = settings.taxRate / 100;
  const incl = settings.pricesIncludeTax;
  const subtotal = sumBy(lines, (l) => l.total);
  const gross = { vatable: 0, exempt: 0, zero: 0 };
  for (const l of lines) gross[VAT_TYPES[l.vat] ? l.vat : 'vatable'] += l.total;

  const t = {
    lines, subtotal, discountType: disc.type, discount: 0, vatExemption: 0,
    vatableSales: 0, vatExemptSales: 0, zeroRatedSales: 0, tax: 0, total: 0,
    taxRate: settings.taxRate, pricesIncludeTax: incl,
  };
  if (disc.type === 'sc' || disc.type === 'pwd') {
    const base = incl ? Math.round(gross.vatable / (1 + rate)) : gross.vatable;
    t.vatExemption = gross.vatable - base;
    t.vatExemptSales = base + gross.exempt;
    t.zeroRatedSales = gross.zero;
    t.discount = Math.round((t.vatExemptSales + t.zeroRatedSales) * SC_RATE / 100);
    t.total = t.vatExemptSales + t.zeroRatedSales - t.discount;
    return t;
  }
  const value = Math.max(0, Number(disc.value) || 0);
  const discount = Math.min(subtotal, disc.type === 'pct' ? Math.round(subtotal * Math.min(value, 100) / 100) : Math.round(value));
  const [dv, de, dz] = allocate(discount, [gross.vatable, gross.exempt, gross.zero]);
  const vatableAfter = gross.vatable - dv;
  t.discount = discount;
  t.vatExemptSales = gross.exempt - de;
  t.zeroRatedSales = gross.zero - dz;
  if (incl) {
    t.vatableSales = Math.round(vatableAfter / (1 + rate));
    t.tax = vatableAfter - t.vatableSales;
    t.total = vatableAfter + t.vatExemptSales + t.zeroRatedSales;
  } else {
    t.vatableSales = vatableAfter;
    t.tax = Math.round(vatableAfter * rate);
    t.total = vatableAfter + t.tax + t.vatExemptSales + t.zeroRatedSales;
  }
  return t;
}

// ---------- Refund helpers ----------
const refundedTotal = (sale) => sumBy(sale.refunds || [], (r) => r.amount);
// Refund items point at a sale line by index; older refunds used the product id.
function refundedLineQty(sale, index) {
  const line = sale.items[index];
  return sumBy(sale.refunds || [], (r) => sumBy(
    r.items.filter((i) => i.line === index || (i.line === undefined && i.productId === line.productId)),
    (i) => i.qty,
  ));
}
function saleStatus(sale) {
  const refunded = refundedTotal(sale);
  const allItemsBack = sale.items.every((l, i) => refundedLineQty(sale, i) >= l.qty);
  if (refunded > 0 && (allItemsBack || refunded >= sale.total)) return 'refunded';
  if (refunded > 0 || (sale.refunds || []).length) return 'partial';
  return 'paid';
}
// Payments made on a sale; older sales stored a single method.
const salePayments = (sale) => (Array.isArray(sale.payments) && sale.payments.length
  ? sale.payments
  : [{ method: sale.method, amount: sale.tendered ?? sale.total, ref: '' }]);
const salePaymentLabel = (sale) => {
  const methods = [...new Set(salePayments(sale).map((p) => p.method))];
  return methods.length > 1 ? `Split (${methods.map(methodLabel).join(' + ')})` : methodLabel(methods[0]);
};

// ---------- Navigation ----------
document.querySelectorAll('.tab').forEach((btn) => {
  btn.addEventListener('click', () => showView(btn.dataset.view));
});

function showView(name) {
  // Cashiers can't open owner-only screens.
  const tab = document.querySelector(`.tab[data-view="${name}"]`);
  if (tab?.hasAttribute('data-owner-only') && !isOwner()) name = 'register';
  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${name}`));
  if (name === 'register') renderRegister();
  if (name === 'products') renderProducts();
  if (name === 'sales') renderSales();
  if (name === 'customers') renderCustomers();
  if (name === 'shift') renderShift();
  if (name === 'reports') renderReports();
  if (name === 'settings') renderSettings();
}

function renderLowStockBadge() {
  const n = state.products.filter(isLowStock).length;
  const badge = $('#low-badge');
  badge.hidden = n === 0;
  badge.textContent = n;
  badge.title = `${n} product${n === 1 ? '' : 's'} low on stock`;
}

// ---------- Register ----------
function categories() {
  return [...new Set(state.products.map((p) => p.category))].sort();
}

function renderCategories() {
  const cats = ['All', ...categories()];
  if (!cats.includes(activeCategory)) activeCategory = 'All';
  $('#categories').innerHTML = cats
    .map((c) => `<button class="chip ${c === activeCategory ? 'active' : ''}" data-cat="${escapeHtml(c)}">${escapeHtml(c)}</button>`)
    .join('');
}

$('#categories').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-cat]');
  if (!btn) return;
  activeCategory = btn.dataset.cat;
  renderCategories();
  renderGrid();
});

// Total quantity of a product across all cart lines (sizes and add-ons share stock).
const inCartQty = (productId) => sumBy(cart.filter((l) => l.productId === productId), (l) => l.qty);

function visibleProducts() {
  const q = $('#search').value.trim().toLowerCase();
  return state.products.filter((p) =>
    (activeCategory === 'All' || p.category === activeCategory) &&
    (!q || p.name.toLowerCase().includes(q) || (p.sku || '').toLowerCase().includes(q)));
}

function renderGrid() {
  const items = visibleProducts();
  if (!items.length) {
    $('#product-grid').innerHTML = '<div class="empty">No products found</div>';
    return;
  }
  $('#product-grid').innerHTML = items.map((p) => {
    const available = p.stock - inCartQty(p.id);
    return `
      <button class="product" data-id="${escapeHtml(p.id)}" ${available <= 0 ? 'disabled' : ''}>
        <span class="name">${escapeHtml(p.name)}</span>
        <span class="stock ${available <= state.settings.lowStock ? 'low' : ''}">${available <= 0 ? 'Out of stock' : `${available} in stock`}</span>
        <span class="price">${money(p.price)}</span>
      </button>`;
  }).join('');
}

$('#product-grid').addEventListener('click', (e) => {
  const btn = e.target.closest('.product');
  if (btn) addToCart(btn.dataset.id);
});

$('#search').addEventListener('input', renderGrid);
// Pressing Enter with an exact SKU (e.g. from a barcode scanner) adds it directly.
// Otherwise the first product shown in the grid is added.
$('#search').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  const q = e.target.value.trim().toLowerCase();
  if (!q) return;
  const match = state.products.find((p) => (p.sku || '').toLowerCase() === q) || visibleProducts()[0];
  if (match) {
    addToCart(match.id);
    e.target.value = '';
    renderGrid();
  } else {
    toast(`No product matches "${e.target.value.trim()}"`);
  }
});

const lineKey = (productId, variant, addons) =>
  [productId, variant?.name || '', ...addons.map((a) => a.name).sort()].join('|');

function addToCart(productId, variant = null, addons = []) {
  const product = findProduct(productId);
  if (!product) return;
  if (inCartQty(productId) + 1 > product.stock) {
    toast(`Only ${product.stock} ${product.name} in stock`);
    return;
  }
  const key = lineKey(productId, variant, addons);
  const line = cart.find((l) => l.key === key);
  if (line) line.qty++;
  else cart.push({ key, productId, variant, addons, qty: 1 });
  renderCart();
  renderGrid();
}

function changeQty(key, delta) {
  const line = cart.find((l) => l.key === key);
  if (!line) return;
  const product = findProduct(line.productId);
  if (delta > 0 && inCartQty(line.productId) + delta > product.stock) {
    toast(`Only ${product.stock} ${product.name} in stock`);
    return;
  }
  line.qty += delta;
  if (line.qty <= 0) cart = cart.filter((l) => l !== line);
  renderCart();
  renderGrid();
}

// Keeps the cart valid after products are edited or deleted.
function syncCartWithStock() {
  const used = {};
  cart = cart
    .filter((l) => findProduct(l.productId))
    .map((l) => {
      const left = findProduct(l.productId).stock - (used[l.productId] || 0);
      const qty = Math.max(0, Math.min(l.qty, left));
      used[l.productId] = (used[l.productId] || 0) + qty;
      return { ...l, qty };
    })
    .filter((l) => l.qty > 0);
}

$('#cart-items').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const key = btn.dataset.key;
  if (btn.dataset.action === 'inc') changeQty(key, 1);
  if (btn.dataset.action === 'dec') changeQty(key, -1);
  if (btn.dataset.action === 'remove') changeQty(key, -Infinity);
});

function lineUnitPrice(product, line) {
  return (line.variant ? line.variant.price : product.price) + sumBy(line.addons || [], (a) => a.price);
}
function lineName(product, line) {
  let name = product.name;
  if (line.variant) name += ` (${line.variant.name})`;
  if (line.addons?.length) name += ` + ${line.addons.map((a) => a.name).join(', ')}`;
  return name;
}

function cartLines() {
  return cart.map((l) => {
    const p = findProduct(l.productId);
    const price = lineUnitPrice(p, l);
    return {
      key: l.key, productId: p.id, name: lineName(p, l), sku: p.sku, category: p.category, vat: p.vat,
      price, qty: l.qty, total: price * l.qty, variant: l.variant?.name || null, addons: (l.addons || []).map((a) => a.name),
    };
  });
}

function currentDiscount() {
  const type = $('#discount-type').value;
  const raw = Math.max(0, parseFloat($('#discount-value').value) || 0);
  return { type, value: type === 'amt' ? toCents(raw) : raw };
}

const computeTotals = () => calcTotals(cartLines(), currentDiscount(), state.settings);
const isScDiscount = (type) => type === 'sc' || type === 'pwd';

function renderCart() {
  const t = computeTotals();
  $('#cart-items').innerHTML = t.lines.length
    ? t.lines.map((l) => `
      <li class="cart-item">
        <div>
          <div>${escapeHtml(l.name)}</div>
          <div class="meta">${money(l.price)} each · <button class="link del" data-action="remove" data-key="${escapeHtml(l.key)}">remove</button></div>
        </div>
        <div class="qty">
          <button data-action="dec" data-key="${escapeHtml(l.key)}" aria-label="Decrease">−</button>
          <span>${l.qty}</span>
          <button data-action="inc" data-key="${escapeHtml(l.key)}" aria-label="Increase">+</button>
        </div>
        <strong>${money(l.total)}</strong>
      </li>`).join('')
    : '<li class="empty">Tap a product to add it</li>';

  const sc = isScDiscount(t.discountType);
  $('#discount-value').hidden = sc;
  $('#subtotal').textContent = money(t.subtotal);
  $('#discount').textContent = money(-t.discount);
  $('#vat-exempt-row').hidden = !t.vatExemption;
  $('#vat-exemption').textContent = money(-t.vatExemption);
  $('#tax-label').textContent = sc
    ? 'VAT (exempt)'
    : `VAT ${state.settings.taxRate}%${state.settings.pricesIncludeTax ? ' (included)' : ''}`;
  $('#tax').textContent = money(t.tax);
  $('#discount-amt-label').textContent = state.settings.currency;
  $('#total').textContent = money(t.total);
  $('#checkout').disabled = t.lines.length === 0;
}

$('#discount-value').addEventListener('input', renderCart);
$('#discount-type').addEventListener('change', renderCart);

$('#clear-cart').addEventListener('click', () => {
  if (cart.length && !confirm('Clear the current sale?')) return;
  resetSale();
});

function resetSale() {
  cart = [];
  cartCustomerId = null;
  renderCartCustomer();
  $('#discount-type').value = 'pct';
  $('#discount-value').value = 0;
  renderCart();
  renderGrid();
}

function renderRegister() {
  syncCartWithStock();
  renderCategories();
  renderGrid();
  renderCart();
}

// ---------- Checkout (cash, card, e-wallets, split payments) ----------
const checkoutDialog = $('#checkout-dialog');
let coTotal = 0;
let coPayments = []; // payments already added when splitting

const coMethod = () => $('#checkout-form').payment.value;
const coRemaining = () => Math.max(0, coTotal - sumBy(coPayments, (p) => p.amount));
const setCoAmount = (cents) => { $('#co-tendered').value = (cents / 100).toFixed(2); };

function renderPayMethods() {
  const cust = cartCustomer();
  $('#pay-methods').innerHTML = PAYMENT_METHODS
    .filter((m) => !m.needsCustomer || (cust && (m.id !== 'points' || (cust.points > 0 && state.settings.pointValue > 0))))
    .map((m) => `<label><input type="radio" name="payment" value="${m.id}" ${m.id === 'cash' ? 'checked' : ''}> ${m.label}</label>`)
    .join('');
}

$('#checkout').addEventListener('click', () => {
  const t = computeTotals();
  if (!t.lines.length) return;
  if (state.settings.requireShift && !openShift()) {
    toast('Open a shift first (Shift tab)');
    return;
  }
  coTotal = t.total;
  coPayments = [];
  $('#co-total').textContent = money(coTotal);
  const sc = isScDiscount(t.discountType);
  $('#co-sc-fields').hidden = !sc;
  if (sc) $('#co-sc-title').textContent = `${SC_LABELS[t.discountType]} details (required)`;
  $('#co-sc-name').value = '';
  $('#co-sc-id').value = '';
  $('#co-ref').value = '';
  renderPayMethods();
  setCoAmount(coTotal);
  renderCheckout();
  checkoutDialog.showModal();
});

// All payments for this sale, including the one being typed in.
function checkoutEntries() {
  const entries = [...coPayments];
  const amount = toCents($('#co-tendered').value);
  if (amount > 0) {
    const method = coMethod();
    entries.push({ method, amount, ref: method === 'cash' ? '' : $('#co-ref').value.trim() });
  }
  return entries;
}

function checkoutCheck() {
  const entries = checkoutEntries();
  const paid = sumBy(entries, (p) => p.amount);
  const nonCash = sumBy(entries.filter((p) => p.method !== 'cash'), (p) => p.amount);
  if (nonCash > coTotal) return { entries, paid, error: 'Only cash can be more than the amount due.' };
  const pointsPaid = sumBy(entries.filter((p) => p.method === 'points'), (p) => p.amount);
  const cust = cartCustomer();
  if (pointsPaid && (!cust || pointsNeeded(pointsPaid) > cust.points)) {
    return { entries, paid, error: `Not enough points (worth ${money((cust?.points || 0) * state.settings.pointValue)}).` };
  }
  return { entries, paid, short: Math.max(0, coTotal - paid), change: Math.max(0, paid - coTotal) };
}

function renderQuickCash() {
  const due = coRemaining();
  // Exact amount plus the next round peso bills above it (₱20 to ₱1,000).
  const options = new Set([due]);
  for (const bill of [2000, 5000, 10000, 20000, 50000, 100000]) options.add(Math.ceil(due / bill) * bill);
  $('#quick-cash').innerHTML = [...options].sort((a, b) => a - b).slice(0, 5)
    .map((c) => `<button type="button" data-cents="${c}">${money(c)}</button>`).join('');
}

function renderCheckout() {
  const isCash = coMethod() === 'cash';
  $('#co-ref-field').hidden = isCash;
  $('#quick-cash').hidden = !isCash;
  if (isCash) renderQuickCash();
  $('#co-payments').innerHTML = coPayments.map((p, i) => `
    <li><span>${escapeHtml(methodLabel(p.method))}${p.ref ? ` <small class="muted">Ref ${escapeHtml(p.ref)}</small>` : ''}</span>
    <span>${money(p.amount)} <button type="button" class="link del" data-remove-pay="${i}" aria-label="Remove payment">✕</button></span></li>`).join('');
  const c = checkoutCheck();
  $('#co-remaining').textContent = money(c.short || 0);
  $('#co-change').textContent = money(c.change || 0);
  $('#co-error').hidden = !c.error;
  $('#co-error').textContent = c.error || '';
  $('#co-confirm').disabled = Boolean(c.error || c.short);
}

$('#pay-methods').addEventListener('change', () => {
  // Card and e-wallets are charged the exact amount still due; points up to what they're worth.
  if (coMethod() === 'points') {
    setCoAmount(Math.min(coRemaining(), cartCustomer().points * state.settings.pointValue));
  } else if (coMethod() !== 'cash') {
    setCoAmount(coRemaining());
  }
  renderCheckout();
});
$('#co-tendered').addEventListener('input', renderCheckout);
$('#quick-cash').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-cents]');
  if (!btn) return;
  setCoAmount(Number(btn.dataset.cents));
  renderCheckout();
});
$('#co-payments').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-remove-pay]');
  if (!btn) return;
  coPayments.splice(Number(btn.dataset.removePay), 1);
  setCoAmount(coRemaining());
  renderCheckout();
});
// Adds the amount typed so far as one part of a split payment.
$('#co-split').addEventListener('click', () => {
  const amount = toCents($('#co-tendered').value);
  const method = coMethod();
  if (amount <= 0) { toast('Enter an amount first'); return; }
  if (amount >= coRemaining()) { toast('That covers the full amount. Tap Complete Sale.'); return; }
  coPayments.push({ method, amount, ref: method === 'cash' ? '' : $('#co-ref').value.trim() });
  $('#co-ref').value = '';
  setCoAmount(coRemaining());
  renderCheckout();
  $('#co-tendered').focus();
});
// A plain button, so pressing Enter in the amount field completes the sale instead of cancelling it.
$('#co-cancel').addEventListener('click', () => checkoutDialog.close('cancel'));

$('#checkout-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const c = checkoutCheck();
  if (c.error || c.short) return;
  const t = computeTotals();
  let sc = null;
  if (isScDiscount(t.discountType)) {
    const name = $('#co-sc-name').value.trim();
    const idNo = $('#co-sc-id').value.trim();
    if (!name || !idNo) {
      $('#co-error').hidden = false;
      $('#co-error').textContent = `Enter the ${SC_LABELS[t.discountType]} name and ID number.`;
      (name ? $('#co-sc-id') : $('#co-sc-name')).focus();
      return;
    }
    sc = { type: t.discountType, name, idNo };
  }
  checkoutDialog.close('confirm');
  completeSale(t, c.entries, c.change, sc);
});

function completeSale(t, payments, change, sc) {
  if (!t.lines.length) return;
  const methods = [...new Set(payments.map((p) => p.method))];
  const sale = {
    id: state.nextReceipt++,
    date: new Date().toISOString(),
    items: t.lines.map(({ key, ...line }) => line),
    subtotal: t.subtotal,
    discountType: t.discountType,
    discount: t.discount,
    vatExemption: t.vatExemption,
    vatableSales: t.vatableSales,
    vatExemptSales: t.vatExemptSales,
    zeroRatedSales: t.zeroRatedSales,
    taxRate: t.taxRate,
    pricesIncludeTax: t.pricesIncludeTax,
    tax: t.tax,
    total: t.total,
    method: methods.length === 1 ? methods[0] : 'split',
    payments,
    tendered: sumBy(payments, (p) => p.amount),
    change,
    sc,
    cashier: cashierInfo(),
    shiftId: openShift()?.id || null,
    customer: null,
    refunds: [],
  };
  const cust = cartCustomer();
  if (cust) {
    sale.customer = { id: cust.id, name: cust.name };
    const credit = sumBy(payments.filter((p) => p.method === 'credit'), (p) => p.amount);
    if (credit) cust.ledger.push({ id: uid('l'), date: sale.date, type: 'charge', amount: credit, saleId: sale.id });
    const pointsPaid = sumBy(payments.filter((p) => p.method === 'points'), (p) => p.amount);
    sale.pointsUsed = pointsPaid ? pointsNeeded(pointsPaid) : 0;
    sale.pointsEarned = state.settings.pointsPer ? Math.floor((sale.total - pointsPaid) / state.settings.pointsPer) : 0;
    cust.points = Math.max(0, cust.points - sale.pointsUsed) + sale.pointsEarned;
  }
  for (const line of t.lines) {
    const p = findProduct(line.productId);
    if (p) p.stock = Math.max(0, p.stock - line.qty);
  }
  state.sales.push(sale);
  saveState();
  resetSale();
  renderLowStockBadge();
  renderShiftDot();
  showReceipt(sale);
}

// ---------- Receipt ----------
const receiptDialog = $('#receipt-dialog');

function discountLabel(sale) {
  if (isScDiscount(sale.discountType)) return `Less: ${SC_LABELS[sale.discountType]} ${SC_RATE}%`;
  return 'Discount';
}

function showReceipt(sale) {
  const row = (l, r, cls = '') => `<div class="row ${cls}"><span>${l}</span><span>${r}</span></div>`;
  const s = state.settings;
  const refunds = sale.refunds || [];
  const vatBreakdown = sale.vatableSales !== undefined; // sales made before VAT breakdown was added don't have it
  const taxRow = !vatBreakdown
    ? row(`Tax (${escapeHtml(sale.taxRate)}%)`, money(sale.tax))
    : (!sale.pricesIncludeTax && !isScDiscount(sale.discountType) ? row(`VAT (${escapeHtml(sale.taxRate)}%)`, money(sale.tax)) : '');
  $('#receipt').innerHTML = `
    <h3>${escapeHtml(s.storeName)}</h3>
    <div class="center">
      ${s.storeAddress ? `${escapeHtml(s.storeAddress)}<br>` : ''}
      ${s.tin ? `VAT REG TIN: ${escapeHtml(s.tin)}<br>` : ''}
      Receipt #${escapeHtml(sale.id)}<br>${new Date(sale.date).toLocaleString()}
      ${sale.cashier ? `<br>Cashier: ${escapeHtml(sale.cashier.name)}` : ''}
    </div>
    <hr>
    ${sale.items.map((l) => row(`${l.qty} × ${escapeHtml(l.name)}`, `${money(l.total)}${vatBreakdown ? ` ${VAT_CODES[l.vat] || 'V'}` : ''}`)).join('')}
    <hr>
    ${row('Subtotal', money(sale.subtotal))}
    ${sale.discount ? row(discountLabel(sale), money(-sale.discount)) : ''}
    ${sale.vatExemption ? row('Less: VAT exemption', money(-sale.vatExemption)) : ''}
    ${taxRow}
    ${row('TOTAL', money(sale.total), 'bold')}
    ${vatBreakdown ? `<hr>
      ${row('VATable sales', money(sale.vatableSales))}
      ${row(`VAT (${escapeHtml(sale.taxRate)}%)`, money(sale.tax))}
      ${row('VAT-exempt sales', money(sale.vatExemptSales))}
      ${row('Zero-rated sales', money(sale.zeroRatedSales))}` : ''}
    <hr>
    ${salePayments(sale).map((p) => row(`${escapeHtml(methodLabel(p.method))}${p.ref ? ` (Ref ${escapeHtml(p.ref)})` : ''}`, money(p.amount))).join('')}
    ${sale.change || salePayments(sale).some((p) => p.method === 'cash') ? row('Change', money(sale.change || 0)) : ''}
    ${sale.customer ? receiptCustomer(sale, row) : ''}
    ${sale.sc ? `<hr>
      ${row(`${SC_LABELS[sale.sc.type]} name`, escapeHtml(sale.sc.name))}
      ${row('ID no.', escapeHtml(sale.sc.idNo))}
      ${row('Signature', '____________')}` : ''}
    ${refunds.length ? `<hr>${refunds.map((r) => `
      ${row(`Refund ${new Date(r.date).toLocaleDateString()}${r.method ? ` (${escapeHtml(methodLabel(r.method))})` : ''}`, money(-r.amount), 'bold')}
      ${r.items.map((i) => row(`&nbsp;&nbsp;${i.qty} × ${escapeHtml(i.name)}`, '')).join('')}`).join('')}
      ${row('NET', money(sale.total - refundedTotal(sale)), 'bold')}` : ''}
    <hr>
    <div class="center">${escapeHtml(s.receiptFooter || '')}</div>`;
  if (!receiptDialog.open) receiptDialog.showModal();
}

$('#print-receipt').addEventListener('click', () => (window.AndroidPOS ? window.AndroidPOS.print() : window.print()));
$('#close-receipt').addEventListener('click', () => receiptDialog.close());

// ---------- Products ----------
function renderProducts() {
  $('#category-list').innerHTML = categories().map((c) => `<option value="${escapeHtml(c)}">`).join('');
  const low = state.products.filter(isLowStock);
  $('#low-stock-summary').textContent = low.length
    ? `${low.length} product${low.length === 1 ? '' : 's'} at or below ${state.settings.lowStock} in stock`
    : 'All products are above the low-stock level';
  const lowOnly = $('#low-only').checked;
  const rows = (lowOnly ? low : [...state.products])
    .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
  $('#product-table').innerHTML = rows.length
    ? rows.map((p) => `
      <tr class="${isLowStock(p) ? 'low' : ''}">
        <td>${escapeHtml(p.name)}</td>
        <td>${escapeHtml(p.sku)}</td>
        <td>${escapeHtml(p.category)}</td>
        <td>${VAT_TYPES[p.vat]}</td>
        <td class="num">${money(p.price)}</td>
        <td class="num stock-cell">${p.stock}</td>
        <td class="num">${can('products') ? `
          <button class="link" data-edit="${escapeHtml(p.id)}">Edit</button>
          <button class="link del" data-delete="${escapeHtml(p.id)}">Delete</button>` : ''}
        </td>
      </tr>`).join('')
    : `<tr><td colspan="7" class="empty">${lowOnly ? 'No low-stock products' : 'No products yet'}</td></tr>`;
  renderLowStockBadge();
}

$('#low-only').addEventListener('change', renderProducts);

function resetProductForm() {
  $('#product-form').reset();
  $('#p-id').value = '';
  $('#p-submit').textContent = 'Add Product';
}

$('#product-table').addEventListener('click', (e) => {
  if (!can('products')) return;
  const editId = e.target.dataset.edit;
  const deleteId = e.target.dataset.delete;
  if (editId) {
    const p = findProduct(editId);
    if (!p) return;
    $('#p-id').value = p.id;
    $('#p-name').value = p.name;
    $('#p-sku').value = p.sku || '';
    $('#p-category').value = p.category;
    $('#p-price').value = (p.price / 100).toFixed(2);
    $('#p-stock').value = p.stock;
    $('#p-vat').value = p.vat;
    $('#p-submit').textContent = 'Save Changes';
    $('#product-form').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    $('#p-name').focus();
  }
  if (deleteId) {
    const p = findProduct(deleteId);
    if (!p || !confirm(`Delete "${p.name}"?`)) return;
    state.products = state.products.filter((x) => x.id !== deleteId);
    cart = cart.filter((l) => l.productId !== deleteId);
    if ($('#p-id').value === deleteId) resetProductForm();
    saveState();
    renderProducts();
    toast('Product deleted');
  }
});

$('#p-cancel').addEventListener('click', resetProductForm);

$('#product-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const id = $('#p-id').value;
  const sku = $('#p-sku').value.trim();
  if (sku && state.products.some((p) => (p.sku || '').toLowerCase() === sku.toLowerCase() && p.id !== id)) {
    toast(`SKU ${sku} is already in use`);
    return;
  }
  const data = {
    name: $('#p-name').value.trim(),
    sku,
    category: $('#p-category').value.trim(),
    price: Math.max(0, toCents($('#p-price').value)),
    stock: Math.max(0, parseInt($('#p-stock').value, 10) || 0),
    vat: VAT_TYPES[$('#p-vat').value] ? $('#p-vat').value : 'vatable',
  };
  if (!data.name || !data.category) {
    toast('Name and category are required');
    return;
  }
  const existing = id && findProduct(id);
  if (existing) {
    Object.assign(existing, data);
    toast('Product updated');
  } else {
    state.products.push({ id: uid(), ...data });
    toast('Product added');
  }
  syncCartWithStock();
  saveState();
  resetProductForm();
  renderProducts();
});

// ---------- Sales ----------
function renderSales() {
  const today = dateKey(new Date());
  const todays = state.sales.filter((s) => dateKey(s.date) === today);
  const refundsToday = state.sales.flatMap((s) => s.refunds || []).filter((r) => dateKey(r.date) === today);
  const todayTotal = sumBy(todays, (s) => s.total);
  const todayRefunds = sumBy(refundsToday, (r) => r.amount);
  const allTimeNet = sumBy(state.sales, (s) => s.total - refundedTotal(s));

  const stats = [
    ['Sales today', todays.length],
    ['Net revenue today', money(todayTotal - todayRefunds)],
    ['Avg. ticket today', money(todays.length ? Math.round(todayTotal / todays.length) : 0)],
    ['Refunds today', money(todayRefunds)],
    ['All-time net revenue', money(allTimeNet)],
  ];
  $('#sales-stats').innerHTML = stats
    .map(([label, value]) => `<div class="stat"><div class="label">${label}</div><div class="value">${value}</div></div>`)
    .join('');

  const labels = { paid: 'Paid', partial: 'Partly refunded', refunded: 'Refunded' };
  const rows = [...state.sales].reverse();
  $('#sales-table').innerHTML = rows.length
    ? rows.map((s) => {
      const status = saleStatus(s);
      return `
      <tr>
        <td>#${escapeHtml(s.id)}</td>
        <td>${new Date(s.date).toLocaleString()}</td>
        <td class="num">${sumBy(s.items, (l) => l.qty)}</td>
        <td>${escapeHtml(salePaymentLabel(s))}${s.sc ? ` <small class="muted">${SC_LABELS[s.sc.type]}</small>` : ''}</td>
        <td class="num">${money(s.total)}${refundedTotal(s) ? `<br><small class="muted">${money(-refundedTotal(s))}</small>` : ''}</td>
        <td><span class="status ${status}">${labels[status]}</span></td>
        <td class="num">
          <button class="link" data-receipt="${escapeHtml(s.id)}">Receipt</button>
          ${status !== 'refunded' && can('refund') ? `<button class="link del" data-refund="${escapeHtml(s.id)}">Refund</button>` : ''}
        </td>
      </tr>`;
    }).join('')
    : '<tr><td colspan="7" class="empty">No sales yet</td></tr>';
}

const findSale = (id) => state.sales.find((s) => String(s.id) === String(id));

$('#sales-table').addEventListener('click', (e) => {
  const { receipt, refund } = e.target.dataset;
  if (receipt) {
    const sale = findSale(receipt);
    if (sale) showReceipt(sale);
  }
  if (refund && can('refund')) {
    const sale = findSale(refund);
    if (sale) openRefund(sale);
  }
});

// ---------- Refunds ----------
const refundDialog = $('#refund-dialog');
let refundSale = null;

function refundableLines(sale) {
  return sale.items
    .map((l, index) => ({ ...l, index, remaining: l.qty - refundedLineQty(sale, index) }))
    .filter((l) => l.remaining > 0);
}

function openRefund(sale) {
  refundSale = sale;
  $('#rf-id').textContent = sale.id;
  const methods = [...new Set(salePayments(sale).map((p) => p.method))];
  if (methods.includes('cash')) methods.unshift(...methods.splice(methods.indexOf('cash'), 1));
  $('#rf-method').innerHTML = methods.map((m) => `<option value="${escapeHtml(m)}">${escapeHtml(methodLabel(m))}</option>`).join('');
  $('#rf-restock').checked = true;
  $('#rf-lines').innerHTML = refundableLines(sale).map((l) => `
    <tr>
      <td>${escapeHtml(l.name)}</td>
      <td class="num">${l.remaining}</td>
      <td class="num"><input type="number" min="0" max="${l.remaining}" step="1" value="0" data-line="${l.index}" aria-label="Refund quantity for ${escapeHtml(l.name)}"></td>
    </tr>`).join('');
  updateRefundAmount();
  refundDialog.showModal();
}

// Works out what to give back. Each line's share of the sale total (after discounts and VAT)
// is refunded; the refund that empties the sale takes whatever is left so totals match exactly.
function computeRefund() {
  const sale = refundSale;
  const items = [];
  for (const input of $('#rf-lines').querySelectorAll('input[data-line]')) {
    const index = Number(input.dataset.line);
    const line = sale.items[index];
    const max = line.qty - refundedLineQty(sale, index);
    const qty = Math.min(max, Math.max(0, parseInt(input.value, 10) || 0));
    if (qty > 0) {
      const amount = sale.subtotal > 0 ? Math.round(line.price * qty * sale.total / sale.subtotal) : 0;
      items.push({ line: index, productId: line.productId, name: line.name, qty, amount });
    }
  }
  const remainingMoney = Math.max(0, sale.total - refundedTotal(sale));
  const emptiesSale = sale.items.every((l, index) =>
    refundedLineQty(sale, index) + sumBy(items.filter((i) => i.line === index), (i) => i.qty) >= l.qty);
  let amount = sumBy(items, (i) => i.amount);
  if (items.length && emptiesSale) {
    items[items.length - 1].amount += remainingMoney - amount;
    amount = remainingMoney;
  }
  amount = Math.min(amount, remainingMoney);
  return { items, amount };
}

function updateRefundAmount() {
  const { items, amount } = computeRefund();
  $('#rf-amount').textContent = money(amount);
  $('#rf-confirm').disabled = items.length === 0;
}

$('#rf-lines').addEventListener('input', updateRefundAmount);
$('#rf-all').addEventListener('click', () => {
  $('#rf-lines').querySelectorAll('input[data-line]').forEach((i) => { i.value = i.max; });
  updateRefundAmount();
});
$('#rf-cancel').addEventListener('click', () => refundDialog.close());

$('#refund-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const sale = refundSale;
  const { items, amount } = computeRefund();
  if (!sale || !items.length) return;
  const restock = $('#rf-restock').checked;
  const method = $('#rf-method').value || sale.method;
  sale.refunds = sale.refunds || [];
  const refund = { date: new Date().toISOString(), items, amount, restock, method, shiftId: openShift()?.id || null, by: cashierInfo() };
  sale.refunds.push(refund);
  // Money back as utang reduces what the customer owes; points go back to their balance.
  const cust = sale.customer && findCustomer(sale.customer.id);
  if (cust && method === 'credit') cust.ledger.push({ id: uid('l'), date: refund.date, type: 'refund', amount, saleId: sale.id });
  if (cust && method === 'points') cust.points += pointsNeeded(amount);
  if (restock) {
    for (const i of items) {
      const p = findProduct(i.productId);
      if (p) p.stock += i.qty;
    }
  }
  saveState();
  refundDialog.close();
  renderSales();
  renderLowStockBadge();
  toast(`Refunded ${money(amount)} via ${methodLabel(method)}`);
});

// ---------- Reports ----------
function setReportRange(range) {
  const today = new Date();
  let from = dateKey(today);
  if (range === 'all') {
    const first = state.sales.reduce((m, s) => (s.date < m ? s.date : m), today.toISOString());
    from = dateKey(first);
  } else if (range !== 'today') {
    const d = new Date(today);
    d.setDate(d.getDate() - (Number(range) - 1));
    from = dateKey(d);
  }
  $('#r-from').value = from;
  $('#r-to').value = dateKey(today);
  document.querySelectorAll('#r-presets .chip').forEach((c) => c.classList.toggle('active', c.dataset.range === range));
}

// Net amount each payment method actually took in for a sale (cash change comes out of cash).
function paymentNet(sale) {
  const out = {};
  for (const p of salePayments(sale)) out[p.method] = (out[p.method] || 0) + p.amount;
  if (sale.change && out.cash !== undefined) out.cash -= sale.change;
  return out;
}

// VAT figures for a sale; older sales without a breakdown count as VATable.
const saleVat = (s) => (s.vatableSales !== undefined
  ? { vatable: s.vatableSales, exempt: s.vatExemptSales, zero: s.zeroRatedSales }
  : { vatable: s.subtotal - s.discount, exempt: 0, zero: 0 });

function reportData() {
  let from = $('#r-from').value || '0000-01-01';
  let to = $('#r-to').value || '9999-12-31';
  if (from > to) [from, to] = [to, from];
  const inRange = (iso) => { const k = dateKey(iso); return k >= from && k <= to; };

  const sales = state.sales.filter((s) => inRange(s.date));
  const refunds = state.sales.flatMap((s) => (s.refunds || []).map((r) => ({ ...r, sale: s }))).filter((r) => inRange(r.date));

  const scSales = sales.filter((s) => isScDiscount(s.discountType));
  const totals = {
    count: sales.length,
    gross: sumBy(sales, (s) => s.subtotal),
    discount: sumBy(sales.filter((s) => !isScDiscount(s.discountType)), (s) => s.discount),
    scDiscount: sumBy(scSales, (s) => s.discount),
    scCount: scSales.length,
    vatExemption: sumBy(sales, (s) => s.vatExemption || 0),
    tax: sumBy(sales, (s) => s.tax),
    vatable: sumBy(sales, (s) => saleVat(s).vatable),
    exempt: sumBy(sales, (s) => saleVat(s).exempt),
    zero: sumBy(sales, (s) => saleVat(s).zero),
    total: sumBy(sales, (s) => s.total),
    refunds: sumBy(refunds, (r) => r.amount),
  };
  totals.net = totals.total - totals.refunds;

  const bump = (obj, key, init) => (obj[key] ??= { ...init });
  const payments = {};
  for (const s of sales) {
    for (const [method, amount] of Object.entries(paymentNet(s))) {
      const m = bump(payments, method, { count: 0, total: 0, refunds: 0 });
      m.count++; m.total += amount;
    }
  }
  for (const r of refunds) bump(payments, r.method || r.sale.method, { count: 0, total: 0, refunds: 0 }).refunds += r.amount;

  const products = {};
  const cats = {};
  for (const s of sales) {
    for (const l of s.items) {
      const category = l.category || findProduct(l.productId)?.category || 'Uncategorized';
      const name = findProduct(l.productId)?.name || l.name;
      const p = bump(products, l.productId, { name, qty: 0, refunded: 0, gross: 0 });
      p.qty += l.qty; p.gross += l.total;
      const c = bump(cats, category, { qty: 0, gross: 0 });
      c.qty += l.qty; c.gross += l.total;
    }
  }
  for (const r of refunds) {
    for (const i of r.items) {
      const name = findProduct(i.productId)?.name || i.name;
      bump(products, i.productId, { name, qty: 0, refunded: 0, gross: 0 }).refunded += i.qty;
    }
  }

  const days = {};
  for (const s of sales) {
    const d = bump(days, dateKey(s.date), { count: 0, total: 0, refunds: 0 });
    d.count++; d.total += s.total;
  }
  for (const r of refunds) bump(days, dateKey(r.date), { count: 0, total: 0, refunds: 0 }).refunds += r.amount;

  return { from, to, sales, refunds, totals, payments, products, cats, days };
}

function renderReports() {
  if (!$('#r-from').value && !$('#r-to').value) setReportRange('7');
  const r = reportData();
  const t = r.totals;
  const stats = [
    ['Sales', t.count],
    ['Gross sales', money(t.gross)],
    ['Discounts', money(-t.discount)],
    ['SC/PWD discounts', money(-t.scDiscount)],
    ['VAT', money(t.tax)],
    ['Refunds', money(-t.refunds)],
    ['Net revenue', money(t.net)],
    ['Avg. ticket', money(t.count ? Math.round(t.total / t.count) : 0)],
  ];
  $('#report-stats').innerHTML = stats
    .map(([label, value]) => `<div class="stat"><div class="label">${label}</div><div class="value">${value}</div></div>`)
    .join('');

  $('#r-vat').innerHTML = [
    ['VATable sales', t.vatable],
    ['VAT amount', t.tax],
    ['VAT-exempt sales', t.exempt],
    ['Zero-rated sales', t.zero],
    [`VAT exemption (SC/PWD, ${t.scCount} sale${t.scCount === 1 ? '' : 's'})`, t.vatExemption],
    ['SC/PWD 20% discount', t.scDiscount],
  ].map(([label, v]) => `<tr><td>${label}</td><td class="num">${money(v)}</td></tr>`).join('');

  const empty = (cols) => `<tr><td colspan="${cols}" class="empty">No data for this period</td></tr>`;
  const pay = Object.entries(r.payments).sort((a, b) => b[1].total - a[1].total);
  $('#r-payments').innerHTML = pay.length ? pay.map(([m, v]) => `
    <tr><td>${escapeHtml(methodLabel(m))}</td><td class="num">${v.count}</td><td class="num">${money(v.total)}</td>
    <td class="num">${money(-v.refunds)}</td><td class="num">${money(v.total - v.refunds)}</td></tr>`).join('') : empty(5);

  const cats = Object.entries(r.cats).sort((a, b) => b[1].gross - a[1].gross);
  $('#r-categories').innerHTML = cats.length ? cats.map(([c, v]) => `
    <tr><td>${escapeHtml(c)}</td><td class="num">${v.qty}</td><td class="num">${money(v.gross)}</td></tr>`).join('') : empty(3);

  const prods = Object.values(r.products).sort((a, b) => b.gross - a.gross || b.qty - a.qty).slice(0, 10);
  $('#r-products').innerHTML = prods.length ? prods.map((v) => `
    <tr><td>${escapeHtml(v.name)}</td><td class="num">${v.qty}</td><td class="num">${v.refunded}</td><td class="num">${money(v.gross)}</td></tr>`).join('') : empty(4);

  const days = Object.entries(r.days).sort((a, b) => b[0].localeCompare(a[0]));
  $('#r-days').innerHTML = days.length ? days.map(([d, v]) => `
    <tr><td>${d}</td><td class="num">${v.count}</td><td class="num">${money(v.total)}</td>
    <td class="num">${money(-v.refunds)}</td><td class="num">${money(v.total - v.refunds)}</td></tr>`).join('') : empty(5);
}

$('#r-presets').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-range]');
  if (!btn) return;
  setReportRange(btn.dataset.range);
  renderReports();
});
['#r-from', '#r-to'].forEach((sel) => $(sel).addEventListener('change', () => {
  document.querySelectorAll('#r-presets .chip').forEach((c) => c.classList.remove('active'));
  renderReports();
}));

// CSV amounts are plain decimals (no currency symbol) so spreadsheets treat them as numbers.
const csvMoney = (cents) => ((cents || 0) / 100).toFixed(2);
const csvCell = (v) => {
  const s = String(v ?? '');
  return /[",\n\r]/.test(s) || /^[=+\-@]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const toCsv = (rows) => rows.map((r) => r.map(csvCell).join(',')).join('\r\n');

$('#csv-sales').addEventListener('click', () => {
  const r = reportData();
  const rows = [['Receipt', 'Date', 'Items', 'Gross', 'Discount type', 'Discount', 'VAT exemption', 'VATable sales', 'VAT',
    'VAT-exempt sales', 'Zero-rated sales', 'Total', 'Payment', 'Payment details', 'Change', 'SC/PWD name', 'SC/PWD ID',
    'Refunded', 'Net', 'Status']];
  for (const s of r.sales) {
    const refunded = refundedTotal(s);
    const vat = saleVat(s);
    const details = salePayments(s).map((p) => `${methodLabel(p.method)} ${csvMoney(p.amount)}${p.ref ? ` ref ${p.ref}` : ''}`).join('; ');
    rows.push([s.id, new Date(s.date).toLocaleString(), sumBy(s.items, (l) => l.qty), csvMoney(s.subtotal),
      s.discount ? (SC_LABELS[s.discountType] || 'Regular') : '', csvMoney(s.discount), csvMoney(s.vatExemption),
      csvMoney(vat.vatable), csvMoney(s.tax), csvMoney(vat.exempt), csvMoney(vat.zero), csvMoney(s.total),
      salePaymentLabel(s), details, csvMoney(s.change), s.sc?.name || '', s.sc?.idNo || '',
      csvMoney(refunded), csvMoney(s.total - refunded), saleStatus(s)]);
  }
  download(`sales-${r.from}-to-${r.to}.csv`, toCsv(rows), 'text/csv');
});

$('#csv-items').addEventListener('click', () => {
  const r = reportData();
  const rows = [['Receipt', 'Date', 'SKU', 'Product', 'Category', 'VAT type', 'Qty', 'Unit price', 'Line total', 'Refunded qty']];
  for (const s of r.sales) {
    s.items.forEach((l, index) => {
      const p = findProduct(l.productId);
      rows.push([s.id, new Date(s.date).toLocaleString(), l.sku ?? p?.sku ?? '', l.name, l.category || p?.category || '',
        VAT_TYPES[l.vat] || 'VATable', l.qty, csvMoney(l.price), csvMoney(l.total), refundedLineQty(s, index)]);
    });
  }
  download(`sale-items-${r.from}-to-${r.to}.csv`, toCsv(rows), 'text/csv');
});

// ---------- Settings ----------
function renderSettings() {
  const s = state.settings;
  $('#s-store').value = s.storeName;
  $('#s-address').value = s.storeAddress;
  $('#s-tin').value = s.tin;
  $('#s-footer').value = s.receiptFooter;
  $('#s-tax').value = s.taxRate;
  $('#s-incl').checked = s.pricesIncludeTax;
  $('#s-currency').value = s.currency;
  $('#s-low').value = s.lowStock;
  $('#s-points-per').value = s.pointsPer / 100;
  $('#s-point-value').value = (s.pointValue / 100).toFixed(2);
  $('#s-require-shift').checked = s.requireShift;
  renderUsers();
}

$('#settings-form').addEventListener('submit', (e) => {
  e.preventDefault();
  Object.assign(state.settings, {
    storeName: $('#s-store').value.trim() || 'My Store',
    storeAddress: $('#s-address').value.trim(),
    tin: $('#s-tin').value.trim(),
    receiptFooter: $('#s-footer').value.trim(),
    taxRate: Math.max(0, parseFloat($('#s-tax').value) || 0),
    pricesIncludeTax: $('#s-incl').checked,
    currency: $('#s-currency').value.trim() || '₱',
    lowStock: Math.max(0, parseInt($('#s-low').value, 10) || 0),
    pointsPer: Math.max(0, toCents($('#s-points-per').value)),
    pointValue: Math.max(0, toCents($('#s-point-value').value)),
    requireShift: $('#s-require-shift').checked,
  });
  saveState();
  applyStoreName();
  renderLowStockBadge();
  toast('Settings saved');
});

$('#export-data').addEventListener('click', () => {
  download(`pos-data-${dateKey(new Date())}.json`, JSON.stringify(state, null, 2), 'application/json');
});

$('#import-data').addEventListener('click', () => $('#import-file').click());
$('#import-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  let data;
  try {
    data = normalizeState(JSON.parse(await file.text()));
  } catch (err) {
    toast('That file is not a valid POS backup');
    return;
  }
  if (!confirm(`Replace all current data with "${file.name}"?\n${data.products.length} products, ${data.sales.length} sales.`)) return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  location.reload();
});

$('#reset-data').addEventListener('click', () => {
  if (!confirm('This deletes all products, sales and settings. Continue?')) return;
  localStorage.removeItem(STORAGE_KEY);
  location.reload();
});

// ---------- Users, PINs and roles ----------
const SESSION_KEY = 'simple-pos-user';
let currentUser = null;
let lockUserId = null;
const usersEnabled = () => state.users.length > 0;
const isOwner = () => !usersEnabled() || currentUser?.role === 'owner';
// Cashiers can sell and handle day-to-day tasks; everything else is owner-only
// (editing products and prices, refunds, Z-reading, settings, reports).
const CASHIER_ACTIONS = ['sell', 'hold', 'xreading', 'customers', 'shift'];
const can = (action) => isOwner() || CASHIER_ACTIONS.includes(action);
const cashierInfo = () => (currentUser ? { id: currentUser.id, name: currentUser.name } : null);
const ownerCount = () => state.users.filter((u) => u.role === 'owner').length;

async function hashPin(userId, pin) {
  const text = `simple-pos:${userId}:${pin}`;
  if (window.crypto?.subtle) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  // Fallback for browsers without Web Crypto (not cryptographically strong).
  let h = 2166136261;
  for (const ch of text) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return `fnv-${(h >>> 0).toString(16)}`;
}

function applyPermissions() {
  document.querySelectorAll('[data-owner-only]').forEach((el) => { el.hidden = !isOwner(); });
  const chip = $('#user-chip');
  chip.hidden = !usersEnabled() || !currentUser;
  if (currentUser) chip.textContent = `${currentUser.name} · ${currentUser.role === 'owner' ? 'Owner' : 'Cashier'} · Lock`;
  const active = document.querySelector('.tab.active');
  if (active?.hasAttribute('data-owner-only') && !isOwner()) showView('register');
}

function showLock() {
  currentUser = null;
  lockUserId = state.users.length === 1 ? state.users[0].id : null;
  try { sessionStorage.removeItem(SESSION_KEY); } catch (e) { /* storage unavailable */ }
  document.querySelectorAll('dialog[open]').forEach((d) => d.close());
  $('#lock-store').textContent = state.settings.storeName;
  renderLockUsers();
  $('#lock-pin').value = '';
  $('#lock-error').hidden = true;
  $('#lock-screen').hidden = false;
  applyPermissions();
  $('#lock-pin').focus();
}

function renderLockUsers() {
  $('#lock-users').innerHTML = state.users
    .map((u) => `<button type="button" class="chip ${u.id === lockUserId ? 'active' : ''}" data-user="${escapeHtml(u.id)}">${escapeHtml(u.name)}</button>`)
    .join('');
}

function startSession() {
  if (!usersEnabled()) { applyPermissions(); return; }
  let id = null;
  try { id = sessionStorage.getItem(SESSION_KEY); } catch (e) { /* storage unavailable */ }
  currentUser = state.users.find((u) => u.id === id) || null;
  if (currentUser) applyPermissions();
  else showLock();
}

$('#lock-users').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-user]');
  if (!btn) return;
  lockUserId = btn.dataset.user;
  renderLockUsers();
  $('#lock-pin').focus();
});

$('#lock-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const user = state.users.find((u) => u.id === lockUserId);
  const showError = (msg) => { $('#lock-error').textContent = msg; $('#lock-error').hidden = false; };
  if (!user) { showError('Choose your name first'); return; }
  if (await hashPin(user.id, $('#lock-pin').value) !== user.pinHash) {
    showError('Wrong PIN');
    $('#lock-pin').value = '';
    return;
  }
  currentUser = user;
  try { sessionStorage.setItem(SESSION_KEY, user.id); } catch (err) { /* storage unavailable */ }
  $('#lock-screen').hidden = true;
  applyPermissions();
  showView('register');
  toast(`Welcome, ${user.name}`);
});

$('#user-chip').addEventListener('click', () => {
  if (cart.length && !confirm('Lock the register? The current sale stays in the cart.')) return;
  showLock();
});

function renderUsers() {
  const none = !usersEnabled();
  $('#users-note').textContent = none
    ? 'No users yet, so the app opens without a PIN. Add yourself as the owner to turn on PIN login.'
    : 'Everyone picks their name and enters a PIN to use the register. Cashiers can sell, hold sales, handle customers and shifts, and run X-readings.';
  $('#users-table').innerHTML = state.users.map((u) => `
    <tr>
      <td>${escapeHtml(u.name)}${u.id === currentUser?.id ? ' <small class="muted">(you)</small>' : ''}</td>
      <td>${u.role === 'owner' ? 'Owner' : 'Cashier'}</td>
      <td class="num">
        <button class="link" data-edit-user="${escapeHtml(u.id)}">Edit</button>
        <button class="link del" data-delete-user="${escapeHtml(u.id)}">Delete</button>
      </td>
    </tr>`).join('') || '<tr><td colspan="3" class="empty">No users</td></tr>';
  if (none) $('#u-role').value = 'owner';
  $('#u-role').disabled = none;
}

function resetUserForm() {
  $('#user-form').reset();
  $('#u-id').value = '';
  $('#u-submit').textContent = 'Add User';
  $('#u-pin').placeholder = '';
  renderUsers();
}

$('#users-table').addEventListener('click', (e) => {
  const editId = e.target.dataset.editUser;
  const deleteId = e.target.dataset.deleteUser;
  if (editId) {
    const u = state.users.find((x) => x.id === editId);
    $('#u-id').value = u.id;
    $('#u-name').value = u.name;
    $('#u-pin').value = '';
    $('#u-pin').placeholder = 'Leave blank to keep';
    $('#u-role').value = u.role;
    $('#u-role').disabled = false;
    $('#u-submit').textContent = 'Save User';
    $('#u-name').focus();
  }
  if (deleteId) {
    const u = state.users.find((x) => x.id === deleteId);
    if (u.role === 'owner' && ownerCount() === 1 && state.users.length > 1) {
      toast('Add another owner before deleting the last one');
      return;
    }
    const last = state.users.length === 1;
    if (!confirm(last ? `Delete ${u.name}? PIN login will turn off.` : `Delete ${u.name}?`)) return;
    state.users = state.users.filter((x) => x.id !== deleteId);
    if (currentUser?.id === deleteId) currentUser = null;
    saveState();
    resetUserForm();
    if (usersEnabled() && !currentUser) showLock();
    else applyPermissions();
  }
});

$('#u-cancel').addEventListener('click', resetUserForm);

$('#user-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = $('#u-id').value;
  const name = $('#u-name').value.trim();
  const pin = $('#u-pin').value.trim();
  const role = usersEnabled() ? $('#u-role').value : 'owner';
  if (!name) return;
  if ((!id || pin) && !/^\d{4,8}$/.test(pin)) { toast('PIN must be 4 to 8 digits'); return; }
  if (state.users.some((u) => u.name.toLowerCase() === name.toLowerCase() && u.id !== id)) { toast('That name is already used'); return; }
  const existing = id && state.users.find((u) => u.id === id);
  if (existing) {
    if (existing.role === 'owner' && role !== 'owner' && ownerCount() === 1) { toast('There must be at least one owner'); return; }
    existing.name = name;
    existing.role = role;
    if (pin) existing.pinHash = await hashPin(existing.id, pin);
    if (currentUser?.id === existing.id) currentUser = existing;
    toast('User saved');
  } else {
    const user = { id: uid('u'), name, role };
    user.pinHash = await hashPin(user.id, pin);
    const first = !usersEnabled();
    state.users.push(user);
    if (first) {
      currentUser = user;
      try { sessionStorage.setItem(SESSION_KEY, user.id); } catch (err) { /* storage unavailable */ }
      toast('PIN login is on. You are signed in as the owner.');
    } else {
      toast('User added');
    }
  }
  saveState();
  resetUserForm();
  applyPermissions();
});

// ---------- Customers, utang and loyalty points ----------
let cartCustomerId = null;
const findCustomer = (id) => state.customers.find((c) => c.id === id);
const cartCustomer = () => (cartCustomerId ? findCustomer(cartCustomerId) || null : null);
const customerBalance = (c) => sumBy(c.ledger || [], (e) => (e.type === 'charge' ? e.amount : -e.amount));
// Points needed to cover an amount (rounded up so the store never gives away extra).
const pointsNeeded = (amount) => (state.settings.pointValue ? Math.ceil(amount / state.settings.pointValue) : 0);

function receiptCustomer(sale, row) {
  const c = findCustomer(sale.customer.id);
  return `<hr>
    ${row('Customer', escapeHtml(sale.customer.name))}
    ${sale.pointsUsed ? row('Points used', sale.pointsUsed) : ''}
    ${sale.pointsEarned ? row('Points earned', sale.pointsEarned) : ''}
    ${c ? row('Points balance', c.points) : ''}
    ${c && customerBalance(c) ? row('Utang balance', money(customerBalance(c))) : ''}`;
}

function renderCartCustomer() {
  const c = cartCustomer();
  const btn = $('#cart-customer');
  btn.classList.toggle('set', Boolean(c));
  btn.textContent = c
    ? `Customer: ${c.name} · ${c.points} pts${customerBalance(c) ? ` · owes ${money(customerBalance(c))}` : ''}`
    : '+ Add customer';
}

const customerDialog = $('#customer-dialog');
$('#cart-customer').addEventListener('click', () => {
  $('#cust-search').value = '';
  renderCustomerResults();
  customerDialog.showModal();
  $('#cust-search').focus();
});

function matchCustomers(q) {
  q = q.trim().toLowerCase();
  return state.customers
    .filter((c) => !q || c.name.toLowerCase().includes(q) || (c.phone || '').includes(q))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function renderCustomerResults() {
  const list = matchCustomers($('#cust-search').value).slice(0, 50);
  $('#cust-results').innerHTML = list.map((c) => `
    <li>
      <span>${escapeHtml(c.name)}<br><span class="muted">${escapeHtml(c.phone)} · ${c.points} pts${customerBalance(c) ? ` · owes ${money(customerBalance(c))}` : ''}</span></span>
      <button type="button" class="${c.id === cartCustomerId ? 'primary' : 'secondary'}" data-pick="${escapeHtml(c.id)}">${c.id === cartCustomerId ? 'Selected' : 'Select'}</button>
    </li>`).join('') || '<li class="empty">No customers found</li>';
}

$('#cust-search').addEventListener('input', renderCustomerResults);
$('#cust-results').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-pick]');
  if (!btn) return;
  cartCustomerId = btn.dataset.pick;
  renderCartCustomer();
  customerDialog.close();
});
$('#cust-quick').addEventListener('submit', (e) => {
  e.preventDefault();
  const name = $('#cq-name').value.trim();
  if (!name) { $('#cq-name').focus(); return; }
  const c = { id: uid('c'), name, phone: $('#cq-phone').value.trim(), points: 0, ledger: [] };
  state.customers.push(c);
  saveState();
  cartCustomerId = c.id;
  $('#cq-name').value = '';
  $('#cq-phone').value = '';
  renderCartCustomer();
  customerDialog.close();
  toast(`Added ${name}`);
});
$('#cust-none').addEventListener('click', () => { cartCustomerId = null; renderCartCustomer(); customerDialog.close(); });
$('#cust-close').addEventListener('click', () => customerDialog.close());

function renderCustomers() {
  const list = matchCustomers($('#cust-filter').value);
  const owed = sumBy(state.customers, (c) => Math.max(0, customerBalance(c)));
  $('#utang-total').textContent = `Total utang: ${money(owed)}`;
  $('#customer-table').innerHTML = list.map((c) => {
    const bal = customerBalance(c);
    return `
    <tr>
      <td>${escapeHtml(c.name)}</td>
      <td>${escapeHtml(c.phone)}</td>
      <td class="num ${bal > 0 ? 'short' : ''}">${money(bal)}</td>
      <td class="num">${c.points}</td>
      <td class="num">
        ${bal > 0 ? `<button class="link" data-pay="${escapeHtml(c.id)}">Pay</button>` : ''}
        <button class="link" data-history="${escapeHtml(c.id)}">History</button>
        <button class="link" data-edit-cust="${escapeHtml(c.id)}">Edit</button>
        ${isOwner() && !bal ? `<button class="link del" data-delete-cust="${escapeHtml(c.id)}">Delete</button>` : ''}
      </td>
    </tr>`;
  }).join('') || '<tr><td colspan="5" class="empty">No customers yet</td></tr>';
}

$('#cust-filter').addEventListener('input', renderCustomers);

function resetCustomerForm() {
  $('#customer-form').reset();
  $('#c-id').value = '';
  $('#c-submit').textContent = 'Add Customer';
}
$('#c-cancel').addEventListener('click', resetCustomerForm);

$('#customer-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const id = $('#c-id').value;
  const data = { name: $('#c-name').value.trim(), phone: $('#c-phone').value.trim() };
  if (!data.name) return;
  const existing = id && findCustomer(id);
  if (existing) Object.assign(existing, data);
  else state.customers.push({ id: uid('c'), ...data, points: 0, ledger: [] });
  saveState();
  toast(existing ? 'Customer updated' : 'Customer added');
  resetCustomerForm();
  renderCustomers();
});

$('#customer-table').addEventListener('click', (e) => {
  const d = e.target.dataset;
  if (d.editCust) {
    const c = findCustomer(d.editCust);
    $('#c-id').value = c.id;
    $('#c-name').value = c.name;
    $('#c-phone').value = c.phone;
    $('#c-submit').textContent = 'Save Customer';
    $('#c-name').focus();
  }
  if (d.deleteCust && isOwner()) {
    const c = findCustomer(d.deleteCust);
    if (!confirm(`Delete ${c.name}? Their history will be removed.`)) return;
    state.customers = state.customers.filter((x) => x.id !== c.id);
    if (cartCustomerId === c.id) cartCustomerId = null;
    saveState();
    renderCustomers();
  }
  if (d.pay) openPayment(findCustomer(d.pay));
  if (d.history) showStatement(findCustomer(d.history));
});

// Utang payments
const payDialog = $('#pay-dialog');
let payCustomer = null;
function openPayment(c) {
  payCustomer = c;
  $('#pay-name').textContent = c.name;
  $('#pay-balance').textContent = money(customerBalance(c));
  $('#pay-amount').value = (customerBalance(c) / 100).toFixed(2);
  $('#pay-method').innerHTML = COLLECTION_METHODS.map((m) => `<option value="${m}">${methodLabel(m)}</option>`).join('');
  $('#pay-ref').value = '';
  payDialog.showModal();
}
$('#pay-cancel').addEventListener('click', () => payDialog.close());
$('#pay-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const c = payCustomer;
  const amount = toCents($('#pay-amount').value);
  const bal = customerBalance(c);
  if (amount <= 0) return;
  if (amount > bal) { toast(`That's more than the ${money(bal)} owed`); return; }
  const entry = {
    id: uid('l'), date: new Date().toISOString(), type: 'payment', amount,
    method: $('#pay-method').value, ref: $('#pay-ref').value.trim(), shiftId: openShift()?.id || null, by: cashierInfo(),
  };
  c.ledger.push(entry);
  saveState();
  payDialog.close();
  renderCustomers();
  showPaymentSlip(c, entry);
});

function slipHeader(title) {
  const s = state.settings;
  return `<h3>${escapeHtml(s.storeName)}</h3>
    <div class="center">${s.storeAddress ? `${escapeHtml(s.storeAddress)}<br>` : ''}${s.tin ? `VAT REG TIN: ${escapeHtml(s.tin)}<br>` : ''}<strong>${title}</strong><br>${new Date().toLocaleString()}</div><hr>`;
}
const slipRow = (l, r, cls = '') => `<div class="row ${cls}"><span>${l}</span><span>${r}</span></div>`;
function showDoc(html) {
  $('#receipt').innerHTML = html;
  if (!receiptDialog.open) receiptDialog.showModal();
}

function showPaymentSlip(c, entry) {
  showDoc(`${slipHeader('UTANG PAYMENT')}
    ${slipRow('Customer', escapeHtml(c.name))}
    ${slipRow(`Paid (${escapeHtml(methodLabel(entry.method))}${entry.ref ? ` ref ${escapeHtml(entry.ref)}` : ''})`, money(entry.amount), 'bold')}
    ${slipRow('Remaining balance', money(customerBalance(c)))}
    ${entry.by ? slipRow('Received by', escapeHtml(entry.by.name)) : ''}
    <hr><div class="center">This is not an official receipt.</div>`);
}

function showStatement(c) {
  let running = 0;
  const labels = { charge: 'Utang', payment: 'Payment', refund: 'Refund' };
  const rows = [...c.ledger].sort((a, b) => a.date.localeCompare(b.date)).map((e) => {
    running += e.type === 'charge' ? e.amount : -e.amount;
    const what = `${new Date(e.date).toLocaleDateString()} ${labels[e.type]}${e.saleId ? ` #${escapeHtml(e.saleId)}` : ''}${e.method ? ` (${escapeHtml(methodLabel(e.method))})` : ''}`;
    return slipRow(what, `${e.type === 'charge' ? '' : '-'}${money(e.amount)}`);
  }).join('');
  showDoc(`${slipHeader('STATEMENT OF ACCOUNT')}
    ${slipRow('Customer', escapeHtml(c.name))}
    ${c.phone ? slipRow('Phone', escapeHtml(c.phone)) : ''}
    ${slipRow('Loyalty points', c.points)}
    <hr>${rows || '<div class="center">No utang history</div>'}<hr>
    ${slipRow('BALANCE', money(running), 'bold')}`);
}

// ---------- Held sales ----------
const heldDialog = $('#held-dialog');
function renderHeldCount() {
  $('#held-count').textContent = state.held.length;
  $('#show-held').disabled = !state.held.length;
}

function holdCurrentSale(label) {
  state.held.push({
    id: uid('h'), date: new Date().toISOString(), label: label || '',
    cart: structuredClone(cart), discountType: $('#discount-type').value, discountValue: $('#discount-value').value,
    customerId: cartCustomerId, by: cashierInfo(),
  });
  saveState();
  resetSale();
  renderHeldCount();
}

$('#hold-sale').addEventListener('click', () => {
  if (!cart.length) { toast('Nothing to hold'); return; }
  const label = prompt('Name or note for this order (optional)', '');
  if (label === null) return;
  holdCurrentSale(label.trim());
  toast('Sale held');
});

$('#show-held').addEventListener('click', () => {
  $('#held-list').innerHTML = [...state.held].reverse().map((h) => {
    const items = sumBy(h.cart, (l) => l.qty);
    const cust = h.customerId && findCustomer(h.customerId);
    return `<li>
      <span>${escapeHtml(h.label || 'Held sale')}<br><span class="muted">${new Date(h.date).toLocaleTimeString()} · ${items} item${items === 1 ? '' : 's'}${cust ? ` · ${escapeHtml(cust.name)}` : ''}${h.by ? ` · ${escapeHtml(h.by.name)}` : ''}</span></span>
      <span><button class="link del" data-drop="${h.id}">Delete</button> <button class="primary" data-recall="${h.id}">Recall</button></span>
    </li>`;
  }).join('') || '<li class="empty">No held sales</li>';
  heldDialog.showModal();
});

$('#held-list').addEventListener('click', (e) => {
  const { recall, drop } = e.target.dataset;
  if (drop) {
    if (!confirm('Delete this held sale?')) return;
    state.held = state.held.filter((h) => h.id !== drop);
    saveState();
    renderHeldCount();
    heldDialog.close();
  }
  if (recall) {
    const h = state.held.find((x) => x.id === recall);
    if (!h) return;
    if (cart.length) {
      if (!confirm('Hold the current sale and recall this one?')) return;
      state.held = state.held.filter((x) => x.id !== recall);
      holdCurrentSale('Held automatically');
    } else {
      state.held = state.held.filter((x) => x.id !== recall);
    }
    cart = h.cart;
    $('#discount-type').value = h.discountType || 'pct';
    $('#discount-value').value = h.discountValue || 0;
    cartCustomerId = h.customerId && findCustomer(h.customerId) ? h.customerId : null;
    saveState();
    heldDialog.close();
    renderCartCustomer();
    renderHeldCount();
    const before = sumBy(cart, (l) => l.qty);
    renderRegister();
    if (sumBy(cart, (l) => l.qty) < before) toast('Some items were reduced to match stock');
  }
});
$('#held-close').addEventListener('click', () => heldDialog.close());

// ---------- Shifts, cash drawer and X/Z readings ----------
const openShift = () => state.shifts.find((s) => !s.closedAt) || null;
const allRefunds = () => state.sales.flatMap((s) => (s.refunds || []).map((r) => ({ ...r, sale: s })));
const allLedger = () => state.customers.flatMap((c) => (c.ledger || []).map((e) => ({ ...e, customer: c })));

function renderShiftDot() {
  $('#shift-dot').hidden = !openShift();
}

// Totals for a set of sales and refunds, as printed on X and Z readings.
function summarize(sales, refunds) {
  const scSales = sales.filter((s) => isScDiscount(s.discountType));
  const ids = sales.map((s) => Number(s.id)).filter(Boolean);
  const payments = {};
  for (const s of sales) {
    for (const [m, amt] of Object.entries(paymentNet(s))) payments[m] = (payments[m] || 0) + amt;
  }
  const refundsByMethod = {};
  for (const r of refunds) {
    const m = r.method || r.sale.method;
    refundsByMethod[m] = (refundsByMethod[m] || 0) + r.amount;
  }
  const total = sumBy(sales, (s) => s.total);
  const refundTotal = sumBy(refunds, (r) => r.amount);
  return {
    count: sales.length,
    firstId: ids.length ? Math.min(...ids) : null,
    lastId: ids.length ? Math.max(...ids) : null,
    gross: sumBy(sales, (s) => s.subtotal),
    discount: sumBy(sales.filter((s) => !isScDiscount(s.discountType)), (s) => s.discount),
    scDiscount: sumBy(scSales, (s) => s.discount),
    scCount: scSales.length,
    vatExemption: sumBy(sales, (s) => s.vatExemption || 0),
    vatable: sumBy(sales, (s) => saleVat(s).vatable),
    tax: sumBy(sales, (s) => s.tax),
    exempt: sumBy(sales, (s) => saleVat(s).exempt),
    zero: sumBy(sales, (s) => saleVat(s).zero),
    total,
    refunds: refundTotal,
    refundCount: refunds.length,
    net: total - refundTotal,
    payments,
    refundsByMethod,
  };
}

// Cash that should be in the drawer for a shift.
function shiftCash(shift) {
  const sales = state.sales.filter((s) => s.shiftId === shift.id);
  const cashSales = sumBy(sales, (s) => paymentNet(s).cash || 0);
  const cashRefunds = sumBy(allRefunds().filter((r) => r.shiftId === shift.id && (r.method || r.sale.method) === 'cash'), (r) => r.amount);
  const collections = sumBy(allLedger().filter((e) => e.type === 'payment' && e.method === 'cash' && e.shiftId === shift.id), (e) => e.amount);
  const cashIn = sumBy((shift.moves || []).filter((m) => m.type === 'in'), (m) => m.amount);
  const cashOut = sumBy((shift.moves || []).filter((m) => m.type === 'out'), (m) => m.amount);
  return {
    opening: shift.openingCash, cashSales, cashRefunds, collections, cashIn, cashOut,
    expected: shift.openingCash + cashSales - cashRefunds + collections + cashIn - cashOut,
  };
}

function readingHtml(title, sum, extra = {}) {
  const r = slipRow;
  const pay = Object.entries(sum.payments).map(([m, v]) => r(methodLabel(m), money(v))).join('');
  const ref = Object.entries(sum.refundsByMethod).map(([m, v]) => r(`Refund ${methodLabel(m)}`, money(-v))).join('');
  const cash = extra.cash;
  return `${slipHeader(title)}
    ${extra.zNo ? r('Z-reading no.', extra.zNo) : ''}
    ${extra.by ? r('Prepared by', escapeHtml(extra.by)) : ''}
    ${extra.period ? r('Period', extra.period) : ''}
    ${r('Beginning receipt #', sum.firstId ?? '-')}
    ${r('Ending receipt #', sum.lastId ?? '-')}
    ${r('Number of sales', sum.count)}
    <hr>
    ${r('Gross sales', money(sum.gross))}
    ${r('Less: Discounts', money(-sum.discount))}
    ${r(`Less: SC/PWD discounts (${sum.scCount})`, money(-sum.scDiscount))}
    ${r('Less: VAT exemption', money(-sum.vatExemption))}
    ${r(`Less: Refunds (${sum.refundCount})`, money(-sum.refunds))}
    ${r('NET SALES', money(sum.net), 'bold')}
    <hr>
    ${r('VATable sales', money(sum.vatable))}
    ${r(`VAT (${state.settings.taxRate}%)`, money(sum.tax))}
    ${r('VAT-exempt sales', money(sum.exempt))}
    ${r('Zero-rated sales', money(sum.zero))}
    <hr>
    <div class="center">PAYMENTS</div>
    ${pay || r('None', money(0))}
    ${ref}
    ${cash ? `<hr>
      <div class="center">CASH DRAWER</div>
      ${r('Opening cash', money(cash.opening))}
      ${r('Cash sales', money(cash.cashSales))}
      ${r('Utang collected (cash)', money(cash.collections))}
      ${r('Cash in', money(cash.cashIn))}
      ${r('Cash out', money(-cash.cashOut))}
      ${r('Cash refunds', money(-cash.cashRefunds))}
      ${r('EXPECTED CASH', money(cash.expected), 'bold')}
      ${extra.counted !== undefined ? `${r('Counted cash', money(extra.counted))}${r('Over / short', money(extra.counted - cash.expected), 'bold')}` : ''}` : ''}
    ${extra.grandBefore !== undefined ? `<hr>
      ${r('Previous grand total', money(extra.grandBefore))}
      ${r('Grand total', money(extra.grandAfter), 'bold')}` : ''}`;
}

function shiftReadingHtml(shift, title, counted) {
  const sales = state.sales.filter((s) => s.shiftId === shift.id);
  const refunds = allRefunds().filter((r) => r.shiftId === shift.id);
  const period = `${new Date(shift.openedAt).toLocaleString()} – ${shift.closedAt ? new Date(shift.closedAt).toLocaleString() : 'now'}`;
  return readingHtml(title, summarize(sales, refunds), { by: shift.openedBy?.name, period, cash: shiftCash(shift), counted });
}

function renderShift() {
  const shift = openShift();
  if (!shift) {
    $('#shift-card').innerHTML = `
      <h3>No shift open</h3>
      <p class="muted">Open a shift at the start of the day with the cash already in the drawer. Sales then count toward the shift, and you can check the drawer when you close it.</p>
      <form id="open-shift-form" class="inline-form">
        <label>Opening cash <input id="open-cash" type="number" min="0" step="0.01" inputmode="decimal" value="0"></label>
        <button class="primary" type="submit">Open shift</button>
      </form>`;
  } else {
    const cash = shiftCash(shift);
    const sales = state.sales.filter((s) => s.shiftId === shift.id);
    $('#shift-card').innerHTML = `
      <h3>Shift open</h3>
      <div class="shift-info">
        <div><span class="muted">Opened</span><strong>${new Date(shift.openedAt).toLocaleTimeString()}</strong></div>
        <div><span class="muted">By</span><strong>${escapeHtml(shift.openedBy?.name || 'Staff')}</strong></div>
        <div><span class="muted">Sales</span><strong>${sales.length}</strong></div>
        <div><span class="muted">Expected cash</span><strong>${money(cash.expected)}</strong></div>
      </div>
      <form id="cash-move-form" class="inline-form">
        <label>Cash in / out
          <select id="move-type"><option value="out">Cash out (expense, payout)</option><option value="in">Cash in (add change)</option></select>
        </label>
        <label>Amount <input id="move-amount" type="number" min="0.01" step="0.01" inputmode="decimal" required></label>
        <label>Note <input id="move-note" placeholder="e.g. ice, delivery"></label>
        <button class="secondary" type="submit">Record</button>
      </form>
      ${(shift.moves || []).length ? `<ul class="pick-list">${shift.moves.map((m) => `<li><span>${new Date(m.date).toLocaleTimeString()} · ${m.type === 'in' ? 'Cash in' : 'Cash out'}${m.note ? ` · ${escapeHtml(m.note)}` : ''}</span><span>${money(m.type === 'in' ? m.amount : -m.amount)}</span></li>`).join('')}</ul>` : ''}
      <form id="close-shift-form" class="inline-form">
        <label>Counted cash in drawer <input id="count-cash" type="number" min="0" step="0.01" inputmode="decimal" required></label>
        <button class="danger" type="submit">Close shift</button>
      </form>`;
  }
  $('#z-table').innerHTML = [...state.zReadings].reverse().map((z) => `
    <tr><td>${z.no}</td><td>${new Date(z.date).toLocaleString()}</td><td class="num">${z.summary.count}</td>
    <td class="num">${money(z.summary.net)}</td><td class="num">${money(z.grandAfter)}</td>
    <td class="num"><button class="link" data-z="${z.no}">View</button></td></tr>`).join('')
    || '<tr><td colspan="6" class="empty">No Z-readings yet</td></tr>';
  $('#shift-history').innerHTML = state.shifts.filter((s) => s.closedAt).reverse().slice(0, 30).map((s) => `
    <tr><td>${new Date(s.openedAt).toLocaleString()}</td><td>${escapeHtml(s.openedBy?.name || 'Staff')}</td>
    <td>${new Date(s.closedAt).toLocaleTimeString()}</td><td class="num">${money(s.expectedCash)}</td><td class="num">${money(s.countedCash)}</td>
    <td class="num ${s.countedCash - s.expectedCash < 0 ? 'short' : s.countedCash - s.expectedCash > 0 ? 'over' : ''}">${money(s.countedCash - s.expectedCash)}</td>
    <td class="num"><button class="link" data-shift="${s.id}">View</button></td></tr>`).join('')
    || '<tr><td colspan="7" class="empty">No closed shifts yet</td></tr>';
  renderShiftDot();
}

$('#shift-card').addEventListener('submit', (e) => {
  e.preventDefault();
  if (e.target.id === 'open-shift-form') {
    if (openShift()) return;
    state.shifts.push({
      id: uid('s'), openedAt: new Date().toISOString(), openedBy: cashierInfo(),
      openingCash: Math.max(0, toCents($('#open-cash').value)), moves: [],
    });
    saveState();
    toast('Shift opened');
  }
  if (e.target.id === 'cash-move-form') {
    const amount = toCents($('#move-amount').value);
    if (amount <= 0) return;
    openShift().moves.push({ date: new Date().toISOString(), type: $('#move-type').value, amount, note: $('#move-note').value.trim(), by: cashierInfo() });
    saveState();
    toast('Recorded');
  }
  if (e.target.id === 'close-shift-form') {
    const shift = openShift();
    const counted = Math.max(0, toCents($('#count-cash').value));
    const expected = shiftCash(shift).expected;
    const diff = counted - expected;
    const note = diff === 0 ? 'The drawer matches.' : `The drawer is ${diff > 0 ? 'over' : 'short'} by ${money(Math.abs(diff))}.`;
    if (!confirm(`Close this shift? ${note}`)) return;
    shift.closedAt = new Date().toISOString();
    shift.closedBy = cashierInfo();
    shift.countedCash = counted;
    shift.expectedCash = expected;
    saveState();
    showDoc(shiftReadingHtml(shift, 'SHIFT CLOSE', counted));
  }
  renderShift();
});

$('#shift-history').addEventListener('click', (e) => {
  const shift = state.shifts.find((s) => s.id === e.target.dataset.shift);
  if (shift) showDoc(shiftReadingHtml(shift, 'SHIFT CLOSE', shift.countedCash));
});

$('#x-reading').addEventListener('click', () => {
  const shift = openShift();
  if (shift) {
    showDoc(shiftReadingHtml(shift, 'X-READING'));
    return;
  }
  // No shift open: everything since the last Z-reading.
  const sales = state.sales.filter((s) => s.zNo === undefined);
  const refunds = allRefunds().filter((r) => r.zNo === undefined);
  showDoc(readingHtml('X-READING', summarize(sales, refunds), { by: currentUser?.name, period: 'Since last Z-reading' }));
});

$('#z-reading').addEventListener('click', () => {
  if (!can('zreading')) return;
  const sales = state.sales.filter((s) => s.zNo === undefined);
  const hasRefunds = state.sales.some((s) => (s.refunds || []).some((r) => r.zNo === undefined));
  if (!sales.length && !hasRefunds) { toast('No new sales since the last Z-reading'); return; }
  if (openShift() && !confirm('A shift is still open. Run the Z-reading anyway?')) return;
  if (!confirm(`Run Z-reading #${state.nextZ}? This closes the totals so far and can't be undone.`)) return;
  const refunds = allRefunds().filter((r) => r.zNo === undefined);
  const summary = summarize(sales, refunds);
  const grandBefore = state.zReadings.length ? state.zReadings[state.zReadings.length - 1].grandAfter : 0;
  const z = {
    no: state.nextZ++, date: new Date().toISOString(), by: cashierInfo(), summary,
    grandBefore, grandAfter: grandBefore + summary.net,
  };
  for (const s of sales) s.zNo = z.no;
  for (const s of state.sales) for (const r of s.refunds || []) if (r.zNo === undefined) r.zNo = z.no;
  state.zReadings.push(z);
  saveState();
  renderShift();
  showZ(z);
});

function showZ(z) {
  showDoc(readingHtml('Z-READING', z.summary, { zNo: z.no, by: z.by?.name, grandBefore: z.grandBefore, grandAfter: z.grandAfter }));
}
$('#z-table').addEventListener('click', (e) => {
  const z = state.zReadings.find((x) => String(x.no) === e.target.dataset.z);
  if (z) showZ(z);
});

// ---------- Init ----------
function applyStoreName() {
  document.title = `${state.settings.storeName} · POS`;
  $('.topbar h1').textContent = state.settings.storeName;
}

// Used by the Android app's Back button: close an open popup, then go back to the register.
// Returns false when there is nothing to close, so the app can exit.
window.posHandleBack = () => {
  if (!$('#lock-screen').hidden) return false;
  const open = document.querySelector('dialog[open]');
  if (open) {
    open.close();
    return true;
  }
  if (!$('#view-register').classList.contains('active')) {
    showView('register');
    return true;
  }
  return false;
};

applyStoreName();
renderLowStockBadge();
startSession();
renderRegister();
renderHeldCount();
renderShiftDot();
renderCartCustomer();
