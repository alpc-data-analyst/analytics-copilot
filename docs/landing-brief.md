# Briefing — página del portfolio para Analytics Copilot

**Para**: el proyecto que gestiona antonioluisperez.com
**Objetivo**: crear la página `antonioluisperez.com/analytics-copilot` presentando la extensión, enlazada desde la sección de herramientas/proyectos del portfolio.

---

## Qué es el producto (elevator pitch)

Analytics Copilot es una extensión de Chrome (Manifest V3) con **9 herramientas de QA para analítica web**, creada por Antonio Luis Pérez. Permite auditar Consent Mode v2, vigilar la sesión de GA4 en tiempo real, verificar la atribución de Google Ads de punta a punta (clic de anuncio → gclid → cookie → conversión con value y currency) y generar eventos de dataLayer — todo desde el popup o el panel de DevTools, sin abrir la pestaña Network. 100% local: no envía ningún dato a ningún servidor.

## Enlaces

| Qué | URL |
|---|---|
| Repositorio (código, MIT) | https://github.com/alpc-data-analyst/analytics-copilot |
| Descarga (ZIP, release) | https://github.com/alpc-data-analyst/analytics-copilot/releases/latest |
| Política de privacidad | https://github.com/alpc-data-analyst/analytics-copilot/blob/main/PRIVACY.md |
| Chrome Web Store | **PENDIENTE de revisión** — dejar un botón "Añadir a Chrome (próximamente)" deshabilitado o un placeholder fácil de actualizar |
| LinkedIn del autor | https://www.linkedin.com/in/antonio-luis-perez-carmona/ |

## Imágenes (URLs públicas, listas para usar)

Base: `https://raw.githubusercontent.com/alpc-data-analyst/analytics-copilot/main/`

- `icons/logo.svg` — logo vectorial (pulso sobre badge slate `#1F2937`, punto azul `#38BDF8`)
- `docs/screenshots/menu.jpg` — **hero/principal**: la parrilla de 9 herramientas (1280×800)
- `docs/screenshots/consent-mode.jpg` — inspector de Consent Mode
- `docs/screenshots/cookies.jpg` — Cookie Audit (sesión GA4 + atribución)
- `docs/screenshots/push-event.jpg` — generador de eventos GA4
- `docs/screenshots/tags.jpg` — detector de tags
- `docs/screenshots/promo-marquee-1400x560.png` — banner horizontal (sirve como OG image / cabecera)
- `docs/screenshots/promo-small-440x280.png` — tile compacta

Todas las capturas van sobre fondo slate `#1F2937` — combinan bien sobre fondos oscuros o como tarjetas con sombra sobre claro.

## Estructura sugerida de la página

1. **Hero**: logo + "Analytics Copilot" + claim: *"QA de analítica web en un clic — GA4, GTM, Google Ads y Consent Mode"* + 2 CTAs: "Descargar (GitHub)" y "Chrome Web Store (próximamente)" + captura `menu.jpg`
2. **Las 9 herramientas** (grid con iconos/emojis):
   - 🔒 **Consent** — Inspector de Consent Mode v2: señales default→update, GCS/GCD decodificado, modo Básico vs Avanzado, hits de Google con su estado de consentimiento al disparo, calculadora GCD y auditoría con 18 reglas
   - 🍪 **Cookie Audit** — Sesión GA4 en vivo (client_id, countdown de inactividad), atribución de Google Ads (gclid → _gcl_aw, Conversion Linker) y conversiones (value, currency, label, enhanced conversions)
   - 🏷 **Tags** — Detecta 40+ herramientas de tracking con sus IDs y permite bloquearlas para pruebas
   - 📈 **Eventos GA4** — Generador de dataLayer.push() del funnel ecommerce completo
   - ⏩ **Time Travel** — Simula otra fecha/hora en el navegador
   - 🔄 **Cache** — Limpia cookies/storage/cache del sitio y recarga
   - 🧪 **Lab** — Inyecta GTM de prueba, push al dataLayer (JSON) y bloqueo de requests
   - 📄 **HTML** — Copia o descarga el DOM renderizado
   - 📟 **Consola** — Captura console.* y errores JS (sobrevive a recargas)
3. **El flujo estrella** (diferencial del producto — sección "cómo se usa"): auditar un clic de anuncio real: *Iniciar Audit → clic en el anuncio → verificar que el gclid se guarda en _gcl_aw → completar la compra → ver la conversión con value, currency y si viajó el gclid. Sin abrir el Network.*
4. **Capturas** (carrusel o grid con las 4 restantes)
5. **Privacidad**: "100% local. Sin cuentas, sin telemetría, sin servidores. Los permisos sensibles son opcionales y se piden al usarlos." + enlace a PRIVACY.md
6. **Instalación** (mientras no esté en la Store): 4 pasos — descargar ZIP de la release → descomprimir → chrome://extensions + Modo desarrollador → "Cargar descomprimida"
7. **Footer**: código abierto (MIT) en GitHub · hecho por Antonio Luis Pérez

## Branding

- Slate oscuro `#1F2937` (fondo del logo y capturas) · Azul acento `#38BDF8` (punto del logo) · Azul primario UI `#2563EB`
- Tipografía de sistema (system-ui) — la extensión no usa webfonts
- Tono: técnico-práctico, para gente de analítica/marketing; español

## SEO

- Title: `Analytics Copilot — extensión de Chrome para QA de analítica web | Antonio Luis Pérez`
- Meta description: `9 herramientas para auditar GA4, GTM, Google Ads y Consent Mode desde Chrome: sesión, atribución, conversiones y consentimiento en tiempo real. Gratis y open source.`
- OG image: `docs/screenshots/promo-marquee-1400x560.png`

## Mantenimiento futuro

Cuando la Chrome Web Store apruebe la extensión, sustituir el placeholder por el botón real "Añadir a Chrome" con la URL de la ficha.
