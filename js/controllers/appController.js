import { apiMock, validators } from "../models/apiModel.js";
import {
  clientLocation,
  companyContact,
  clientOrderExamples,
  clientPaymentMethods,
  clientProducts,
  genericRows,
  inventoryProducts,
  moduleConfig,
  orders,
  publicContent,
  sales,
} from "../models/appModel.js";
import { formatCOP, normalizeCOPAmount } from "../models/storageModel.js";
import { $, $$, escapeHtml, icon, publicFooterTemplate } from "../views/domView.js";
import { operationsModel } from "../models/operationsModel.js";
import { createInvoicePdf, createInvoiceXlsx } from "../models/documentModel.js";
import {
  incidentsTemplate,
  materialsTemplate,
  pricesTemplate,
  scrapsTemplate,
  scrapSuggestionCards,
} from "../views/operationsView.js";

let currentUser = null;
let pendingAuthEmail = sessionStorage.getItem("yesmau_pending_email") || "";
let pendingClientSearch = "";
let salesReportPeriod = "month";

const isAdminRole = () => ["Administrador", "Administradora"].includes(currentUser?.role);
const isEmployeeRole = () => currentUser?.role === "Empleado";
const isClientRole = () => currentUser?.role === "Cliente";
const employeeViews = ["dashboard", "tienda", "ventas", "telas", "retazos", "incidencias"];
const hasPermission = permission => isAdminRole() || apiMock.getCurrentPermissions().includes(permission);
const permissionLabel = permission => permission === "agregar_articulos_tienda"
  ? "Agregar artículos a la tienda"
  : permission.replaceAll("_", " ");
const clientStorageKeyFor = (name, userId) => `yesmau_client_${name}_${userId || "guest"}`;
const clientStorageKey = name => clientStorageKeyFor(name, currentUser?.id);
const PUBLIC_CONTENT_KEY = "yesmau_public_content";
const PUBLIC_IMAGE_FALLBACK = "/assets/yesmau-login-textiles.jpg";
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
let pendingContentImages = {};
let pendingStoreImage = null;
let storeImageValidationPending = false;
let scrapPageState = { page: 1, pageSize: 25, filters: {} };
let scrapChatState = { scrapId: "", messages: [], context: {} };

const escapeAttribute = value => escapeHtml(value).replaceAll('"', "&quot;").replaceAll("'", "&#39;");

function managedImageSource(slot) {
  const source = publicContent.images?.[slot]?.dataUrl;
  return /^data:image\/(?:png|jpeg|webp);base64,/i.test(source || "") ? source : PUBLIC_IMAGE_FALLBACK;
}

function safeProductImageSource(source) {
  const value = String(source || "");
  return /^data:image\/(?:png|jpeg|webp);base64,/i.test(value)
    || /^https:\/\/images\.unsplash\.com\//i.test(value)
    || /^\/assets\/[a-z0-9._/-]+$/i.test(value)
    ? value
    : PUBLIC_IMAGE_FALLBACK;
}

function sanitizeManagedText(value, label, maxLength) {
  const text = String(value || "").replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim();
  if (!text) throw new Error(`${label} es obligatorio.`);
  if (/[<>]/.test(text)) throw new Error(`${label} contiene caracteres no permitidos.`);
  if (text.length > maxLength) throw new Error(`${label} supera el límite de ${maxLength} caracteres.`);
  return text;
}

function formatFileSize(bytes) {
  return bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function loadClientData(name, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(clientStorageKey(name)) || "null");
    return value ?? fallback;
  } catch {
    return fallback;
  }
}

function saveClientData(name, value) {
  localStorage.setItem(clientStorageKey(name), JSON.stringify(value));
}

const stockStatus = stock => stock === 0 ? "Agotado" : stock <= 6 ? "Stock bajo" : "Disponible";

function linkedProducts(identifier) {
  let catalog = clientProducts.find(product => product.id === identifier)
    || clientProducts.find(product => product.name === identifier);
  const inventory = inventoryProducts.find(product => product.sku === identifier)
    || inventoryProducts.find(product => product.name === catalog?.name)
    || inventoryProducts.find(product => product.name === identifier);
  if (!catalog && inventory) catalog = clientProducts.find(product => product.name === inventory.name);
  return { catalog, inventory };
}

function persistProductCollections() {
  localStorage.setItem("yesmau_client_products", JSON.stringify(clientProducts));
  localStorage.setItem("yesmau_inventory_products", JSON.stringify(inventoryProducts));
}

function setLinkedStock(identifier, stock) {
  const nextStock = Math.max(0, Number(stock) || 0);
  const { catalog, inventory } = linkedProducts(identifier);
  if (catalog) catalog.stock = nextStock;
  if (inventory) {
    inventory.stock = nextStock;
    inventory.status = stockStatus(nextStock);
  }
}

function reconcileProductCollections() {
  let changed = false;
  clientProducts.forEach(product => {
    let inventory = inventoryProducts.find(item => item.sku === product.id || item.name === product.name);
    if (!inventory) {
      inventory = {
        sku: product.id,
        name: product.name,
        category: product.category,
        articleType: product.articleType || (product.unit ? "Tela" : "Prenda"),
        type: product.type || product.category,
        characteristics: product.description,
        size: product.size,
        color: product.color,
        supplier: product.supplier,
        stock: product.stock,
        price: product.price,
        status: stockStatus(product.stock),
      };
      inventoryProducts.push(inventory);
      changed = true;
    } else if (product.stock !== inventory.stock || product.price !== inventory.price) {
      product.stock = inventory.stock;
      product.price = inventory.price;
      changed = true;
    }
  });
  if (changed) persistProductCollections();
}

const getClientCart = () => loadClientData("cart", {});
const getClientFavorites = () => loadClientData("favorites", []);
const getClientOrders = () => localStorage.getItem(clientStorageKey("orders")) === null
  ? clientOrderExamples
  : loadClientData("orders", []);

function adminOrderFromClient(order, user = currentUser) {
  return {
    id: order.id,
    client: user?.name || "Cliente",
    email: user?.email || "",
    product: Array.isArray(order.items) ? order.items.map(item => `${item.quantity} × ${item.name}`).join(", ") : "Sin detalle",
    total: formatCOP(order.total),
    status: order.status,
    type: statusClass(order.status),
    initials: String(user?.name || "Cliente").split(/\s+/).map(part => part[0]).slice(0, 2).join("").toUpperCase(),
    clientUserId: user?.id,
    clientOrderId: order.id,
    paymentMethod: order.paymentMethod,
    createdAt: order.createdAt || new Date().toISOString(),
  };
}

function reconcileCurrentClientOrders() {
  if (!isClientRole() || localStorage.getItem(clientStorageKey("orders")) === null) return;
  const missing = loadClientData("orders", []).filter(order => !orders.some(item => item.id === order.id));
  if (!missing.length) return;
  orders.unshift(...missing.map(order => adminOrderFromClient(order)));
  localStorage.setItem("yesmau_orders", JSON.stringify(orders));
  localStorage.setItem("yesmau_new_orders", String(Number(localStorage.getItem("yesmau_new_orders") || 0) + missing.length));
}

function cartDetails() {
  const cart = getClientCart();
  const items = Object.entries(cart).map(([id, quantity]) => {
    const product = clientProducts.find(item => item.id === id);
    return product ? { ...product, quantity, subtotal: product.price * quantity } : null;
  }).filter(Boolean);
  return { items, total: items.reduce((sum, item) => sum + item.subtotal, 0) };
}

function syncClientBadges() {
  const count = cartDetails().items.reduce((sum, item) => sum + item.quantity, 0);
  $(".cart-button span").textContent = String(count);
  $(".cart-button").setAttribute("aria-label", `Carrito de compras, ${count} ${count === 1 ? "artículo" : "artículos"}`);
}

function statusClass(value) {
  if (/en camino/i.test(value)) return "bronze";
  if (/pagada|disponible|activo|recibida|resuelta|enviado/i.test(value)) return "success";
  if (/crítico|agotado|alta|abierta|reembolsada/i.test(value)) return "danger";
  if (/pendiente|bajo|revisión|media/i.test(value)) return "warning";
  return "info";
}

function roleClass(value) {
  if (/administrador/i.test(value)) return "admin";
  if (/cliente/i.test(value)) return "client";
  if (/proveedor/i.test(value)) return "supplier";
  return "employee";
}

function saleDate(value) {
  const text = String(value || "").toLowerCase();
  const now = new Date();
  if (/ahora|hoy/.test(text)) return now;
  if (/ayer/.test(text)) return new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 12);
  const months = { ene: 0, feb: 1, mar: 2, abr: 3, may: 4, jun: 5, jul: 6, ago: 7, sep: 8, oct: 9, nov: 10, dic: 11 };
  const match = text.match(/(\d{1,2})\s+([a-záéíóú]{3})[^0-9]*(\d{4})/i);
  return match ? new Date(Number(match[3]), months[match[2].slice(0, 3)] ?? 0, Number(match[1]), 12) : null;
}

function filteredSales(period) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let start = null;
  let end = new Date(now.getTime() + 1000);
  if (period === "today") start = today;
  if (period === "yesterday") {
    start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
    end = today;
  }
  if (period === "week") start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 7);
  if (period === "month") start = new Date(today.getFullYear(), today.getMonth() - 1, today.getDate());
  if (period === "year") start = new Date(today.getFullYear() - 1, today.getMonth(), today.getDate());
  return sales.filter(record => {
    if (!start) return true;
    const date = saleDate(record[5]);
    return date && date >= start && date < end;
  });
}

function salesReportTemplate() {
  const records = filteredSales(salesReportPeriod);
  const total = records.reduce((sum, record) => sum + normalizeCOPAmount(record[7]), 0);
  const paid = records.filter(record => /pagada|recibida/i.test(record[6])).length;
  const average = records.length ? total / records.length : 0;
  return `<section class="card sales-report-card">
    <div class="card-header sales-report-header"><div><p class="eyebrow">INFORME DE VENTAS</p><h2>Resumen por período</h2><p>Información calculada con las ventas registradas en el sistema.</p></div><label>Período<select id="salesReportPeriod"><option value="today" ${salesReportPeriod === "today" ? "selected" : ""}>Hoy</option><option value="yesterday" ${salesReportPeriod === "yesterday" ? "selected" : ""}>Ayer</option><option value="week" ${salesReportPeriod === "week" ? "selected" : ""}>Última semana</option><option value="month" ${salesReportPeriod === "month" ? "selected" : ""}>Último mes</option><option value="year" ${salesReportPeriod === "year" ? "selected" : ""}>Último año</option><option value="all" ${salesReportPeriod === "all" ? "selected" : ""}>Todo el historial</option></select></label></div>
    <div class="sales-report-metrics"><div><span>Ingresos</span><strong>${formatCOP(total)}</strong></div><div><span>Operaciones</span><strong>${records.length}</strong></div><div><span>Ticket promedio</span><strong>${formatCOP(average)}</strong></div><div><span>Pagadas o recibidas</span><strong>${paid}</strong></div></div>
    <div class="table-scroll"><table><thead><tr><th>FACTURA</th><th>CLIENTE</th><th>DETALLE</th><th>FECHA</th><th>ESTADO</th><th>TOTAL</th></tr></thead><tbody>${records.length ? records.slice(0, 8).map(record => `<tr><td><strong>${escapeHtml(record[0])}</strong></td><td>${escapeHtml(record[1])}</td><td>${escapeHtml(record[2])}</td><td>${escapeHtml(record[5])}</td><td><span class="status ${statusClass(record[6])}">${escapeHtml(record[6])}</span></td><td><strong>${escapeHtml(record[7])}</strong></td></tr>`).join("") : `<tr><td colspan="6" class="empty-search">No hay ventas registradas en este período.</td></tr>`}</tbody></table></div>
  </section>`;
}

function systemActivityTemplate() {
  const logs = apiMock.getLogs().slice(0, 10);
  return `<section class="card table-card system-activity-card">
    <div class="card-header"><div><p class="eyebrow">TRAZABILIDAD COMPARTIDA</p><h2>Actividad del sistema</h2><p>Acciones recientes realizadas por clientes, empleados y administración.</p></div><span class="activity-count">${logs.length} recientes</span></div>
    <div class="table-scroll"><table><thead><tr><th>FECHA</th><th>ACCIÓN</th><th>USUARIO</th><th>DETALLE</th><th>RESULTADO</th></tr></thead><tbody>${logs.length
      ? logs.map(log => `<tr><td>${escapeHtml(new Date(log.timestamp).toLocaleString("es-CO"))}</td><td><strong>${escapeHtml(String(log.action || "").replaceAll("_", " "))}</strong></td><td>${escapeHtml(log.email || "Sin usuario")}</td><td>${escapeHtml(log.detail || "Sin detalle")}</td><td><span class="status ${log.result === "ÉXITO" ? "success" : "danger"}">${escapeHtml(log.result)}</span></td></tr>`).join("")
      : `<tr><td colspan="5" class="empty-search">Aún no hay actividad registrada.</td></tr>`}</tbody></table></div>
  </section>`;
}

function dashboardTemplate() {
  return `
    <div class="page-heading">
      <div><p class="eyebrow">MIÉRCOLES, 18 DE JUNIO</p><h1>Buenos días, ${currentUser?.name?.split(" ")[0] || "Elena"}</h1><p>Esto es lo que está sucediendo hoy en tu atelier.</p></div>
      <button class="button button-primary" data-modal="sale">${icon("plus")} Registrar venta</button>
    </div>
    <section class="atelier-banner">
      <div><p class="eyebrow">CONTROL DE PRODUCCIÓN</p><h2>De la fibra a la prenda,<br>todo bajo control.</h2><p>Inventario, trazabilidad y ventas conectados en una sola experiencia.</p><button class="button button-light" data-view-link="telas">Explorar materiales ${icon("arrow")}</button></div>
      <span>Fotografía: Vitaly Gariev / Unsplash</span>
    </section>
    <div class="metric-grid">
      ${metric("Ventas del mes", "$18.420.000 COP", "chart", "↑ 12,5%", "vs. mes anterior")}
      ${metric("Pedidos activos", "38", "box", "↑ 8,2%", "6 nuevos hoy")}
      ${metric("Prendas en producción", "24", "shirt", "14 listas", "esta semana")}
      ${metric("Stock crítico", "7", "alert", "↓ 3 referencias", "requieren compra", true)}
    </div>
    ${salesReportTemplate()}
    ${systemActivityTemplate()}
    <div class="dashboard-grid">
      <section class="card">
        <div class="card-header">
          <div><h2>Rendimiento de ventas</h2><p>Ingresos netos de los últimos 7 días</p></div>
          <div class="period-tabs" id="periodTabs"><button>Mes</button><button class="active">Semana</button><button>Año</button></div>
        </div>
        <div class="chart-wrap">
          <svg viewBox="0 0 700 210" preserveAspectRatio="none" aria-label="Gráfico de ventas">
            <g class="chart-grid"><line x1="28" y1="20" x2="690" y2="20"/><line x1="28" y1="73" x2="690" y2="73"/><line x1="28" y1="126" x2="690" y2="126"/><line x1="28" y1="179" x2="690" y2="179"/></g>
            <defs><linearGradient id="area" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#24545A" stop-opacity=".25"/><stop offset="1" stop-color="#24545A" stop-opacity="0"/></linearGradient></defs>
            <path id="chartArea" d="M28 160 C90 143 120 155 174 117 S265 142 330 93 S430 119 492 65 S594 99 690 38 L690 190 L28 190 Z" fill="url(#area)" stroke="none"/>
            <path id="chartLine" d="M28 160 C90 143 120 155 174 117 S265 142 330 93 S430 119 492 65 S594 99 690 38" fill="none" stroke="#24545A" stroke-width="3"/>
            <circle cx="492" cy="65" r="5" fill="#fff" stroke="#B6533C" stroke-width="3"/>
          </svg>
          <div class="chart-tooltip">Viernes<strong>$3.240.000 COP</strong></div>
        </div>
        <div class="chart-labels"><span>Lun 12</span><span>Mar 13</span><span>Mié 14</span><span>Jue 15</span><span>Vie 16</span><span>Sáb 17</span><span>Dom 18</span></div>
      </section>
      <section class="card production-card">
        <div class="card-header"><div><h2>En producción</h2><p>Avance de órdenes activas</p></div><button class="text-button" data-view-link="pedidos">Ver todo</button></div>
        <div class="production-list">
          ${production("#1048 · Vestido Aura", "Corte y preparación", "68%", "Entrega 20 jun", 68, "shirt", "")}
          ${production("#1044 · Blazer Siena", "Confección", "45%", "Entrega 22 jun", 45, "scissors", "terra")}
          ${production("#1041 · Pantalón Alba", "Control de calidad", "92%", "Entrega mañana", 92, "sparkle", "sand")}
        </div>
        <div class="production-footer"><button class="text-button" data-view-link="pedidos">Gestionar producción ${icon("arrow")}</button></div>
      </section>
    </div>
    <div class="lower-grid">
      <section class="card table-card">
        <div class="card-header"><div><h2>Pedidos recientes</h2><p>Últimas operaciones registradas</p></div><div class="table-tools"><select class="select-control" id="orderFilter"><option value="all">Todos los estados</option><option>Pendiente</option><option>Pago recibido</option><option>En producción</option><option>Enviado</option><option>Entregado</option></select><button class="text-button" data-view-link="pedidos">Ver todos</button></div></div>
        <div class="table-scroll"><table><thead><tr><th>PEDIDO</th><th>CLIENTE</th><th>ARTÍCULO</th><th>ESTADO</th><th>TOTAL</th><th>ACCIÓN</th></tr></thead><tbody id="ordersBody">${ordersRows(orders)}</tbody></table></div>
      </section>
      <aside class="card quick-card">
        <p class="eyebrow">HERRAMIENTAS</p><h2>Acciones rápidas</h2><p>Optimiza los procesos diarios de tu taller.</p>
        <div class="quick-list">
          ${quick("ruler", "Calcular tela", "Metraje para una prenda", "fabric")}
          ${quickLink("receipt", "Precio de prendas", "Costos, margen y fórmula", "precios")}
          ${quickLink("sparkle", "Gestionar retazos", "Registro y sugerencias con IA", "retazos")}
          ${isAdminRole() ? quickLink("image", "Contenido web", "Imágenes, títulos y subtítulos", "contenido") : ""}
        </div>
      </aside>
    </div>`;
}

function employeeDashboardTemplate() {
  const canPublish = hasPermission("agregar_articulos_tienda");
  return `
    <div class="page-heading">
      <div><p class="eyebrow">PERFIL DE EMPLEADO</p><h1>Hola, ${escapeHtml(currentUser?.firstName || "Empleado")}</h1><p>Gestiona las tareas habilitadas por Administración.</p></div>
      ${canPublish ? `<button class="button button-primary" data-view-link="tienda">${icon("plus")} Agregar artículo</button>` : ""}
    </div>
    <section class="atelier-banner employee-banner">
      <div><p class="eyebrow">ESPACIO DE TRABAJO</p><h2>Operación clara,<br>producción responsable.</h2><p>Consulta la tienda y transforma sobrantes textiles en nuevas oportunidades con Retazos inteligentes.</p><button class="button button-light" data-view-link="retazos">Abrir Retazos inteligentes ${icon("arrow")}</button></div>
    </section>
    <div class="metric-grid client-metrics">
      ${metric("Rol", "Empleado", "users", "Cuenta activa", "acceso operativo")}
      ${metric("Tienda", String(clientProducts.length), "shirt", "Artículos", "publicados")}
      ${metric("Retazos inteligentes", "Habilitado", "sparkle", "YESMAU IA", "disponible")}
      ${metric("Publicación", canPublish ? "Habilitada" : "Restringida", canPublish ? "plus" : "alert", canPublish ? "Permiso concedido" : "Requiere permiso", "por Administración")}
    </div>`;
}

function clientProductCards(products = clientProducts, { showCategory = true } = {}) {
  const favorites = getClientFavorites();
  return products.map(product => {
    const favorite = favorites.includes(product.id);
    return `<article class="client-product card" data-product-card data-search="${escapeAttribute(`${product.name} ${product.category} ${product.description}`.toLowerCase())}" data-category="${escapeAttribute(product.category)}">
      <div class="client-product-image">
        <img src="${escapeAttribute(safeProductImageSource(product.image))}" alt="${escapeHtml(product.name)}" loading="lazy">
        ${product.stock > 0 ? "" : `<span class="product-stock-badge">Agotado</span>`}
        <button class="favorite-toggle ${favorite ? "active" : ""}" data-favorite="${escapeAttribute(product.id)}" aria-pressed="${favorite}" aria-label="${favorite ? "Quitar" : "Agregar"} ${escapeAttribute(product.name)} ${favorite ? "de" : "a"} favoritos">${icon("heart")}</button>
      </div>
      <div class="client-product-copy">
        ${showCategory ? `<span>${escapeHtml(product.category.toUpperCase())}</span>` : ""}
        <h3>${escapeHtml(product.name)}</h3>
        <p class="product-description">${escapeHtml(product.description)}</p>
        <div class="product-purchase"><strong>${formatCOP(product.price)}${product.unit ? ` / ${escapeHtml(product.unit)}` : ""}</strong><button class="button button-primary" data-add-cart="${escapeAttribute(product.id)}" ${product.stock > 0 ? "" : "disabled"}>${product.stock > 0 ? `${icon("cart")} Agregar` : "Agotado"}</button></div>
      </div>
    </article>`;
  }).join("");
}

function clientProductSections(products = clientProducts) {
  const groups = products.reduce((result, product) => {
    const category = product.category || "Otros";
    if (!result[category]) result[category] = [];
    result[category].push(product);
    return result;
  }, {});
  return Object.entries(groups).map(([category, items]) => `
    <section class="catalog-category" data-product-section>
      <div class="catalog-category-heading"><div><p class="eyebrow">SECCIÓN</p><h2>${escapeHtml(category)}</h2></div><span>${items.length} ${items.length === 1 ? "artículo" : "artículos"}</span></div>
      <div class="client-product-grid">${clientProductCards(items)}</div>
    </section>`).join("");
}

function contentImageCard(slot, title, description) {
  const image = publicContent.images?.[slot];
  return `
    <article class="card content-image-card" data-content-image-card="${slot}">
      <div class="content-image-preview">
        <img src="${escapeAttribute(managedImageSource(slot))}" alt="Vista previa de ${escapeAttribute(title)}" data-content-preview="${slot}">
        <span>${image ? "Imagen personalizada" : "Imagen predeterminada"}</span>
      </div>
      <div class="content-image-copy">
        <p class="eyebrow">IMAGEN DE SECCIÓN</p>
        <h2>${escapeHtml(title)}</h2>
        <p>${escapeHtml(description)}</p>
        <small data-content-file-info="${slot}">${image ? `${escapeHtml(image.name)} · ${formatFileSize(image.size)}` : "Sin archivo personalizado asignado"}</small>
        <div class="content-image-actions">
          <label class="button button-secondary content-file-button">
            ${icon("image")} ${image ? "Reemplazar imagen" : "Subir imagen"}
            <input type="file" accept=".webp,.png,.jpg,.jpeg,image/webp,image/png,image/jpeg" data-content-image="${slot}">
          </label>
          <button class="text-button danger-text" type="button" data-remove-content-image="${slot}" ${image ? "" : "hidden"}>Eliminar imagen</button>
        </div>
        <p class="content-file-help">WEBP, PNG o JPG · máximo 2 MB.</p>
      </div>
    </article>`;
}

function contentManagerTemplate() {
  const textSections = [
    ["Portada", "heroTitle", "heroSubtitle"],
    ["Colección destacada", "collectionTitle", "collectionSubtitle"],
    ["Proceso", "processTitle", "processSubtitle"],
    ["Nosotros", "aboutTitle", "aboutSubtitle"],
    ["Llamado final", "ctaTitle", "ctaSubtitle"],
  ];
  return `
    <section class="card module-hero">
      <div><p class="eyebrow">EXPERIENCIA DIGITAL</p><h1>Contenido web</h1><p>Administra las imágenes y los mensajes principales de la página pública de YESMAU.</p></div>
      <span class="hero-icon">${icon("image")}</span>
    </section>
    <div class="page-heading">
      <div><p class="eyebrow">GESTIÓN DE IMÁGENES</p><h2>Recursos visuales</h2><p>Los cambios se almacenan localmente y reemplazan automáticamente la versión anterior.</p></div>
    </div>
    <section class="content-image-grid">
      ${contentImageCard("hero", "Portada principal", "Imagen que acompaña el mensaje inicial de la tienda pública.")}
      ${contentImageCard("process", "Proceso de confección", "Imagen de apoyo para explicar el recorrido del material hasta la entrega.")}
    </section>
    <section class="card content-text-card">
      <div class="card-header"><div><p class="eyebrow">GESTIÓN DE TEXTOS</p><h2>Títulos y subtítulos</h2><p>Edita los mensajes de cada sección. No se admite código HTML.</p></div></div>
      <form id="contentManagerForm" class="content-text-form" novalidate>
        ${textSections.map(([section, titleName, subtitleName]) => `
          <fieldset>
            <legend>${escapeHtml(section)}</legend>
            <div class="field">
              <label for="${titleName}">Título principal</label>
              <input id="${titleName}" name="${titleName}" value="${escapeAttribute(publicContent[titleName])}" maxlength="90" required>
              <small>Máximo 90 caracteres.</small>
            </div>
            <div class="field">
              <label for="${subtitleName}">Subtítulo</label>
              <textarea id="${subtitleName}" name="${subtitleName}" maxlength="240" required>${escapeHtml(publicContent[subtitleName])}</textarea>
              <small>Máximo 240 caracteres.</small>
            </div>
          </fieldset>`).join("")}
        <div class="content-save-bar">
          <p>${icon("alert")} Los textos se sanitizan antes de guardarse para evitar código o contenido excesivo.</p>
          <button class="button button-primary" type="submit">Guardar contenido</button>
        </div>
      </form>
    </section>`;
}

/*Vista Principal*/
function publicStoreTemplate() {
  return `
    <div class="public-store">
      <header class="public-nav">
        <button class="public-brand" type="button" data-public-home aria-label="Inicio de YESMAU"><img src="/assets/yesmau-logo.png" alt=""><span><strong>YESMAU</strong><small>ROPA CASUAL</small></span></button>
        <nav aria-label="Navegación de tienda"><a href="#publicCollection">Colección</a><a href="#publicServices">Lo que ofrecemos</a><a href="#publicProcess">Nuestro proceso</a><a href="#publicAbout">Nosotros</a></nav>
        <div><button class="icon-button" data-theme-toggle aria-label="Cambiar tema"><svg><use href="#i-moon"></use></svg></button><button class="button button-secondary" data-auth-view="login">Ingresar</button><button class="button button-primary" data-auth-view="register">Crear cuenta</button></div>
      </header>
      <main class="public-main">
        <section class="public-hero">
          <div class="public-hero-copy"><p class="eyebrow">MODA CASUAL · PRODUCCIÓN CONSCIENTE</p><h1>${escapeHtml(publicContent.heroTitle)}</h1><p>${escapeHtml(publicContent.heroSubtitle)}</p><div class="public-hero-actions"><a class="button button-primary" href="#publicCollection">Ver colección ${icon("arrow")}</a><button class="button button-ghost" data-auth-view="register">Crear mi cuenta</button></div><div class="public-trust"><span><strong>Envíos seguros</strong><small>Seguimiento de tu pedido</small></span><span><strong>Compra protegida</strong><small>Pagos y datos seguros</small></span><span><strong>Diseño local</strong><small>Hecho con intención</small></span></div></div>
          <div class="public-hero-image"><img src="${escapeAttribute(managedImageSource("hero"))}" alt="Muestras de textiles en diferentes colores"><span>Texturas, color y diseño YESMAU</span></div>
        </section>
        <section class="public-section" id="publicCollection">
          <div class="public-section-heading"><div><p class="eyebrow">COLECCIÓN DESTACADA</p><h2>${escapeHtml(publicContent.collectionTitle)}</h2><p>${escapeHtml(publicContent.collectionSubtitle)}</p></div><button class="text-button" data-auth-view="login">Ver catálogo completo ${icon("arrow")}</button></div>
          <div class="client-product-grid public-products public-featured-grid" aria-label="Tres artículos destacados">${clientProductCards(clientProducts.slice(0, 3), { showCategory: false })}</div>
        </section>
        <section class="public-benefits" id="publicServices">
          <article><span>${icon("shirt")}</span><p class="eyebrow">DISEÑO Y CALIDAD</p><h3>Artículos con identidad</h3><p>Prendas casuales con materiales seleccionados, tallas y colores para diferentes estilos.</p></article>
          <article><span>${icon("box")}</span><p class="eyebrow">TRAZABILIDAD</p><h3>Tu pedido siempre visible</h3><p>Consulta el avance desde la preparación hasta la entrega directamente en tu cuenta.</p></article>
          <article><span>${icon("sparkle")}</span><p class="eyebrow">PRODUCCIÓN CIRCULAR</p><h3>Aprovechamos cada retazo</h3><p>Usamos tecnología para convertir sobrantes textiles en nuevas oportunidades de diseño.</p></article>
        </section>
        <section class="public-process" id="publicProcess">
          <div class="public-process-image"><img src="${escapeAttribute(managedImageSource("process"))}" alt="Proceso de confección YESMAU"><span>${icon("scissors")}</span></div>
          <div><p class="eyebrow">DEL MATERIAL A TUS MANOS</p><h2>${escapeHtml(publicContent.processTitle)}</h2><p>${escapeHtml(publicContent.processSubtitle)}</p><ol><li><b>01</b><span><strong>Selecciona tu artículo</strong><small>Explora diseños, tallas y colores disponibles.</small></span></li><li><b>02</b><span><strong>Compra de forma segura</strong><small>Tu información y pago permanecen protegidos.</small></span></li><li><b>03</b><span><strong>Sigue tu pedido</strong><small>Recibe novedades hasta la entrega.</small></span></li></ol></div>
        </section>
        <section class="public-about" id="publicAbout">
          <div class="public-about-intro">
            <div>
              <p class="eyebrow">NUESTRA HISTORIA</p>
              <h2>${escapeHtml(publicContent.aboutTitle)}</h2>
              <p>${escapeHtml(publicContent.aboutSubtitle)}</p>
            </div>
            <div class="public-about-copy">
              <p>Somos una empresa familiar del sector textil con una trayectoria que se remonta aproximadamente al año 2000. Nacimos como un pequeño taller de confección dedicado inicialmente a trabajar para terceros y, gracias al esfuerzo, compromiso y dedicación de cinco hermanas, fuimos construyendo poco a poco nuestra propia cartera de clientes.</p>
              <p>Con el paso de los años, ampliamos nuestra actividad y comenzamos a distribuir nuestras prendas a pequeñas empresas y establecimientos comerciales ubicados en el centro de la ciudad. Nuestra experiencia se ha construido a través del trabajo conjunto y la especialización de cada integrante en las diferentes etapas del proceso de confección, desde la elaboración de moldes y corte de telas hasta la confección y los acabados de cada prenda.</p>
              <p>Nos especializamos principalmente en la confección de prendas para dama, como blusas de estilo señorial, secretarial y ejecutivo, además de faldas, vestidos y pantalones. También contamos con una línea de camisas casuales para caballero.</p>
              <p>Hoy continuamos trabajando con el propósito de crecer, fortalecer nuestros procesos y ampliar nuestra capacidad de producción, manteniendo como base la experiencia, la calidad, el compromiso y el espíritu familiar que han acompañado nuestra empresa desde sus inicios.</p>
            </div>
          </div>
          <div class="public-purpose-grid">
            <article>
              <span>01</span>
              <p class="eyebrow">NUESTRO PRESENTE</p>
              <h3>Misión</h3>
              <p>Confeccionar y comercializar prendas de vestir para dama y caballero, ofreciendo productos de calidad, con diseños elegantes y funcionales que respondan a las necesidades de nuestros clientes. Trabajamos con compromiso, experiencia y dedicación, fortaleciendo cada día nuestros procesos de producción y manteniendo los valores de una empresa familiar que busca generar relaciones duraderas con sus clientes y contribuir al desarrollo del sector textil de nuestra ciudad.</p>
            </article>
            <article>
              <span>02</span>
              <p class="eyebrow">HACIA EL 2030</p>
              <h3>Visión</h3>
              <p>Para el año 2030, consolidarnos como una empresa textil de tamaño mediano, reconocida en nuestra ciudad por la calidad, elegancia y variedad de nuestras prendas, especialmente en la línea de dama y caballero. Buscamos ampliar nuestra capacidad de producción, fortalecer nuestra presencia en el mercado y establecer relaciones comerciales con un mayor número de empresas y establecimientos, manteniendo nuestra esencia familiar y creciendo de manera sostenible.</p>
            </article>
          </div>
        </section>
        <section class="public-cta"><div><p class="eyebrow">TU ESPACIO YESMAU</p><h2>${escapeHtml(publicContent.ctaTitle)}</h2><p>${escapeHtml(publicContent.ctaSubtitle)}</p></div><div><button class="button button-light" data-auth-view="register">Crear cuenta</button><button class="button button-outline-light" data-auth-view="login">Ya tengo cuenta</button></div></section>
      </main>
      <footer class="app-footer client-app-footer">${publicFooterTemplate(companyContact, clientLocation, new Date().getFullYear())}</footer>
    </div>`;
}

function openPublicFooterInfo(topic) {
  const information = {
    faq: {
      kicker: "CENTRO DE AYUDA",
      title: "Preguntas frecuentes",
      content: `<h3>¿Cómo puedo comprar?</h3><p>Explora la colección, crea tu cuenta y agrega los artículos al carrito.</p><h3>¿Dónde consulto un pedido?</h3><p>Después de ingresar, abre la sección “Mis pedidos” para revisar su estado y seguimiento.</p><h3>¿Cómo guardo un artículo?</h3><p>Inicia sesión y usa el botón de favoritos disponible en cada producto.</p>`,
    },
    contact: {
      kicker: "CONTACTO",
      title: "Habla con YESMAU",
      content: `<p><strong>Correo:</strong> ${escapeHtml(companyContact.email)}</p><p><strong>Teléfono:</strong> ${escapeHtml(companyContact.phone)}</p><p>Los canales oficiales deben configurarse en <code>companyContact</code> antes de publicarse.</p>`,
    },
    glossary: {
      kicker: "GUÍA RÁPIDA",
      title: "Glosario textil",
      content: `<h3>Trazabilidad</h3><p>Seguimiento del artículo desde sus materiales hasta la entrega.</p><h3>Retazo</h3><p>Fragmento de tela restante que puede aprovecharse en una nueva pieza.</p><h3>Metraje</h3><p>Cantidad de tela expresada en metros necesaria para fabricar un artículo.</p>`,
    },
    social: {
      kicker: "COMUNIDAD",
      title: "Redes sociales",
      content: `<p>YESMAU aún no tiene perfiles sociales oficiales configurados en el software.</p><p>Agrega la URL verificada en <code>companyContact.socialUrl</code> para habilitar el acceso directo.</p>`,
    },
    complaints: {
      kicker: "ATENCIÓN AL CLIENTE",
      title: "Quejas o reclamos",
      content: `<p>El canal oficial de solicitudes, quejas o reclamos está pendiente de configuración.</p><p>Agrega el destino verificado en <code>companyContact.complaintsUrl</code>.</p>`,
    },
    location: {
      kicker: "UBICACIÓN",
      title: "Taller y tienda YESMAU",
      content: `<p>${escapeHtml(clientLocation.address)}</p><p>Configura la dirección y la URL de navegación en <code>clientLocation</code> para habilitar el mapa.</p>`,
    },
    privacy: {
      kicker: "INFORMACIÓN LEGAL",
      title: "Privacidad",
      content: `<p>La política de privacidad oficial está pendiente de publicación.</p><p>Configura su URL verificada en <code>companyContact.privacyUrl</code>.</p>`,
    },
    terms: {
      kicker: "INFORMACIÓN LEGAL",
      title: "Términos y condiciones",
      content: `<p>Los términos y condiciones oficiales están pendientes de publicación.</p><p>Configura su URL verificada en <code>companyContact.termsUrl</code>.</p>`,
    },
  };
  const item = information[topic];
  if (!item) return;
  $("#modalContent").innerHTML = `<p class="eyebrow">${item.kicker}</p><h2 id="modalTitle">${item.title}</h2><div class="footer-info-content">${item.content}</div><div class="modal-actions"><button type="button" class="button button-primary" data-cancel>Cerrar</button></div>`;
  $("#modalBackdrop").hidden = false;
  document.body.style.overflow = "hidden";
  const closeButton = $("[data-cancel]");
  closeButton.addEventListener("click", closeModal);
  closeButton.focus();
}

function bindPublicStore() {
  $(".public-hero", $("#authRoot"))?.style.setProperty("--public-hero-image", `url("${managedImageSource("hero")}")`);
  $$("[data-public-home]", $("#authRoot")).forEach(button => button.addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" })));
  $$('a[href^="#public"]', $("#authRoot")).forEach(link => link.addEventListener("click", event => {
    const target = $(link.getAttribute("href"), $("#authRoot"));
    if (!target) return;
    event.preventDefault();
    target.scrollIntoView({ behavior: "smooth", block: "start" });
    history.replaceState(null, "", link.getAttribute("href"));
  }));
  $$("[data-auth-view]", $("#authRoot")).forEach(button => button.addEventListener("click", () => showAuth(button.dataset.authView)));
  $$("[data-footer-info]", $("#authRoot")).forEach(button => button.addEventListener("click", () => openPublicFooterInfo(button.dataset.footerInfo)));
  $$("[data-add-cart], [data-favorite]", $("#authRoot")).forEach(button => button.addEventListener("click", () => {
    showToast("Inicia sesión para guardar artículos y comprar");
    setTimeout(() => showAuth("login"), 650);
  }));
  applyTheme(document.documentElement.dataset.theme, false);
}

function showPublicStore() {
  $("#appShell").hidden = true;
  $("#authRoot").hidden = false;
  $("#authRoot").classList.add("public-mode");
  $("#authRoot").innerHTML = publicStoreTemplate();
  $("#whatsappWidget").hidden = !whatsappConfig.number;
  document.body.style.overflow = "";
  bindPublicStore();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function clientTemplate(view) {
  if (view === "client-orders") {
    const orders = getClientOrders();
    return `<div class="page-heading"><div><p class="eyebrow">PORTAL DEL CLIENTE</p><h1>Mis pedidos</h1><p>Consulta estado, fecha, artículos, total y disponibilidad de factura.</p></div></div>
      ${orders.length ? `<div class="client-orders-list">${orders.map(order => `
        <article class="card client-order-card">
          <header><div><span class="status ${statusClass(order.status)}">${escapeHtml(order.status)}</span><h2>Pedido ${escapeHtml(order.id)}</h2><p>${escapeHtml(order.date)}${order.example ? " · Datos de ejemplo" : ""}</p></div><strong>${formatCOP(order.total)}</strong></header>
          <ul class="order-products">${order.items.map(item => `<li><span>${item.quantity} × ${escapeHtml(item.name)}</span><strong>${formatCOP(item.price * item.quantity)}</strong></li>`).join("")}</ul>
          <div class="order-footer"><span>${icon("box")} ${escapeHtml(order.tracking)}</span><button class="button button-secondary" data-client-invoice="${escapeAttribute(order.id)}">${icon("receipt")} Ver factura y descargar</button></div>
          ${order.example ? `<p class="demo-disclaimer">Registro demostrativo. No constituye un pedido ni documento fiscal válido.</p>` : ""}
        </article>`).join("")}</div>` : emptyState("box", "Aún no tienes pedidos", "Cuando completes una compra, podrás seguirla desde aquí.", "Explorar la tienda", "client-shop")}`;
  }
  if (view === "client-favorites") {
    const favoriteProducts = clientProducts.filter(product => getClientFavorites().includes(product.id));
    return `<div class="page-heading"><div><p class="eyebrow">TU SELECCIÓN</p><h1>Favoritos</h1><p>Artículos que guardaste para ver más tarde.</p></div></div>${favoriteProducts.length ? `<div class="client-product-grid">${clientProductCards(favoriteProducts)}</div>` : emptyState("heart", "Tu lista de favoritos está vacía", "Marca el corazón de un artículo para guardarlo aquí.", "Descubrir productos", "client-shop")}`;
  }
  if (view === "client-cart") {
    return clientCartTemplate();
  }
  const featuredCatalog = view === "dashboard";
  const productCategories = [...new Set(clientProducts.map(product => product.category))];
  const categories = ["Todos", ...productCategories.filter(category =>
    !featuredCatalog || clientProducts.filter(product => product.category === category).length >= 3,
  )];
  const favoriteCount = getClientFavorites().length;
  const cartCount = cartDetails().items.reduce((sum, item) => sum + item.quantity, 0);
  return `<section class="client-hero"><div><p class="eyebrow">EXPERIENCIA YESMAU</p><h1>${view === "client-shop" ? "Encuentra algo hecho para ti" : `Hola, ${escapeHtml(currentUser?.firstName || currentUser?.name?.split(" ")[0])}`}</h1><p>Diseño casual, materiales seleccionados y seguimiento de cada pedido en un solo lugar.</p><button class="button button-light" data-view-link="client-shop">Explorar colección ${icon("arrow")}</button></div></section>
    ${view === "dashboard" ? `<div class="metric-grid client-metrics">${metric("Pedidos", String(getClientOrders().length), "box", "Seguimiento", "en un solo lugar")}${metric("Favoritos", String(favoriteCount), "heart", "Tu selección", "guardados")}${metric("Carrito", String(cartCount), "cart", "Compra segura", "sin guardar tarjetas")}</div>` : ""}
    <section class="store-catalog ${featuredCatalog ? "featured-client-catalog" : ""}" aria-labelledby="catalogTitle">
      <div class="section-heading"><div><p class="eyebrow">COLECCIÓN YESMAU</p><h2 id="catalogTitle">${view === "client-shop" ? "Explora el catálogo" : "Elegidos para ti"}</h2></div><span id="clientResultCount">${featuredCatalog ? 3 : clientProducts.length} productos</span></div>
      <div class="client-shop-tools">
        <label class="client-search"><span class="sr-only">Buscar productos</span>${icon("search")}<input id="clientProductSearch" type="search" value="${escapeAttribute(pendingClientSearch)}" placeholder="Buscar por nombre, categoría o descripción…" aria-controls="clientProductGrid"></label>
        <div class="category-filter" role="group" aria-label="Filtrar por categoría">${categories.map((category, index) => `<button type="button" class="${index === 0 ? "active" : ""}" data-client-category="${escapeAttribute(category)}" aria-pressed="${index === 0}">${escapeHtml(category)}</button>`).join("")}</div>
      </div>
      <div class="${featuredCatalog ? "client-product-grid" : "catalog-sections"}" id="clientProductGrid" ${featuredCatalog ? 'data-featured-catalog="true"' : ""}>${featuredCatalog ? clientProductCards() : clientProductSections()}</div>
      <div class="empty-state client-search-empty" id="clientSearchEmpty" hidden>${icon("search")}<h3>Sin resultados</h3><p>Prueba con otra palabra o selecciona una categoría diferente.</p><button class="button button-secondary" id="clearClientFilters">Limpiar filtros</button></div>
    </section>`;
}

function emptyState(iconName, title, description, action, target) {
  return `<section class="card empty-state">${icon(iconName)}<h2>${title}</h2><p>${description}</p>${action ? `<button class="button button-primary" data-view-link="${target}">${action}</button>` : ""}</section>`;
}

function clientCartTemplate() {
  const { items, total } = cartDetails();
  if (!items.length) {
    return `<div class="page-heading"><div><p class="eyebrow">TU COMPRA</p><h1>Carrito</h1><p>Revisa tus artículos antes de continuar.</p></div></div>${emptyState("cart", "Tu carrito está vacío", "Agrega prendas o telas desde el catálogo para comenzar.", "Ir a la tienda", "client-shop")}`;
  }
  return `<div class="page-heading"><div><p class="eyebrow">TU COMPRA</p><h1>Carrito</h1><p>Cambia cantidades o retira artículos antes de confirmar.</p></div></div>
    <div class="client-cart-layout">
      <section class="card cart-items" aria-label="Artículos en el carrito">${items.map(item => `<article class="cart-line">
        <img src="${escapeAttribute(safeProductImageSource(item.image))}" alt="">
        <div><span>${escapeHtml(item.category)}</span><h2>${escapeHtml(item.name)}</h2><p>${formatCOP(item.price)} por ${escapeHtml(item.unit || "unidad")}</p><button class="text-button danger-text" data-cart-remove="${escapeAttribute(item.id)}">Quitar</button></div>
        <div class="quantity-control" aria-label="Cantidad de ${escapeAttribute(item.name)}"><button type="button" data-cart-step="${escapeAttribute(item.id)}" data-step="-1" aria-label="Reducir cantidad">−</button><span aria-live="polite">${item.quantity}</span><button type="button" data-cart-step="${escapeAttribute(item.id)}" data-step="1" aria-label="Aumentar cantidad">+</button></div>
        <strong>${formatCOP(item.subtotal)}</strong>
      </article>`).join("")}</section>
      <aside class="card cart-summary"><p class="eyebrow">RESUMEN</p><h2>Total de la compra</h2><dl><div><dt>Subtotal</dt><dd>${formatCOP(total)}</dd></div><div><dt>Envío</dt><dd>Por confirmar</dd></div><div class="summary-total"><dt>Total</dt><dd>${formatCOP(total)}</dd></div></dl><p>El costo de envío se confirmará según cobertura. No se solicitan ni almacenan datos de tarjetas.</p><button class="button button-primary" id="startCheckout">Continuar al pago ${icon("arrow")}</button></aside>
    </div>`;
}

function metric(label, value, iconName, trend, detail, down = false) {
  return `<article class="metric-card"><div class="metric-head"><span>${label}</span><span class="metric-icon">${icon(iconName)}</span></div><div class="metric-value">${value}</div><div class="trend ${down ? "down" : ""}"><span>${trend}</span><small>${detail}</small></div></article>`;
}
function production(title, stage, percent, date, progress, iconName, variant) {
  return `<div class="production-item"><span class="order-thumb ${variant}">${icon(iconName)}</span><div class="order-copy"><strong>${title}</strong><small>${stage}</small><div class="mini-progress"><span style="width:${progress}%"></span></div></div><div class="production-status"><strong>${percent}</strong><small>${date}</small></div></div>`;
}
function quick(iconName, title, subtitle, modal) {
  return `<button class="quick-action" data-modal="${modal}"><span>${icon(iconName)}</span><div><strong>${title}</strong><small>${subtitle}</small></div>${icon("chevron")}</button>`;
}
function quickLink(iconName, title, subtitle, view) {
  return `<button class="quick-action" data-view-link="${view}"><span>${icon(iconName)}</span><div><strong>${title}</strong><small>${subtitle}</small></div>${icon("chevron")}</button>`;
}
function ordersRows(list) {
  return list.map(order => `<tr data-type="${escapeAttribute(order.type)}"><td><strong>${escapeHtml(order.id)}</strong></td><td><div class="client-cell"><span class="client-avatar">${escapeHtml(order.initials)}</span><span><strong>${escapeHtml(order.client)}</strong><small>${escapeHtml(order.email)}</small></span></div></td><td>${escapeHtml(order.product)}</td><td><span class="status ${escapeAttribute(order.type)}">${escapeHtml(order.status)}</span></td><td><strong>${escapeHtml(order.total)}</strong></td><td><button class="table-action" data-order="${escapeAttribute(order.id)}">Actualizar</button></td></tr>`).join("");
}

async function moduleTemplate(key) {
  const item = moduleConfig[key];
  let rows;
  if (key === "clientes") {
    const users = await apiMock.listUsers();
    rows = users.map((user) => [user.name, user.email, user.role, new Date(user.createdAt).toLocaleDateString("es-CO"), user.status, user.id]);
  } else if (key === "roles") {
    const roles = await apiMock.listRoles();
    rows = roles.map((role) => [role.name, "—", `${role.permissions.length} permisos`, "Hoy", "Activo", role.id]);
  } else {
    rows = key === "pedidos"
      ? orders.map(o => [o.id, o.client, o.product, o.status, o.total])
      : key === "tienda"
        ? clientProducts.map(product => [product.id, product.name, product.articleType || (product.unit ? "Tela" : "Prenda"), product.type || product.category, product.description || "Sin características registradas", formatCOP(product.price), `${product.stock} ${product.unit || "unidades"}`, stockStatus(product.stock)])
      : key === "inventario"
        ? inventoryProducts.map(product => [product.sku, product.name, product.category, formatCOP(product.price), `${product.stock} unidades`, product.status])
        : genericRows[key];
  }
  const statusColumns = { pedidos: 3, tienda: 7, inventario: 5, ventas: 6, compras: 3, telas: 5, retazos: 4, proveedores: 6, incidencias: 4, clientes: 4, roles: 4 };
  const statusOptions = [...new Set(rows.map(row => row[statusColumns[key]]).filter(Boolean))];
  const visibleRows = rows.map((row) => {
    const id = key === "clientes" || key === "roles" ? row.pop() : row[0];
    const action = key === "pedidos"
      ? `<button class="table-action" data-order="${escapeAttribute(id)}">Actualizar</button>`
      : key === "clientes"
        ? `<button class="table-action" data-user="${escapeAttribute(id)}">Editar</button>`
        : key === "roles"
          ? `<button class="table-action" data-role="${escapeAttribute(id)}">Permisos</button>`
          : key === "ventas"
            ? `<button class="table-action" data-invoice="${escapeAttribute(id)}">Ver factura</button>`
            : key === "incidencias"
              ? `<button class="table-action" data-incident="${escapeAttribute(id)}">Actualizar estado</button>`
            : `<button class="table-action" data-record="${escapeAttribute(id)}" data-record-module="${escapeAttribute(key)}">${key === "tienda" ? "Ver detalles" : "Ver detalle"}</button>`;
    return `<tr data-status="${escapeAttribute(String(row[statusColumns[key]] || "").toLowerCase())}">${row.map((cell, index) => {
      const content = index === statusColumns[key]
        ? `<span class="status ${statusClass(cell)}">${escapeHtml(cell)}</span>`
        : key === "clientes" && index === 2
          ? `<span class="role-badge ${roleClass(cell)}">${escapeHtml(cell)}</span>`
          : escapeHtml(cell);
      return `<td>${content}</td>`;
    }).join("")}<td>${action}</td></tr>`;
  }).join("");
  const requiredCreatePermission = key === "tienda"
    ? "agregar_articulos_tienda"
    : key === "ventas"
      ? "registrar_ventas"
      : null;
  const canCreate = !requiredCreatePermission || hasPermission(requiredCreatePermission);
  const permissionNotice = requiredCreatePermission
    ? `Administración debe conceder el permiso “${permissionLabel(requiredCreatePermission)}”.`
    : "";
  return `
    <section class="card module-hero">
      <div><p class="eyebrow">${item.kicker}</p><h1>${item.title}</h1><p>${item.description}</p></div>
      <span class="hero-icon">${icon(item.icon)}</span>
    </section>
    <div class="page-heading">
      <div><p class="eyebrow">PANEL DE CONTROL</p><p>Información actualizada en tiempo real</p></div>
      ${canCreate ? `<button class="button button-primary" data-modal="${key === "ventas" ? "sale" : "generic"}" data-module="${key}">${icon("plus")} ${item.action}</button>` : `<span class="permission-notice">${icon("alert")} ${escapeHtml(permissionNotice)}</span>`}
    </div>
    <div class="module-stats">${(key === "tienda" ? [["Artículos publicados", String(clientProducts.length)], ["Prendas", String(clientProducts.filter(product => !product.unit).length)], ["Telas", String(clientProducts.filter(product => product.unit).length)]] : item.stats).map(stat => `<article class="card compact-stat"><small>${stat[0]}</small><strong>${stat[1]}</strong></article>`).join("")}</div>
    <section class="card table-card">
      <div class="module-table-head"><h2>Todos los registros</h2><div class="module-filters"><input id="moduleSearch" type="search" placeholder="Buscar en este módulo..." aria-label="Buscar en este módulo" /><select id="moduleStatusFilter" class="select-control" aria-label="Filtrar por estado"><option value="">Todos los estados</option>${statusOptions.map(status => `<option>${escapeHtml(status)}</option>`).join("")}</select></div></div>
      <div class="table-scroll"><table id="moduleTable" class="${key === "ventas" ? "sales-table" : ""}"><thead><tr>${item.columns.map(col => `<th>${col.toUpperCase()}</th>`).join("")}<th>ACCIÓN</th></tr></thead><tbody>${visibleRows}</tbody></table></div>
    </section>`;
}

let activeView = "dashboard";
const viewContainer = $("#viewContainer");

function syncNewOrdersBadge(clear = false) {
  if (clear) localStorage.setItem("yesmau_new_orders", "0");
  const count = Number(localStorage.getItem("yesmau_new_orders") || 0);
  const badge = $("#newOrdersBadge");
  if (!badge) return;
  badge.textContent = String(count);
  badge.hidden = count <= 0;
}

function operationsTemplate(view) {
  if (view === "telas") return materialsTemplate(operationsModel.listMaterials());
  if (view === "incidencias" || view === "client-incidents") {
    return incidentsTemplate(operationsModel.listIncidents(currentUser), {
      canManage: !isClientRole(),
      canReport: isClientRole() || isEmployeeRole(),
      isAdmin: isAdminRole(),
      emailConfig: operationsModel.getEmailConfig(),
    });
  }
  if (view === "precios") return pricesTemplate(operationsModel.listGarmentCosts(), inventoryProducts);
  if (view === "retazos") {
    const filters = scrapPageState.filters;
    const allScraps = operationsModel.listScraps();
    const all = allScraps.filter(item => {
      const query = String(filters.query || "").toLowerCase();
      const material = String(filters.material || "").toLowerCase();
      const location = String(filters.location || "").toLowerCase();
      return (!query || item.code.toLowerCase().includes(query))
        && (!filters.fabricId || item.fabricId === filters.fabricId)
        && (!material || item.material.toLowerCase().includes(material))
        && (!filters.minSize || item.sizeMeters >= Number(filters.minSize))
        && (!filters.maxSize || item.sizeMeters <= Number(filters.maxSize))
        && (!location || String(item.location || "").toLowerCase().includes(location))
        && (!filters.date || item.entryDate === filters.date);
    });
    const totalPages = Math.max(1, Math.ceil(all.length / scrapPageState.pageSize));
    scrapPageState.page = Math.min(scrapPageState.page, totalPages);
    const start = (scrapPageState.page - 1) * scrapPageState.pageSize;
    return scrapsTemplate({
      scraps: all.slice(start, start + scrapPageState.pageSize),
      allScraps,
      fabrics: operationsModel.listMaterials().filter(item => item.category === "tela"),
      filters,
      page: scrapPageState.page,
      totalPages,
      total: all.length,
      isAdmin: isAdminRole(),
      aiConfig: operationsModel.getAiConfig(),
      chat: scrapChatState,
    });
  }
  return "";
}

async function imageFileToRecord(file) {
  const extension = file.name.split(".").pop()?.toLowerCase();
  const allowedExtensions = ["webp", "png", "jpg", "jpeg"];
  const allowedTypes = ["image/webp", "image/png", "image/jpeg"];
  if (!allowedExtensions.includes(extension) || !allowedTypes.includes(file.type)) {
    throw new Error("Selecciona una imagen WEBP, PNG o JPG válida.");
  }
  const extensionMatchesType = (extension === "webp" && file.type === "image/webp")
    || (extension === "png" && file.type === "image/png")
    || (["jpg", "jpeg"].includes(extension) && file.type === "image/jpeg");
  if (!extensionMatchesType) throw new Error("La extensión de la imagen no coincide con su formato.");
  if (file.size > MAX_IMAGE_BYTES) {
    throw new Error("La imagen supera el límite de 2 MB.");
  }
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const isPng = bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte);
  const isJpeg = bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  const isWebp = bytes.length >= 12
    && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF"
    && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
  const signatureMatches = (file.type === "image/png" && isPng)
    || (file.type === "image/jpeg" && isJpeg)
    || (file.type === "image/webp" && isWebp);
  if (!signatureMatches) throw new Error("El contenido del archivo no coincide con un formato de imagen permitido.");
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("No se pudo leer la imagen seleccionada."));
    reader.readAsDataURL(file);
  });
  return {
    dataUrl,
    name: file.name.slice(0, 120),
    type: file.type,
    size: file.size,
    updatedAt: new Date().toISOString(),
  };
}

function bindStoreImageUpload() {
  const input = $("#storeImageInput");
  if (!input) return;
  const preview = $("#storeImagePreview");
  const status = $("#storeImageStatus");
  const errorMessage = $("#storeImageError");
  const removeButton = $("#removeStoreImage");
  const submitButton = $('#modalForm button[type="submit"]');
  pendingStoreImage = null;
  storeImageValidationPending = false;

  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    if (!file) return;
    errorMessage.textContent = "";
    storeImageValidationPending = true;
    submitButton.disabled = true;
    status.textContent = "Validando imagen…";
    try {
      pendingStoreImage = await imageFileToRecord(file);
      preview.src = pendingStoreImage.dataUrl;
      status.textContent = `${pendingStoreImage.name} · ${formatFileSize(pendingStoreImage.size)}`;
      $("#storeImageAction").textContent = "Cambiar imagen";
      removeButton.hidden = false;
    } catch (error) {
      pendingStoreImage = null;
      input.value = "";
      preview.src = PUBLIC_IMAGE_FALLBACK;
      status.textContent = "Sin imagen seleccionada";
      errorMessage.textContent = error.message;
      removeButton.hidden = true;
      showToast(error.message, true);
    } finally {
      storeImageValidationPending = false;
      submitButton.disabled = false;
    }
  });

  removeButton.addEventListener("click", () => {
    pendingStoreImage = null;
    input.value = "";
    preview.src = PUBLIC_IMAGE_FALLBACK;
    status.textContent = "Sin imagen seleccionada";
    errorMessage.textContent = "";
    $("#storeImageAction").textContent = "Seleccionar imagen";
    removeButton.hidden = true;
    showToast("Imagen retirada del artículo");
  });
}

function bindContentManager() {
  const form = $("#contentManagerForm");
  if (!form) return;
  pendingContentImages = {};
  $$("[data-content-image]", viewContainer).forEach(input => input.addEventListener("change", async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const record = await imageFileToRecord(file);
      const slot = input.dataset.contentImage;
      pendingContentImages[slot] = record;
      $(`[data-content-preview="${slot}"]`).src = record.dataUrl;
      $(`[data-content-file-info="${slot}"]`).textContent = `${record.name} · ${formatFileSize(record.size)} · pendiente de guardar`;
      $(`[data-remove-content-image="${slot}"]`).hidden = false;
      showToast("Imagen validada. Guarda el contenido para aplicar el cambio.");
    } catch (error) {
      input.value = "";
      showToast(error.message, true);
    }
  }));
  $$("[data-remove-content-image]", viewContainer).forEach(button => button.addEventListener("click", () => {
    const slot = button.dataset.removeContentImage;
    pendingContentImages[slot] = null;
    $(`[data-content-preview="${slot}"]`).src = PUBLIC_IMAGE_FALLBACK;
    $(`[data-content-file-info="${slot}"]`).textContent = "Se restaurará la imagen predeterminada al guardar";
    button.hidden = true;
  }));
  form.addEventListener("submit", async event => {
    event.preventDefault();
    try {
      const data = new FormData(form);
      const nextContent = {
        heroTitle: sanitizeManagedText(data.get("heroTitle"), "El título de portada", 90),
        heroSubtitle: sanitizeManagedText(data.get("heroSubtitle"), "El subtítulo de portada", 240),
        collectionTitle: sanitizeManagedText(data.get("collectionTitle"), "El título de colección", 90),
        collectionSubtitle: sanitizeManagedText(data.get("collectionSubtitle"), "El subtítulo de colección", 240),
        processTitle: sanitizeManagedText(data.get("processTitle"), "El título del proceso", 90),
        processSubtitle: sanitizeManagedText(data.get("processSubtitle"), "El subtítulo del proceso", 240),
        aboutTitle: sanitizeManagedText(data.get("aboutTitle"), "El título de nosotros", 90),
        aboutSubtitle: sanitizeManagedText(data.get("aboutSubtitle"), "El subtítulo de nosotros", 240),
        ctaTitle: sanitizeManagedText(data.get("ctaTitle"), "El título del llamado final", 90),
        ctaSubtitle: sanitizeManagedText(data.get("ctaSubtitle"), "El subtítulo del llamado final", 240),
        images: { ...publicContent.images },
      };
      ["hero", "process"].forEach(slot => {
        if (Object.prototype.hasOwnProperty.call(pendingContentImages, slot)) {
          nextContent.images[slot] = pendingContentImages[slot];
        }
      });
      localStorage.setItem(PUBLIC_CONTENT_KEY, JSON.stringify(nextContent));
      Object.assign(publicContent, nextContent);
      pendingContentImages = {};
      await renderView("contenido");
      showToast("Contenido web actualizado correctamente");
    } catch (error) {
      const message = error?.name === "QuotaExceededError"
        ? "No hay espacio local suficiente. Reduce el tamaño de las imágenes."
        : error.message;
      showToast(message, true);
    }
  });
}

async function renderView(view) {
  const clientViews = ["dashboard", "client-shop", "client-cart", "client-orders", "client-favorites", "client-incidents"];
  if (["contenido", "precios"].includes(view) && !isAdminRole()) {
    showToast("Este módulo es exclusivo del perfil Administrador", true);
    view = "dashboard";
  } else if (isClientRole() && !clientViews.includes(view)) {
    showToast("Acceso denegado", true);
    view = "dashboard";
  } else if (isEmployeeRole() && !employeeViews.includes(view)) {
    showToast("Esta función no está habilitada para el perfil Empleado", true);
    view = "dashboard";
  }
  activeView = view;
  if (view === "pedidos" && isAdminRole()) syncNewOrdersBadge(true);
  viewContainer.innerHTML = isClientRole()
    ? (view === "client-incidents" ? operationsTemplate(view) : clientTemplate(view))
    : view === "dashboard"
      ? (isEmployeeRole() ? employeeDashboardTemplate() : dashboardTemplate())
      : view === "contenido"
        ? contentManagerTemplate()
      : ["telas", "incidencias", "retazos", "precios"].includes(view)
        ? operationsTemplate(view)
      : await moduleTemplate(view);
  $$(".nav-item").forEach(item => item.classList.toggle("active", item.dataset.view === view));
  bindViewEvents();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function bindViewEvents() {
  $$("[data-view-link]", viewContainer).forEach(button => button.addEventListener("click", () => renderView(button.dataset.viewLink)));
  $$("[data-modal]", viewContainer).forEach(button => button.addEventListener("click", () => openModal(button.dataset.modal, button.dataset.module)));
  $("#orderFilter")?.addEventListener("change", (event) => {
    const filtered = event.target.value === "all" ? orders : orders.filter(order => order.status === event.target.value);
    $("#ordersBody").innerHTML = ordersRows(filtered);
    bindRowActions();
  });
  $("#salesReportPeriod")?.addEventListener("change", event => {
    salesReportPeriod = event.target.value;
    renderView("dashboard");
  });
  const applyModuleFilters = () => {
    const term = $("#moduleSearch")?.value.toLowerCase() || "";
    const status = $("#moduleStatusFilter")?.value.toLowerCase() || "";
    let visible = 0;
    $$("#moduleTable tbody tr").forEach(row => {
      row.hidden = !row.textContent.toLowerCase().includes(term) || (status && row.dataset.status !== status);
      if (!row.hidden) visible += 1;
    });
    $("#moduleResultCount").textContent = `${visible} ${visible === 1 ? "resultado" : "resultados"}`;
  };
  $("#moduleSearch")?.addEventListener("input", applyModuleFilters);
  $("#moduleStatusFilter")?.addEventListener("change", applyModuleFilters);
  if ($("#moduleTable")) {
    const count = document.createElement("small");
    count.id = "moduleResultCount";
    count.className = "module-result-count";
    count.textContent = `${$$("#moduleTable tbody tr").length} resultados`;
    $(".module-filters").appendChild(count);
  }
  $$("#periodTabs button").forEach(button => button.addEventListener("click", () => {
    $$("#periodTabs button").forEach(item => item.classList.remove("active"));
    button.classList.add("active");
    $(".chart-tooltip").innerHTML = `${button.textContent === "Año" ? "Junio" : button.textContent === "Mes" ? "Semana 3" : "Viernes"}<strong>${button.textContent === "Año" ? "$84.920.000 COP" : button.textContent === "Mes" ? "$12.680.000 COP" : "$3.240.000 COP"}</strong>`;
  }));
  $$("[data-add-cart]").forEach(button => button.addEventListener("click", () => addClientProduct(button.dataset.addCart)));
  $$("[data-favorite]").forEach(button => button.addEventListener("click", () => toggleClientFavorite(button.dataset.favorite)));
  $$("[data-cart-step]").forEach(button => button.addEventListener("click", () => changeCartQuantity(button.dataset.cartStep, Number(button.dataset.step))));
  $$("[data-cart-remove]").forEach(button => button.addEventListener("click", () => removeCartProduct(button.dataset.cartRemove)));
  $$("[data-client-invoice]").forEach(button => button.addEventListener("click", () => openClientInvoice(button.dataset.clientInvoice)));
  $("#startCheckout")?.addEventListener("click", openClientCheckout);
  bindClientCatalogFilters();
  if ($("#contentManagerForm")) bindContentManager();
  bindOperationsEvents();
  bindRowActions();
}

function incidentErrorMessage(error) {
  return ["DatabaseError", "QuotaExceededError", "UnknownError", "InvalidStateError"].includes(error?.name)
    ? "Error al reportar la incidencia. Intente más tarde"
    : error.message;
}

const scrapErrorMessage = error => ["DatabaseError", "QuotaExceededError", "UnknownError"].includes(error?.name)
  ? "Error interno, intente más tarde"
  : error.message;

function scrapChatStorageKey(scrapId) {
  return `yesmau_scrap_chat_${currentUser?.id || "unknown"}_${scrapId || "manual"}`;
}

function loadScrapChat(scrapId) {
  try {
    const messages = JSON.parse(localStorage.getItem(scrapChatStorageKey(scrapId)) || "[]");
    return Array.isArray(messages) ? messages.slice(-20) : [];
  } catch {
    return [];
  }
}

function saveScrapChat() {
  localStorage.setItem(scrapChatStorageKey(scrapChatState.scrapId), JSON.stringify(scrapChatState.messages.slice(-20)));
}

async function submitIncidentForm(form, user = currentUser) {
  const data = new FormData(form);
  const files = [...(form.elements.attachments?.files || [])];
  const result = await operationsModel.createIncident(Object.fromEntries(data), user, files);
  const emailStatus = result.email.sent
    ? "Correo de confirmación enviado."
    : `${result.email.reason}.`;
  return { code: result.incident.code, emailStatus };
}

function bindOperationsEvents() {
  $("#materialForm")?.addEventListener("submit", event => {
    event.preventDefault();
    try {
      operationsModel.createMaterial(Object.fromEntries(new FormData(event.currentTarget)), currentUser);
      renderView("telas");
      showToast("Materia prima registrada correctamente");
    } catch (error) {
      showToast(error.message, true);
    }
  });

  $("#incidentForm")?.addEventListener("submit", async event => {
    event.preventDefault();
    const button = $('button[type="submit"]', event.currentTarget);
    button.disabled = true;
    try {
      const result = await submitIncidentForm(event.currentTarget);
      await renderView(activeView);
      showToast(`Incidencia ${result.code} registrada. ${result.emailStatus}`, !result.emailStatus.includes("enviado."));
    } catch (error) {
      showToast(incidentErrorMessage(error), true);
    } finally {
      button.disabled = false;
    }
  });

  $$("[data-manage-incident]", viewContainer).forEach(button => button.addEventListener("click", () => {
    const incident = operationsModel.listIncidents(currentUser).find(item => item.code === button.dataset.manageIncident);
    if (!incident) return showToast("No se encontró la incidencia", true);
    $("#modalContent").innerHTML = modalBase("SEGUIMIENTO", incident.code, incident.title, `
      <div class="field full"><label>Estado</label><select name="status">${["Abierta", "En revisión", "En proceso", "Resuelta", "Cerrada"].map(status => `<option ${status === incident.status ? "selected" : ""}>${status}</option>`).join("")}</select></div>`, "Actualizar estado");
    $("#modalBackdrop").hidden = false;
    document.body.style.overflow = "hidden";
    $("[data-cancel]").addEventListener("click", closeModal);
    $("#modalForm").addEventListener("submit", event => {
      event.preventDefault();
      try {
        operationsModel.updateIncidentStatus(incident.code, new FormData(event.currentTarget).get("status"), currentUser);
        closeModal();
        renderView(activeView);
        showToast("Incidencia actualizada");
      } catch (error) {
        showToast(error.message, true);
      }
    });
  }));

  const costForm = $("#garmentCostForm");
  if (costForm) {
    const calculate = () => {
      const data = Object.fromEntries(new FormData(costForm));
      const required = ["materials", "minutes", "hourlyRate", "indirect", "margin"];
      if (required.some(name => data[name] === "")) {
        $("#liveGarmentPrice").textContent = "Precio no calculado, defina costos primero";
        $("#priceBreakdown").textContent = "";
        return null;
      }
      try {
        const result = operationsModel.calculatePrice(data);
        $("#liveGarmentPrice").textContent = formatCOP(result.price);
        $("#priceBreakdown").innerHTML = `<span>Base: ${formatCOP(result.base)}</span><span>Mano de obra: ${formatCOP(result.labor)}</span><span>Margen: ${result.margin.toFixed(2)} %</span>`;
        return result;
      } catch (error) {
        $("#liveGarmentPrice").textContent = error.message;
        $("#priceBreakdown").textContent = "";
        return null;
      }
    };
    $("#costProduct").addEventListener("change", event => {
      $("#costProductName").value = event.target.selectedOptions[0]?.dataset.name || "";
      const existing = operationsModel.listGarmentCosts().find(item => item.productCode === event.target.value);
      if (existing) {
        ["materials", "minutes", "hourlyRate", "indirect", "margin"].forEach(name => {
          costForm.elements[name].value = existing[name];
        });
      }
      calculate();
    });
    $$('input[type="number"]', costForm).forEach(input => input.addEventListener("input", calculate));
    costForm.addEventListener("submit", event => {
      event.preventDefault();
      try {
        const payload = Object.fromEntries(new FormData(costForm));
        const record = operationsModel.saveGarmentCost(payload, currentUser);
        const inventoryProduct = inventoryProducts.find(item => item.sku === record.productCode);
        if (inventoryProduct) inventoryProduct.price = record.price;
        const catalogProduct = clientProducts.find(item => item.id === record.productCode)
          || clientProducts.find(item => item.name === record.productName);
        if (catalogProduct) catalogProduct.price = record.price;
        localStorage.setItem("yesmau_inventory_products", JSON.stringify(inventoryProducts));
        localStorage.setItem("yesmau_client_products", JSON.stringify(clientProducts));
        renderView("precios");
        showToast("Fórmula guardada y precio actualizado");
      } catch (error) {
        showToast(error.message || "Precio no calculado, defina costos primero", true);
      }
    });
  }

  $("#scrapForm")?.addEventListener("submit", event => {
    event.preventDefault();
    try {
      operationsModel.createScrap(Object.fromEntries(new FormData(event.currentTarget)), currentUser);
      scrapPageState.page = 1;
      renderView("retazos");
      showToast("Retazo registrado exitosamente");
    } catch (error) {
      showToast(scrapErrorMessage(error), true);
    }
  });

  $("#scrapFilters")?.addEventListener("submit", event => {
    event.preventDefault();
    scrapPageState.filters = Object.fromEntries(new FormData(event.currentTarget));
    scrapPageState.page = 1;
    renderView("retazos");
  });
  $("#clearScrapFilters")?.addEventListener("click", () => {
    scrapPageState = { ...scrapPageState, page: 1, filters: {} };
    renderView("retazos");
  });
  $$("[data-scrap-page]", viewContainer).forEach(button => button.addEventListener("click", () => {
    scrapPageState.page = Number(button.dataset.scrapPage);
    renderView("retazos");
  }));

  $("#aiConfigForm")?.addEventListener("submit", event => {
    event.preventDefault();
    try {
      operationsModel.saveAiConfig(Object.fromEntries(new FormData(event.currentTarget)), currentUser);
      renderView("retazos");
      showToast("Configuración de IA guardada");
    } catch (error) {
      showToast(error.message, true);
    }
  });

  $("#scrapChatTarget")?.addEventListener("change", event => {
    const scrapId = event.target.value;
    const scrap = operationsModel.listScraps().find(item => item.id === scrapId);
    scrapChatState = {
      scrapId,
      messages: loadScrapChat(scrapId),
      context: scrap ? {
        fabricId: scrap.fabricId,
        sizeMeters: scrap.sizeMeters,
        material: scrap.material,
        shape: scrap.shape || "",
        goal: "",
      } : {},
    };
    renderView("retazos");
  });
  $$("[data-chat-prompt]", viewContainer).forEach(button => button.addEventListener("click", () => {
    $("#scrapChatInput").value = button.dataset.chatPrompt;
    $("#scrapChatInput").focus();
  }));
  $("#analyzeFabricContext")?.addEventListener("click", () => {
    $("#scrapChatInput").value = "Analiza esta cantidad de tela. Indica qué productos puedo confeccionar, cuánto consumiría cada opción, qué retazos quedarían y cómo podría aprovecharlos.";
    $("#scrapChatForm").requestSubmit();
  });
  $("#scrapChatForm")?.addEventListener("submit", async event => {
    event.preventDefault();
    const input = $("#scrapChatInput");
    let message;
    try {
      message = sanitizeManagedText(input.value, "La consulta", 1000);
    } catch (error) {
      return showToast(error.message, true);
    }
    const scrapId = scrapChatState.scrapId;
    const fabricSelect = $("#chatFabricId");
    const manualContext = {
      fabricId: fabricSelect?.value || "",
      fabricType: fabricSelect?.selectedOptions[0]?.textContent || "",
      sizeMeters: $("#chatFabricAmount")?.value || "",
      material: $("#chatFabricMaterial")?.value || "",
      shape: $("#chatFabricShape")?.value || "",
      goal: $("#chatFabricGoal")?.value || "",
    };
    if (!scrapId && (!manualContext.fabricId || !manualContext.sizeMeters || !manualContext.material.trim())) {
      return showToast("Completa tipo de tela, cantidad disponible y material", true);
    }
    scrapChatState.context = manualContext;
    const previousHistory = [...scrapChatState.messages];
    scrapChatState.messages.push({ role: "user", text: message, author: (currentUser?.name || "T").slice(0, 1) });
    saveScrapChat();
    await renderView("retazos");
    try {
      const reply = await operationsModel.chatAboutScrap(scrapId, message, previousHistory, currentUser, manualContext);
      if (scrapChatState.scrapId !== scrapId) return;
      scrapChatState.messages.push({ role: "assistant", text: reply });
      saveScrapChat();
      await renderView("retazos");
    } catch (error) {
      showToast(/no está configurada|obligatorio|debe ser/i.test(error.message)
        ? error.message
        : "Error al consultar la IA", true);
    }
  });

  $("#emailConfigForm")?.addEventListener("submit", event => {
    event.preventDefault();
    try {
      operationsModel.saveEmailConfig(Object.fromEntries(new FormData(event.currentTarget)), currentUser);
      renderView("incidencias");
      showToast("Configuración de correo guardada");
    } catch (error) {
      showToast(error.message, true);
    }
  });

  $$("[data-scrap-detail]", viewContainer).forEach(button => button.addEventListener("click", () => openScrapDetails(button.dataset.scrapDetail)));
  $$("[data-scrap-edit]", viewContainer).forEach(button => button.addEventListener("click", () => openScrapEditor(button.dataset.scrapEdit)));
  $$("[data-scrap-delete]", viewContainer).forEach(button => button.addEventListener("click", () => openScrapDelete(button.dataset.scrapDelete)));
  $$("[data-scrap-ai]", viewContainer).forEach(button => button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      const suggestions = await operationsModel.generateScrapSuggestions(button.dataset.scrapAi, currentUser);
      if (!suggestions.length) showToast("No se encontraron sugerencias para este retazo", true);
      openScrapDetails(button.dataset.scrapAi);
    } catch (error) {
      showToast(error.message === "La IA no está configurada. Administración debe registrar un endpoint."
        ? error.message
        : "Error al generar sugerencias", true);
    } finally {
      button.disabled = false;
    }
  }));
}

function scrapFields(scrap = {}) {
  const fabrics = operationsModel.listMaterials().filter(item => item.category === "tela");
  return `
    <div class="field"><label>Tipo de tela</label><select name="fabricId" required>${fabrics.map(item => `<option value="${escapeAttribute(item.id)}" ${item.id === scrap.fabricId ? "selected" : ""}>${escapeHtml(item.name)}</option>`).join("")}</select></div>
    <div class="field"><label>Tamaño (metros)</label><input name="sizeMeters" type="number" min="0.01" step="0.01" value="${escapeAttribute(scrap.sizeMeters || "")}" required></div>
    <div class="field"><label>Material</label><input name="material" maxlength="90" value="${escapeAttribute(scrap.material || "")}" required></div>
    <div class="field"><label>Forma</label><input name="shape" maxlength="50" value="${escapeAttribute(scrap.shape || "")}"></div>
    <div class="field"><label>Ubicación</label><input name="location" maxlength="90" value="${escapeAttribute(scrap.location || "")}"></div>
    <div class="field"><label>Piezas</label><input name="pieces" type="number" min="1" value="${escapeAttribute(scrap.pieces || 1)}" required></div>
    <div class="field"><label>Fecha</label><input name="entryDate" type="date" value="${escapeAttribute(scrap.entryDate || new Date().toISOString().slice(0, 10))}" required></div>
    <div class="field"><label>Origen</label><select name="origin">${["Corte de producción", "Devolución", "Ajuste manual"].map(origin => `<option ${origin === scrap.origin ? "selected" : ""}>${origin}</option>`).join("")}</select></div>`;
}

function openScrapEditor(id) {
  const scrap = operationsModel.listScraps().find(item => item.id === id);
  if (!scrap) return showToast("No se encontró el retazo", true);
  $("#modalContent").innerHTML = modalBase("EDITAR RETAZO", scrap.code, "Actualiza la información registrada.", scrapFields(scrap), "Guardar cambios");
  $("#modalBackdrop").hidden = false;
  document.body.style.overflow = "hidden";
  $("[data-cancel]").addEventListener("click", closeModal);
  $("#modalForm").addEventListener("submit", event => {
    event.preventDefault();
    try {
      operationsModel.updateScrap(id, Object.fromEntries(new FormData(event.currentTarget)), currentUser);
      closeModal();
      renderView("retazos");
      showToast("Retazo actualizado");
    } catch (error) {
      showToast(scrapErrorMessage(error), true);
    }
  });
}

function openScrapDelete(id) {
  const scrap = operationsModel.listScraps().find(item => item.id === id);
  if (!scrap) return showToast("No se encontró el retazo", true);
  $("#modalContent").innerHTML = `<p class="eyebrow">CONFIRMAR ELIMINACIÓN</p><h2 id="modalTitle">Eliminar ${escapeHtml(scrap.code)}</h2><p class="modal-desc">Esta acción elimina el registro y sus sugerencias asociadas.</p><div class="modal-actions"><button class="button button-secondary" data-cancel>Cancelar</button><button class="button button-primary" id="confirmScrapDelete">Eliminar retazo</button></div>`;
  $("#modalBackdrop").hidden = false;
  document.body.style.overflow = "hidden";
  $("[data-cancel]").addEventListener("click", closeModal);
  $("#confirmScrapDelete").addEventListener("click", () => {
    try {
      operationsModel.deleteScrap(id, currentUser);
      closeModal();
      renderView("retazos");
      showToast("Retazo eliminado");
    } catch (error) {
      showToast(scrapErrorMessage(error), true);
    }
  });
}

function openScrapDetails(id) {
  const scrap = operationsModel.listScraps().find(item => item.id === id);
  if (!scrap) return showToast("No se encontró el retazo", true);
  $("#modalContent").innerHTML = `
    <p class="eyebrow">DETALLE DEL RETAZO</p><h2 id="modalTitle">${escapeHtml(scrap.code)}</h2>
    <dl class="record-details"><div><dt>Tela</dt><dd>${escapeHtml(scrap.fabricName)}</dd></div><div><dt>Material</dt><dd>${escapeHtml(scrap.material)}</dd></div><div><dt>Tamaño</dt><dd>${scrap.sizeMeters.toFixed(2)} m</dd></div><div><dt>Forma</dt><dd>${escapeHtml(scrap.shape || "No asignada")}</dd></div><div><dt>Ubicación</dt><dd>${escapeHtml(scrap.location || "No asignada")}</dd></div><div><dt>Piezas</dt><dd>${scrap.pieces}</dd></div><div><dt>Origen</dt><dd>${escapeHtml(scrap.origin)}</dd></div><div><dt>Fecha</dt><dd>${escapeHtml(scrap.entryDate)}</dd></div></dl>
    <div class="scrap-suggestions"><p class="eyebrow">SUGERENCIAS DE IA</p>${scrapSuggestionCards(scrap)}</div>
    <div class="modal-actions"><button class="button button-primary" data-cancel>Cerrar</button></div>`;
  $(".modal").classList.add("scrap-detail-modal");
  $("#modalBackdrop").hidden = false;
  document.body.style.overflow = "hidden";
  $("[data-cancel]").addEventListener("click", closeModal);
  $$("[data-suggestion]", $("#modalContent")).forEach(button => button.addEventListener("click", () => {
    try {
      operationsModel.markSuggestion(id, button.dataset.suggestion, button.dataset.suggestionField, currentUser);
      openScrapDetails(id);
    } catch (error) {
      showToast(error.message, true);
    }
  }));
}

function addClientProduct(productId) {
  const product = clientProducts.find(item => item.id === productId);
  if (!product) return;
  if (product.stock < 1) return showToast("Este artículo está agotado", true);
  const cart = getClientCart();
  const nextQuantity = Math.min((cart[productId] || 0) + 1, product.stock);
  cart[productId] = nextQuantity;
  saveClientData("cart", cart);
  apiMock.recordAudit("CARRITO_ACTUALIZADO", `${product.name} · ${nextQuantity} unidad(es)`);
  syncClientBadges();
  showToast(`${product.name} agregado al carrito`);
}

function toggleClientFavorite(productId) {
  const favorites = getClientFavorites();
  const exists = favorites.includes(productId);
  const next = exists ? favorites.filter(id => id !== productId) : [...favorites, productId];
  saveClientData("favorites", next);
  const product = clientProducts.find(item => item.id === productId);
  apiMock.recordAudit(exists ? "FAVORITO_ELIMINADO" : "FAVORITO_AGREGADO", product?.name || productId);
  const button = $(`[data-favorite="${productId}"]`);
  if (button) {
    button.classList.toggle("active", !exists);
    button.setAttribute("aria-pressed", String(!exists));
    button.setAttribute("aria-label", `${exists ? "Agregar" : "Quitar"} ${product.name} ${exists ? "a" : "de"} favoritos`);
  }
  showToast(exists ? "Artículo eliminado de favoritos" : "Artículo añadido a favoritos");
  if (activeView === "client-favorites") renderView(activeView);
}

function changeCartQuantity(productId, step) {
  const cart = getClientCart();
  const product = clientProducts.find(item => item.id === productId);
  if (!product) return;
  const quantity = Math.max(0, Math.min((cart[productId] || 0) + step, product.stock));
  if (quantity) cart[productId] = quantity;
  else delete cart[productId];
  saveClientData("cart", cart);
  syncClientBadges();
  renderView("client-cart");
}

function removeCartProduct(productId) {
  const cart = getClientCart();
  delete cart[productId];
  saveClientData("cart", cart);
  syncClientBadges();
  renderView("client-cart");
  showToast("Artículo retirado del carrito");
}

function bindClientCatalogFilters() {
  const search = $("#clientProductSearch");
  if (!search) return;
  const featuredLimit = $("#clientProductGrid")?.dataset.featuredCatalog === "true" ? 3 : null;
  let category = "Todos";
  const applyFilters = () => {
    const term = search.value.trim().toLowerCase();
    const cards = $$("[data-product-card]", viewContainer);
    cards.forEach(card => {
      card.hidden = !card.dataset.search.includes(term) || (category !== "Todos" && card.dataset.category !== category);
    });
    if (featuredLimit) cards.filter(card => !card.hidden).slice(featuredLimit).forEach(card => { card.hidden = true; });
    const visible = cards.filter(card => !card.hidden).length;
    $$("[data-product-section]", viewContainer).forEach(section => {
      section.hidden = !$$("[data-product-card]", section).some(card => !card.hidden);
    });
    $("#clientResultCount").textContent = `${visible} ${visible === 1 ? "producto" : "productos"}`;
    $("#clientSearchEmpty").hidden = visible > 0;
    pendingClientSearch = term;
  };
  search.addEventListener("input", applyFilters);
  $$("[data-client-category]").forEach(button => button.addEventListener("click", () => {
    category = button.dataset.clientCategory;
    $$("[data-client-category]").forEach(item => {
      const active = item === button;
      item.classList.toggle("active", active);
      item.setAttribute("aria-pressed", String(active));
    });
    applyFilters();
  }));
  $("#clearClientFilters")?.addEventListener("click", () => {
    search.value = "";
    category = "Todos";
    $('[data-client-category="Todos"]').click();
    search.focus();
  });
  applyFilters();
}

function openClientCheckout() {
  const { items, total } = cartDetails();
  if (!items.length) return;
  $("#modalContent").innerHTML = modalBase("COMPRA SEGURA", "Elige cómo pagar", "Selecciona un método. Nunca solicitamos ni almacenamos datos reales de tarjetas en esta demostración.", `
    <fieldset class="payment-options full"><legend>Métodos disponibles</legend>${clientPaymentMethods.map((method, index) => `<label><input type="radio" name="payment" value="${method.id}" ${index === 0 ? "checked" : ""}><span><strong>${method.name}</strong><small>${method.description}</small></span></label>`).join("")}</fieldset>
    <div class="checkout-total full"><span>${items.length} ${items.length === 1 ? "artículo" : "artículos"}</span><strong>${formatCOP(total)}</strong></div>`, "Revisar y confirmar");
  $("#modalBackdrop").hidden = false;
  document.body.style.overflow = "hidden";
  $("[data-cancel]").addEventListener("click", closeModal);
  $("#modalForm").addEventListener("submit", event => {
    event.preventDefault();
    const method = clientPaymentMethods.find(item => item.id === new FormData(event.currentTarget).get("payment"));
    showCheckoutConfirmation(method);
  });
}

function openClientInvoice(orderId) {
  const order = getClientOrders().find(item => item.id === orderId);
  if (!order) return showToast("El documento no está disponible", true);
  const documentNumber = order.invoice || `REC-${order.id}`;
  const detail = order.items.map(item => `${item.quantity} × ${item.name}`).join(", ");
  const invoice = {
    number: documentNumber,
    date: order.date,
    client: currentUser?.name || "Cliente",
    detail,
    gateway: order.paymentMethod || "No registrado",
    paymentMethod: order.paymentMethod || "No registrado",
    status: order.status,
    subtotal: formatCOP(order.total),
    total: formatCOP(order.total),
  };
  $(".modal").classList.add("invoice-detail-modal");
  $("#modalContent").innerHTML = `<div class="invoice-header"><div><p class="eyebrow">FACTURA / COMPROBANTE DEL PEDIDO</p><h2 id="modalTitle">${escapeHtml(documentNumber)}</h2><span>Pedido ${escapeHtml(order.id)} · ${escapeHtml(currentUser?.name || "Cliente")}</span></div><span class="status ${statusClass(order.status)}">${escapeHtml(order.status)}</span></div>
    <div class="invoice-demo-alert">${icon("alert")} Comprobante específico del pedido. No reemplaza una factura electrónica fiscal.</div>
    <dl class="record-details invoice-summary"><div><dt>Pedido</dt><dd>${escapeHtml(order.id)}</dd></div><div><dt>Fecha</dt><dd>${escapeHtml(order.date)}</dd></div><div><dt>Método</dt><dd>${escapeHtml(order.paymentMethod || "No registrado")}</dd></div><div><dt>Seguimiento</dt><dd>${escapeHtml(order.tracking)}</dd></div></dl>
    <div class="table-scroll invoice-lines"><table><thead><tr><th>ARTÍCULO</th><th>CANTIDAD</th><th>VALOR UNITARIO</th><th>SUBTOTAL</th></tr></thead><tbody>${order.items.map(item => `<tr><td><strong>${escapeHtml(item.name)}</strong></td><td>${item.quantity}</td><td>${formatCOP(item.price)}</td><td><strong>${formatCOP(item.price * item.quantity)}</strong></td></tr>`).join("")}</tbody></table></div>
    <div class="invoice-totals"><div><span>Subtotal</span><strong>${formatCOP(order.total)}</strong></div><div class="invoice-grand-total"><span>Total</span><strong>${formatCOP(order.total)}</strong></div></div>
    <div class="modal-actions invoice-actions"><button class="button button-secondary" data-client-pdf>${icon("receipt")} Descargar PDF</button><button class="button button-secondary" data-client-xlsx>${icon("chart")} Descargar XLSX</button><button class="button button-primary" data-close-invoice>Cerrar</button></div>`;
  $("#modalBackdrop").hidden = false;
  document.body.style.overflow = "hidden";
  $("[data-close-invoice]").addEventListener("click", closeModal);
  $("[data-client-pdf]").addEventListener("click", () => downloadDocument(createInvoicePdf(invoice), `${documentNumber}.pdf`));
  $("[data-client-xlsx]").addEventListener("click", () => downloadDocument(createInvoiceXlsx(invoice), `${documentNumber}.xlsx`));
}

function showCheckoutConfirmation(method) {
  const { items, total } = cartDetails();
  $("#modalContent").innerHTML = `<p class="eyebrow">CONFIRMACIÓN FINAL</p><h2 id="modalTitle">Confirma tu pedido</h2><p class="modal-desc">Revisa el resumen. Al confirmar se creará el pedido, pero no se procesará ningún cobro real.</p>
    <ul class="checkout-review">${items.map(item => `<li><span>${item.quantity} × ${escapeHtml(item.name)}</span><strong>${formatCOP(item.subtotal)}</strong></li>`).join("")}</ul>
    <dl class="checkout-confirmation"><div><dt>Método</dt><dd>${escapeHtml(method.name)}</dd></div><div><dt>Total</dt><dd>${formatCOP(total)}</dd></div></dl>
    <label class="check-row checkout-consent"><input id="checkoutConsent" type="checkbox"><span>Confirmo que revisé los artículos y entiendo que esta es una compra simulada.</span></label>
    <div class="modal-actions"><button class="button button-secondary" id="backToPayment">Volver</button><button class="button button-primary" id="confirmClientOrder">Confirmar pedido</button></div>`;
  $("#backToPayment").addEventListener("click", openClientCheckout);
  $("#confirmClientOrder").addEventListener("click", () => completeClientOrder(method));
}

function completeClientOrder(method) {
  if (!$("#checkoutConsent").checked) return showToast("Confirma que revisaste el pedido", true);
  const { items, total } = cartDetails();
  const unavailable = items.find(item => {
    const { catalog, inventory } = linkedProducts(item.id);
    const available = Math.min(catalog?.stock ?? Infinity, inventory?.stock ?? Infinity);
    return !Number.isFinite(available) || item.quantity > available;
  });
  if (unavailable) return showToast(`No hay existencias suficientes de ${unavailable.name}`, true);
  items.forEach(item => {
    const { catalog, inventory } = linkedProducts(item.id);
    const available = Math.min(catalog?.stock ?? Infinity, inventory?.stock ?? Infinity);
    setLinkedStock(item.id, available - item.quantity);
  });
  persistProductCollections();
  const order = {
    id: `YM-${String(Date.now()).slice(-6)}`,
    date: new Date().toLocaleDateString("es-CO", { day: "2-digit", month: "short", year: "numeric" }),
    status: method.id === "delivery" ? "Confirmado" : "Pago pendiente",
    items: items.map(item => ({ name: item.name, quantity: item.quantity, price: item.price })),
    total,
    tracking: "Estamos preparando la información de tu pedido",
    invoice: `REC-${String(Date.now()).slice(-6)}`,
    paymentMethod: method.name,
  };
  order.createdAt = new Date().toISOString();
  const adminOrder = adminOrderFromClient(order);
  saveClientData("orders", [order, ...loadClientData("orders", [])]);
  orders.unshift(adminOrder);
  localStorage.setItem("yesmau_orders", JSON.stringify(orders));
  localStorage.setItem("yesmau_new_orders", String(Number(localStorage.getItem("yesmau_new_orders") || 0) + 1));
  saveClientData("cart", {});
  const notifications = loadClientData("notifications", []);
  saveClientData("notifications", [{ title: `Pedido ${order.id} confirmado`, detail: `${method.name} · ${formatCOP(total)} · ahora`, unread: true }, ...notifications]);
  apiMock.recordAudit("PEDIDO_CLIENTE_CREADO", `${order.id} · ${adminOrder.product} · ${formatCOP(total)}`);
  syncClientBadges();
  renderClientNotifications();
  closeModal();
  renderView("client-orders");
  showToast("Pedido confirmado correctamente");
}

function bindRowActions() {
  $$("[data-order]", viewContainer).forEach(button => button.addEventListener("click", () => openOrderStatus(button.dataset.order)));
  $$("[data-invoice]", viewContainer).forEach(button => button.addEventListener("click", () => openInvoiceDetails(button.dataset.invoice)));
  $$("[data-record]", viewContainer).forEach(button => button.addEventListener("click", () => openRecordDetails(button.dataset.recordModule, button.dataset.record)));
  $$("[data-incident]", viewContainer).forEach(button => button.addEventListener("click", () => openIncidentStatus(button.dataset.incident)));
  $$("[data-user]", viewContainer).forEach(button => button.addEventListener("click", () => openUserEditor(button.dataset.user)));
  $$("[data-role]", viewContainer).forEach(button => button.addEventListener("click", () => openRolePermissions(button.dataset.role)));
}

function modalBase(kicker, title, description, fields, submit = "Guardar") {
  return `<p class="eyebrow">${escapeHtml(kicker)}</p><h2 id="modalTitle">${escapeHtml(title)}</h2><p class="modal-desc">${escapeHtml(description)}</p><form id="modalForm"><div class="form-grid">${fields}</div><div class="modal-actions"><button type="button" class="button button-secondary" data-cancel>Cancelar</button><button type="submit" class="button button-primary">${escapeHtml(submit)}</button></div></form>`;
}
const field = (label, type = "text", placeholder = "", full = false) => `<div class="field ${full ? "full" : ""}"><label>${label}</label><input type="${type}" placeholder="${placeholder}" ${type !== "text" ? "" : "required"} /></div>`;

function registrationFormFor(module) {
  const availableOptions = inventoryProducts.filter(product => product.stock > 0).map(product => `<option value="${escapeAttribute(product.sku)}">${escapeHtml(product.name)} · ${product.stock} disponibles</option>`).join("");
  const forms = {
    pedidos: {
      description: "Registra los datos comerciales del pedido y asígnale un artículo disponible.",
      submit: "Crear pedido",
      fields: `<div class="field"><label>Cliente</label><input name="client" required></div><div class="field"><label>Correo</label><input name="email" type="email" required></div><div class="field full"><label>Artículo</label><select name="product">${availableOptions}</select></div><div class="field"><label>Cantidad</label><input name="quantity" type="number" value="1" min="1" required></div><div class="field"><label>Estado inicial</label><select name="status"><option>Pendiente</option><option>Pago recibido</option><option>En producción</option></select></div>`,
    },
    inventario: {
      description: "Añade una referencia comercial con precio, categoría y existencias iniciales.",
      submit: "Guardar artículo",
      fields: `<div class="field"><label>SKU</label><input name="sku" placeholder="ART-0250" required></div><div class="field"><label>Artículo</label><input name="name" required></div><div class="field"><label>Categoría</label><input name="category" placeholder="Vestidos, camisas..." required></div><div class="field"><label>Precio unitario (COP)</label><input name="price" type="number" min="0" step="1000" placeholder="150000" required></div><div class="field"><label>Existencias</label><input name="stock" type="number" min="0" required></div><div class="field"><label>Estado</label><select name="status"><option>Disponible</option><option>Stock bajo</option><option>Agotado</option></select></div>`,
    },
    tienda: {
      description: "Publica una prenda o tela en la tienda e indica sus características comerciales.",
      submit: "Publicar artículo",
      fields: `
        <div class="field full store-image-field">
          <span class="field-label">Imagen del artículo</span>
          <div class="store-image-uploader">
            <div class="store-image-preview"><img id="storeImagePreview" src="${PUBLIC_IMAGE_FALLBACK}" alt="Vista previa del artículo"><span id="storeImageStatus">Sin imagen seleccionada</span></div>
            <div class="store-image-controls">
              <label class="button button-secondary content-file-button">${icon("image")} <span id="storeImageAction">Seleccionar imagen</span><input id="storeImageInput" type="file" accept=".webp,.png,.jpg,.jpeg,image/webp,image/png,image/jpeg"></label>
              <button class="text-button danger-text" id="removeStoreImage" type="button" hidden>Quitar imagen</button>
              <small>WEBP, PNG o JPG · máximo 2 MB.</small>
              <p class="store-image-error" id="storeImageError" role="alert" aria-live="polite"></p>
            </div>
          </div>
        </div>
        <div class="field"><label>SKU</label><input name="sku" maxlength="30" placeholder="ART-0250" required></div>
        <div class="field"><label>Nombre del artículo</label><input name="name" maxlength="90" placeholder="Blusa Aurora" required></div>
        <div class="field"><label>Clase de artículo</label><select name="articleType"><option>Prenda</option><option>Tela</option></select></div>
        <div class="field"><label>Tipo de prenda o material</label><input name="type" maxlength="60" placeholder="Blusa, vestido, lino..." required></div>
        <div class="field"><label>Talla</label><input name="size" maxlength="40" placeholder="XS, S, M, L o única" required></div>
        <div class="field"><label>Color</label><input name="color" maxlength="50" placeholder="Terracota" required></div>
        <div class="field full"><label>Descripción</label><textarea name="characteristics" maxlength="500" placeholder="Material, acabado, corte o composición" required></textarea></div>
        <div class="field"><label>Precio (COP)</label><input name="price" type="number" min="0" step="1000" placeholder="150000" required></div>
        <div class="field"><label>Cantidad disponible</label><input name="stock" type="number" min="0" value="1" required></div>
        <div class="field full"><label>Proveedor</label><input name="supplier" maxlength="90" placeholder="Nombre del proveedor" required></div>`,
    },
    compras: {
      description: "Crea una orden de abastecimiento con proveedor, entrega prevista y valor total.",
      submit: "Crear orden de compra",
      fields: `<div class="field"><label>Número de orden</label><input name="id" placeholder="OC-020" required></div><div class="field"><label>Proveedor</label><input name="supplier" required></div><div class="field full"><label>Artículo</label><select name="product" required><option value="">Selecciona</option>${inventoryProducts.map(product => `<option value="${escapeAttribute(product.sku)}">${escapeHtml(product.name)} · ${escapeHtml(product.sku)}</option>`).join("")}</select></div><div class="field"><label>Cantidad</label><input name="quantity" type="number" min="1" step="1" value="1" required></div><div class="field"><label>Fecha de entrega</label><input name="date" type="date" required></div><div class="field"><label>Valor total (COP)</label><input name="total" type="number" min="0" step="1000" required></div><div class="field"><label>Estado</label><select name="status"><option>Pendiente</option><option>Confirmada</option><option>En tránsito</option><option>Recibida</option></select></div>`,
    },
    telas: {
      description: "Registra una tela o materia prima indicando composición y disponibilidad real.",
      submit: "Registrar material",
      fields: `<div class="field"><label>Código</label><input name="id" placeholder="TEL-075" required></div><div class="field"><label>Material</label><input name="material" required></div><div class="field"><label>Composición</label><input name="composition" placeholder="100% algodón" required></div><div class="field"><label>Proveedor</label><input name="supplier" placeholder="Empresa proveedora" required></div><div class="field"><label>Cantidad disponible</label><input name="available" placeholder="25 m o 100 und." required></div><div class="field"><label>Estado</label><select name="status"><option>Disponible</option><option>Stock crítico</option><option>Agotado</option></select></div>`,
    },
    retazos: {
      description: "Clasifica el sobrante por tela, medida y oportunidad de aprovechamiento.",
      submit: "Registrar retazo",
      fields: `<div class="field"><label>Lote</label><input name="id" placeholder="RT-0147" required></div><div class="field"><label>Tela</label><input name="fabric" required></div><div class="field"><label>Medida</label><input name="size" placeholder="65 × 48 cm" required></div><div class="field"><label>Sugerencia de uso</label><input name="suggestion" required></div><div class="field full"><label>Estado</label><select name="status"><option>Disponible</option><option>Reservado</option><option>En uso</option></select></div>`,
    },
    proveedores: {
      description: "Centraliza la información comercial y especialidad del nuevo proveedor.",
      submit: "Guardar proveedor",
      fields: `<div class="field"><label>Empresa</label><input name="name" required></div><div class="field"><label>Número de contacto</label><input name="phone" type="tel" placeholder="+57 300 000 0000" required></div><div class="field"><label>Correo comercial</label><input name="email" type="email" placeholder="ventas@empresa.com" required></div><div class="field"><label>Dirección</label><input name="address" placeholder="Calle, número y ciudad" required></div><div class="field"><label>Especialidad</label><input name="specialty" required></div><div class="field"><label>Evaluación inicial</label><input name="rating" placeholder="5.0 / 5" required></div><div class="field full"><label>Estado</label><select name="status"><option>Activo</option><option>En revisión</option><option>Inactivo</option></select></div>`,
    },
    incidencias: {
      description: "Documenta la novedad, asigna un responsable y define su prioridad.",
      submit: "Crear incidencia",
      fields: `<div class="field"><label>Número de caso</label><input name="id" placeholder="INC-0099" required></div><div class="field"><label>Asunto</label><input name="subject" required></div><div class="field"><label>Responsable</label><input name="responsible" required></div><div class="field"><label>Prioridad</label><select name="priority"><option>Baja</option><option>Media</option><option>Alta</option><option>Crítica</option></select></div><div class="field full"><label>Estado</label><select name="status"><option>Abierta</option><option>En proceso</option><option>Resuelta</option></select></div>`,
    },
    clientes: {
      description: "Crea una cuenta verificada y asigna su rol de acceso al sistema.",
      submit: "Registrar usuario",
      fields: `<div class="field"><label>Nombre completo</label><input name="name" required></div><div class="field"><label>Correo</label><input name="email" type="email" required></div><div class="field"><label>Tipo de documento</label><select name="documentType"><option>CC</option><option>CE</option><option>TI</option><option>PA</option><option>NIT</option></select></div><div class="field"><label>Documento</label><input name="document" required></div><div class="field"><label>Rol</label><select name="role"><option>Cliente</option><option>Producción</option><option>Inventario</option><option>Administrador</option></select></div><div class="field"><label>Contraseña temporal</label><input name="password" type="password" required></div>`,
    },
  };
  return forms[module];
}

function openModal(type, module) {
  if (module === "tienda" && !hasPermission("agregar_articulos_tienda")) {
    showToast("Administración debe concederte permiso para agregar artículos", true);
    return;
  }
  if (type === "sale" && !hasPermission("registrar_ventas")) {
    showToast("Administración debe concederte permiso para registrar ventas", true);
    return;
  }
  let content = "";
  if (type === "sale") {
    const availableProducts = inventoryProducts.filter(product => product.stock > 0);
    if (!availableProducts.length) {
      showToast("No hay artículos disponibles para registrar una venta", true);
      return;
    }
    content = modalBase("NUEVA OPERACIÓN", "Registrar una venta", "Selecciona un artículo disponible, genera su factura y prepara el cobro seguro mediante Stripe.", `
      <div class="field"><label>Cliente</label><input name="client" type="text" placeholder="Nombre del cliente" required></div>
      <div class="field"><label>Correo para la factura</label><input name="email" type="email" placeholder="cliente@email.com" required></div>
      <div class="field full"><label>Artículo disponible</label><select id="saleProduct" name="product" required>${availableProducts.map(product => `<option value="${escapeAttribute(product.sku)}" data-price="${product.price}" data-stock="${product.stock}">${escapeHtml(product.name)} · ${product.stock} disponibles</option>`).join("")}</select></div>
      <div class="field"><label>Cantidad</label><input id="saleQuantity" name="quantity" type="number" value="1" min="1" max="${availableProducts[0]?.stock || 1}" required></div>
      <div class="field"><label>Precio total (COP)</label><input id="salePrice" name="price" type="number" value="${availableProducts[0]?.price || 0}" readonly></div>
      <div class="field"><label>Método de pago</label><select id="salePaymentMethod" name="paymentMethod"><option data-gateway="STRIPE">Visa</option><option data-gateway="STRIPE">Mastercard</option><option data-gateway="STRIPE">PSE</option><option data-gateway="STRIPE">American Express</option><option data-gateway="STRIPE">Diners Club</option><option data-gateway="STRIPE">Apple Pay</option><option data-gateway="STRIPE">Google Pay</option><option data-gateway="CAJA">Efectivo</option></select></div>
      <div class="field"><label>Pasarela o canal</label><input id="saleGateway" name="gateway" value="STRIPE" readonly></div>
      <div class="field full"><label>Referencia del pago</label><input id="salePaymentReference" name="paymentReference" placeholder="Ej. •••• 4242, CUS de PSE o recibo de caja" required></div>
      <div class="calculator-result full"><span>Precio unitario del artículo</span><strong id="saleUnitPrice">${formatCOP(availableProducts[0]?.price || 0)}</strong></div>`, "Registrar pago y generar factura");
  } else if (type === "fabric") {
    content = modalBase("CALCULADORA DE METRAJE", "¿Cuánta tela necesitas?", "Obtén un estimado según el tipo de prenda, talla y cantidad.", `<div class="field"><label>Prenda</label><select id="garment"><option value="2.4">Vestido</option><option value="1.8">Pantalón</option><option value="2.1">Blazer</option><option value="1.4">Camisa</option></select></div><div class="field"><label>Talla</label><select id="size"><option value="0.9">XS</option><option value="1">S / M</option><option value="1.15">L</option><option value="1.3">XL</option></select></div>${field("Cantidad", "number", "1")}<div class="calculator-result full"><span>Metraje recomendado, con 12% de margen</span><strong id="fabricResult">2.69 metros</strong></div>`, "Guardar cálculo");
  } else if (type === "generic" && module === "roles") {
    const permissions = apiMock.getPermissions();
    content = modalBase("SEGURIDAD", "Crear nuevo rol", "Define un nombre único y selecciona las funcionalidades permitidas.", `<div class="field"><label>Nombre del rol</label><input name="name" type="text" pattern="[A-Za-zÁÉÍÓÚÜÑáéíóúüñ ]+" required></div><div class="field"><label>Descripción</label><input name="description" type="text" required></div><div class="field full"><label>Permisos</label><div class="permission-grid">${permissions.map(permission => `<label class="permission-check"><input name="permissions" type="checkbox" value="${permission}"><span>${permissionLabel(permission)}</span></label>`).join("")}</div></div>`);
  } else {
    const item = moduleConfig[module];
    const form = registrationFormFor(module);
    content = modalBase(item.kicker, item.action, form.description, form.fields, form.submit);
  }
  $("#modalContent").innerHTML = content;
  $("#modalBackdrop").hidden = false;
  document.body.style.overflow = "hidden";
  bindModalCalculators(type);
  if (type === "generic" && module === "tienda") {
    $(".modal").classList.add("store-product-modal");
    bindStoreImageUpload();
  }
  $("[data-cancel]")?.addEventListener("click", closeModal);
  $("#modalForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      if (type === "generic" && module === "roles") {
        const data = new FormData(event.currentTarget);
        await apiMock.createRole({
          name: data.get("name"),
          description: data.get("description"),
          permissions: data.getAll("permissions"),
        });
        closeModal();
        await renderView("roles");
        showToast("Rol creado correctamente");
      } else if (type === "sale") {
        const data = new FormData(event.currentTarget);
        const product = inventoryProducts.find(item => item.sku === data.get("product"));
        const quantity = Number(data.get("quantity"));
        if (!product || quantity < 1 || quantity > product.stock) throw new Error("La cantidad supera el inventario disponible.");
        const invoiceNumber = Math.max(86, ...sales.map(sale => Number(String(sale[0]).replace(/\D/g, "")) || 0)) + 1;
        const total = product.price * quantity;
        const gateway = data.get("gateway");
        const paymentMethod = data.get("paymentMethod");
        const paymentReference = data.get("paymentReference");
        const paymentStatus = gateway === "CAJA" ? "Recibida" : "Pagada";
        sales.unshift([`FAC-${String(invoiceNumber).padStart(4, "0")}`, data.get("client"), `${quantity} × ${product.name}`, gateway, `${paymentMethod} · ${paymentReference}`, "Ahora", paymentStatus, formatCOP(total)]);
        setLinkedStock(product.sku, product.stock - quantity);
        localStorage.setItem("yesmau_sales", JSON.stringify(sales));
        persistProductCollections();
        apiMock.recordAudit("VENTA_REGISTRADA", `${sales[0][0]} · ${product.name} · ${formatCOP(total)}`);
        closeModal();
        if (activeView === "ventas" || activeView === "inventario") await renderView(activeView);
        showToast(`Venta registrada por ${gateway}: ${paymentMethod}`);
      } else if (type === "generic") {
        const data = new FormData(event.currentTarget);
        if (module === "pedidos") {
          const product = inventoryProducts.find(item => item.sku === data.get("product"));
          const quantity = Number(data.get("quantity"));
          if (!product || quantity < 1 || quantity > product.stock) throw new Error("La cantidad solicitada supera el inventario disponible.");
          const nextId = Math.max(...orders.map(order => Number(order.id.replace(/\D/g, "")))) + 1;
          const client = data.get("client");
          orders.unshift({
            id: `#${nextId}`,
            client,
            email: data.get("email"),
            product: `${quantity} × ${product.name}`,
            total: formatCOP(product.price * quantity),
            status: data.get("status"),
            type: statusClass(data.get("status")),
            initials: client.split(/\s+/).map(part => part[0]).slice(0, 2).join("").toUpperCase(),
          });
          localStorage.setItem("yesmau_orders", JSON.stringify(orders));
        } else if (module === "inventario") {
          const stock = Number(data.get("stock"));
          inventoryProducts.unshift({ sku: data.get("sku"), name: data.get("name"), category: data.get("category"), stock, price: Number(data.get("price")), status: data.get("status") });
          localStorage.setItem("yesmau_inventory_products", JSON.stringify(inventoryProducts));
        } else if (module === "tienda") {
          if (!hasPermission("agregar_articulos_tienda")) throw new Error("No tienes permiso para agregar artículos a la tienda.");
          if (storeImageValidationPending) throw new Error("Espera a que termine la validación de la imagen.");
          const sku = sanitizeManagedText(data.get("sku"), "El SKU", 30);
          if (inventoryProducts.some(product => product.sku.toLowerCase() === sku.toLowerCase())
            || clientProducts.some(product => product.id.toLowerCase() === sku.toLowerCase())) {
            throw new Error("Ya existe un artículo con este SKU.");
          }
          const stock = Number(data.get("stock"));
          const articlePrice = Number(data.get("price"));
          if (!Number.isInteger(stock) || stock < 0) throw new Error("La cantidad disponible debe ser un número entero válido.");
          if (!Number.isFinite(articlePrice) || articlePrice < 0) throw new Error("El precio debe ser un valor válido.");
          const name = sanitizeManagedText(data.get("name"), "El nombre", 90);
          const articleType = sanitizeManagedText(data.get("articleType"), "La clase de artículo", 20);
          const type = sanitizeManagedText(data.get("type"), "El tipo", 60);
          const size = sanitizeManagedText(data.get("size"), "La talla", 40);
          const color = sanitizeManagedText(data.get("color"), "El color", 50);
          const characteristics = sanitizeManagedText(data.get("characteristics"), "La descripción", 500);
          const supplier = sanitizeManagedText(data.get("supplier"), "El proveedor", 90);
          const status = stock === 0 ? "Agotado" : stock <= 6 ? "Stock bajo" : "Disponible";
          const inventoryProduct = { sku, name, articleType, type, size, color, characteristics, supplier, category: type, stock, price: articlePrice, status };
          const clientProduct = {
            id: sku,
            name,
            category: type,
            description: characteristics,
            articleType,
            type,
            size,
            color,
            supplier,
            price: articlePrice,
            stock,
            unit: articleType === "Tela" ? "metro" : undefined,
            image: pendingStoreImage?.dataUrl || PUBLIC_IMAGE_FALLBACK,
          };
          localStorage.setItem("yesmau_client_products", JSON.stringify([clientProduct, ...clientProducts]));
          localStorage.setItem("yesmau_inventory_products", JSON.stringify([inventoryProduct, ...inventoryProducts]));
          inventoryProducts.unshift(inventoryProduct);
          clientProducts.unshift(clientProduct);
          pendingStoreImage = null;
        } else if (module === "compras") {
          const id = sanitizeManagedText(data.get("id"), "El número de orden", 30);
          if (genericRows.compras.some(row => row[0].toLowerCase() === id.toLowerCase())) throw new Error("Ya existe una orden con este número.");
          const product = inventoryProducts.find(item => item.sku === data.get("product"));
          if (!product) throw new Error("Selecciona un artículo válido.");
          const quantity = Number(data.get("quantity"));
          const total = Number(data.get("total"));
          if (!Number.isInteger(quantity) || quantity < 1) throw new Error("La cantidad debe ser un número entero válido.");
          if (!Number.isFinite(total) || total < 0) throw new Error("El valor total debe ser válido.");
          const supplier = sanitizeManagedText(data.get("supplier"), "El proveedor", 90);
          const date = sanitizeManagedText(data.get("date"), "La fecha", 10);
          const status = sanitizeManagedText(data.get("status"), "El estado", 30);
          const row = [id, supplier, date, status, formatCOP(total)];
          const details = JSON.parse(localStorage.getItem("yesmau_purchase_details") || "{}");
          details[id] = {
            id,
            supplier,
            deliveryDate: date,
            status,
            total,
            quantity,
            productSku: product.sku,
            productName: product.name,
            category: product.category,
            unitPrice: Number((total / quantity).toFixed(2)),
            createdAt: new Date().toISOString(),
            createdBy: currentUser?.name || "No registrado",
          };
          localStorage.setItem("yesmau_purchase_details", JSON.stringify(details));
          genericRows.compras.unshift(row);
          localStorage.setItem("yesmau_records_compras", JSON.stringify(genericRows.compras));
        } else if (module === "clientes") {
          await apiMock.createUser(Object.fromEntries(data));
        } else {
          const builders = {
            telas: () => [data.get("id"), data.get("material"), data.get("composition"), data.get("supplier"), data.get("available"), data.get("status")],
            retazos: () => [data.get("id"), data.get("fabric"), data.get("size"), data.get("suggestion"), data.get("status")],
            proveedores: () => [data.get("name"), data.get("phone"), data.get("email"), data.get("address"), data.get("specialty"), data.get("rating"), data.get("status")],
            incidencias: () => [data.get("id"), data.get("subject"), data.get("responsible"), data.get("priority"), data.get("status")],
          };
          genericRows[module].unshift(builders[module]());
          localStorage.setItem(`yesmau_records_${module}`, JSON.stringify(genericRows[module]));
        }
        if (module !== "clientes") apiMock.recordAudit("REGISTRO_CREADO", `${moduleConfig[module].title} · ${currentUser?.name || "Usuario"}`);
        closeModal();
        await renderView(module);
        showToast(`${moduleConfig[module].action} completado correctamente`);
      } else {
        closeModal();
        showToast("Registro guardado correctamente");
      }
    } catch (error) {
      showToast(error?.name === "QuotaExceededError"
        ? "No hay espacio local suficiente para guardar la imagen. Usa un archivo más pequeño."
        : error.message, true);
    }
  });
}

function showReadOnlyModal(kicker, title, description, details) {
  $("#modalContent").innerHTML = `
    <p class="eyebrow">${kicker}</p>
    <h2 id="modalTitle">${escapeHtml(title)}</h2>
    <p class="modal-desc">${escapeHtml(description)}</p>
    <dl class="record-details">
      ${details.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("")}
    </dl>
    <div class="modal-actions"><button type="button" class="button button-primary" data-cancel>Cerrar</button></div>`;
  $("#modalBackdrop").hidden = false;
  document.body.style.overflow = "hidden";
  $("[data-cancel]").addEventListener("click", closeModal);
}

function openInvoiceDetails(id) {
  const sale = sales.find(record => record[0] === id);
  if (!sale) return showToast("No se encontró la factura solicitada", true);
  const quantityMatch = String(sale[2]).match(/^(\d+)\s*×\s*(.+)$/);
  const quantity = Number(quantityMatch?.[1] || 1);
  const productName = quantityMatch?.[2] || sale[2];
  const product = inventoryProducts.find(item => item.name === productName);
  const totalValue = normalizeCOPAmount(sale[7]);
  const invoice = {
    number: sale[0],
    client: sale[1],
    detail: sale[2],
    gateway: sale[3],
    paymentMethod: sale[4],
    date: sale[5],
    status: sale[6],
    subtotal: formatCOP(totalValue),
    total: formatCOP(totalValue),
  };
  $(".modal").classList.add("invoice-detail-modal");
  $("#modalContent").innerHTML = `
    <div class="invoice-header"><div><p class="eyebrow">COMPROBANTE INTERNO DE VENTA</p><h2 id="modalTitle">${escapeHtml(sale[0])}</h2><span>YESMAU · Gestión textil</span></div><span class="status ${statusClass(sale[6])}">${escapeHtml(sale[6])}</span></div>
    <div class="invoice-demo-alert">${icon("alert")} Documento operativo basado en la venta registrada. No reemplaza una factura electrónica fiscal.</div>
    <dl class="record-details invoice-summary"><div><dt>Cliente</dt><dd>${escapeHtml(sale[1])}</dd></div><div><dt>Fecha</dt><dd>${escapeHtml(sale[5])}</dd></div><div><dt>Canal</dt><dd>${escapeHtml(sale[3])}</dd></div><div><dt>Método y referencia</dt><dd>${escapeHtml(sale[4])}</dd></div></dl>
    <div class="table-scroll invoice-lines"><table><thead><tr><th>SKU</th><th>ARTÍCULO</th><th>CANTIDAD</th><th>VALOR UNITARIO</th><th>SUBTOTAL</th></tr></thead><tbody><tr><td>${escapeHtml(product?.sku || "No registrado")}</td><td><strong>${escapeHtml(productName)}</strong></td><td>${quantity}</td><td>${formatCOP(totalValue / quantity)}</td><td><strong>${formatCOP(totalValue)}</strong></td></tr></tbody></table></div>
    <div class="invoice-totals"><div><span>Subtotal</span><strong>${formatCOP(totalValue)}</strong></div><div><span>Impuestos</span><strong>No discriminados</strong></div><div class="invoice-grand-total"><span>Total registrado</span><strong>${formatCOP(totalValue)}</strong></div></div>
    <div class="modal-actions invoice-actions"><button type="button" class="button button-secondary" data-invoice-pdf>${icon("receipt")} Descargar PDF</button><button type="button" class="button button-secondary" data-invoice-xlsx>${icon("chart")} Descargar XLSX</button><button type="button" class="button button-primary" data-cancel>Cerrar</button></div>`;
  $("#modalBackdrop").hidden = false;
  document.body.style.overflow = "hidden";
  $("[data-cancel]").addEventListener("click", closeModal);
  $("[data-invoice-pdf]").addEventListener("click", () => downloadDocument(createInvoicePdf(invoice), `${sale[0]}.pdf`));
  $("[data-invoice-xlsx]").addEventListener("click", () => downloadDocument(createInvoiceXlsx(invoice), `${sale[0]}.xlsx`));
}

function downloadDocument(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function showStoreProductDetails(product, catalogProduct) {
  const image = safeProductImageSource(catalogProduct?.image);
  const description = product.characteristics || catalogProduct?.description || "Sin descripción registrada";
  $(".modal").classList.add("product-detail-modal");
  $("#modalContent").innerHTML = `
    <div class="product-detail-image"><img src="${escapeAttribute(image)}" alt="${escapeAttribute(product.name)}"></div>
    <p class="eyebrow">DETALLE DEL ARTÍCULO</p>
    <h2 id="modalTitle">${escapeHtml(product.name)}</h2>
    <dl class="record-details product-detail-grid">
      <div><dt>SKU</dt><dd>${escapeHtml(product.sku)}</dd></div>
      <div><dt>Nombre</dt><dd>${escapeHtml(product.name)}</dd></div>
      <div><dt>Clase</dt><dd>${escapeHtml(product.articleType || "Prenda")}</dd></div>
      <div><dt>Tipo de prenda</dt><dd>${escapeHtml(product.type || product.category || product.articleType || "No registrado")}</dd></div>
      <div class="product-detail-description"><dt>Descripción</dt><dd>${escapeHtml(description)}</dd></div>
      <div><dt>Talla</dt><dd>${escapeHtml(product.size || catalogProduct?.size || "No registrada")}</dd></div>
      <div><dt>Color</dt><dd>${escapeHtml(product.color || catalogProduct?.color || "No registrado")}</dd></div>
      <div><dt>Cantidad disponible</dt><dd>${escapeHtml(`${product.stock} ${product.articleType === "Tela" ? "metros" : "unidades"}`)}</dd></div>
      <div><dt>Precio</dt><dd>${escapeHtml(formatCOP(product.price))}</dd></div>
      <div><dt>Proveedor</dt><dd>${escapeHtml(product.supplier || catalogProduct?.supplier || "No registrado")}</dd></div>
      <div><dt>Estado</dt><dd>${escapeHtml(product.status || "No registrado")}</dd></div>
    </dl>
    <div class="modal-actions"><button type="button" class="button button-primary" data-cancel>Cerrar</button></div>`;
  $("#modalBackdrop").hidden = false;
  document.body.style.overflow = "hidden";
  $("[data-cancel]").addEventListener("click", closeModal);
}

function showPurchaseDetails(id) {
  const row = genericRows.compras.find(item => item[0] === id);
  if (!row) return showToast("No se encontró la orden de compra", true);
  const details = JSON.parse(localStorage.getItem("yesmau_purchase_details") || "{}")[id] || {};
  const catalogProduct = clientProducts.find(item => item.id === details.productSku)
    || clientProducts.find(item => item.name === details.productName);
  const image = safeProductImageSource(catalogProduct?.image);
  $(".modal").classList.add("product-detail-modal");
  $("#modalContent").innerHTML = `
    <div class="product-detail-image purchase-detail-image"><img src="${escapeAttribute(image)}" alt="${escapeAttribute(details.productName || "Artículo sin imagen registrada")}"></div>
    <p class="eyebrow">DETALLE DE COMPRA</p><h2 id="modalTitle">${escapeHtml(id)}</h2>
    <dl class="record-details product-detail-grid">
      <div><dt>Artículo</dt><dd>${escapeHtml(details.productName || "No registrado en esta orden")}</dd></div>
      <div><dt>SKU</dt><dd>${escapeHtml(details.productSku || "No registrado")}</dd></div>
      <div><dt>Categoría</dt><dd>${escapeHtml(details.category || "No registrada")}</dd></div>
      <div><dt>Cantidad</dt><dd>${escapeHtml(details.quantity || "No registrada")}</dd></div>
      <div><dt>Proveedor</dt><dd>${escapeHtml(details.supplier || row[1])}</dd></div>
      <div><dt>Entrega prevista</dt><dd>${escapeHtml(details.deliveryDate || row[2])}</dd></div>
      <div><dt>Estado</dt><dd><span class="status ${statusClass(details.status || row[3])}">${escapeHtml(details.status || row[3])}</span></dd></div>
      <div><dt>Valor unitario</dt><dd>${details.unitPrice != null ? formatCOP(details.unitPrice) : "No registrado"}</dd></div>
      <div><dt>Total</dt><dd>${details.total != null ? formatCOP(details.total) : escapeHtml(row[4])}</dd></div>
      <div><dt>Registrado por</dt><dd>${escapeHtml(details.createdBy || "No registrado")}</dd></div>
    </dl>
    ${!details.productName ? `<p class="integration-note">${icon("alert")} Esta orden fue creada antes de habilitar el vínculo con artículos; por eso no tiene imagen específica registrada.</p>` : ""}
    <div class="modal-actions"><button type="button" class="button button-primary" data-cancel>Cerrar</button></div>`;
  $("#modalBackdrop").hidden = false;
  document.body.style.overflow = "hidden";
  $("[data-cancel]").addEventListener("click", closeModal);
}

function openRecordDetails(module, id) {
  if (module === "tienda") {
    const catalogProduct = clientProducts.find(item => item.id === id);
    const product = inventoryProducts.find(item => item.sku === id)
      || inventoryProducts.find(item => item.name === catalogProduct?.name);
    if (!catalogProduct && !product) return showToast("No se encontró el artículo solicitado", true);
    showStoreProductDetails(product || {
      sku: catalogProduct.id,
      name: catalogProduct.name,
      category: catalogProduct.category,
      stock: catalogProduct.stock,
      price: catalogProduct.price,
      status: stockStatus(catalogProduct.stock),
    }, catalogProduct);
    return;
  }
  if (module === "compras") {
    showPurchaseDetails(id);
    return;
  }
  const source = module === "inventario"
    ? inventoryProducts.map(product => [product.sku, product.name, product.category, formatCOP(product.price), `${product.stock} unidades`, product.status])
    : genericRows[module];
  const record = source?.find(row => row[0] === id);
  if (!record) return showToast("No se encontró el registro solicitado", true);
  showReadOnlyModal("DETALLE DEL REGISTRO", id, `Información registrada en ${moduleConfig[module].title.toLowerCase()}.`, moduleConfig[module].columns.map((column, index) => [column, record[index]]));
}

function openOrderStatus(id) {
  const order = orders.find(item => item.id === id);
  if (!order) return showToast("No se encontró el pedido solicitado", true);
  const statuses = ["Pendiente", "Pago recibido", "En producción", "Control de calidad", "Enviado", "Entregado", "Cancelado"];
  $("#modalContent").innerHTML = modalBase("SEGUIMIENTO DEL PEDIDO", `Actualizar ${order.id}`, `${order.client} · ${order.product}. El nuevo estado se reflejará también en la vista general.`, `
    <div class="field full"><label>Estado del pedido</label><select name="status">${statuses.map(status => `<option ${status === order.status ? "selected" : ""}>${status}</option>`).join("")}</select></div>
    <div class="field full"><label>Notificación</label><input value="${escapeAttribute(order.email)}" readonly></div>`, "Actualizar estado");
  $("#modalBackdrop").hidden = false;
  document.body.style.overflow = "hidden";
  $("[data-cancel]").addEventListener("click", closeModal);
  $("#modalForm").addEventListener("submit", async event => {
    event.preventDefault();
    const status = new FormData(event.currentTarget).get("status");
    order.status = status;
    order.type = /cancelado/i.test(status) ? "danger" : /pendiente/i.test(status) ? "warning" : /en producción|control de calidad/i.test(status) ? "info" : "success";
    localStorage.setItem("yesmau_orders", JSON.stringify(orders));
    if (order.clientUserId) {
      const clientOrdersKey = clientStorageKeyFor("orders", order.clientUserId);
      const clientOrders = JSON.parse(localStorage.getItem(clientOrdersKey) || "[]");
      const clientOrder = clientOrders.find(item => item.id === (order.clientOrderId || order.id));
      if (clientOrder) {
        clientOrder.status = status;
        clientOrder.tracking = `Estado actualizado por YESMAU: ${status}`;
        localStorage.setItem(clientOrdersKey, JSON.stringify(clientOrders));
      }
      const notificationKey = clientStorageKeyFor("notifications", order.clientUserId);
      const notifications = JSON.parse(localStorage.getItem(notificationKey) || "[]");
      notifications.unshift({ title: `Tu pedido ${order.id} fue actualizado`, detail: `Nuevo estado: ${status} · ahora`, unread: true });
      localStorage.setItem(notificationKey, JSON.stringify(notifications.slice(0, 50)));
    }
    apiMock.recordAudit("PEDIDO_ACTUALIZADO", `${order.id} · ${status}`);
    closeModal();
    await renderView(activeView);
    showToast(`${order.id} actualizado a “${status}”`);
  });
}

function openIncidentStatus(id) {
  const incident = genericRows.incidencias.find(item => item[0] === id);
  if (!incident) return showToast("No se encontró la incidencia solicitada", true);
  const statuses = ["Abierta", "En proceso", "En revisión", "Resuelta", "Cerrada"];
  $("#modalContent").innerHTML = modalBase("GESTIÓN DE INCIDENCIAS", `Actualizar ${incident[0]}`, `${incident[1]} · Responsable: ${incident[2]} · Prioridad: ${incident[3]}.`, `
    <div class="field full"><label>Estado de la incidencia</label><select name="status">${statuses.map(status => `<option ${status === incident[4] ? "selected" : ""}>${status}</option>`).join("")}</select></div>
    <div class="field full"><label>Observación de seguimiento</label><textarea name="note" placeholder="Describe el avance o la solución aplicada" required></textarea></div>`, "Actualizar incidencia");
  $("#modalBackdrop").hidden = false;
  document.body.style.overflow = "hidden";
  $("[data-cancel]").addEventListener("click", closeModal);
  $("#modalForm").addEventListener("submit", async event => {
    event.preventDefault();
    const status = new FormData(event.currentTarget).get("status");
    incident[4] = status;
    localStorage.setItem("yesmau_records_incidencias", JSON.stringify(genericRows.incidencias));
    closeModal();
    await renderView("incidencias");
    showToast(`${incident[0]} actualizada a “${status}”`);
  });
}

function openProfileDetails() {
  const permissions = apiMock.getCurrentPermissions();
  showReadOnlyModal("MI PERFIL", currentUser.name, "Información asociada a tu cuenta y permisos actuales.", [
    ["Nombre", currentUser.name],
    ["Correo", currentUser.email],
    ["Tipo de documento", currentUser.documentType || "No registrado"],
    ["Documento", currentUser.document || "No registrado"],
    ["Rol", currentUser.role],
    ["Estado", currentUser.status],
    ["Permisos", permissions.length ? permissions.map(permissionLabel).join(", ") : "Sin permisos adicionales"],
    ["Cuenta verificada", currentUser.verified ? "Sí" : "No"],
    ["Fecha de creación", currentUser.createdAt ? new Date(currentUser.createdAt).toLocaleDateString("es-CO") : "No disponible"],
  ]);
}

async function openUserEditor(id) {
  try {
    const user = (await apiMock.listUsers()).find((item) => item.id === id);
    const roles = await apiMock.listRoles();
    $("#modalContent").innerHTML = modalBase("GESTIÓN DE USUARIOS", "Editar usuario", "Actualiza los datos, el rol o el estado de la cuenta.", `
      <div class="field full"><label>Nombre</label><input name="name" value="${escapeAttribute(user.name)}" pattern="[A-Za-zÁÉÍÓÚÜÑáéíóúüñ ]+" required></div>
      <div class="field full"><label>Correo</label><input value="${escapeAttribute(user.email)}" readonly></div>
      <div class="field"><label>Rol</label><select name="role">${roles.map(role => `<option ${role.name === user.role ? "selected" : ""}>${role.name}</option>`).join("")}</select></div>
      <div class="field"><label>Estado</label><select name="status"><option ${user.status === "Activo" ? "selected" : ""}>Activo</option><option ${user.status === "Inactivo" ? "selected" : ""}>Inactivo</option></select></div>
      <div class="field full"><label>Creado</label><input value="${escapeAttribute(new Date(user.createdAt).toLocaleString("es-CO"))}" readonly></div>`, "Actualizar usuario");
    $("#modalBackdrop").hidden = false;
    document.body.style.overflow = "hidden";
    $("[data-cancel]").addEventListener("click", closeModal);
    $("#modalForm").addEventListener("submit", async event => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      try {
        await apiMock.updateUser(id, Object.fromEntries(data));
        closeModal();
        await renderView("clientes");
        showToast("Usuario actualizado correctamente");
      } catch (error) { showToast(error.message, true); }
    });
  } catch (error) { showToast(error.message, true); }
}

async function openRolePermissions(id) {
  try {
    const role = (await apiMock.listRoles()).find((item) => item.id === id);
    const permissions = apiMock.getPermissions();
    const lockedRole = ["Administrador", "Administradora"].includes(role.name);
    $("#modalContent").innerHTML = modalBase("MATRIZ DE PERMISOS", role.name, role.description, `<div class="field full"><label>Funcionalidades habilitadas</label><div class="permission-grid">${permissions.map(permission => lockedRole ? `<div class="permission-check permission-locked">${icon("settings")}<span>${permissionLabel(permission)}</span><small>Incluido</small></div>` : `<label class="permission-check"><input name="permissions" type="checkbox" value="${permission}" ${role.permissions.includes(permission) ? "checked" : ""}><span>${permissionLabel(permission)}</span></label>`).join("")}</div></div>`, lockedRole ? "Cerrar" : "Guardar permisos");
    $("#modalBackdrop").hidden = false;
    document.body.style.overflow = "hidden";
    $("[data-cancel]").addEventListener("click", closeModal);
    $("#modalForm").addEventListener("submit", async event => {
      event.preventDefault();
      try {
        if (lockedRole) {
          closeModal();
          return;
        }
        const data = new FormData(event.currentTarget);
        await apiMock.updateRole(id, data.getAll("permissions"));
        closeModal();
        await renderView("roles");
        showToast("Permisos actualizados correctamente");
      } catch (error) { showToast(error.message, true); }
    });
  } catch (error) { showToast(error.message, true); }
}

function bindModalCalculators(type) {
  const inputs = $$("#modalForm input, #modalForm select");
  if (type === "fabric") {
    const calculate = () => {
      const values = inputs.map(input => Number(input.value || input.querySelector?.("option:checked")?.value || 1));
      const garment = Number($("#garment").value);
      const size = Number($("#size").value);
      const quantity = Number($('input[type="number"]', $("#modalForm")).value || 1);
      $("#fabricResult").textContent = `${(garment * size * quantity * 1.12).toFixed(2)} metros`;
    };
    inputs.forEach(input => input.addEventListener("input", calculate));
  }
  if (type === "sale") {
    const product = $("#saleProduct");
    const quantity = $("#saleQuantity");
    const paymentMethod = $("#salePaymentMethod");
    const updateSale = () => {
      const option = product.selectedOptions[0];
      const price = Number(option?.dataset.price || 0);
      const stock = Number(option?.dataset.stock || 1);
      quantity.max = String(stock);
      if (Number(quantity.value) > stock) quantity.value = String(stock);
      $("#salePrice").value = String(Math.round(price * Number(quantity.value || 1)));
      $("#saleUnitPrice").textContent = formatCOP(price);
    };
    const updateGateway = () => {
      const gateway = paymentMethod.selectedOptions[0].dataset.gateway;
      $("#saleGateway").value = gateway;
      $("#salePaymentReference").placeholder = gateway === "CAJA" ? "Ej. RC-0091" : paymentMethod.value === "PSE" ? "Ej. CUS 184025" : "Ej. •••• 4242 o ID de transacción";
    };
    product.addEventListener("change", updateSale);
    quantity.addEventListener("input", updateSale);
    paymentMethod.addEventListener("change", updateGateway);
  }
}

function closeModal() {
  $("#modalBackdrop").hidden = true;
  $(".modal").classList.remove("store-product-modal", "product-detail-modal", "scrap-detail-modal", "invoice-detail-modal");
  pendingStoreImage = null;
  storeImageValidationPending = false;
  document.body.style.overflow = "";
}

let toastTimer;
function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 2600);
}

$$(".nav-item").forEach(item => item.addEventListener("click", () => {
  renderView(item.dataset.view);
  closeSidebar();
}));

const sidebar = $("#sidebar");
const overlay = $("#sidebarOverlay");
function closeSidebar() { sidebar.classList.remove("open"); overlay.classList.remove("open"); }
$("#mobileMenu").addEventListener("click", () => {
  if (window.innerWidth <= 780) {
    sidebar.classList.add("open");
    overlay.classList.add("open");
    return;
  }
  $("#appShell").classList.toggle("sidebar-collapsed");
  localStorage.setItem("yesmau_sidebar_collapsed", String($("#appShell").classList.contains("sidebar-collapsed")));
});
$("#sidebarClose").addEventListener("click", closeSidebar);
overlay.addEventListener("click", closeSidebar);

$("#modalClose").addEventListener("click", closeModal);
$("#modalBackdrop").addEventListener("click", event => { if (event.target === event.currentTarget) closeModal(); });
document.addEventListener("keydown", event => {
  if (event.key === "Escape") { closeModal(); closeSidebar(); $$(".popover").forEach(popover => popover.classList.remove("open")); setProfileMenu(false); }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); $("#globalSearch").focus(); }
});

function setProfileMenu(open) {
  $("#profilePanel").classList.toggle("open", open);
  $("#profileBtn").setAttribute("aria-expanded", String(open));
}

$("#notificationBtn").addEventListener("click", event => {
  event.stopPropagation();
  setProfileMenu(false);
  $("#notificationPanel").classList.toggle("open");
});
$("#profileBtn").addEventListener("click", event => {
  event.stopPropagation();
  $("#notificationPanel").classList.remove("open");
  setProfileMenu(!$("#profilePanel").classList.contains("open"));
});
document.addEventListener("click", event => {
  if (!event.target.closest(".popover")) {
    $$(".popover").forEach(popover => popover.classList.remove("open"));
    setProfileMenu(false);
  }
});
$("[data-close-popover]").addEventListener("click", () => {
  $$(".notice").forEach(notice => notice.classList.remove("unread"));
  $(".notification-button span").hidden = true;
  showToast("Notificaciones marcadas como leídas");
});
$$("[data-action]").forEach(button => button.addEventListener("click", () => {
  setProfileMenu(false);
  if (button.dataset.action === "seguridad") {
    $("#modalContent").innerHTML = modalBase("SEGURIDAD", "Restablecer contraseña", "Enviaremos un enlace seguro al correo asociado a tu cuenta.", `${field("Correo electrónico", "email", "admin@yesmau.com", true)}`, "Enviar enlace");
    $("#modalBackdrop").hidden = false;
    document.body.style.overflow = "hidden";
    $("[data-cancel]").addEventListener("click", closeModal);
    $("#modalForm").addEventListener("submit", event => { event.preventDefault(); closeModal(); showToast("Enlace de recuperación enviado"); });
  } else if (button.dataset.action === "salir") {
    apiMock.logout();
    currentUser = null;
    showPublicStore();
    showToast("Sesión cerrada de forma segura");
  } else {
    openProfileDetails();
  }
}));

const whatsappConfig = JSON.parse(localStorage.getItem("yesmau_whatsapp_config") || '{"number":"","display":"WhatsApp por configurar","message":"Hola YESMAU, necesito ayuda"}');
const whatsappUrl = whatsappConfig.number
  ? `https://wa.me/${whatsappConfig.number}?text=${encodeURIComponent(whatsappConfig.message)}`
  : "https://wa.me/";
$("#whatsappBtn").addEventListener("click", () => {
  window.open(whatsappUrl, "_blank", "noopener");
});
$("#cartBtn").addEventListener("click", () => {
  if (isClientRole()) renderView("client-cart");
});
$("#whatsappNumber").textContent = whatsappConfig.display;
if (whatsappUrl) $("#whatsappWidget").href = whatsappUrl;

function renderGlobalProductResults(term) {
  const panel = $("#globalSearchResults");
  const query = String(term || "").trim().toLowerCase();
  if (query.length < 2) {
    panel.hidden = true;
    panel.innerHTML = "";
    $("#globalSearch").setAttribute("aria-expanded", "false");
    return;
  }
  const matches = clientProducts.filter(product =>
    `${product.name} ${product.category} ${product.description}`.toLowerCase().includes(query),
  ).slice(0, 7);
  panel.innerHTML = matches.length
    ? matches.map(product => `<button type="button" role="option" data-global-product="${escapeAttribute(product.name)}"><img src="${escapeAttribute(safeProductImageSource(product.image))}" alt=""><span><strong>${escapeHtml(product.name)}</strong><small>${escapeHtml(product.category)} · ${escapeHtml(product.description)}</small></span>${icon("arrow")}</button>`).join("")
    : `<div class="global-search-empty">No hay artículos relacionados con “${escapeHtml(term)}”.</div>`;
  panel.hidden = false;
  $("#globalSearch").setAttribute("aria-expanded", "true");
}

$("#globalSearch").setAttribute("aria-controls", "globalSearchResults");
$("#globalSearch").setAttribute("aria-expanded", "false");
$("#globalSearch").addEventListener("input", event => renderGlobalProductResults(event.target.value));
$("#globalSearch").addEventListener("focus", event => renderGlobalProductResults(event.target.value));
document.addEventListener("click", event => {
  if (!event.target.closest(".global-search")) {
    $("#globalSearchResults").hidden = true;
    $("#globalSearch").setAttribute("aria-expanded", "false");
  }
});
$("#globalSearchResults").addEventListener("click", async event => {
  const button = event.target.closest("[data-global-product]");
  if (!button) return;
  const productName = button.dataset.globalProduct;
  $("#globalSearch").value = productName;
  renderGlobalProductResults("");
  if (isClientRole()) {
    pendingClientSearch = productName.toLowerCase();
    await renderView("client-shop");
  } else {
    await renderView("tienda");
    const search = $("#moduleSearch");
    if (search) {
      search.value = productName;
      search.dispatchEvent(new Event("input"));
    }
  }
  showToast(`Mostrando artículos relacionados con “${productName}”`);
});

$("#globalSearch").addEventListener("keydown", async event => {
  if (event.key !== "Enter") return;
  const term = event.target.value.trim().toLowerCase();
  if (!term) return;
  renderGlobalProductResults("");
  if (isClientRole()) {
    const clientTarget = /pedido|seguimiento|entrega/.test(term)
      ? "client-orders"
      : /incidencia|reclamo|problema|soporte/.test(term)
        ? "client-incidents"
      : /carrito|compra|pago/.test(term)
        ? "client-cart"
        : clientProducts.some(product => `${product.name} ${product.category} ${product.description}`.toLowerCase().includes(term)) || /tienda|colecci[oó]n|prenda|artículo|tela|camisa|blusa|pantal[oó]n|vestido/.test(term)
        ? "client-shop"
        : "";
    if (!clientTarget) return showToast(`No se encontraron resultados para “${event.target.value.trim()}”`, true);
    if (clientTarget === "client-shop") pendingClientSearch = term;
    await renderView(clientTarget);
    event.target.value = "";
    return showToast(clientTarget === "client-orders" ? "Mostrando tus pedidos" : clientTarget === "client-cart" ? "Mostrando tu carrito" : "Mostrando artículos de la tienda");
  }
  if (isEmployeeRole()) {
    const employeeTarget = /incidencia|reclamo|problema/.test(term)
      ? "incidencias"
      : /venta|factura|comprobante|pago/.test(term)
        ? "ventas"
      : /materia prima|material|hilo|bot[oó]n|hilaza/.test(term)
        ? "telas"
        : /retazo|sobrante|desperdicio|corte|yesmau ia|\bia\b/.test(term)
          ? "retazos"
          : "tienda";
    await renderView(employeeTarget);
    const moduleSearch = $("#moduleSearch");
    if (moduleSearch && !moduleConfig[employeeTarget].title.toLowerCase().includes(term) && !employeeTarget.includes(term)) {
      moduleSearch.value = term;
      moduleSearch.dispatchEvent(new Event("input"));
    }
    event.target.value = "";
    return showToast(`Mostrando resultados en ${moduleConfig[employeeTarget].title}`);
  }
  if (isAdminRole() && /contenido|imagen|portada|título|titulo|subtítulo|subtitulo|fórmula|formula|precio de prenda|costos/.test(term)) {
    const adminTarget = /fórmula|formula|precio de prenda|costos/.test(term) ? "precios" : "contenido";
    await renderView(adminTarget);
    event.target.value = "";
    return showToast(adminTarget === "precios" ? "Mostrando el cálculo de precios" : "Mostrando el gestor de contenido web");
  }
  let target = Object.keys(moduleConfig).find(key => moduleConfig[key].title.toLowerCase().includes(term) || key.includes(term));
  if (!target) {
    const searchable = {
      pedidos: orders.map(order => Object.values(order)),
      inventario: inventoryProducts.map(product => Object.values(product)),
      ventas: sales,
      compras: genericRows.compras,
      telas: operationsModel.listMaterials().map(item => Object.values(item)),
      retazos: operationsModel.listScraps().map(item => Object.values(item)),
      proveedores: genericRows.proveedores,
      incidencias: operationsModel.listIncidents(currentUser).map(item => Object.values(item)),
      clientes: (await apiMock.listUsers()).map(user => Object.values(user)),
      roles: (await apiMock.listRoles()).map(role => Object.values(role)),
    };
    target = Object.keys(searchable).find(key => searchable[key].some(record => record.flat(2).join(" ").toLowerCase().includes(term)));
  }
  if (!target) return showToast(`No se encontraron resultados para “${event.target.value.trim()}”`, true);
  await renderView(target);
  const moduleSearch = $("#moduleSearch");
  if (moduleSearch && !moduleConfig[target].title.toLowerCase().includes(term) && !target.includes(term)) {
    moduleSearch.value = event.target.value.trim();
    moduleSearch.dispatchEvent(new Event("input"));
  }
  event.target.value = "";
  showToast(`Resultados encontrados en ${moduleConfig[target].title}`);
});

function authTemplate(view) {
  const headings = {
    login: ["BIENVENIDA DE NUEVO", "Accede a tu espacio", "Gestiona tu taller, inventario y ventas desde un solo lugar."],
    register: ["CREA TU CUENTA", "Comienza con YESMAU", "Registra tus datos para crear un espacio de trabajo seguro."],
    recovery: ["RECUPERA TU ACCESO", "Restablece tu contraseña", "Escribe tu correo y te enviaremos un enlace seguro."],
    verify: ["VERIFICA TU CUENTA", "Confirma tu correo", `Ingresa el código de seis dígitos enviado a ${pendingAuthEmail}.`],
    reset: ["NUEVA CONTRASEÑA", "Crea una clave segura", "El código es válido durante cinco minutos."],
  };
  const [kicker, title, description] = headings[view];
  let form = "";

  if (view === "login") {
    form = `
      <div class="auth-field"><label for="loginEmail">Correo electrónico</label><input id="loginEmail" name="email" type="email" autocomplete="email" placeholder="nombre@empresa.com" required><p class="field-error" data-error="email"></p></div>
      <div class="auth-field"><div class="auth-label-row"><label for="loginPassword">Contraseña</label><button class="auth-link" type="button" data-auth-view="recovery">¿La olvidaste?</button></div><div class="password-wrap"><input id="loginPassword" name="password" type="password" autocomplete="current-password" placeholder="Tu contraseña" required><button class="password-toggle" type="button" data-password-toggle>Ver</button></div><p class="field-error" data-error="password"></p></div>
      <label class="check-row"><input name="remember" type="checkbox"><span>Mantener mi sesión iniciada en este dispositivo.</span></label>
      <button class="button button-primary auth-submit" type="submit">Ingresar a YESMAU</button>
      <p class="auth-switch">¿Aún no tienes cuenta? <button class="auth-link" type="button" data-auth-view="register">Crear cuenta</button></p>`;
  } else if (view === "register") {
    form = `
      <div class="auth-form-row"><div class="auth-field"><label for="registerFirstName">Nombres</label><input id="registerFirstName" name="firstName" type="text" autocomplete="given-name" maxlength="50" placeholder="Tus nombres" required><p class="field-error" data-error="firstName"></p></div><div class="auth-field"><label for="registerLastName">Apellidos</label><input id="registerLastName" name="lastName" type="text" autocomplete="family-name" maxlength="50" placeholder="Tus apellidos" required><p class="field-error" data-error="lastName"></p></div></div>
      <div class="auth-field"><label for="registerEmail">Correo electrónico</label><input id="registerEmail" name="email" type="email" autocomplete="email" placeholder="nombre@empresa.com" required><p class="field-error" data-error="email"></p></div>
      <div class="auth-form-row"><div class="auth-field"><label for="registerDocumentType">Tipo de documento</label><select id="registerDocumentType" name="documentType" required><option value="">Selecciona</option><option value="CC">Cédula de ciudadanía</option><option value="CE">Cédula de extranjería</option><option value="TI">Tarjeta de identidad</option><option value="PA">Pasaporte</option><option value="NIT">NIT</option></select><p class="field-error" data-error="documentType"></p></div><div class="auth-field"><label for="registerDocument">Número de documento</label><input id="registerDocument" name="document" type="text" maxlength="20" placeholder="Letras y números" required><p class="field-error" data-error="document"></p></div></div>
      <div class="auth-field"><label for="registerBirthDate">Fecha de nacimiento</label><input id="registerBirthDate" name="birthDate" type="date" required><p class="field-error" data-error="birthDate"></p></div>
      <div class="auth-field"><label for="registerPassword">Contraseña segura</label><div class="password-wrap"><input id="registerPassword" name="password" type="password" autocomplete="new-password" maxlength="64" placeholder="Mínimo 8 caracteres" required><button class="password-toggle" type="button" data-password-toggle>Ver</button></div><div class="password-rules"><span data-rule="length">8 caracteres</span><span data-rule="upper">Una mayúscula</span><span data-rule="number">Un número</span><span data-rule="symbol">Un símbolo</span></div><p class="field-error" data-error="password"></p></div>
      <div class="auth-field"><label for="confirmPassword">Confirmar contraseña</label><input id="confirmPassword" name="confirmPassword" type="password" autocomplete="new-password" placeholder="Repite tu contraseña" required><p class="field-error" data-error="confirmPassword"></p></div>
      <label class="check-row"><input name="terms" type="checkbox"><span>Acepto los términos de servicio y la política de privacidad.</span></label>
      <button class="button button-primary auth-submit" type="submit">Crear mi cuenta</button>
      <p class="auth-switch">¿Ya tienes una cuenta? <button class="auth-link" type="button" data-auth-view="login">Iniciar sesión</button></p>`;
  } else if (view === "recovery") {
    form = `
      <div class="auth-field"><label for="recoveryEmail">Correo electrónico</label><input id="recoveryEmail" name="email" type="email" autocomplete="email" placeholder="nombre@empresa.com" required><p class="field-error" data-error="email"></p></div>
      <button class="button button-primary auth-submit" type="submit">Enviar enlace seguro</button>
      <p class="auth-switch"><button class="auth-link" type="button" data-auth-view="login">← Volver al inicio de sesión</button></p>`;
  } else if (view === "verify") {
    form = `
      <div class="auth-field"><label for="verificationCode">Código de verificación</label><input id="verificationCode" name="code" class="code-input" type="text" inputmode="numeric" maxlength="6" placeholder="000000" required><p class="field-error" data-error="code"></p></div>
      <button class="button button-primary auth-submit" type="submit">Verificar mi cuenta</button>
      <p class="auth-switch"><button class="auth-link" type="button" data-auth-view="register">Cambiar datos de registro</button></p>`;
  } else {
    form = `
      <div class="auth-field"><label for="recoveryCode">Código recibido</label><input id="recoveryCode" name="code" class="code-input" type="text" inputmode="numeric" maxlength="6" placeholder="000000" required><p class="field-error" data-error="code"></p></div>
      <div class="auth-field"><label for="resetPassword">Nueva contraseña</label><div class="password-wrap"><input id="resetPassword" name="password" type="password" autocomplete="new-password" maxlength="64" required><button class="password-toggle" type="button" data-password-toggle>Ver</button></div><p class="field-error" data-error="password"></p></div>
      <div class="auth-field"><label for="resetConfirm">Confirmar contraseña</label><input id="resetConfirm" name="confirmPassword" type="password" autocomplete="new-password" required><p class="field-error" data-error="confirmPassword"></p></div>
      <button class="button button-primary auth-submit" type="submit">Actualizar contraseña</button>`;
  }

  return `
    <div class="auth-visual">
      <div class="auth-brand"><span class="company-logo company-logo-auth"><img src="/assets/yesmau-logo.png" alt="YESMAU Ropa Casual"></span><div><strong>YESMAU</strong><small>GESTIÓN TEXTIL</small></div></div>
      <div class="auth-story"><p class="eyebrow">GESTIÓN HECHA A TU MEDIDA</p><h1>Diseña.<br>Produce.<br>Crece.</h1><p>Una plataforma pensada para marcas y talleres que transforman materiales en historias.</p><div class="auth-benefits"><span>Inventario conectado</span><span>Producción eficiente</span><span>Ventas en control</span></div></div>
      <p class="auth-copyright">© 2025 YESMAU · Hecho para crear con propósito.</p>
    </div>
    <div class="auth-panel"><button class="auth-store-back" type="button" data-public-store>${icon("arrow")} Volver a la tienda</button><button class="icon-button auth-theme-button" data-theme-toggle aria-label="Cambiar tema" title="Cambiar tema"><svg><use href="#i-moon"></use></svg></button><div class="auth-card"><div class="auth-heading"><p class="eyebrow">${kicker}</p><h2>${title}</h2><p>${description}</p></div><form class="auth-form" id="authForm" data-view="${view}" novalidate>${form}</form></div></div>`;
}

function setFieldError(form, name, message) {
  const input = form.elements[name];
  const target = $(`[data-error="${name}"]`, form);
  input?.classList.toggle("invalid", Boolean(message));
  if (target) target.textContent = message;
}

function validateAuthForm(form) {
  const view = form.dataset.view;
  const values = Object.fromEntries(new FormData(form));
  let valid = true;
  const checks = view === "recovery" || view === "login"
    ? { email: validators.email(values.email) }
    : view === "verify"
      ? { code: /^\d{6}$/.test(values.code || "") ? "" : "Ingresa el código de seis dígitos." }
      : view === "reset"
        ? {
            code: /^\d{6}$/.test(values.code || "") ? "" : "Ingresa el código de seis dígitos.",
            password: validators.password(values.password),
            confirmPassword: values.password === values.confirmPassword ? "" : "Las contraseñas no coinciden.",
          }
    : {
        firstName: validators.name(values.firstName),
        lastName: validators.name(values.lastName),
        email: validators.email(values.email),
        documentType: ["CC", "CE", "TI", "PA", "NIT"].includes(values.documentType) ? "" : "Selecciona un tipo de documento.",
        document: validators.document(values.document),
        birthDate: values.birthDate && new Date(values.birthDate) < new Date() ? "" : "Ingresa una fecha válida.",
        password: validators.password(values.password),
        confirmPassword: values.password === values.confirmPassword ? "" : "Las contraseñas no coinciden.",
      };
  if (view === "login" && !values.password) checks.password = "La contraseña es obligatoria.";
  Object.entries(checks).forEach(([name, message]) => {
    setFieldError(form, name, message);
    if (message) valid = false;
  });
  return { valid, values };
}

function bindAuth(view) {
  applyTheme(document.documentElement.dataset.theme, false);
  $("[data-public-store]")?.addEventListener("click", showPublicStore);
  $$("[data-auth-view]").forEach((button) => button.addEventListener("click", () => showAuth(button.dataset.authView)));
  $$("[data-password-toggle]").forEach((button) => button.addEventListener("click", () => {
    const input = button.previousElementSibling;
    input.type = input.type === "password" ? "text" : "password";
    button.textContent = input.type === "password" ? "Ver" : "Ocultar";
  }));

  const passwordInput = $("#registerPassword");
  passwordInput?.addEventListener("input", () => {
    const value = passwordInput.value;
    $('[data-rule="length"]').classList.toggle("valid", value.length >= 8);
    $('[data-rule="upper"]').classList.toggle("valid", /[A-Z]/.test(value));
    $('[data-rule="number"]').classList.toggle("valid", /\d/.test(value));
    $('[data-rule="symbol"]').classList.toggle("valid", /[!@#$%&*._-]/.test(value));
  });

  $("#authForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const result = validateAuthForm(form);
    if (!result.valid) {
      showToast("Revisa los campos señalados", true);
      return;
    }

    const button = $('button[type="submit"]', form);
    const originalText = button.textContent;
    button.disabled = true;
    button.textContent = "Procesando…";
    try {
      if (view === "login") {
        const response = await apiMock.login(result.values);
        currentUser = response.user;
        showApp();
        showToast(`Bienvenida, ${currentUser.name.split(" ")[0]}`);
      } else if (view === "register") {
        result.values.terms = form.elements.terms.checked;
        const response = await apiMock.register(result.values);
        pendingAuthEmail = response.email;
        sessionStorage.setItem("yesmau_pending_email", pendingAuthEmail);
        showAuth("verify");
        showToast(`Registro exitoso. Código de prueba: ${response.verificationCode}`);
      } else if (view === "verify") {
        await apiMock.verifyRegistration(pendingAuthEmail, result.values.code);
        showAuth("login");
        $("#loginEmail").value = pendingAuthEmail;
        showToast("Cuenta verificada. Ya puedes iniciar sesión.");
      } else if (view === "recovery") {
        const response = await apiMock.recoverPassword(result.values.email);
        pendingAuthEmail = response.email;
        sessionStorage.setItem("yesmau_pending_email", pendingAuthEmail);
        showAuth("reset");
        showToast(`${response.message} Código de prueba: ${response.code}`);
      } else {
        await apiMock.resetPassword({ ...result.values, email: pendingAuthEmail });
        showAuth("login");
        $("#loginEmail").value = pendingAuthEmail;
        showToast("Contraseña actualizada correctamente.");
      }
    } catch (error) {
      showToast(error.message, true);
    } finally {
      if (button.isConnected) {
        button.disabled = false;
        button.textContent = originalText;
      }
    }
  });
}

function showAuth(view = "login") {
  $("#appShell").hidden = true;
  $("#authRoot").hidden = false;
  $("#authRoot").classList.remove("public-mode");
  $("#authRoot").innerHTML = authTemplate(view);
  $("#whatsappWidget").hidden = true;
  document.body.style.overflow = "";
  bindAuth(view);
}

function showApp() {
  $("#authRoot").hidden = true;
  $("#authRoot").classList.remove("public-mode");
  $("#appShell").hidden = false;
  reconcileCurrentClientOrders();
  const names = currentUser.name.split(" ");
  $(".avatar").textContent = names.map((name) => name[0]).slice(0, 2).join("").toUpperCase();
  $(".profile-copy strong").textContent = currentUser.name;
  $(".profile-copy small").textContent = currentUser.role;
  $$(".nav-item").forEach(item => {
    const clientOnly = item.classList.contains("client-only");
    const adminOnly = item.classList.contains("admin-only");
    const dashboard = item.dataset.view === "dashboard";
    if (adminOnly) {
      item.hidden = !isAdminRole();
    } else if (clientOnly) {
      item.hidden = !isClientRole();
    } else if (isClientRole()) {
      item.hidden = !dashboard;
    } else if (isEmployeeRole()) {
      item.hidden = !employeeViews.includes(item.dataset.view);
    } else {
      item.hidden = false;
    }
  });
  $$(".nav-label").forEach(label => {
    let sibling = label.nextElementSibling;
    let hasVisibleItem = false;
    while (sibling && !sibling.classList.contains("nav-label")) {
      if (sibling.classList.contains("nav-item") && !sibling.hidden) hasVisibleItem = true;
      sibling = sibling.nextElementSibling;
    }
    label.hidden = !hasVisibleItem;
  });
  const clientMode = isClientRole();
  $("#sidebar").classList.toggle("client-mode", clientMode);
  const cartButton = $(".cart-button");
  const whatsappButton = $("#whatsappBtn");
  const whatsappWidget = $("#whatsappWidget");
  const aiUsagePanel = $("#aiUsagePanel");
  if (cartButton) cartButton.hidden = !clientMode;
  if (whatsappButton) whatsappButton.hidden = !clientMode;
  if (whatsappWidget) whatsappWidget.hidden = !clientMode || !whatsappConfig.number;
  if (aiUsagePanel) aiUsagePanel.hidden = true;
  syncNewOrdersBadge();
  if (clientMode) {
    syncClientBadges();
    renderClientNotifications();
    $("#globalSearch").placeholder = "Buscar productos, categorías o pedidos...";
  } else if (isEmployeeRole()) {
    $("#globalSearch").placeholder = "Buscar artículos o retazos inteligentes...";
  } else {
    $("#globalSearch").placeholder = "Buscar pedidos, artículos, clientes...";
  }
  $("#appShell").classList.toggle("sidebar-collapsed", localStorage.getItem("yesmau_sidebar_collapsed") === "true");
  renderView("dashboard");
}

function renderClientNotifications() {
  if (!currentUser || !isClientRole()) return;
  const stored = loadClientData("notifications", []);
  const notifications = stored.length ? stored : [
    { title: "Tu pedido YM-1048 está en camino", detail: "Consulta la guía desde Mis pedidos · hace 2 h", unread: true },
    { title: "Pago confirmado", detail: "Recibimos el pago de tu pedido · ayer", unread: false },
    { title: "Beneficio para clientes", detail: "Envío gratuito en compras seleccionadas · esta semana", unread: false },
  ];
  $("#notificationPanel").innerHTML = `<div class="popover-title"><strong>Notificaciones</strong><button data-client-read>Marcar leídas</button></div>${notifications.map(notice => `<div class="notice ${notice.unread ? "unread" : ""}"><span></span><div><strong>${escapeHtml(notice.title)}</strong><small>${escapeHtml(notice.detail)}</small></div></div>`).join("")}`;
  $(".notification-button span").hidden = !notifications.some(notice => notice.unread);
  $("[data-client-read]")?.addEventListener("click", () => {
    const read = notifications.map(notice => ({ ...notice, unread: false }));
    saveClientData("notifications", read);
    renderClientNotifications();
    showToast("Notificaciones marcadas como leídas");
  });
}

const originalShowToast = showToast;
showToast = function (message, isError = false) {
  originalShowToast(message);
  $("#toast").classList.toggle("error", isError);
  if (!isError) setTimeout(() => $("#toast").classList.remove("error"), 2700);
};

function applyTheme(theme, persist = true) {
  document.documentElement.dataset.theme = theme;
  if (persist) localStorage.setItem("yesmau_theme", theme);
  $$("[data-theme-toggle]").forEach(button => {
    const dark = theme === "dark";
    button.setAttribute("aria-label", dark ? "Activar modo claro" : "Activar modo oscuro");
    const use = $("use", button);
    if (use) use.setAttribute("href", dark ? "#i-sun" : "#i-moon");
  });
}

document.addEventListener("click", event => {
  const toggle = event.target.closest("[data-theme-toggle]");
  if (!toggle) return;
  applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
});

export async function bootstrap() {
  await apiMock.initialize();
  reconcileProductCollections();
  applyTheme(document.documentElement.dataset.theme, false);
  currentUser = await apiMock.getSession();
  if (currentUser) showApp();
  else showPublicStore();
}
