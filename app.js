'use strict';

// ---------- Storage ----------
const STORAGE_KEY = 'simple-pos-v1';

const DEFAULT_SETTINGS = { storeName: 'My Store', taxRate: 8.25, currency: '$', lowStock: 5 };

const DEFAULT_STATE = {
  settings: { ...DEFAULT_SETTINGS },
  products: [
    { id: 'p1', name: 'Espresso', sku: '1001', category: 'Coffee', price: 300, stock: 100 },
    { id: 'p2', name: 'Cappuccino', sku: '1002', category: 'Coffee', price: 450, stock: 100 },
    { id: 'p3', name: 'Latte', sku: '1003', category: 'Coffee', price: 475, stock: 100 },
    { id: 'p4', name: 'Cold Brew', sku: '1004', category: 'Coffee', price: 425, stock: 60 },
    { id: 'p5', name: 'Green Tea', sku: '2001', category: 'Tea', price: 325, stock: 80 },
    { id: 'p6', name: 'Chai Latte', sku: '2002', category: 'Tea', price: 450, stock: 80 },
    { id: 'p7', name: 'Croissant', sku: '3001', category: 'Bakery', price: 350, stock: 24 },
    { id: 'p8', name: 'Blueberry Muffin', sku: '3002', category: 'Bakery', price: 375, stock: 18 },
    { id: 'p9', name: 'Bagel', sku: '3003', category: 'Bakery', price: 275, stock: 4 },
    { id: 'p10', name: 'Bottled Water', sku: '4001', category: 'Drinks', price: 200, stock: 48 },
    { id: 'p11', name: 'Orange Juice', sku: '4002', category: 'Drinks', price: 400, stock: 30 },
  ],
  sales: [],
  nextReceipt: 1001,
};

// Fills in missing fields so data saved by older versions (or imported files) keeps working.
function normalizeState(data) {
  if (!data || typeof data !== 'object' || !Array.isArray(data.products) || !Array.isArray(data.sales)) {
    throw new Error('Not a valid POS data file');
  }
  const settings = { ...DEFAULT_SETTINGS, ...(data.settings || {}) };
  settings.taxRate = Math.max(0, Number(settings.taxRate) || 0);
  settings.lowStock = Math.max(0, parseInt(settings.lowStock, 10) || 0);
  const products = data.products
    .filter((p) => p && p.id && p.name)
    .map((p) => ({
      id: String(p.id),
      name: String(p.name),
      sku: String(p.sku ?? ''),
      category: String(p.category || 'Uncategorized'),
      price: Math.max(0, Math.round(Number(p.price) || 0)),
      stock: Math.max(0, Math.round(Number(p.stock) || 0)),
    }));
  const sales = data.sales
    .filter((s) => s && s.id != null && Array.isArray(s.items))
    .map((s) => ({ ...s, refunds: Array.isArray(s.refunds) ? s.refunds : [] }));
  const maxId = sales.reduce((m, s) => Math.max(m, Number(s.id) || 0), 0);
  const nextReceipt = Math.max(Number(data.nextReceipt) || 1001, maxId + 1);
  return { settings, products, sales, nextReceipt };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return normalizeState(JSON.parse(raw));
  } catch (e) {
    console.warn('Could not load saved data', e);
  }
  return structuredClone(DEFAULT_STATE);
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    toast('Could not save data in this browser');
  }
}

const state = loadState();
// Cart lines: { productId, qty }
let cart = [];
let activeCategory = 'All';

// ---------- Helpers ----------
const $ = (sel) => document.querySelector(sel);

// Prices are stored as integer cents to avoid floating point drift.
const toCents = (value) => Math.round(parseFloat(value || 0) * 100);
const money = (cents) => {
  const sign = cents < 0 ? '-' : '';
  return `${sign}${state.settings.currency}${(Math.abs(cents) / 100).toFixed(2)}`;
};
const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));
const uid = () => 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const findProduct = (id) => state.products.find((p) => p.id === id);
const isLowStock = (p) => p.stock <= state.settings.lowStock;
// Local calendar date as YYYY-MM-DD (used for reports and date inputs).
const dateKey = (d) => {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};

function download(filename, text, type) {
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
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

// ---------- Refund helpers ----------
const refundedTotal = (sale) => (sale.refunds || []).reduce((s, r) => s + r.amount, 0);
const refundedQty = (sale, productId) => (sale.refunds || [])
  .reduce((n, r) => n + r.items.filter((i) => i.productId === productId).reduce((m, i) => m + i.qty, 0), 0);
function saleStatus(sale) {
  const refunded = refundedTotal(sale);
  const allItemsBack = sale.items.every((l) => refundedQty(sale, l.productId) >= l.qty);
  if (refunded > 0 && (allItemsBack || refunded >= sale.total)) return 'refunded';
  if (refunded > 0 || (sale.refunds || []).length) return 'partial';
  return 'paid';
}

// ---------- Navigation ----------
document.querySelectorAll('.tab').forEach((btn) => {
  btn.addEventListener('click', () => showView(btn.dataset.view));
});

function showView(name) {
  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${name}`));
  if (name === 'register') renderRegister();
  if (name === 'products') renderProducts();
  if (name === 'sales') renderSales();
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

function inCartQty(productId) {
  return cart.find((l) => l.productId === productId)?.qty ?? 0;
}

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

function addToCart(productId) {
  const product = findProduct(productId);
  if (!product) return;
  const line = cart.find((l) => l.productId === productId);
  const qty = line ? line.qty : 0;
  if (qty + 1 > product.stock) {
    toast(`Only ${product.stock} ${product.name} in stock`);
    return;
  }
  if (line) line.qty++;
  else cart.push({ productId, qty: 1 });
  renderCart();
  renderGrid();
}

function changeQty(productId, delta) {
  const line = cart.find((l) => l.productId === productId);
  if (!line) return;
  const product = findProduct(productId);
  if (delta > 0 && line.qty + delta > product.stock) {
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
  cart = cart
    .filter((l) => findProduct(l.productId))
    .map((l) => ({ ...l, qty: Math.min(l.qty, findProduct(l.productId).stock) }))
    .filter((l) => l.qty > 0);
}

$('#cart-items').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const id = btn.dataset.id;
  if (btn.dataset.action === 'inc') changeQty(id, 1);
  if (btn.dataset.action === 'dec') changeQty(id, -1);
  if (btn.dataset.action === 'remove') changeQty(id, -Infinity);
});

function computeTotals() {
  const lines = cart.map((l) => {
    const p = findProduct(l.productId);
    return { productId: p.id, name: p.name, sku: p.sku, category: p.category, price: p.price, qty: l.qty, total: p.price * l.qty };
  });
  const subtotal = lines.reduce((s, l) => s + l.total, 0);
  const dValue = Math.max(0, parseFloat($('#discount-value').value) || 0);
  let discount = $('#discount-type').value === 'pct'
    ? Math.round(subtotal * Math.min(dValue, 100) / 100)
    : toCents(dValue);
  discount = Math.min(discount, subtotal);
  const tax = Math.round((subtotal - discount) * state.settings.taxRate / 100);
  return { lines, subtotal, discount, tax, total: subtotal - discount + tax };
}

function renderCart() {
  const t = computeTotals();
  $('#cart-items').innerHTML = t.lines.length
    ? t.lines.map((l) => `
      <li class="cart-item">
        <div>
          <div>${escapeHtml(l.name)}</div>
          <div class="meta">${money(l.price)} each · <button class="link del" data-action="remove" data-id="${escapeHtml(l.productId)}">remove</button></div>
        </div>
        <div class="qty">
          <button data-action="dec" data-id="${escapeHtml(l.productId)}" aria-label="Decrease">−</button>
          <span>${l.qty}</span>
          <button data-action="inc" data-id="${escapeHtml(l.productId)}" aria-label="Increase">+</button>
        </div>
        <strong>${money(l.total)}</strong>
      </li>`).join('')
    : '<li class="empty">Tap a product to add it</li>';

  $('#subtotal').textContent = money(t.subtotal);
  $('#discount').textContent = money(-t.discount);
  $('#tax').textContent = money(t.tax);
  $('#tax-rate-label').textContent = state.settings.taxRate;
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

// ---------- Checkout ----------
const checkoutDialog = $('#checkout-dialog');

$('#checkout').addEventListener('click', () => {
  const { total } = computeTotals();
  $('#co-total').textContent = money(total);
  $('#co-tendered').value = (total / 100).toFixed(2);
  $('#checkout-form').payment.value = 'cash';
  checkoutDialog.returnValue = '';

  // Quick cash buttons: exact amount plus the next round bills above it.
  const options = new Set([total]);
  for (const bill of [500, 1000, 2000, 5000, 10000]) {
    options.add(Math.ceil(total / bill) * bill);
  }
  $('#quick-cash').innerHTML = [...options].sort((a, b) => a - b).slice(0, 5)
    .map((c) => `<button type="button" data-cents="${c}">${money(c)}</button>`).join('');

  updateCashFields();
  checkoutDialog.showModal();
});

$('#quick-cash').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-cents]');
  if (!btn) return;
  $('#co-tendered').value = (btn.dataset.cents / 100).toFixed(2);
  updateCashFields();
});

$('#checkout-form').addEventListener('change', updateCashFields);
$('#co-tendered').addEventListener('input', updateCashFields);
// A plain button, so pressing Enter in the amount field completes the sale instead of cancelling it.
$('#co-cancel').addEventListener('click', () => checkoutDialog.close('cancel'));

function updateCashFields() {
  const isCash = $('#checkout-form').payment.value === 'cash';
  $('#cash-fields').hidden = !isCash;
  const { total } = computeTotals();
  const change = toCents($('#co-tendered').value) - total;
  $('#co-change').textContent = money(Math.max(0, change));
  $('#co-confirm').disabled = isCash && change < 0;
}

checkoutDialog.addEventListener('close', () => {
  if (checkoutDialog.returnValue === 'confirm') completeSale();
});

function completeSale() {
  const t = computeTotals();
  if (!t.lines.length) return;
  const method = $('#checkout-form').payment.value;
  const tendered = method === 'cash' ? toCents($('#co-tendered').value) : t.total;

  const sale = {
    id: state.nextReceipt++,
    date: new Date().toISOString(),
    items: t.lines,
    subtotal: t.subtotal,
    discount: t.discount,
    taxRate: state.settings.taxRate,
    tax: t.tax,
    total: t.total,
    method,
    tendered,
    change: tendered - t.total,
    refunds: [],
  };

  for (const line of t.lines) {
    const p = findProduct(line.productId);
    if (p) p.stock = Math.max(0, p.stock - line.qty);
  }
  state.sales.push(sale);
  saveState();
  resetSale();
  renderLowStockBadge();
  showReceipt(sale);
}

// ---------- Receipt ----------
const receiptDialog = $('#receipt-dialog');

function showReceipt(sale) {
  const row = (l, r, cls = '') => `<div class="row ${cls}"><span>${l}</span><span>${r}</span></div>`;
  const refunds = sale.refunds || [];
  $('#receipt').innerHTML = `
    <h3>${escapeHtml(state.settings.storeName)}</h3>
    <div class="center">Receipt #${escapeHtml(sale.id)}<br>${new Date(sale.date).toLocaleString()}</div>
    <hr>
    ${sale.items.map((l) => row(`${l.qty} × ${escapeHtml(l.name)}`, money(l.total))).join('')}
    <hr>
    ${row('Subtotal', money(sale.subtotal))}
    ${sale.discount ? row('Discount', money(-sale.discount)) : ''}
    ${row(`Tax (${escapeHtml(sale.taxRate)}%)`, money(sale.tax))}
    ${row('TOTAL', money(sale.total), 'bold')}
    <hr>
    ${row(`Paid (${escapeHtml(sale.method)})`, money(sale.tendered))}
    ${sale.method === 'cash' ? row('Change', money(sale.change)) : ''}
    ${refunds.length ? `<hr>${refunds.map((r) => `
      ${row(`Refund ${new Date(r.date).toLocaleDateString()}`, money(-r.amount), 'bold')}
      ${r.items.map((i) => row(`&nbsp;&nbsp;${i.qty} × ${escapeHtml(i.name)}`, '')).join('')}`).join('')}
      ${row('NET', money(sale.total - refundedTotal(sale)), 'bold')}` : ''}
    <hr>
    <div class="center">Thank you!</div>`;
  if (!receiptDialog.open) receiptDialog.showModal();
}

$('#print-receipt').addEventListener('click', () => window.print());
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
        <td class="num">${money(p.price)}</td>
        <td class="num stock-cell">${p.stock}</td>
        <td class="num">
          <button class="link" data-edit="${escapeHtml(p.id)}">Edit</button>
          <button class="link del" data-delete="${escapeHtml(p.id)}">Delete</button>
        </td>
      </tr>`).join('')
    : `<tr><td colspan="6" class="empty">${lowOnly ? 'No low-stock products' : 'No products yet'}</td></tr>`;
  renderLowStockBadge();
}

$('#low-only').addEventListener('change', renderProducts);

function resetProductForm() {
  $('#product-form').reset();
  $('#p-id').value = '';
  $('#p-submit').textContent = 'Add Product';
}

$('#product-table').addEventListener('click', (e) => {
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
  const sum = (arr, k) => arr.reduce((s, x) => s + x[k], 0);
  const todayTotal = sum(todays, 'total');
  const todayRefunds = sum(refundsToday, 'amount');
  const allTimeNet = sum(state.sales, 'total') - state.sales.reduce((s, x) => s + refundedTotal(x), 0);

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
        <td class="num">${s.items.reduce((n, l) => n + l.qty, 0)}</td>
        <td>${escapeHtml(s.method)}</td>
        <td class="num">${money(s.total)}${refundedTotal(s) ? `<br><small class="muted">${money(-refundedTotal(s))}</small>` : ''}</td>
        <td><span class="status ${status}">${labels[status]}</span></td>
        <td class="num">
          <button class="link" data-receipt="${escapeHtml(s.id)}">Receipt</button>
          ${status !== 'refunded' ? `<button class="link del" data-refund="${escapeHtml(s.id)}">Refund</button>` : ''}
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
  if (refund) {
    const sale = findSale(refund);
    if (sale) openRefund(sale);
  }
});

// ---------- Refunds ----------
const refundDialog = $('#refund-dialog');
let refundSale = null;

function refundableLines(sale) {
  return sale.items
    .map((l, index) => ({ ...l, index, remaining: l.qty - refundedQty(sale, l.productId) }))
    .filter((l) => l.remaining > 0);
}

function openRefund(sale) {
  refundSale = sale;
  $('#rf-id').textContent = sale.id;
  $('#rf-method').textContent = sale.method;
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

// Works out what to give back. Each line's share of the sale total (after discount and tax)
// is refunded; the last refund that empties the sale takes whatever is left so totals match exactly.
function computeRefund() {
  const sale = refundSale;
  const items = [];
  for (const input of $('#rf-lines').querySelectorAll('input[data-line]')) {
    const line = sale.items[Number(input.dataset.line)];
    const max = line.qty - refundedQty(sale, line.productId);
    const qty = Math.min(max, Math.max(0, parseInt(input.value, 10) || 0));
    if (qty > 0) {
      const amount = sale.subtotal > 0 ? Math.round(line.price * qty * sale.total / sale.subtotal) : 0;
      items.push({ productId: line.productId, name: line.name, qty, amount });
    }
  }
  const alreadyRefunded = refundedTotal(sale);
  const remainingMoney = Math.max(0, sale.total - alreadyRefunded);
  const emptiesSale = sale.items.every((l) => {
    const back = refundedQty(sale, l.productId) + (items.find((i) => i.productId === l.productId)?.qty || 0);
    return back >= l.qty;
  });
  let amount = items.reduce((s, i) => s + i.amount, 0);
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
  sale.refunds = sale.refunds || [];
  sale.refunds.push({ date: new Date().toISOString(), items, amount, restock });
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
  toast(`Refunded ${money(amount)} to ${sale.method}`);
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

function reportData() {
  let from = $('#r-from').value || '0000-01-01';
  let to = $('#r-to').value || '9999-12-31';
  if (from > to) [from, to] = [to, from];
  const inRange = (iso) => { const k = dateKey(iso); return k >= from && k <= to; };

  const sales = state.sales.filter((s) => inRange(s.date));
  const refunds = state.sales.flatMap((s) => (s.refunds || []).map((r) => ({ ...r, sale: s }))).filter((r) => inRange(r.date));
  const sum = (arr, f) => arr.reduce((s, x) => s + f(x), 0);

  const totals = {
    count: sales.length,
    gross: sum(sales, (s) => s.subtotal),
    discount: sum(sales, (s) => s.discount),
    tax: sum(sales, (s) => s.tax),
    total: sum(sales, (s) => s.total),
    refunds: sum(refunds, (r) => r.amount),
  };
  totals.net = totals.total - totals.refunds;

  const payments = {};
  const bump = (obj, key, init) => (obj[key] ??= { ...init });
  for (const s of sales) {
    const m = bump(payments, s.method, { count: 0, total: 0, refunds: 0 });
    m.count++; m.total += s.total;
  }
  for (const r of refunds) bump(payments, r.sale.method, { count: 0, total: 0, refunds: 0 }).refunds += r.amount;

  const products = {};
  const cats = {};
  for (const s of sales) {
    for (const l of s.items) {
      const category = l.category || findProduct(l.productId)?.category || 'Uncategorized';
      const p = bump(products, l.productId, { name: l.name, qty: 0, refunded: 0, gross: 0 });
      p.qty += l.qty; p.gross += l.total;
      const c = bump(cats, category, { qty: 0, gross: 0 });
      c.qty += l.qty; c.gross += l.total;
    }
  }
  for (const r of refunds) {
    for (const i of r.items) bump(products, i.productId, { name: i.name, qty: 0, refunded: 0, gross: 0 }).refunded += i.qty;
  }

  const days = {};
  for (const s of sales) {
    const d = bump(days, dateKey(s.date), { count: 0, total: 0, refunds: 0 });
    d.count++; d.total += s.total;
  }
  for (const r of refunds) bump(days, dateKey(r.date), { count: 0, total: 0, refunds: 0 }).refunds += r.amount;

  return { from, to, sales, totals, payments, products, cats, days };
}

function renderReports() {
  if (!$('#r-from').value && !$('#r-to').value) setReportRange('7');
  const r = reportData();
  const t = r.totals;
  const stats = [
    ['Sales', t.count],
    ['Gross sales', money(t.gross)],
    ['Discounts', money(-t.discount)],
    ['Tax collected', money(t.tax)],
    ['Refunds', money(-t.refunds)],
    ['Net revenue', money(t.net)],
    ['Avg. ticket', money(t.count ? Math.round(t.total / t.count) : 0)],
  ];
  $('#report-stats').innerHTML = stats
    .map(([label, value]) => `<div class="stat"><div class="label">${label}</div><div class="value">${value}</div></div>`)
    .join('');

  const empty = (cols) => `<tr><td colspan="${cols}" class="empty">No data for this period</td></tr>`;
  const pay = Object.entries(r.payments).sort((a, b) => b[1].total - a[1].total);
  $('#r-payments').innerHTML = pay.length ? pay.map(([m, v]) => `
    <tr><td>${escapeHtml(m)}</td><td class="num">${v.count}</td><td class="num">${money(v.total)}</td>
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
const csvMoney = (cents) => (cents / 100).toFixed(2);
const csvCell = (v) => {
  const s = String(v ?? '');
  return /[",\n\r]/.test(s) || /^[=+\-@]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const toCsv = (rows) => rows.map((r) => r.map(csvCell).join(',')).join('\r\n');

$('#csv-sales').addEventListener('click', () => {
  const r = reportData();
  const rows = [['Receipt', 'Date', 'Items', 'Subtotal', 'Discount', 'Tax', 'Total', 'Payment', 'Tendered', 'Change', 'Refunded', 'Net', 'Status']];
  for (const s of r.sales) {
    const refunded = refundedTotal(s);
    rows.push([s.id, new Date(s.date).toLocaleString(), s.items.reduce((n, l) => n + l.qty, 0),
      csvMoney(s.subtotal), csvMoney(s.discount), csvMoney(s.tax), csvMoney(s.total), s.method,
      csvMoney(s.tendered), csvMoney(s.change), csvMoney(refunded), csvMoney(s.total - refunded), saleStatus(s)]);
  }
  download(`sales-${r.from}-to-${r.to}.csv`, toCsv(rows), 'text/csv');
});

$('#csv-items').addEventListener('click', () => {
  const r = reportData();
  const rows = [['Receipt', 'Date', 'SKU', 'Product', 'Category', 'Qty', 'Unit price', 'Line total', 'Refunded qty']];
  for (const s of r.sales) {
    for (const l of s.items) {
      const p = findProduct(l.productId);
      rows.push([s.id, new Date(s.date).toLocaleString(), l.sku ?? p?.sku ?? '', l.name,
        l.category || p?.category || '', l.qty, csvMoney(l.price), csvMoney(l.total), refundedQty(s, l.productId)]);
    }
  }
  download(`sale-items-${r.from}-to-${r.to}.csv`, toCsv(rows), 'text/csv');
});

// ---------- Settings ----------
function renderSettings() {
  $('#s-store').value = state.settings.storeName;
  $('#s-tax').value = state.settings.taxRate;
  $('#s-currency').value = state.settings.currency;
  $('#s-low').value = state.settings.lowStock;
}

$('#settings-form').addEventListener('submit', (e) => {
  e.preventDefault();
  state.settings = {
    storeName: $('#s-store').value.trim() || 'My Store',
    taxRate: Math.max(0, parseFloat($('#s-tax').value) || 0),
    currency: $('#s-currency').value.trim() || '$',
    lowStock: Math.max(0, parseInt($('#s-low').value, 10) || 0),
  };
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

// ---------- Init ----------
function applyStoreName() {
  document.title = `${state.settings.storeName} · POS`;
  $('.topbar h1').textContent = state.settings.storeName;
}

applyStoreName();
renderLowStockBadge();
renderRegister();
