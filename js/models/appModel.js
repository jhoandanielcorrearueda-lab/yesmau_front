import { formatCOP, loadLocalObject, loadLocalRecords, normalizeCOPAmount } from "./storageModel.js";

export const orders = loadLocalRecords("yesmau_orders", [
  { id: "#1048", client: "Mariana Ortiz", email: "mariana@email.com", product: "Vestido Aura", total: "$284.000 COP", status: "En producción", type: "info", initials: "MO" },
  { id: "#1047", client: "Sofía Herrera", email: "sofia@email.com", product: "Blazer Siena", total: "$195.000 COP", status: "Pago recibido", type: "success", initials: "SH" },
  { id: "#1046", client: "Lucía Méndez", email: "lucia@email.com", product: "Pantalón Alba", total: "$128.000 COP", status: "Pendiente", type: "warning", initials: "LM" },
  { id: "#1045", client: "Camila Torres", email: "camila@email.com", product: "Camisa Nube", total: "$96.000 COP", status: "Enviado", type: "success", initials: "CT" },
]).map(order => ({ ...order, total: formatCOP(normalizeCOPAmount(order.total)) }));

export const inventoryProducts = loadLocalRecords("yesmau_inventory_products", [
  { sku: "ART-0248", name: "Vestido Aura", category: "Vestidos", stock: 18, price: 284000, status: "Disponible" },
  { sku: "ART-0196", name: "Blazer Siena", category: "Chaquetas", stock: 6, price: 195000, status: "Stock bajo" },
  { sku: "ART-0174", name: "Pantalón Alba", category: "Pantalones", stock: 24, price: 128000, status: "Disponible" },
  { sku: "ART-0152", name: "Camisa Nube", category: "Camisas", stock: 0, price: 96000, status: "Agotado" },
]).map(product => ({ ...product, price: normalizeCOPAmount(product.price) }));

export const sales = loadLocalRecords("yesmau_sales", [
  ["FAC-0086", "Mariana Ortiz", "1 × Vestido Aura", "STRIPE", "Visa •••• 4242", "Hoy, 10:42", "Pagada", "$284.000 COP"],
  ["FAC-0085", "Sofía Herrera", "1 × Blazer Siena", "STRIPE", "Mastercard •••• 4444", "Ayer, 16:20", "Pagada", "$195.000 COP"],
  ["FAC-0084", "Lucía Méndez", "1 × Pantalón Alba", "STRIPE", "PSE · CUS 184025", "14 jun, 2025", "Pendiente", "$128.000 COP"],
  ["FAC-0083", "Camila Torres", "1 × Camisa Nube", "CAJA", "Efectivo · RC-0083", "13 jun, 2025", "Recibida", "$96.000 COP"],
]).map(record => {
  const normalized = record.length === 7 ? [record[0], record[1], record[2], record[3], "Tarjeta", record[4], record[5], record[6]] : record;
  normalized[7] = formatCOP(normalizeCOPAmount(normalized[7]));
  return normalized;
});

export const moduleConfig = {
  pedidos: { title: "Pedidos", kicker: "OPERACIÓN COMERCIAL", description: "Controla cada encargo desde la confirmación de pago hasta la entrega. Los cambios de estado generan una notificación para el cliente.", icon: "box", action: "Nuevo pedido", stats: [["Pedidos activos", "38"], ["Por despachar", "12"], ["Devoluciones", "3"]], columns: ["Pedido", "Cliente", "Artículo", "Estado", "Total"] },
  tienda: { title: "Tienda", kicker: "CATÁLOGO COMERCIAL", description: "Publica prendas y telas con su tipo, características, precio y disponibilidad para el catálogo de clientes.", icon: "shirt", action: "Agregar nuevo artículo", stats: [["Artículos publicados", "9"], ["Prendas", "8"], ["Telas", "1"]], columns: ["SKU", "Artículo", "Clase", "Tipo", "Características", "Precio", "Stock", "Estado"] },
  inventario: { title: "Inventario", kicker: "EXISTENCIAS", description: "Gestiona artículos, precios en pesos colombianos, variantes y alertas de stock desde un único lugar.", icon: "shirt", action: "Añadir artículo", stats: [["Artículos", "248"], ["Stock bajo", "7"], ["Favoritos", "126"]], columns: ["SKU", "Artículo", "Categoría", "Precio", "Stock", "Estado"] },
  ventas: { title: "Ventas y facturas", kicker: "FINANZAS", description: "Registra ventas en pesos colombianos, identifica la pasarela y el método de pago, y genera facturas listas para consultar.", icon: "chart", action: "Registrar venta", stats: [["Este mes", "$18.420.000 COP"], ["Facturas", "86"], ["Por cobrar", "$1.280.000 COP"]], columns: ["Factura", "Cliente", "Detalle", "Pasarela", "Método", "Fecha", "Estado", "Total"] },
  compras: { title: "Órdenes de compra", kicker: "ABASTECIMIENTO", description: "Planifica compras de materia prima y da seguimiento a cada orden enviada a tus proveedores.", icon: "cart", action: "Nueva orden", stats: [["Órdenes abiertas", "9"], ["En tránsito", "4"], ["Inversión mensual", "$6.840.000 COP"]], columns: ["Orden", "Proveedor", "Entrega", "Estado", "Total"] },
  telas: { title: "Telas y materias primas", kicker: "MATERIALES", description: "Registra telas, insumos, proveedor, lotes y metrajes disponibles para asegurar la continuidad de la producción.", icon: "scissors", action: "Registrar material", stats: [["Referencias", "74"], ["Metros disponibles", "1.284 m"], ["Stock crítico", "5"]], columns: ["Código", "Material", "Composición", "Proveedor", "Disponible", "Estado"] },
  retazos: { title: "Retazos inteligentes", kicker: "PRODUCCIÓN CIRCULAR", description: "Clasifica sobrantes y recibe sugerencias para convertirlos en nuevas piezas con valor comercial.", icon: "sparkle", action: "Registrar retazo", stats: [["Retazos", "146"], ["Aprovechables", "89%"], ["Ahorro estimado", "$920.000 COP"]], columns: ["Lote", "Tela", "Medida", "Sugerencia", "Estado"] },
  proveedores: { title: "Proveedores", kicker: "RED DE SUMINISTRO", description: "Centraliza teléfono, correo, dirección, especialidad y desempeño comercial de cada proveedor.", icon: "factory", action: "Nuevo proveedor", stats: [["Proveedores", "24"], ["Activos", "19"], ["Evaluación media", "4.8"]], columns: ["Proveedor", "Teléfono", "Correo", "Dirección", "Especialidad", "Evaluación", "Estado"] },
  incidencias: { title: "Incidencias", kicker: "CALIDAD Y SOPORTE", description: "Registra novedades de producción, asigna responsables y resuelve cada caso con trazabilidad.", icon: "alert", action: "Nueva incidencia", stats: [["Abiertas", "6"], ["Críticas", "1"], ["Resueltas este mes", "31"]], columns: ["Caso", "Asunto", "Responsable", "Prioridad", "Estado"] },
  clientes: { title: "Usuarios y clientes", kicker: "COMUNIDAD", description: "Gestiona cuentas, datos de contacto, favoritos, reseñas y acceso seguro a la plataforma.", icon: "users", action: "Registrar usuario", stats: [["Usuarios", "1.842"], ["Nuevos este mes", "126"], ["Reseñas", "438"]], columns: ["Usuario", "Correo", "Rol", "Último acceso", "Estado"] },
  roles: { title: "Roles y permisos", kicker: "SEGURIDAD", description: "Crea roles personalizados y asigna permisos granulares para proteger cada área del negocio.", icon: "settings", action: "Crear rol", stats: [["Roles", "6"], ["Permisos", "42"], ["Administradores", "3"]], columns: ["Rol", "Usuarios", "Permisos", "Actualizado", "Estado"] },
};

export const genericRows = {
  ventas: sales,
  compras: loadLocalRecords("yesmau_records_compras", [["OC-019", "Textiles del Sur", "18 jun, 2025", "En tránsito", "$2.420.000 COP"], ["OC-018", "Casa del Lino", "20 jun, 2025", "Confirmada", "$1.860.000 COP"], ["OC-017", "Botones & Más", "12 jun, 2025", "Recibida", "$740.000 COP"], ["OC-016", "Fibras Naturales", "22 jun, 2025", "Pendiente", "$1.320.000 COP"]]),
  telas: loadLocalRecords("yesmau_records_telas", [["TEL-074", "Lino Siena", "100% lino", "Textiles del Sur", "6.2 m", "Stock crítico"], ["TEL-073", "Algodón Nube", "97% algodón", "Fibras Naturales", "84 m", "Disponible"], ["MAT-031", "Botón Nácar", "Nácar natural", "Botones & Más", "540 und.", "Disponible"], ["TEL-068", "Sarga Alba", "Algodón / lino", "Casa del Lino", "42 m", "Disponible"]]),
  retazos: loadLocalRecords("yesmau_records_retazos", [["RT-0146", "Lino Siena", "65 × 48 cm", "Top estructurado", "Reservado"], ["RT-0145", "Algodón Nube", "42 × 36 cm", "Bolsa mini", "Disponible"], ["RT-0144", "Sarga Alba", "80 × 28 cm", "Cinturón", "En uso"], ["RT-0143", "Lino Siena", "34 × 22 cm", "Accesorio", "Disponible"]]),
  proveedores: loadLocalRecords("yesmau_records_proveedores", [["Textiles del Sur", "+57 315 420 1870", "ventas@textilesdelsur.co", "Cra. 18 #24-61, Cúcuta", "Linos y sargas", "4.9 / 5", "Activo"], ["Casa del Lino", "+57 300 615 2240", "pedidos@casadellino.co", "Av. 5 #12-38, Cúcuta", "Fibras naturales", "4.8 / 5", "Activo"], ["Botones & Más", "+57 312 804 1192", "contacto@botonesymas.co", "Calle 11 #8-27, Cúcuta", "Avíos", "4.6 / 5", "Activo"], ["Fibras Naturales", "+57 320 553 4801", "comercial@fibrasnaturales.co", "Zona Industrial, Bodega 14", "Algodones", "4.4 / 5", "En revisión"]]),
  incidencias: loadLocalRecords("yesmau_records_incidencias", [["INC-0098", "Variación de tono en lote", "Andrea Ruiz", "Alta", "Abierta"], ["INC-0097", "Ajuste de patrón", "Diego Paz", "Media", "En proceso"], ["INC-0096", "Retraso de proveedor", "Elena Castro", "Baja", "Resuelta"], ["INC-0095", "Costura irregular", "Andrea Ruiz", "Media", "En proceso"]]),
  clientes: [["Mariana Ortiz", "mariana@email.com", "Cliente", "Hoy, 10:42", "Activo"], ["Sofía Herrera", "sofia@email.com", "Cliente", "Ayer, 16:20", "Activo"], ["Andrea Ruiz", "andrea@yesmau.com", "Producción", "Hoy, 08:15", "Activo"], ["Diego Paz", "diego@yesmau.com", "Inventario", "12 jun, 2025", "Invitado"]],
  roles: [["Administración", "3 usuarios", "42 permisos", "Hoy", "Activo"], ["Producción", "8 usuarios", "18 permisos", "12 jun, 2025", "Activo"], ["Inventario", "4 usuarios", "14 permisos", "8 jun, 2025", "Activo"], ["Atención al cliente", "6 usuarios", "11 permisos", "1 jun, 2025", "Activo"]],
};
genericRows.compras = genericRows.compras.map(row => [...row.slice(0, 4), formatCOP(normalizeCOPAmount(row[4]))]);
genericRows.telas = genericRows.telas.map(row => row.length === 5 ? [row[0], row[1], row[2], "Proveedor no asignado", row[3], row[4]] : row);
genericRows.proveedores = genericRows.proveedores.map(row => row.length === 5 ? [row[0], row[1], "Correo no registrado", "Dirección no registrada", row[2], row[3], row[4]] : row);

export const clientProducts = loadLocalRecords("yesmau_client_products", [
  { id: "P-001", name: "Vestido Aura", category: "Vestidos", description: "Vestido midi de caída ligera, cintura definida y acabado versátil.", price: 284000, stock: 18, image: "https://images.unsplash.com/photo-1772714601004-23b94ae3913d?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&q=80&w=700" },
  { id: "P-002", name: "Blazer Siena", category: "Chaquetas", description: "Blazer estructurado de líneas limpias para combinar de día o de noche.", price: 195000, stock: 6, image: "https://images.unsplash.com/photo-1779406167603-d0afe0a4cdd7?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&q=80&w=700" },
  { id: "P-003", name: "Camisa Nube", category: "Camisas", description: "Camisa casual de algodón suave con silueta cómoda y cuello clásico.", price: 96000, stock: 12, image: "https://images.unsplash.com/photo-1788500304966-2c60274a5de7?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&q=80&w=700" },
  { id: "P-004", name: "Blusa Magnolia", category: "Blusas", description: "Blusa femenina de manga corta con textura sutil y movimiento natural.", price: 118000, stock: 15, image: "https://images.unsplash.com/photo-1787505136265-9a99dad3bbac?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&q=80&w=700" },
  { id: "P-005", name: "Pantalón Alba", category: "Pantalones", description: "Pantalón de tiro alto y corte recto para una elegancia cotidiana.", price: 128000, stock: 24, image: "https://images.unsplash.com/photo-1753162657464-7f829c766d54?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&q=80&w=700" },
  { id: "P-006", name: "Tela Lino Siena", category: "Telas", description: "Lino de tacto fresco y trama visible, vendido por metro.", price: 58000, stock: 32, unit: "metro", image: "/assets/yesmau-login-textiles.jpg" },
  { id: "P-007", name: "Camisa Horizonte", category: "Camisas", description: "Camisa masculina casual en tejido liviano con detalle artesanal.", price: 109000, stock: 9, image: "https://images.unsplash.com/photo-1779907391045-002a6cafefa2?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&q=80&w=700" },
  { id: "P-008", name: "Vestido Brisa", category: "Vestidos", description: "Vestido fresco con falda amplia, pensado para días cálidos.", price: 246000, stock: 7, image: "https://images.unsplash.com/photo-1753164597442-ae97e3cb3dca?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&q=80&w=700" },
  { id: "P-009", name: "Falda Terracota", category: "Faldas", description: "Falda midi de paneles con cintura cómoda y acabado fluido.", price: 139000, stock: 11, image: "https://images.unsplash.com/photo-1753162658031-8a0d6350c75f?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&q=80&w=700" },
]);

const catalogExpansionProducts = [
  { id: "P-010", name: "Vestido Serena", category: "Vestidos", description: "Vestido de líneas suaves y largo midi para ocasiones cotidianas.", price: 229000, stock: 8, image: "https://images.unsplash.com/photo-1659522761084-79196b64abe4?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&q=80&w=700" },
  { id: "P-011", name: "Chaqueta Horizonte", category: "Chaquetas", description: "Chaqueta ligera de corte contemporáneo y acabado estructurado.", price: 198000, stock: 10, image: "https://images.unsplash.com/photo-1565101129934-0da84e9fd368?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&q=80&w=700" },
  { id: "P-012", name: "Blazer Violeta", category: "Chaquetas", description: "Blazer de silueta definida con un tono expresivo y versátil.", price: 215000, stock: 7, image: "https://images.unsplash.com/photo-1713204767650-8be36bc71040?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&q=80&w=700" },
  { id: "P-013", name: "Camisa Marfil", category: "Camisas", description: "Camisa clara de manga larga con caída relajada y tacto suave.", price: 104000, stock: 16, image: "https://images.unsplash.com/flagged/photo-1570733117311-d990c3816c47?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&q=80&w=700" },
  { id: "P-014", name: "Blusa Celeste", category: "Blusas", description: "Blusa liviana con cuello limpio y una silueta fácil de combinar.", price: 112000, stock: 13, image: "https://images.unsplash.com/photo-1583686543381-2608547b3963?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&q=80&w=700" },
  { id: "P-015", name: "Blusa Arena", category: "Blusas", description: "Blusa de tono neutro, manga fluida y acabado delicado.", price: 121000, stock: 9, image: "https://images.unsplash.com/photo-1590919549124-c0721c146191?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&q=80&w=700" },
  { id: "P-016", name: "Pantalón Siena", category: "Pantalones", description: "Pantalón sastre de pierna recta para conjuntos formales o casuales.", price: 136000, stock: 14, image: "https://images.unsplash.com/photo-1613915617430-8ab0fd7c6baf?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&q=80&w=700" },
  { id: "P-017", name: "Pantalón Índigo", category: "Pantalones", description: "Pantalón cómodo de tiro medio y construcción resistente.", price: 132000, stock: 12, image: "https://images.unsplash.com/photo-1662532577856-e8ee8b138a8b?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&q=80&w=700" },
  { id: "P-018", name: "Tela Algodón Nube", category: "Telas", description: "Algodón suave y transpirable para camisas, blusas y prendas ligeras.", price: 46000, stock: 40, unit: "metro", image: "https://images.unsplash.com/photo-1588610992315-5654831ceebd?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&q=80&w=700" },
  { id: "P-019", name: "Tela Lino Natural", category: "Telas", description: "Lino de fibra visible y tono natural para prendas frescas.", price: 62000, stock: 28, unit: "metro", image: "https://images.unsplash.com/photo-1612654516785-0e1a96be21d1?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&q=80&w=700" },
  { id: "P-020", name: "Falda Siena", category: "Faldas", description: "Falda midi de corte limpio con movimiento ligero.", price: 145000, stock: 10, image: "https://images.unsplash.com/photo-1542381335-c78825c1598b?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&q=80&w=700" },
  { id: "P-021", name: "Falda Magnolia", category: "Faldas", description: "Falda versátil de cintura definida y caída elegante.", price: 149000, stock: 8, image: "https://images.unsplash.com/photo-1653040321630-698cfc09254e?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&q=80&w=700" },
];
catalogExpansionProducts.forEach(product => {
  if (!clientProducts.some(item => item.id === product.id)) clientProducts.push(product);
});

export const defaultPublicContent = {
  heroTitle: "Prendas que cuentan tu historia.",
  heroSubtitle: "Descubre diseños casuales creados con materiales seleccionados, trazabilidad y una visión de aprovechamiento textil responsable.",
  collectionTitle: "Encuentra tu próxima prenda",
  collectionSubtitle: "Una selección casual pensada para acompañarte todos los días.",
  processTitle: "Una experiencia conectada de principio a fin.",
  processSubtitle: "Seleccionamos materiales, desarrollamos cada artículo, controlamos su calidad y te informamos durante todo el proceso.",
  aboutTitle: "¿Quiénes somos?",
  aboutSubtitle: "Experiencia, calidad y espíritu familiar desde nuestros inicios.",
  ctaTitle: "Guarda favoritos, compra y sigue tus pedidos.",
  ctaSubtitle: "Crea tu cuenta y disfruta toda la experiencia YESMAU.",
  images: {
    hero: null,
    process: null,
  },
};

const storedPublicContent = loadLocalObject("yesmau_public_content", defaultPublicContent);
export const publicContent = {
  ...defaultPublicContent,
  ...storedPublicContent,
  images: {
    ...defaultPublicContent.images,
    ...(storedPublicContent.images || {}),
  },
};

export const clientOrderExamples = [
  {
    id: "YM-1048",
    date: "18 jun 2025",
    status: "En camino",
    items: [{ name: "Vestido Aura", quantity: 1, price: 284000 }],
    total: 284000,
    tracking: "Guía YM-840219 · Coordinadora",
    invoice: null,
    example: true,
  },
  {
    id: "YM-1029",
    date: "02 jun 2025",
    status: "Entregado",
    items: [{ name: "Camisa Nube", quantity: 1, price: 96000 }, { name: "Tela Lino Siena", quantity: 2, price: 58000 }],
    total: 212000,
    tracking: "Entregado el 06 jun 2025",
    invoice: "DEMO-FE-1029",
    example: true,
  },
];

export const clientPaymentMethods = [
  { id: "pse", name: "PSE", description: "Continúa en la pasarela bancaria al confirmar." },
  { id: "transfer", name: "Transferencia bancaria", description: "Recibirás instrucciones para completar el pago." },
  { id: "delivery", name: "Pago contra entrega", description: "Sujeto a cobertura y confirmación de YESMAU." },
];

export const clientLocation = {
  configured: false,
  name: "Taller y tienda YESMAU",
  address: "Dirección pendiente de configuración",
  mapUrl: "",
};

// Datos institucionales del footer Cliente. Completa únicamente información verificada.
export const companyContact = {
  phone: "Teléfono pendiente de configuración",
  phoneUrl: "",
  email: "Correo pendiente de configuración",
  emailUrl: "",
  faqUrl: "",
  glossaryUrl: "",
  socialUrl: "",
  complaintsUrl: "",
  privacyUrl: "",
  termsUrl: "",
};
