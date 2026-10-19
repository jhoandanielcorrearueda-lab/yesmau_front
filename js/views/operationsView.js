import { formatCOP } from "../models/storageModel.js";
import { escapeHtml, icon } from "./domView.js";

const attr = value => escapeHtml(value).replaceAll('"', "&quot;").replaceAll("'", "&#39;");
const localDate = value => new Date(value).toLocaleString("es-CO");
const today = () => new Date().toISOString().slice(0, 10);

function hero(kicker, title, description, iconName) {
  return `<section class="card module-hero"><div><p class="eyebrow">${kicker}</p><h1>${title}</h1><p>${description}</p></div><span class="hero-icon">${icon(iconName)}</span></section>`;
}

export function materialsTemplate(materials) {
  return `
    ${hero("CONTROL DE EXISTENCIAS", "Materias primas", "Registra insumos disponibles para compras, producción y control de inventario.", "scissors")}
    <div class="operations-layout">
      <section class="card operations-form-card">
        <p class="eyebrow">NUEVO REGISTRO</p><h2>Registrar materia prima</h2>
        <form id="materialForm" class="form-grid">
          <div class="field"><label>Nombre</label><input name="name" maxlength="90" required></div>
          <div class="field"><label>Código único</label><input name="code" maxlength="30" placeholder="MAT-0001" required></div>
          <div class="field"><label>Categoría</label><select name="category" required><option value="">Selecciona</option><option value="hilo">Hilo</option><option value="botón">Botón</option><option value="tela">Tela</option><option value="hilazas">Hilazas</option></select></div>
          <div class="field"><label>Unidad de medida</label><select name="unit" required><option value="">Selecciona</option><option>metros</option><option>unidades</option><option>kilogramos</option><option>rollos</option><option>conos</option></select></div>
          <div class="field"><label>Cantidad inicial</label><input name="quantity" type="number" min="0" step="0.01" required></div>
          <div class="field"><label>Costo de adquisición (COP)</label><input name="acquisitionCost" type="number" min="0" step="0.01" required></div>
          <div class="field full"><label>Proveedor opcional</label><input name="supplier" maxlength="90"></div>
          <div class="modal-actions full"><button class="button button-primary" type="submit">Registrar materia prima</button></div>
        </form>
      </section>
      <section class="card table-card operations-table-card">
        <div class="module-table-head"><div><p class="eyebrow">INVENTARIO</p><h2>Materias primas registradas</h2></div><small>${materials.length} registros</small></div>
        <div class="table-scroll"><table><thead><tr><th>CÓDIGO</th><th>NOMBRE</th><th>CATEGORÍA</th><th>UNIDAD</th><th>CANTIDAD</th><th>COSTO</th><th>PROVEEDOR</th><th>REGISTRADO POR</th></tr></thead>
        <tbody>${materials.length ? materials.map(item => `<tr><td><strong>${escapeHtml(item.code)}</strong></td><td>${escapeHtml(item.name)}</td><td>${escapeHtml(item.category)}</td><td>${escapeHtml(item.unit)}</td><td>${item.quantity.toFixed(2)}</td><td>${formatCOP(item.acquisitionCost)}</td><td>${escapeHtml(item.supplier || "No asignado")}</td><td>${escapeHtml(item.createdBy.name)}<small class="table-meta">${localDate(item.createdAt)}</small></td></tr>`).join("") : `<tr><td colspan="8" class="empty-search">No hay materias primas registradas.</td></tr>`}</tbody></table></div>
      </section>
    </div>`;
}

export function incidentsTemplate(incidents, { canManage = false, canReport = false } = {}) {
  return `
    ${hero("CALIDAD Y SOPORTE", "Reporte de incidencias", "Registra novedades y consulta su estado actual con trazabilidad.", "alert")}
    <div class="operations-layout ${canReport ? "" : "operations-layout-single"}">
      ${canReport ? `<section class="card operations-form-card">
        <p class="eyebrow">NUEVA INCIDENCIA</p><h2>Cuéntanos qué ocurrió</h2>
        <form id="incidentForm" class="form-grid">
          <div class="field full"><label>Título</label><input name="title" maxlength="120" required></div>
          <div class="field full"><label>Descripción</label><textarea name="description" maxlength="1200" required></textarea></div>
          <div class="field"><label>Categoría opcional</label><select name="category"><option value="">Sin categoría</option><option>Producto</option><option>Pedido</option><option>Pago</option><option>Producción</option><option>Servicio</option></select></div>
          <div class="field"><label>Adjuntos</label><input name="attachments" type="file" accept=".jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf" multiple><small>Máximo 5 archivos, 5 MB cada uno.</small></div>
          <div class="modal-actions full"><button class="button button-primary" type="submit">Reportar incidencia</button></div>
        </form>
        <p class="integration-note">${icon("alert")} El correo solo se envía si existe un endpoint configurado; el sistema nunca simula el envío.</p>
      </section>` : ""}
      <section class="card table-card operations-table-card">
        <div class="module-table-head"><div><p class="eyebrow">${canManage ? "SEGUIMIENTO GENERAL" : "MIS REPORTES"}</p><h2>Incidencias registradas</h2></div><small>${incidents.length} registros</small></div>
        <div class="table-scroll"><table><thead><tr><th>CÓDIGO</th><th>TÍTULO</th><th>CATEGORÍA</th><th>REPORTADO POR</th><th>FECHA</th><th>ESTADO</th>${canManage ? "<th>ACCIÓN</th>" : ""}</tr></thead>
        <tbody>${incidents.length ? incidents.map(item => `<tr><td><strong>${escapeHtml(item.code)}</strong></td><td>${escapeHtml(item.title)}</td><td>${escapeHtml(item.category || "Sin categoría")}</td><td>${escapeHtml(item.reporter.name)}</td><td>${localDate(item.createdAt)}</td><td><span class="status ${/cerrada|resuelta/i.test(item.status) ? "success" : "warning"}">${escapeHtml(item.status)}</span></td>${canManage ? `<td><button class="table-action" data-manage-incident="${attr(item.code)}">Actualizar</button></td>` : ""}</tr>`).join("") : `<tr><td colspan="${canManage ? 7 : 6}" class="empty-search">No hay incidencias registradas.</td></tr>`}</tbody></table></div>
      </section>
    </div>`;
}

export function pricesTemplate(costs, products) {
  return `
    ${hero("COSTOS Y RENTABILIDAD", "Precio de prendas", "Configura componentes de costo y calcula el precio con una fórmula auditable.", "receipt")}
    <div class="operations-layout prices-layout">
      <section class="card operations-form-card">
        <p class="eyebrow">FÓRMULA DE PRECIO</p><h2>Definir costos</h2>
        <form id="garmentCostForm" class="form-grid">
          <div class="field full"><label>Prenda</label><select name="productCode" id="costProduct" required><option value="">Selecciona</option>${products.map(product => `<option value="${attr(product.sku)}" data-name="${attr(product.name)}">${escapeHtml(product.name)} · ${escapeHtml(product.sku)}</option>`).join("")}</select><input name="productName" id="costProductName" type="hidden"></div>
          <div class="field"><label>Materiales (COP)</label><input name="materials" type="number" min="0" step="0.01" required></div>
          <div class="field"><label>Tiempo de confección (min)</label><input name="minutes" type="number" min="0" step="0.01" required></div>
          <div class="field"><label>Tarifa por hora (COP)</label><input name="hourlyRate" type="number" min="0" step="0.01" required></div>
          <div class="field"><label>Costos indirectos (COP)</label><input name="indirect" type="number" min="0" step="0.01" required></div>
          <div class="field full"><label>Margen de ganancia (%)</label><input name="margin" type="number" min="0" max="1000" step="0.01" required></div>
          <div class="calculator-result full"><span>Precio calculado</span><strong id="liveGarmentPrice">Precio no calculado, defina costos primero</strong><div id="priceBreakdown" class="price-breakdown"></div></div>
          <div class="modal-actions price-form-actions full"><button class="button button-primary" type="submit">Guardar fórmula</button></div>
        </form>
      </section>
      <section class="card table-card operations-table-card">
        <div class="module-table-head"><div><p class="eyebrow">FÓRMULAS GUARDADAS</p><h2>Precios calculados</h2></div><small>${costs.length} prendas</small></div>
        <div class="table-scroll"><table><thead><tr><th>PRENDA</th><th>MATERIALES</th><th>MANO DE OBRA</th><th>INDIRECTOS</th><th>MARGEN</th><th>PRECIO</th><th>ACTUALIZADO</th></tr></thead><tbody>${costs.length ? costs.map(item => `<tr><td><strong>${escapeHtml(item.productName)}</strong><small class="table-meta">${escapeHtml(item.productCode)}</small></td><td>${formatCOP(item.materials)}</td><td>${formatCOP(item.labor)}</td><td>${formatCOP(item.indirect)}</td><td>${item.margin.toFixed(2)} %</td><td><strong>${formatCOP(item.price)}</strong></td><td>${localDate(item.updatedAt)}</td></tr>`).join("") : `<tr><td colspan="7" class="empty-search">Precio no calculado, defina costos primero</td></tr>`}</tbody></table></div>
      </section>
    </div>`;
}

export function scrapsTemplate({ scraps, allScraps, fabrics, filters, page, totalPages, total, aiConfig, chat }) {
  const fabricOptions = fabrics.map(item => `<option value="${attr(item.id)}">${escapeHtml(item.name)} · ${escapeHtml(item.code)}</option>`).join("");
  return `
    ${hero("PRODUCCIÓN CIRCULAR", "Retazos inteligentes", "Indica cuánta tela tienes y descubre qué confeccionar, qué sobrantes quedarían y cómo aprovecharlos.", "sparkle")}
    <section class="scrap-simple-workspace">
      <article class="card ai-chat-card scrap-chat-card">
        <header class="ai-chat-header"><div class="ai-identity"><span>${icon("sparkle")}</span><div><p class="eyebrow">ASISTENTE TEXTIL</p><h2>¿Qué podemos crear?</h2></div></div><span class="ai-online ${aiConfig.endpoint ? "" : "offline"}"><i></i>${aiConfig.endpoint ? "Conectado" : "No configurado"}</span></header>
        <div class="scrap-chat-selector"><label for="scrapChatTarget">Usar información de</label><select id="scrapChatTarget"><option value="" ${!chat.scrapId ? "selected" : ""}>Una cantidad de tela que quiero analizar</option>${allScraps.map(item => `<option value="${attr(item.id)}" ${chat.scrapId === item.id ? "selected" : ""}>${escapeHtml(item.code)} · ${escapeHtml(item.fabricName)} · ${item.sizeMeters.toFixed(2)} m</option>`).join("")}</select></div>
        <div class="ai-messages scrap-chat-messages" id="scrapChatMessages" aria-live="polite">${chat.messages.length ? chat.messages.map(entry => `<div class="ai-message ${entry.role}"><span>${entry.role === "assistant" ? icon("sparkle") : escapeHtml(entry.author || "T")}</span><div><strong>${entry.role === "assistant" ? "YESMAU IA" : "Tú"}</strong><p>${escapeHtml(entry.text)}</p></div></div>`).join("") : `<div class="scrap-chat-empty">${icon("sparkle")}<h3>Cuéntame qué tela tienes</h3><p>Te ayudaré a elegir productos viables, estimar el consumo y aprovechar los retazos que puedan quedar.</p></div>`}</div>
        <div class="ai-prompts"><button type="button" data-chat-prompt="¿Qué prendas puedo confeccionar y cuánta tela consumiría cada opción?">Prendas posibles</button><button type="button" data-chat-prompt="¿Qué retazos quedarían después del corte y de qué tamaño aproximado?">Retazos resultantes</button><button type="button" data-chat-prompt="¿Cómo puedo aprovechar cada sobrante para reducir desperdicios?">Aprovechar sobrantes</button></div>
        <form class="ai-composer" id="scrapChatForm"><label class="sr-only" for="scrapChatInput">Consulta sobre la tela</label><textarea id="scrapChatInput" maxlength="1000" placeholder="Ejemplo: quiero hacer una blusa y aprovechar todos los sobrantes…" required></textarea><button class="button button-primary" type="submit">Preguntar ${icon("arrow")}</button></form>
        ${!aiConfig.endpoint ? `<p class="ai-disclaimer">Puedes preparar tu consulta. Administración debe configurar el servicio de IA para recibir una respuesta real.</p>` : `<p class="ai-disclaimer">La IA estimará usos y sobrantes; valida las medidas antes de cortar.</p>`}
      </article>
      <aside class="card ai-context-card scrap-simple-context">
        <p class="eyebrow">DATOS DE LA TELA</p><h2>Lo esencial</h2><p>Completa estos datos para obtener una recomendación más precisa.</p>
        <div class="ai-context-fields">
          <label>Tipo de tela<select id="chatFabricId"><option value="">Selecciona</option>${fabrics.map(item => `<option value="${attr(item.id)}" ${chat.context?.fabricId === item.id ? "selected" : ""}>${escapeHtml(item.name)}</option>`).join("")}</select></label>
          <label>Cantidad disponible (metros)<input id="chatFabricAmount" type="number" min="0.01" step="0.01" value="${attr(chat.context?.sizeMeters || "")}" placeholder="Ej. 1.50"></label>
          <label>Material o composición<input id="chatFabricMaterial" maxlength="90" value="${attr(chat.context?.material || "")}" placeholder="Ej. algodón, lino, denim"></label>
          <label>Forma disponible<select id="chatFabricShape"><option value="">No especificada</option>${["Rectangular", "Cuadrada", "Irregular", "Tiras", "Piezas pequeñas"].map(shape => `<option ${chat.context?.shape === shape ? "selected" : ""}>${shape}</option>`).join("")}</select></label>
          <label>Qué te gustaría crear<input id="chatFabricGoal" maxlength="160" value="${attr(chat.context?.goal || "")}" placeholder="Ej. blusa, accesorios o ideas abiertas"></label>
        </div>
        <button class="button button-secondary ai-context-submit" id="analyzeFabricContext">Analizar esta tela ${icon("arrow")}</button>
        <div class="ai-capabilities"><span>${icon("shirt")} Productos posibles</span><span>${icon("ruler")} Consumo aproximado</span><span>${icon("sparkle")} Uso de sobrantes</span></div>
      </aside>
    </section>
    <details class="card scrap-management-card">
      <summary><span><strong>Inventario de retazos</strong><small>Registrar, buscar, editar o eliminar · ${total} registros</small></span>${icon("chevron")}</summary>
      <div class="scrap-management-content">
        <section class="operations-form-card scrap-form-card"><div class="card-header"><div><p class="eyebrow">NUEVO RETAZO</p><h2>Registrar retazo</h2></div></div>
        ${fabrics.length ? `<form id="scrapForm" class="form-grid"><div class="field"><label>Tipo de tela</label><select name="fabricId" required><option value="">Selecciona</option>${fabricOptions}</select></div><div class="field"><label>Tamaño (metros)</label><input name="sizeMeters" type="number" min="0.01" step="0.01" required></div><div class="field"><label>Material</label><input name="material" maxlength="90" required></div><div class="field"><label>Forma opcional</label><input name="shape" maxlength="50"></div><div class="field"><label>Ubicación opcional</label><input name="location" maxlength="90"></div><div class="field"><label>Piezas</label><input name="pieces" type="number" min="1" value="1" required></div><div class="field"><label>Fecha</label><input name="entryDate" type="date" value="${today()}" required></div><div class="field"><label>Origen</label><select name="origin"><option>Corte de producción</option><option>Devolución</option><option>Ajuste manual</option></select></div><div class="modal-actions full"><button class="button button-primary" type="submit">Registrar retazo</button></div></form>` : `<div class="integration-note">${icon("alert")} Primero registra una materia prima con categoría “tela”.</div>`}</section>
        <form id="scrapFilters" class="scrap-filters">
        <input name="query" type="search" value="${attr(filters.query || "")}" placeholder="Buscar por código">
        <select name="fabricId"><option value="">Todas las telas</option>${fabrics.map(item => `<option value="${attr(item.id)}" ${filters.fabricId === item.id ? "selected" : ""}>${escapeHtml(item.name)}</option>`).join("")}</select>
        <input name="material" value="${attr(filters.material || "")}" placeholder="Material">
        <input name="minSize" type="number" min="0" step="0.01" value="${attr(filters.minSize || "")}" placeholder="Tamaño mín.">
        <input name="maxSize" type="number" min="0" step="0.01" value="${attr(filters.maxSize || "")}" placeholder="Tamaño máx.">
        <input name="location" value="${attr(filters.location || "")}" placeholder="Ubicación">
        <input name="date" type="date" value="${attr(filters.date || "")}">
        <button class="button button-secondary" type="submit">Aplicar filtros</button>
        <button class="text-button" id="clearScrapFilters" type="button">Limpiar</button>
        </form>
      <div class="module-table-head"><h2>Retazos registrados</h2><small>${total} resultados</small></div>
      <div class="table-scroll"><table><thead><tr><th>CÓDIGO</th><th>TELA</th><th>MATERIAL</th><th>TAMAÑO</th><th>PIEZAS</th><th>UBICACIÓN</th><th>FECHA</th><th>ACCIÓN</th></tr></thead><tbody>${scraps.length ? scraps.map(item => `<tr><td><strong>${escapeHtml(item.code)}</strong></td><td>${escapeHtml(item.fabricName)}</td><td>${escapeHtml(item.material)}</td><td>${item.sizeMeters.toFixed(2)} m</td><td>${item.pieces}</td><td>${escapeHtml(item.location || "No asignada")}</td><td>${escapeHtml(item.entryDate)}</td><td><div class="row-actions"><button class="table-action" data-scrap-detail="${attr(item.id)}">Detalle</button><button class="table-action" data-scrap-edit="${attr(item.id)}">Editar</button><button class="table-action" data-scrap-ai="${attr(item.id)}">Sugerencias IA</button><button class="table-action danger-text" data-scrap-delete="${attr(item.id)}">Eliminar</button></div></td></tr>`).join("") : `<tr><td colspan="8" class="empty-search">No hay retazos que coincidan con los filtros.</td></tr>`}</tbody></table></div>
      <div class="pagination"><button class="button button-secondary" data-scrap-page="${page - 1}" ${page <= 1 ? "hidden" : ""}>Anterior</button><span>Página ${page} de ${totalPages}</span><button class="button button-secondary" data-scrap-page="${page + 1}" ${page >= totalPages ? "hidden" : ""}>Siguiente</button></div>
      </div>
    </details>`;
}

export function scrapSuggestionCards(scrap) {
  if (!scrap.suggestions?.length) return `<p class="empty-search">No se encontraron sugerencias para este retazo</p>`;
  return `<div class="suggestion-list">${scrap.suggestions.map(item => `<article class="suggestion-card">
    ${item.visualUrl ? `<img src="${attr(item.visualUrl)}" alt="">` : `<span class="suggestion-placeholder">${icon("sparkle")}</span>`}
    <div><div class="suggestion-heading"><h3>${escapeHtml(item.productName)}</h3><strong>${item.viability}% viable</strong></div><p>${escapeHtml(item.description)}</p><dl><div><dt>Tamaño requerido</dt><dd>${escapeHtml(item.requiredSize)}</dd></div><div><dt>Dificultad</dt><dd>${escapeHtml(item.difficulty)}</dd></div></dl><div class="suggestion-actions"><button class="button button-secondary ${item.selected ? "active" : ""}" data-suggestion="${attr(item.id)}" data-suggestion-field="selected">${item.selected ? "Seleccionada" : "Seleccionar"}</button><button class="button button-secondary ${item.used ? "active" : ""}" data-suggestion="${attr(item.id)}" data-suggestion-field="used">${item.used ? "Utilizada" : "Marcar utilizada"}</button></div></div>
  </article>`).join("")}</div>`;
}
