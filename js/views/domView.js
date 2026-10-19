export const $ = (selector, context = document) => context.querySelector(selector);

export const $$ = (selector, context = document) => [...context.querySelectorAll(selector)];

export const icon = name => `<svg aria-hidden="true"><use href="#i-${name}"></use></svg>`;

export function escapeHtml(value) {
  const element = document.createElement("div");
  element.textContent = String(value);
  return element.innerHTML;
}

function configuredLink(label, url, topic, external = false) {
  if (!url) {
    return `<button type="button" data-footer-info="${escapeHtml(topic)}">${escapeHtml(label)}</button>`;
  }
  return `<a href="${escapeHtml(url)}"${external ? ' target="_blank" rel="noopener noreferrer"' : ""}>${escapeHtml(label)}</a>`;
}

function footerNavigation() {
  return `
    <a href="#publicCollection">Colección</a>
    <a href="#publicServices">Servicios</a>
    <a href="#publicProcess">Nuestro proceso</a>
    <a href="#publicAbout">Nosotros</a>
    <button type="button" data-auth-view="login">Ingresar</button>`;
}

export function publicFooterTemplate(contact, location, year) {
  return `
    <div class="client-footer-main">
      <div class="client-footer-brand">
        <span class="company-logo company-logo-footer"><img src="/assets/yesmau-logo.png" alt="YESMAU Ropa Casual"></span>
        <div><strong>YESMAU</strong><small>ROPA CASUAL BY E&amp;R</small></div>
        <p>Diseño casual y gestión textil conectados en una experiencia cercana.</p>
      </div>
      <section class="client-footer-column">
        <h2>Ayuda y contacto</h2>
        <div class="client-footer-list">
          ${configuredLink("Preguntas frecuentes", contact.faqUrl, "faq")}
          <a href="#publicServices">Servicios en línea</a>
          ${configuredLink("Contáctanos", contact.emailUrl, "contact")}
          ${configuredLink("Glosario", contact.glossaryUrl, "glossary")}
          ${configuredLink("Redes sociales", contact.socialUrl, "social", true)}
          ${configuredLink("Quejas o reclamos", contact.complaintsUrl, "complaints")}
        </div>
      </section>
      <section class="client-footer-column">
        <h2>Datos de contacto</h2>
        <address class="client-footer-list">
          <span><b>Dirección</b>${escapeHtml(location.address)}</span>
          <span><b>Teléfono</b>${contact.phoneUrl ? `<a href="${escapeHtml(contact.phoneUrl)}">${escapeHtml(contact.phone)}</a>` : `${escapeHtml(contact.phone)}<small>Por configurar</small>`}</span>
          <span><b>Correo</b>${contact.emailUrl ? `<a href="${escapeHtml(contact.emailUrl)}">${escapeHtml(contact.email)}</a>` : `${escapeHtml(contact.email)}<small>Por configurar</small>`}</span>
          ${location.configured && location.mapUrl ? `<a href="${escapeHtml(location.mapUrl)}" target="_blank" rel="noopener noreferrer">Ver ubicación</a>` : `<button type="button" data-footer-info="location">Consultar ubicación</button>`}
        </address>
      </section>
      <nav class="client-footer-column" aria-label="Mapa del sitio">
        <h2>Mapa del sitio</h2>
        <div class="client-footer-list">${footerNavigation()}</div>
      </nav>
    </div>
    <div class="client-footer-legal">
      <small>© ${year} YESMAU. Todos los derechos reservados.</small>
      <div>${configuredLink("Privacidad", contact.privacyUrl, "privacy")}${configuredLink("Términos y condiciones", contact.termsUrl, "terms")}</div>
    </div>`;
}
