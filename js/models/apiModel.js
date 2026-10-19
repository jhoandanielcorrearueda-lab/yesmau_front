const KEYS = {
  users: "yesmau_users_v2",
  roles: "yesmau_roles",
  token: "yesmau_auth_token",
  session: "yesmau_session",
  logs: "yesmau_audit_logs",
  recovery: "yesmau_recovery_codes",
};

const API_DELAY = 480;
const EMAIL_PATTERN = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
const NAME_PATTERN = /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ\s]{2,50}$/;
const DOCUMENT_PATTERN = /^[A-Za-z0-9]{6,20}$/;
const PASSWORD_PATTERN = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%&*._-]).{8,64}$/;
const SQL_PATTERN = /(--|;|\/\*|\*\/|\b(SELECT|INSERT|UPDATE|DELETE|DROP|UNION|ALTER|EXEC)\b)/i;
const encoder = new TextEncoder();

const wait = (result, reject = false) =>
  new Promise((resolve, rejectPromise) => {
    setTimeout(() => (reject ? rejectPromise(result) : resolve(result)), API_DELAY);
  });

const bytesToBase64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const base64ToBytes = (value) => Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
const safeJson = (key, fallback) => {
  try { return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback)); }
  catch { return fallback; }
};

function assertSafe(value, field = "campo") {
  const text = String(value || "").trim();
  if (/[<>]/.test(text) || SQL_PATTERN.test(text)) {
    throw new Error(`El ${field} contiene caracteres no permitidos.`);
  }
  return text;
}

function validateEmail(value) {
  const email = assertSafe(value, "correo").toLowerCase();
  if (!EMAIL_PATTERN.test(email)) throw new Error("Ingresa un correo electrónico válido.");
  return email;
}

function validateName(value) {
  const name = assertSafe(value, "nombre").replace(/\s+/g, " ");
  if (!NAME_PATTERN.test(name)) throw new Error("El nombre solo puede contener letras y espacios.");
  return name;
}

function validateDocument(value) {
  const document = assertSafe(value, "documento");
  if (!DOCUMENT_PATTERN.test(document)) throw new Error("El documento debe contener entre 6 y 20 letras o números.");
  return document;
}

function validatePassword(password) {
  if (!PASSWORD_PATTERN.test(password)) {
    throw new Error("La contraseña debe tener 8 caracteres, mayúscula, minúscula, número y símbolo.");
  }
  return password;
}

async function hashPassword(password, saltValue) {
  const salt = saltValue ? base64ToBytes(saltValue) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const hash = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: 120000, hash: "SHA-256" },
    key,
    256,
  );
  return `pbkdf2$120000$${bytesToBase64(salt)}$${bytesToBase64(hash)}`;
}

async function verifyPassword(password, stored) {
  if (typeof stored !== "string" || !/^pbkdf2\$120000\$[^$]+\$[^$]+$/.test(stored)) return false;
  const [, , salt] = stored.split("$");
  return (await hashPassword(password, salt)) === stored;
}

function audit(action, email, result, detail = "") {
  const logs = safeJson(KEYS.logs, []);
  logs.unshift({
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    ip: "127.0.0.1 (simulada)",
    action,
    email: String(email || "").slice(0, 120),
    result,
    detail,
  });
  localStorage.setItem(KEYS.logs, JSON.stringify(logs.slice(0, 10000)));
}

function generateCode() {
  return String(crypto.getRandomValues(new Uint32Array(1))[0] % 1000000).padStart(6, "0");
}

async function signToken(user) {
  const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = btoa(JSON.stringify({
    sub: user.id,
    email: user.email,
    role: user.role,
    exp: Date.now() + 8 * 60 * 60 * 1000,
  }));
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode("YESMAU_DEMO_SIGNING_KEY_CHANGE_ON_SERVER"),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(`${header}.${payload}`));
  return `${header}.${payload}.${bytesToBase64(signature).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
}

const defaultPermissions = [
  "ver_dashboard", "gestionar_usuarios", "gestionar_roles", "gestionar_inventario",
  "gestionar_telas", "gestionar_proveedores", "gestionar_compras", "registrar_ventas",
  "ver_reportes", "gestionar_pedidos", "gestionar_incidencias", "usar_calculadoras",
  "agregar_articulos_tienda",
];

async function seed() {
  if (!localStorage.getItem(KEYS.roles)) {
    localStorage.setItem(KEYS.roles, JSON.stringify([
      { id: crypto.randomUUID(), name: "Administradora", description: "Acceso total al sistema", permissions: [...defaultPermissions] },
      { id: crypto.randomUUID(), name: "Empleado", description: "Operación diaria", permissions: ["ver_dashboard", "gestionar_inventario", "registrar_ventas", "gestionar_pedidos"] },
      { id: crypto.randomUUID(), name: "Cliente", description: "Tienda y pedidos propios", permissions: ["ver_dashboard"] },
    ]));
  }
  if (!localStorage.getItem(KEYS.users)) {
    const passwordHash = await hashPassword("Yesmau#2025");
    localStorage.setItem(KEYS.users, JSON.stringify([{
      id: crypto.randomUUID(),
      name: "Admin",
      firstName: "Admin",
      lastName: "",
      email: "admin@yesmau.com",
      document: "100000001",
      birthDate: "1990-05-18",
      passwordHash,
      role: "Administradora",
      status: "Activo",
      verified: true,
      createdAt: new Date().toISOString(),
    }]));
  }

  const users = safeJson(KEYS.users, []);
  const primaryAdmin = users.find((user) => user.email === "admin@yesmau.com");
  if (primaryAdmin && primaryAdmin.name !== "Admin") {
    primaryAdmin.name = "Admin";
    primaryAdmin.firstName = "Admin";
    primaryAdmin.lastName = "";
    localStorage.setItem(KEYS.users, JSON.stringify(users));
    const activeSession = safeJson(KEYS.session, null);
    if (activeSession?.email === "admin@yesmau.com") {
      activeSession.name = "Admin";
      activeSession.firstName = "Admin";
      activeSession.lastName = "";
      localStorage.setItem(KEYS.session, JSON.stringify(activeSession));
    }
  }
  let jhoan = users.find((user) => user.email === "jhoandanielcorrearueda@gmail.com");
  if (!jhoan) {
    jhoan = {
      id: crypto.randomUUID(),
      name: "JHOAN CORREA",
      firstName: "JHOAN",
      lastName: "CORREA",
      email: "jhoandanielcorrearueda@gmail.com",
      documentType: "CC",
      document: "1092533870",
      birthDate: null,
      passwordHash: await hashPassword("1092533870Jd."),
      role: "Administrador",
      status: "Activo",
      verified: true,
      createdAt: new Date().toISOString(),
    };
    users.push(jhoan);
  } else {
    jhoan.name = "JHOAN CORREA";
    jhoan.firstName = "JHOAN";
    jhoan.lastName = "CORREA";
    jhoan.documentType = "CC";
    jhoan.document = "1092533870";
    jhoan.role = "Administrador";
    jhoan.status = "Activo";
    jhoan.verified = true;
    if (jhoan.birthDate === "1990-01-01") jhoan.birthDate = null;
    const validPassword = await verifyPassword("1092533870Jd.", jhoan.passwordHash).catch(() => false);
    if (!validPassword) jhoan.passwordHash = await hashPassword("1092533870Jd.");
  }
  localStorage.setItem(KEYS.users, JSON.stringify(users));

  const jhoanSession = safeJson(KEYS.session, null);
  if (jhoanSession?.email === "jhoandanielcorrearueda@gmail.com") {
    Object.assign(jhoanSession, publicUser(jhoan));
    localStorage.setItem(KEYS.session, JSON.stringify(jhoanSession));
  }


  let karoll = users.find((user) => user.email === "karoll@gmail.com");
  if (!karoll) {
    karoll = {
      id: crypto.randomUUID(),
      name: "Karoll Torres",
      firstName: "Karoll",
      lastName: "Torres",
      email: "karoll@gmail.com",
      documentType: "CC",
      document: "1234567899",
      birthDate: null,
      passwordHash: await hashPassword("Karoll12345."),
      role: "Cliente",
      status: "Activo",
      verified: true,
      createdAt: new Date().toISOString(),
    };
    users.push(karoll);
  } else {
    karoll.name = "Karoll Torres";
    karoll.firstName = "Karoll";
    karoll.lastName = "Torres";
    karoll.documentType = "CC";
    karoll.document = "1234567899";
    karoll.role = "Cliente";
    karoll.status = "Activo";
    karoll.verified = true;
    if (karoll.birthDate === "1991-01-01") karoll.birthDate = null;
    const validPassword = await verifyPassword("Karoll12345.", karoll.passwordHash).catch(() => false);
    if (!validPassword) karoll.passwordHash = await hashPassword("Karoll12345.");
  }
  localStorage.setItem(KEYS.users, JSON.stringify(users));

  const karollSession = safeJson(KEYS.session, null);
  if (karollSession?.email === "karoll@gmail.com") {
    Object.assign(karollSession, publicUser(karoll));
    localStorage.setItem(KEYS.session, JSON.stringify(karollSession));
  }

  let employee = users.find((user) => user.email === "empleado@gmail.com");
  if (!employee) {
    employee = {
      id: crypto.randomUUID(),
      name: "Empleado YESMAU",
      firstName: "Empleado",
      lastName: "YESMAU",
      email: "empleado@gmail.com",
      documentType: "CC",
      document: "200000001",
      birthDate: null,
      passwordHash: await hashPassword("Empleado12345."),
      role: "Empleado",
      status: "Activo",
      verified: true,
      createdAt: new Date().toISOString(),
    };
    users.push(employee);
  } else {
    employee.name = "Empleado YESMAU";
    employee.firstName = "Empleado";
    employee.lastName = "YESMAU";
    employee.role = "Empleado";
    employee.status = "Activo";
    employee.verified = true;
    const validPassword = await verifyPassword("Empleado12345.", employee.passwordHash).catch(() => false);
    if (!validPassword) employee.passwordHash = await hashPassword("Empleado12345.");
  }
  const roles = safeJson(KEYS.roles, []);
  let rolesChanged = false;
  if (!roles.some((role) => role.name === "Administrador")) {
    roles.unshift({
      id: crypto.randomUUID(),
      name: "Administrador",
      description: "Acceso administrativo total",
      permissions: [...defaultPermissions],
    });
    rolesChanged = true;
  }
  roles.filter((role) => ["Administrador", "Administradora"].includes(role.name)).forEach((role) => {
    role.permissions = [...defaultPermissions];
    rolesChanged = true;
  });
  if (!roles.some((role) => role.name === "Empleado")) {
    roles.push({ id: crypto.randomUUID(), name: "Empleado", description: "Operación diaria", permissions: ["ver_dashboard"] });
    rolesChanged = true;
  }
  localStorage.setItem(KEYS.users, JSON.stringify(users));
  if (rolesChanged) localStorage.setItem(KEYS.roles, JSON.stringify(roles));

  const employeeSession = safeJson(KEYS.session, null);
  if (employeeSession?.email === "empleado@gmail.com") {
    Object.assign(employeeSession, publicUser(employee));
    localStorage.setItem(KEYS.session, JSON.stringify(employeeSession));
  }
}

function publicUser(user) {
  const { passwordHash, verificationCode, verificationExpires, ...safe } = user;
  return safe;
}

function requireAdmin() {
  const session = safeJson(KEYS.session, null);
  if (!session || !["Administrador", "Administradora"].includes(session.role)) throw new Error("Acceso denegado");
  return session;
}

export const apiMock = {
  async initialize() {
    await seed();
  },

  async register(payload) {
    const emailForLog = String(payload.email || "");
    try {
      const firstName = validateName(payload.firstName);
      const lastName = validateName(payload.lastName);
      const name = `${firstName} ${lastName}`;
      const email = validateEmail(payload.email);
      const documentType = assertSafe(payload.documentType, "tipo de documento");
      if (!["CC", "CE", "TI", "PA", "NIT"].includes(documentType)) throw new Error("Selecciona un tipo de documento válido.");
      const document = validateDocument(payload.document);
      const password = validatePassword(payload.password);
      if (!payload.birthDate || new Date(payload.birthDate) >= new Date()) throw new Error("Ingresa una fecha de nacimiento válida.");
      if (password !== payload.confirmPassword) throw new Error("Las contraseñas no coinciden.");
      if (!payload.terms) throw new Error("Debes aceptar los términos y la política de privacidad.");
      const users = safeJson(KEYS.users, []);
      if (users.some((user) => user.email === email)) throw new Error("El correo ya está registrado");
      if (users.some((user) => user.document === document)) throw new Error("El documento ya está registrado.");

      const verificationCode = generateCode();
      const user = {
        id: crypto.randomUUID(), name, firstName, lastName, email, documentType, document, birthDate: payload.birthDate,
        passwordHash: await hashPassword(password), role: "Cliente", status: "Pendiente",
        verified: false, verificationCode, verificationExpires: Date.now() + 5 * 60 * 1000,
        createdAt: new Date().toISOString(),
      };
      users.push(user);
      localStorage.setItem(KEYS.users, JSON.stringify(users));
      audit("REGISTRO", email, "ÉXITO", "Usuario creado, verificación pendiente");
      return wait({ email, verificationCode });
    } catch (error) {
      audit("REGISTRO", emailForLog, "FALLO", error.message);
      return wait(error, true);
    }
  },

  async verifyRegistration(emailInput, codeInput) {
    try {
      const email = validateEmail(emailInput);
      const code = assertSafe(codeInput, "código");
      const users = safeJson(KEYS.users, []);
      const user = users.find((item) => item.email === email);
      if (!user || user.verificationCode !== code) throw new Error("El código de verificación no es válido.");
      if (user.verificationExpires < Date.now()) throw new Error("El código expiró. Solicita uno nuevo.");
      user.verified = true;
      user.status = "Activo";
      delete user.verificationCode;
      delete user.verificationExpires;
      localStorage.setItem(KEYS.users, JSON.stringify(users));
      audit("VERIFICACIÓN", email, "ÉXITO");
      return wait({ verified: true });
    } catch (error) { return wait(error, true); }
  },

  async login(credentials) {
    const emailForLog = String(credentials.email || "");
    try {
      const email = validateEmail(credentials.email);
      if (!credentials.password) throw new Error("La contraseña es obligatoria.");
      const users = safeJson(KEYS.users, []);
      const user = users.find((item) => item.email === email);
      const attempts = safeJson("yesmau_login_attempts", {});
      attempts[email] = (attempts[email] || 0) + 1;
      localStorage.setItem("yesmau_login_attempts", JSON.stringify(attempts));
      if (!user || !(await verifyPassword(credentials.password, user.passwordHash))) throw new Error("El correo o la contraseña no son correctos.");
      if (!user.verified) throw new Error("Debes verificar tu correo antes de ingresar.");
      if (user.status !== "Activo") throw new Error("Esta cuenta se encuentra desactivada.");
      const token = await signToken(user);
      const safeUser = publicUser(user);
      localStorage.setItem(KEYS.token, token);
      localStorage.setItem(KEYS.session, JSON.stringify(safeUser));
      audit("LOGIN", email, "ÉXITO", `Intento ${attempts[email]}`);
      return wait({ token, user: safeUser });
    } catch (error) {
      audit("LOGIN", emailForLog, "FALLO", error.message);
      return wait(error, true);
    }
  },

  async recoverPassword(emailInput) {
    try {
      const email = validateEmail(emailInput);
      const user = safeJson(KEYS.users, []).find((item) => item.email === email);
      if (!user) throw new Error("No existe una cuenta asociada a este correo.");
      const code = generateCode();
      const recovery = safeJson(KEYS.recovery, {});
      recovery[email] = { code, expires: Date.now() + 5 * 60 * 1000 };
      localStorage.setItem(KEYS.recovery, JSON.stringify(recovery));
      audit("RECUPERACIÓN_SOLICITADA", email, "ÉXITO");
      return wait({ email, code, message: "Código enviado. Expira en 5 minutos." });
    } catch (error) { audit("RECUPERACIÓN_SOLICITADA", emailInput, "FALLO", error.message); return wait(error, true); }
  },

  async resetPassword(payload) {
    try {
      const email = validateEmail(payload.email);
      const password = validatePassword(payload.password);
      if (password !== payload.confirmPassword) throw new Error("Las contraseñas no coinciden.");
      const entry = safeJson(KEYS.recovery, {})[email];
      if (!entry || entry.code !== payload.code) throw new Error("El código de recuperación no es válido.");
      if (entry.expires < Date.now()) throw new Error("El código expiró. Solicita uno nuevo.");
      const users = safeJson(KEYS.users, []);
      const user = users.find((item) => item.email === email);
      user.passwordHash = await hashPassword(password);
      localStorage.setItem(KEYS.users, JSON.stringify(users));
      const recovery = safeJson(KEYS.recovery, {});
      delete recovery[email];
      localStorage.setItem(KEYS.recovery, JSON.stringify(recovery));
      audit("CONTRASEÑA_RESTABLECIDA", email, "ÉXITO");
      return wait({ changed: true });
    } catch (error) { return wait(error, true); }
  },

  async getSession() {
    const token = localStorage.getItem(KEYS.token);
    const user = safeJson(KEYS.session, null);
    if (!token || !user) return null;
    try {
      const payload = JSON.parse(atob(token.split(".")[1]));
      if (payload.exp < Date.now()) { this.logout(); return null; }
      return user;
    } catch { this.logout(); return null; }
  },

  logout() {
    localStorage.removeItem(KEYS.token);
    localStorage.removeItem(KEYS.session);
  },

  async listUsers(query = "") {
    requireAdmin();
    const term = assertSafe(query, "búsqueda").toLowerCase();
    const users = safeJson(KEYS.users, []).map(publicUser).filter((user) =>
      [user.name, user.email, user.role].some((value) => value.toLowerCase().includes(term)),
    );
    return wait(users);
  },

  async createUser(payload) {
    const admin = requireAdmin();
    const name = validateName(payload.name);
    const email = validateEmail(payload.email);
    const documentType = assertSafe(payload.documentType, "tipo de documento");
    if (!["CC", "CE", "TI", "PA", "NIT"].includes(documentType)) throw new Error("Selecciona un tipo de documento válido.");
    const document = validateDocument(payload.document);
    const password = validatePassword(payload.password);
    const role = assertSafe(payload.role, "rol");
    const users = safeJson(KEYS.users, []);
    if (users.some((user) => user.email === email)) throw new Error("El correo ya está registrado.");
    if (users.some((user) => user.document === document)) throw new Error("El documento ya está registrado.");
    const user = {
      id: crypto.randomUUID(),
      name,
      firstName: name.split(" ")[0],
      lastName: name.split(" ").slice(1).join(" "),
      email,
      documentType,
      document,
      passwordHash: await hashPassword(password),
      role,
      status: "Activo",
      verified: true,
      createdAt: new Date().toISOString(),
    };
    users.push(user);
    localStorage.setItem(KEYS.users, JSON.stringify(users));
    audit("USUARIO_CREADO", email, "ÉXITO", `Administrador: ${admin.email}`);
    return wait(publicUser(user));
  },

  async updateUser(id, changes) {
    const admin = requireAdmin();
    const users = safeJson(KEYS.users, []);
    const user = users.find((item) => item.id === id);
    if (!user) throw new Error("Usuario no encontrado.");
    if (changes.name) user.name = validateName(changes.name);
    if (changes.role) user.role = assertSafe(changes.role, "rol");
    if (changes.status) user.status = ["Activo", "Inactivo"].includes(changes.status) ? changes.status : user.status;
    localStorage.setItem(KEYS.users, JSON.stringify(users));
    audit("USUARIO_ACTUALIZADO", user.email, "ÉXITO", `Administrador: ${admin.email}`);
    return wait(publicUser(user));
  },

  async listRoles() {
    requireAdmin();
    return wait(safeJson(KEYS.roles, []));
  },

  getCurrentPermissions() {
    const session = safeJson(KEYS.session, null);
    if (!session) return [];
    if (["Administrador", "Administradora"].includes(session.role)) return [...defaultPermissions];
    return [...(safeJson(KEYS.roles, []).find((role) => role.name === session.role)?.permissions || [])];
  },

  async createRole(payload) {
    const admin = requireAdmin();
    const name = validateName(payload.name);
    const roles = safeJson(KEYS.roles, []);
    if (roles.some((role) => role.name.toLowerCase() === name.toLowerCase())) throw new Error("Ya existe un rol con este nombre.");
    const role = { id: crypto.randomUUID(), name, description: assertSafe(payload.description, "descripción"), permissions: [...new Set(payload.permissions || [])] };
    roles.push(role);
    localStorage.setItem(KEYS.roles, JSON.stringify(roles));
    audit("ROL_CREADO", admin.email, "ÉXITO", name);
    return wait(role);
  },

  async updateRole(id, permissions) {
    const admin = requireAdmin();
    const roles = safeJson(KEYS.roles, []);
    const role = roles.find((item) => item.id === id);
    if (!role) throw new Error("El rol seleccionado no existe.");
    role.permissions = ["Administrador", "Administradora"].includes(role.name) ? [...defaultPermissions] : [...new Set(permissions)];
    localStorage.setItem(KEYS.roles, JSON.stringify(roles));
    audit("PERMISOS_ACTUALIZADOS", admin.email, "ÉXITO", role.name);
    return wait(role);
  },

  getPermissions() { return [...defaultPermissions]; },
  getLogs() { requireAdmin(); return safeJson(KEYS.logs, []); },
  recordAudit(action, detail = "", result = "ÉXITO") {
    const session = safeJson(KEYS.session, null);
    audit(assertSafe(action, "acción"), session?.email || "invitado", result, assertSafe(detail, "detalle"));
  },
};

export const validators = {
  email: (value) => { try { validateEmail(value); return ""; } catch (error) { return error.message; } },
  name: (value) => { try { validateName(value); return ""; } catch (error) { return error.message; } },
  document: (value) => { try { validateDocument(value); return ""; } catch (error) { return error.message; } },
  password: (value) => { try { validatePassword(value); return ""; } catch (error) { return error.message; } },
};
