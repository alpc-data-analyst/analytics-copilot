# Material para la ficha de Chrome Web Store

## Propósito único (single purpose)

> ES: Analytics Copilot tiene un único propósito: **depurar y auditar la implementación de analítica web** (GA4, Google Tag Manager, Google Ads, Consent Mode) de las páginas que el usuario decide inspeccionar. Todas las funciones — inspección de consentimiento, auditoría de cookies y sesión, verificación de atribución y conversiones, generación de eventos de prueba, captura de logs y captura de pantalla para documentar hallazgos — sirven a ese único fin de QA de medición.

> EN: Analytics Copilot has a single purpose: **debugging and auditing the web-analytics implementation** (GA4, Google Tag Manager, Google Ads, Consent Mode) of pages the user chooses to inspect. Every feature — consent inspection, cookie/session auditing, attribution and conversion verification, test-event generation, console capture and screenshots to document findings — serves that single measurement-QA goal.

## Justificación de permisos (pestaña "Prácticas de privacidad")

| Permiso | Justificación (EN, para el formulario) |
|---|---|
| `activeTab` | Used to run one-off, user-initiated scans (tag detection, HTML capture, full-page screenshot) on the tab the user is currently inspecting. |
| `storage` | Stores only the user's own extension settings locally (Time Travel date, Lab blocking rules, UI state). No personal data, nothing is transmitted. |
| `scripting` | Injects read-only inspection snippets into the page the user chose to audit (read dataLayer/consent state, list cookies, capture console logs) and the small floating status widget. All injections are user-initiated. |
| `browsingData` | Powers the user-initiated "clear site data" tool (cookies/cache/storage of the current site) used to test tracking from a clean state. |
| `webNavigation` | Detects page loads during an active cookie/session audit so cross-domain hops and session breaks can be attributed to the right navigation. |
| `declarativeNetRequest` | Implements the user-configured request blocking (e.g. block GTM/GA4) used to test how the site behaves without a given tag. Rules are created only by the user. |
| `cookies` (opcional) | Requested only when the user starts a Cookie Audit; needed to read cookie metadata (HttpOnly, domain, expiry) and observe changes to diagnose GA4 session loss. |
| Host permissions `http/https` (opcional) | Requested on first use, because the user may need to audit analytics on any site they work on. The extension only ever reads; nothing is collected or transmitted. |

## Descripción para la ficha (ES)

**Analytics Copilot — QA de analítica web en un clic**

9 herramientas para implementadores y auditores de GA4 / GTM / Google Ads:

🔒 Consent Mode v2: señales default→update, GCS/GCD decodificado, modo Básico vs Avanzado, hits con su estado de consentimiento, calculadora GCD y auditoría con 18 reglas.
🍪 Cookie Audit: vigila la sesión de GA4 en vivo (client_id, countdown de inactividad), la atribución de Google Ads (gclid → _gcl_aw, Conversion Linker) y las conversiones (value, currency, label, enhanced conversions).
🏷 Tag Scanner: detecta 40+ herramientas de tracking con sus IDs y permite bloquearlas para pruebas.
📈 Eventos GA4: genera dataLayer.push() del funnel ecommerce completo.
📸 Captura de página completa: hace scroll y cose la página entera en una imagen, y la abre en un editor para señalar con flechas, cajas y texto y difuminar datos sensibles antes de compartirla.
⏩ Time Travel, 🔄 limpieza de caché por sitio, 📄 captura de HTML, 📟 captura de consola y 🧪 Lab de inyección/bloqueo.

Sin cuentas, sin telemetría: todo ocurre en tu navegador.

## Checklist de envío

1. ZIP del build (sin .git, sin docs/) — `manifest.json` en la raíz
2. Capturas 1280×800 (mínimo 1, ideal 4-5): home, Consent, Cookie Audit con conversión, Tags
3. Icono de ficha 128×128 ✓ (ya en el ZIP)
4. Categoría: **Developer Tools** · Idioma: Español
5. Privacy practices: propósito único + tabla de arriba + "no recoge datos" + URL de PRIVACY.md
6. URL de política de privacidad: enlace a PRIVACY.md del repo (público) o página en antonioluisperez.com

---

## Actualización v1.4.0 (agosto 2026)

**Novedad**: captura de página completa con editor de anotaciones.

- **No añade ningún permiso nuevo.** Usa `activeTab` + `scripting`, ya concedidos, y la API
  `chrome.tabs.captureVisibleTab`, que solo actúa sobre la pestaña activa por gesto del usuario.
- La imagen **nunca sale del navegador**: se compone en un `<canvas>` local y se guarda en
  IndexedDB del propio usuario. No hay subida, ni servidor, ni telemetría.
- El difuminado pixela la zona muestreando la imagen original, de forma que el dato queda
  irrecuperable en el PNG exportado (pensado para tapar client_id, emails o transaction_id
  antes de compartir una captura con un cliente o compañero).

**Qué contestar si preguntan por el cambio**: sustituye a las extensiones de captura de página
completa para el caso de uso de QA de analítica — documentar un hallazgo (un banner de consentimiento
mal configurado, un tag que no dispara) sin salir de la herramienta ni conceder permisos a un tercero.

**Texto para "Qué hay de nuevo"**:
> Nueva captura de página completa con editor: señala con flechas, cajas y texto, y difumina datos
> sensibles antes de compartir. Sin permisos nuevos y sin que la imagen salga de tu navegador.
