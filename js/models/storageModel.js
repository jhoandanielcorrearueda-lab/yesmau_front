export function loadLocalRecords(key, fallback) {
  try {
    const saved = JSON.parse(localStorage.getItem(key) || "null");
    return Array.isArray(saved) ? saved : fallback;
  } catch {
    return fallback;
  }
}

export function loadLocalObject(key, fallback) {
  try {
    const saved = JSON.parse(localStorage.getItem(key) || "null");
    return saved && typeof saved === "object" && !Array.isArray(saved)
      ? { ...fallback, ...saved }
      : { ...fallback };
  } catch {
    return { ...fallback };
  }
}

export function normalizeCOPAmount(value) {
  if (typeof value === "number") return value < 10000 ? value * 1000 : value;
  const text = String(value || "").trim();
  if (text.includes("COP")) return Number(text.replace(/\D/g, ""));
  if (/\$\s*\d{1,3}(?:\.\d{3})+/.test(text)) {
    const amount = Number(text.replace(/\D/g, ""));
    return amount < 10000 ? amount * 1000 : amount;
  }
  const parsed = Number(text.replace(/[^\d.]/g, ""));
  return Number.isFinite(parsed) ? (parsed < 10000 ? parsed * 1000 : parsed) : 0;
}

export function formatCOP(value) {
  return `$${Math.round(Number(value) || 0).toLocaleString("es-CO")} COP`;
}
