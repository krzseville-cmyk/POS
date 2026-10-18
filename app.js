'use strict';

// ---------- Storage ----------
const STORAGE_KEY = 'simple-pos-v1';

const DEFAULT_STATE = {
  settings: { storeName: 'My Store', taxRate: 8.25, currency: '$' },
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

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...structuredClone(DEFAULT_STATE), ...JSON.parse(raw) };
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

let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
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
  if (name === 'settings') renderSettings();
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

function renderGrid() {
  const q = $('#search').value.trim().toLowerCase();
  const items = state.products.filter((p) =>
    (activeCategory === 'All' || p.category === activeCategory) &&
    (!q || p.name.toLowerCase().includes(q) || (p.sku || '').toLowerCase().includes(q)));

  if (!items.length) {
    $('#product-grid').innerHTML = '<div class="empty">No products found</div>';
    return;
  }
  $('#product-grid').innerHTML = items.map((p) => {
    const available = p.stock - inCartQty(p.id);
    return `
      <button class="product" data-id="${p.id}" ${available <= 0 ? 'disabled' : ''}>
        <span class="name">${escapeHtml(p.name)}</span>
        <span class="stock ${available <= 5 ? 'low' : ''}">${available <= 0 ? 'Out of stock' : `${available} in stock`}</span>
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
$('#search').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  const q = e.target.value.trim().toLowerCase();
  const match = state.products.find((p) => (p.sku || '').toLowerCase() === q)
    || state.products.filter((p) => p.name.toLowerCase().includes(q)).at(0);
  if (match) {
    addToCart(match.id);
    e.target.value = '';
    renderGrid();
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
    return { productId: p.id, name: p.name, price: p.price, qty: l.qty, total: p.price * l.qty };
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
          <div class="meta">${money(l.price)} each · <button class="link del" data-action="remove" data-id="${l.productId}">remove</button></div>
        </div>
        <div class="qty">
          <button data-action="dec" data-id="${l.productId}" aria-label="Decrease">−</button>
          <span>${l.qty}</span>
          <button data-action="inc" data-id="${l.productId}" aria-label="Increase">+</button>
        </div>
        <strong>${money(l.total)}</strong>
      </li>`).join('')
    : '<li class="empty">Tap a product to add it</li>';

  $('#subtotal').textContent = money(t.subtotal);
  $('#discount').textContent = money(-t.discount);
  $('#tax').textContent = money(t.tax);
  $('#tax-rate-label').textContent = state.settings.taxRate;
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
  };

  for (const line of t.lines) {
    const p = findProduct(line.productId);
    if (p) p.stock = Math.max(0, p.stock - line.qty);
  }
  state.sales.push(sale);
  saveState();
  resetSale();
  showReceipt(sale);
}

// ---------- Receipt ----------
const receiptDialog = $('#receipt-dialog');

function showReceipt(sale) {
  const row = (l, r, cls = '') => `<div class="row ${cls}"><span>${l}</span><span>${r}</span></div>`;
  $('#receipt').innerHTML = `
    <h3>${escapeHtml(state.settings.storeName)}</h3>
    <div class="center">Receipt #${sale.id}<br>${new Date(sale.date).toLocaleString()}</div>
    <hr>
    ${sale.items.map((l) => row(`${l.qty} × ${escapeHtml(l.name)}`, money(l.total))).join('')}
    <hr>
    ${row('Subtotal', money(sale.subtotal))}
    ${sale.discount ? row('Discount', money(-sale.discount)) : ''}
    ${row(`Tax (${sale.taxRate}%)`, money(sale.tax))}
    ${row('TOTAL', money(sale.total), 'bold')}
    <hr>
    ${row(`Paid (${sale.method})`, money(sale.tendered))}
    ${sale.method === 'cash' ? row('Change', money(sale.change)) : ''}
    <hr>
    <div class="center">Thank you!</div>`;
  receiptDialog.showModal();
}

$('#print-receipt').addEventListener('click', () => window.print());
$('#close-receipt').addEventListener('click', () => receiptDialog.close());

// ---------- Products ----------
function renderProducts() {
  $('#category-list').innerHTML = categories().map((c) => `<option value="${escapeHtml(c)}">`).join('');
  const rows = [...state.products].sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
  $('#product-table').innerHTML = rows.length
    ? rows.map((p) => `
      <tr>
        <td>${escapeHtml(p.name)}</td>
        <td>${escapeHtml(p.sku)}</td>
        <td>${escapeHtml(p.category)}</td>
        <td class="num">${money(p.price)}</td>
        <td class="num">${p.stock}</td>
        <td class="num">
          <button class="link" data-edit="${p.id}">Edit</button>
          <button class="link del" data-delete="${p.id}">Delete</button>
        </td>
      </tr>`).join('')
    : '<tr><td colspan="6" class="empty">No products yet</td></tr>';
}

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
    $('#p-id').value = p.id;
    $('#p-name').value = p.name;
    $('#p-sku').value = p.sku || '';
    $('#p-category').value = p.category;
    $('#p-price').value = (p.price / 100).toFixed(2);
    $('#p-stock').value = p.stock;
    $('#p-submit').textContent = 'Save Changes';
    $('#p-name').focus();
  }
  if (deleteId) {
    const p = findProduct(deleteId);
    if (!confirm(`Delete "${p.name}"?`)) return;
    state.products = state.products.filter((x) => x.id !== deleteId);
    cart = cart.filter((l) => l.productId !== deleteId);
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
  if (sku && state.products.some((p) => p.sku === sku && p.id !== id)) {
    toast(`SKU ${sku} is already in use`);
    return;
  }
  const data = {
    name: $('#p-name').value.trim(),
    sku,
    category: $('#p-category').value.trim(),
    price: toCents($('#p-price').value),
    stock: Math.max(0, parseInt($('#p-stock').value, 10) || 0),
  };
  if (id) {
    Object.assign(findProduct(id), data);
    toast('Product updated');
  } else {
    state.products.push({ id: uid(), ...data });
    toast('Product added');
  }
  saveState();
  resetProductForm();
  renderProducts();
});

// ---------- Sales ----------
function renderSales() {
  const today = new Date().toDateString();
  const todays = state.sales.filter((s) => new Date(s.date).toDateString() === today);
  const sum = (arr, k) => arr.reduce((s, x) => s + x[k], 0);
  const todayTotal = sum(todays, 'total');

  const stats = [
    ['Sales today', todays.length],
    ['Revenue today', money(todayTotal)],
    ['Avg. ticket today', money(todays.length ? Math.round(todayTotal / todays.length) : 0)],
    ['All-time revenue', money(sum(state.sales, 'total'))],
  ];
  $('#sales-stats').innerHTML = stats
    .map(([label, value]) => `<div class="stat"><div class="label">${label}</div><div class="value">${value}</div></div>`)
    .join('');

  const rows = [...state.sales].reverse();
  $('#sales-table').innerHTML = rows.length
    ? rows.map((s) => `
      <tr>
        <td>#${s.id}</td>
        <td>${new Date(s.date).toLocaleString()}</td>
        <td class="num">${s.items.reduce((n, l) => n + l.qty, 0)}</td>
        <td>${s.method}</td>
        <td class="num">${money(s.total)}</td>
        <td class="num"><button class="link" data-receipt="${s.id}">Receipt</button></td>
      </tr>`).join('')
    : '<tr><td colspan="6" class="empty">No sales yet</td></tr>';
}

$('#sales-table').addEventListener('click', (e) => {
  const id = Number(e.target.dataset.receipt);
  const sale = id && state.sales.find((s) => s.id === id);
  if (sale) showReceipt(sale);
});

// ---------- Settings ----------
function renderSettings() {
  $('#s-store').value = state.settings.storeName;
  $('#s-tax').value = state.settings.taxRate;
  $('#s-currency').value = state.settings.currency;
}

$('#settings-form').addEventListener('submit', (e) => {
  e.preventDefault();
  state.settings = {
    storeName: $('#s-store').value.trim() || 'My Store',
    taxRate: Math.max(0, parseFloat($('#s-tax').value) || 0),
    currency: $('#s-currency').value.trim() || '$',
  };
  saveState();
  document.title = `${state.settings.storeName} · POS`;
  $('.topbar h1').textContent = state.settings.storeName;
  toast('Settings saved');
});

$('#export-data').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `pos-data-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
});

$('#reset-data').addEventListener('click', () => {
  if (!confirm('This deletes all products, sales and settings. Continue?')) return;
  localStorage.removeItem(STORAGE_KEY);
  location.reload();
});

// ---------- Init ----------
document.title = `${state.settings.storeName} · POS`;
$('.topbar h1').textContent = state.settings.storeName;
renderRegister();
