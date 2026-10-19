import { apiMock } from "./apiModel.js";
import { loadLocalObject, loadLocalRecords } from "./storageModel.js";

const KEYS = {
  materials: "yesmau_raw_materials_v1",
  incidents: "yesmau_incidents_v1",
  costs: "yesmau_garment_costs_v1",
  scraps: "yesmau_scraps_v1",
  aiConfig: "yesmau_ai_config_v1",
  emailConfig: "yesmau_email_service_v1",
};

const SQL_PATTERN = /(--|;|\/\*|\*\/|\b(SELECT|INSERT|UPDATE|DELETE|DROP|UNION|ALTER|EXEC)\b)/i;
const EMAIL_PATTERN = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
const DEFAULT_FABRICS = [
  { id: "FAB-LINO-SIENA", code: "TEL-001", name: "Lino Siena", category: "tela", unit: "metros", quantity: 32, supplier: "Textiles del Sur", acquisitionCost: 38000, createdAt: "2025-01-01T12:00:00.000Z", createdBy: { id: null, name: "Sistema YESMAU", email: "", role: "Sistema" } },
  { id: "FAB-ALGODON-NUBE", code: "TEL-002", name: "Algodón Nube", category: "tela", unit: "metros", quantity: 48, supplier: "Fibras Naturales", acquisitionCost: 29000, createdAt: "2025-01-01T12:00:00.000Z", createdBy: { id: null, name: "Sistema YESMAU", email: "", role: "Sistema" } },
  { id: "FAB-SARGA-ALBA", code: "TEL-003", name: "Sarga Alba", category: "tela", unit: "metros", quantity: 27, supplier: "Casa del Lino", acquisitionCost: 34000, createdAt: "2025-01-01T12:00:00.000Z", createdBy: { id: null, name: "Sistema YESMAU", email: "", role: "Sistema" } },
  { id: "FAB-DENIM-INDIGO", code: "TEL-004", name: "Denim Índigo", category: "tela", unit: "metros", quantity: 36, supplier: "Textiles del Sur", acquisitionCost: 42000, createdAt: "2025-01-01T12:00:00.000Z", createdBy: { id: null, name: "Sistema YESMAU", email: "", role: "Sistema" } },
];

function clean(value, label, max = 240, required = true) {
  const text = String(value || "").replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim();
  if (required && !text) throw new Error(`${label} es obligatorio.`);
  if (text.length > max) throw new Error(`${label} supera el límite de ${max} caracteres.`);
  if (/[<>]/.test(text) || SQL_PATTERN.test(text)) throw new Error(`${label} contiene caracteres no permitidos.`);
  return text;
}

function positiveNumber(value, label, allowZero = true) {
  const number = Number(value);
  if (!Number.isFinite(number) || (allowZero ? number < 0 : number <= 0)) throw new Error(`${label} debe ser un número válido.`);
  return number;
}

function save(key, records) {
  try {
    localStorage.setItem(key, JSON.stringify(records));
  } catch {
    const error = new Error("Error interno, intente más tarde");
    error.name = "DatabaseError";
    throw error;
  }
}

function nextCode(records, prefix) {
  const next = records.reduce((max, record) => Math.max(max, Number(String(record.code || "").replace(/\D/g, "")) || 0), 0) + 1;
  return `${prefix}-${String(next).padStart(6, "0")}`;
}

function reserveCode(records, prefix) {
  const key = `yesmau_sequence_${prefix}`;
  const existingMaximum = records.reduce((max, record) => Math.max(max, Number(String(record.code || "").replace(/\D/g, "")) || 0), 0);
  const next = Math.max(existingMaximum, Number(localStorage.getItem(key)) || 0) + 1;
  localStorage.setItem(key, String(next));
  return `${prefix}-${String(next).padStart(6, "0")}`;
}

function userIdentity(user) {
  return {
    id: user?.id || null,
    name: user?.name || "Invitado",
    email: user?.email || "",
    role: user?.role || "Invitado",
  };
}

function audit(action, detail) {
  apiMock.recordAudit(action, detail);
}

function openAttachmentDatabase() {
  return new Promise((resolve, reject) => {
    if (!("indexedDB" in window)) return reject(new Error("El navegador no admite almacenamiento de adjuntos."));
    const request = indexedDB.open("yesmau_files", 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains("incidentAttachments")) {
        database.createObjectStore("incidentAttachments", { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("No se pudo abrir el almacenamiento de adjuntos."));
  });
}

async function validateIncidentFiles(files) {
  if (files.length > 5) throw new Error("Puedes adjuntar máximo cinco archivos.");
  const allowed = {
    "image/jpeg": ["jpg", "jpeg"],
    "image/png": ["png"],
    "application/pdf": ["pdf"],
  };
  for (const file of files) {
    if (file.size > 5 * 1024 * 1024) throw new Error(`${file.name} supera el límite de 5 MB.`);
    const extension = file.name.split(".").pop()?.toLowerCase();
    if (!allowed[file.type]?.includes(extension)) throw new Error(`${file.name} no es JPG, PNG o PDF válido.`);
    const bytes = new Uint8Array(await file.slice(0, 8).arrayBuffer());
    const valid = file.type === "image/jpeg"
      ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
      : file.type === "image/png"
        ? [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte)
        : String.fromCharCode(...bytes.slice(0, 5)) === "%PDF-";
    if (!valid) throw new Error(`El contenido de ${file.name} no coincide con su formato.`);
  }
}

async function persistIncidentFiles(incidentCode, files) {
  if (!files.length) return [];
  const database = await openAttachmentDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction("incidentAttachments", "readwrite");
    const store = transaction.objectStore("incidentAttachments");
    const metadata = files.map((file, index) => {
      const record = {
        id: `${incidentCode}-${index + 1}`,
        incidentCode,
        name: file.name.slice(0, 160),
        type: file.type,
        size: file.size,
        blob: file,
      };
      store.put(record);
      return { id: record.id, name: record.name, type: record.type, size: record.size };
    });
    transaction.oncomplete = () => {
      database.close();
      resolve(metadata);
    };
    transaction.onerror = () => {
      database.close();
      reject(transaction.error || new Error("No se pudieron guardar los adjuntos."));
    };
  });
}

async function sendIncidentEmail(incident, timeoutMs = 1800) {
  const config = loadLocalObject(KEYS.emailConfig, { endpoint: "" });
  if (!config.endpoint) return { sent: false, reason: "Servicio de correo no configurado" };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(config.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        template: "incident-confirmation",
        to: incident.reporter.email,
        incident: { code: incident.code, title: incident.title, status: incident.status, createdAt: incident.createdAt },
      }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error("El servicio de correo rechazó la solicitud.");
    return { sent: true, reason: "" };
  } catch {
    return { sent: false, reason: "No se pudo enviar el correo de confirmación" };
  } finally {
    clearTimeout(timeout);
  }
}

export const operationsModel = {
  listMaterials() {
    const records = loadLocalRecords(KEYS.materials, []);
    DEFAULT_FABRICS.forEach(fabric => {
      if (!records.some(record => record.id === fabric.id || record.code === fabric.code)) records.push({ ...fabric });
    });
    return records;
  },

  createMaterial(payload, user) {
    if (!user || !["Administrador", "Administradora", "Empleado"].includes(user.role)) throw new Error("No tienes permiso para registrar materias primas.");
    const records = this.listMaterials();
    const code = clean(payload.code, "El código", 30).toUpperCase();
    if (records.some(record => record.code.toLowerCase() === code.toLowerCase())) throw new Error("Ya existe una materia prima con este código.");
    const category = clean(payload.category, "La categoría", 20).toLowerCase();
    if (!["hilo", "botón", "tela", "hilazas"].includes(category)) throw new Error("Selecciona una categoría válida.");
    const record = {
      id: crypto.randomUUID(),
      code,
      name: clean(payload.name, "El nombre", 90),
      category,
      unit: clean(payload.unit, "La unidad de medida", 30),
      quantity: Number(positiveNumber(payload.quantity, "La cantidad inicial").toFixed(2)),
      supplier: clean(payload.supplier, "El proveedor", 90, false) || null,
      acquisitionCost: Number(positiveNumber(payload.acquisitionCost, "El costo de adquisición").toFixed(2)),
      createdAt: new Date().toISOString(),
      createdBy: userIdentity(user),
    };
    records.unshift(record);
    save(KEYS.materials, records);
    audit("MATERIA_PRIMA_CREADA", `${record.code} · ${record.name}`);
    return record;
  },

  listIncidents(user) {
    const records = loadLocalRecords(KEYS.incidents, []);
    if (!user) return [];
    if (["Administrador", "Administradora", "Empleado"].includes(user.role)) return records;
    return records.filter(record => record.reporter.id === user.id || record.reporter.email === user.email);
  },

  async createIncident(payload, user, files = []) {
    if (!user || !["Cliente", "Empleado"].includes(user.role)) throw new Error("Inicia sesión como Cliente o Empleado para reportar una incidencia.");
    const records = loadLocalRecords(KEYS.incidents, []);
    const reporter = userIdentity(user);
    if (!EMAIL_PATTERN.test(reporter.email)) throw new Error("Ingresa un correo electrónico válido.");
    const code = reserveCode(records, "INC");
    await validateIncidentFiles([...files]);
    let attachments;
    try {
      attachments = await persistIncidentFiles(code, [...files]);
    } catch {
      const error = new Error("Error al reportar la incidencia. Intente más tarde");
      error.name = "DatabaseError";
      throw error;
    }
    const incident = {
      id: crypto.randomUUID(),
      code,
      title: clean(payload.title, "El título", 120),
      description: clean(payload.description, "La descripción", 1200),
      category: clean(payload.category, "La categoría", 60, false) || null,
      status: "Abierta",
      reporter,
      attachments,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    records.unshift(incident);
    try {
      save(KEYS.incidents, records);
    } catch {
      const error = new Error("Error al reportar la incidencia. Intente más tarde");
      error.name = "DatabaseError";
      throw error;
    }
    audit("INCIDENCIA_REPORTADA", `${incident.code} · ${incident.title}`);
    const email = await sendIncidentEmail(incident);
    return { incident, email };
  },

  updateIncidentStatus(code, status, user) {
    if (!user || !["Administrador", "Administradora", "Empleado"].includes(user.role)) throw new Error("No tienes permiso para actualizar incidencias.");
    const records = loadLocalRecords(KEYS.incidents, []);
    const incident = records.find(record => record.code === code);
    if (!incident) throw new Error("No se encontró la incidencia.");
    incident.status = clean(status, "El estado", 40);
    incident.updatedAt = new Date().toISOString();
    save(KEYS.incidents, records);
    audit("INCIDENCIA_ACTUALIZADA", `${code} · ${incident.status}`);
    return incident;
  },

  getEmailConfig() {
    return loadLocalObject(KEYS.emailConfig, { endpoint: "" });
  },

  saveEmailConfig(payload, user) {
    if (!user || !["Administrador", "Administradora"].includes(user.role)) throw new Error("Solo Administración puede configurar el correo.");
    const endpoint = clean(payload.endpoint, "El endpoint de correo", 500, false);
    if (endpoint && !/^https?:\/\//i.test(endpoint)) throw new Error("El endpoint de correo debe ser una URL HTTP o HTTPS.");
    const config = { endpoint, updatedAt: new Date().toISOString() };
    localStorage.setItem(KEYS.emailConfig, JSON.stringify(config));
    audit("CORREO_INCIDENCIAS_CONFIGURADO", endpoint || "Sin endpoint");
    return config;
  },

  listGarmentCosts() {
    return loadLocalRecords(KEYS.costs, []);
  },

  calculatePrice(payload) {
    const materials = positiveNumber(payload.materials, "El costo de materiales");
    const minutes = positiveNumber(payload.minutes, "El tiempo de confección");
    const hourlyRate = positiveNumber(payload.hourlyRate, "La tarifa de mano de obra");
    const indirect = positiveNumber(payload.indirect, "Los costos indirectos");
    const margin = positiveNumber(payload.margin, "El margen");
    if (margin > 1000) throw new Error("El margen debe estar entre 0 y 1000 %.");
    const labor = (minutes / 60) * hourlyRate;
    const base = materials + labor + indirect;
    return {
      materials: Number(materials.toFixed(2)),
      minutes: Number(minutes.toFixed(2)),
      hourlyRate: Number(hourlyRate.toFixed(2)),
      labor: Number(labor.toFixed(2)),
      indirect: Number(indirect.toFixed(2)),
      margin: Number(margin.toFixed(2)),
      base: Number(base.toFixed(2)),
      price: Number((base * (1 + margin / 100)).toFixed(2)),
    };
  },

  saveGarmentCost(payload, user) {
    if (!user || !["Administrador", "Administradora"].includes(user.role)) throw new Error("Solo Administración puede editar fórmulas de precio.");
    const productCode = clean(payload.productCode, "La prenda", 40);
    const calculation = this.calculatePrice(payload);
    const records = this.listGarmentCosts();
    const existing = records.find(record => record.productCode === productCode);
    const record = {
      id: existing?.id || crypto.randomUUID(),
      productCode,
      productName: clean(payload.productName, "El tipo de prenda", 90),
      ...calculation,
      updatedAt: new Date().toISOString(),
      updatedBy: userIdentity(user),
    };
    if (existing) Object.assign(existing, record);
    else records.unshift(record);
    save(KEYS.costs, records);
    audit("FORMULA_PRECIO_ACTUALIZADA", `${record.productCode} · ${record.price.toFixed(2)}`);
    return record;
  },

  listScraps() {
    return loadLocalRecords(KEYS.scraps, []);
  },

  createScrap(payload, user) {
    if (!user || !["Administrador", "Administradora", "Empleado"].includes(user.role)) throw new Error("No tienes permiso para registrar retazos.");
    const records = this.listScraps();
    const fabric = this.listMaterials().find(item => item.id === payload.fabricId && item.category === "tela");
    if (!fabric) throw new Error("Selecciona una tela registrada.");
    const record = {
      id: crypto.randomUUID(),
      code: nextCode(records, "RET"),
      fabricId: fabric.id,
      fabricName: fabric.name,
      sizeMeters: Number(positiveNumber(payload.sizeMeters, "El tamaño", false).toFixed(2)),
      material: clean(payload.material, "El material", 90),
      shape: clean(payload.shape, "La forma", 50, false) || null,
      location: clean(payload.location, "La ubicación", 90, false) || null,
      pieces: Math.max(1, Math.trunc(positiveNumber(payload.pieces || 1, "La cantidad de piezas", false))),
      entryDate: clean(payload.entryDate, "La fecha de ingreso", 10),
      origin: clean(payload.origin, "El origen", 40),
      suggestions: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      createdBy: userIdentity(user),
    };
    records.unshift(record);
    save(KEYS.scraps, records);
    audit("RETAZO_CREADO", record.code);
    return record;
  },

  updateScrap(id, payload, user) {
    if (!user || !["Administrador", "Administradora", "Empleado"].includes(user.role)) throw new Error("No tienes permiso para actualizar retazos.");
    const records = this.listScraps();
    const record = records.find(item => item.id === id);
    if (!record) throw new Error("No se encontró el retazo.");
    const fabric = this.listMaterials().find(item => item.id === payload.fabricId && item.category === "tela");
    if (!fabric) throw new Error("Selecciona una tela registrada.");
    Object.assign(record, {
      fabricId: fabric.id,
      fabricName: fabric.name,
      sizeMeters: Number(positiveNumber(payload.sizeMeters, "El tamaño", false).toFixed(2)),
      material: clean(payload.material, "El material", 90),
      shape: clean(payload.shape, "La forma", 50, false) || null,
      location: clean(payload.location, "La ubicación", 90, false) || null,
      pieces: Math.max(1, Math.trunc(positiveNumber(payload.pieces || 1, "La cantidad de piezas", false))),
      entryDate: clean(payload.entryDate, "La fecha de ingreso", 10),
      origin: clean(payload.origin, "El origen", 40),
      updatedAt: new Date().toISOString(),
    });
    save(KEYS.scraps, records);
    audit("RETAZO_ACTUALIZADO", `${record.code} · ${user?.email || "desconocido"}`);
    return record;
  },

  deleteScrap(id, user) {
    if (!user || !["Administrador", "Administradora", "Empleado"].includes(user.role)) throw new Error("No tienes permiso para eliminar retazos.");
    const records = this.listScraps();
    const index = records.findIndex(item => item.id === id);
    if (index < 0) throw new Error("No se encontró el retazo.");
    const [record] = records.splice(index, 1);
    save(KEYS.scraps, records);
    audit("RETAZO_ELIMINADO", `${record.code} · ${user?.email || "desconocido"}`);
    return record;
  },

  getAiConfig() {
    return loadLocalObject(KEYS.aiConfig, { endpoint: "", rules: "" });
  },

  saveAiConfig(payload, user) {
    if (!user || !["Administrador", "Administradora"].includes(user.role)) throw new Error("Solo Administración puede configurar la IA.");
    const config = {
      endpoint: clean(payload.endpoint, "El endpoint", 500, false),
      rules: clean(payload.rules, "Las reglas", 3000, false),
      updatedAt: new Date().toISOString(),
    };
    if (config.endpoint && !/^https?:\/\//i.test(config.endpoint)) throw new Error("El endpoint de IA debe ser una URL HTTP o HTTPS.");
    localStorage.setItem(KEYS.aiConfig, JSON.stringify(config));
    audit("IA_RETAZOS_CONFIGURADA", config.endpoint || "Sin endpoint");
    return config;
  },

  async generateScrapSuggestions(id, user) {
    if (!user || !["Administrador", "Administradora", "Empleado"].includes(user.role)) throw new Error("No tienes permiso para consultar sugerencias.");
    const records = this.listScraps();
    const scrap = records.find(item => item.id === id);
    if (!scrap) throw new Error("No se encontró el retazo.");
    const config = this.getAiConfig();
    if (!config.endpoint) throw new Error("La IA no está configurada. Administración debe registrar un endpoint.");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    try {
      const response = await fetch(config.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          task: "scrap-product-suggestions",
          context: {
            fabricType: scrap.fabricName,
            material: scrap.material,
            sizeMeters: scrap.sizeMeters,
            shape: scrap.shape,
            pieces: scrap.pieces,
          },
          rules: config.rules,
        }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error("Error al generar sugerencias");
      const payload = await response.json();
      const suggestions = (Array.isArray(payload) ? payload : payload.suggestions || []).map((item, index) => ({
        id: crypto.randomUUID(),
        productName: clean(item.productName || item.name, "El producto sugerido", 120),
        requiredSize: clean(item.requiredSize, "El tamaño requerido", 80),
        difficulty: ["baja", "media", "alta"].includes(String(item.difficulty).toLowerCase()) ? String(item.difficulty).toLowerCase() : "media",
        description: clean(item.description, "La descripción", 500),
        visualUrl: /^https?:\/\//i.test(item.visualUrl || "") ? item.visualUrl : null,
        viability: Math.max(0, Math.min(100, Number(item.viability) || (100 - index))),
        selected: false,
        used: false,
      })).sort((a, b) => b.viability - a.viability);
      scrap.suggestions = suggestions;
      scrap.updatedAt = new Date().toISOString();
      save(KEYS.scraps, records);
      audit("IA_SUGERENCIAS_GENERADAS", `${scrap.code} · ${suggestions.length}`);
      return suggestions;
    } catch (error) {
      if (error.message === "Error al generar sugerencias") throw error;
      throw new Error("Error al generar sugerencias");
    } finally {
      clearTimeout(timeout);
    }
  },

  async chatAboutScrap(id, message, history, user, manualContext = {}) {
    if (!user || !["Administrador", "Administradora", "Empleado"].includes(user.role)) throw new Error("No tienes permiso para usar el chat de retazos.");
    const scrap = id ? this.listScraps().find(item => item.id === id) : null;
    if (id && !scrap) throw new Error("No se encontró el retazo seleccionado.");
    const config = this.getAiConfig();
    if (!config.endpoint) throw new Error("La IA no está configurada. Administración debe registrar un endpoint.");
    const cleanMessage = clean(message, "La consulta", 1000);
    const context = scrap
      ? {
          source: "registered-scrap",
          code: scrap.code,
          fabricType: scrap.fabricName,
          material: scrap.material,
          sizeMeters: scrap.sizeMeters,
          shape: scrap.shape,
          pieces: scrap.pieces,
          origin: scrap.origin,
        }
      : {
          source: "fabric-amount",
          fabricType: clean(manualContext.fabricType, "El tipo de tela", 90),
          material: clean(manualContext.material, "El material", 90),
          sizeMeters: Number(positiveNumber(manualContext.sizeMeters, "La cantidad de tela", false).toFixed(2)),
          shape: clean(manualContext.shape, "La forma", 50, false) || null,
          goal: clean(manualContext.goal, "El objetivo", 160, false) || null,
        };
    const safeHistory = (Array.isArray(history) ? history : []).slice(-10).map(entry => ({
      role: entry.role === "assistant" ? "assistant" : "user",
      text: clean(entry.text, "El mensaje", 1000),
    }));
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    try {
      const response = await fetch(config.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          task: "fabric-utilization-chat",
          context,
          rules: config.rules,
          history: safeHistory,
          message: cleanMessage,
          requestedAnalysis: [
            "Productos o prendas viables para la cantidad de tela indicada",
            "Consumo aproximado de cada alternativa",
            "Cantidad y forma probable de los retazos restantes",
            "Opciones concretas para aprovechar cada retazo resultante",
          ],
        }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error("Error al consultar la IA");
      const payload = await response.json();
      const reply = clean(payload.reply || payload.message, "La respuesta de IA", 3000);
      audit("IA_CHAT_RETAZOS", `${scrap?.code || context.fabricType} · ${user.email}`);
      return reply;
    } catch (error) {
      if (error.message === "Error al consultar la IA") throw error;
      throw new Error("Error al consultar la IA");
    } finally {
      clearTimeout(timeout);
    }
  },

  markSuggestion(scrapId, suggestionId, field, user) {
    if (!user || !["Administrador", "Administradora", "Empleado"].includes(user.role)) throw new Error("No tienes permiso para actualizar sugerencias.");
    const records = this.listScraps();
    const scrap = records.find(item => item.id === scrapId);
    const suggestion = scrap?.suggestions?.find(item => item.id === suggestionId);
    if (!suggestion || !["selected", "used"].includes(field)) throw new Error("No se encontró la sugerencia.");
    suggestion[field] = !suggestion[field];
    save(KEYS.scraps, records);
    audit("IA_SUGERENCIA_ACTUALIZADA", `${scrap.code} · ${suggestion.productName} · ${field}`);
    return suggestion;
  },
};
