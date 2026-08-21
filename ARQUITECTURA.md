# Analytics Copilot — Arquitectura y documentación técnica

---

## Archivos

```
manifest.json          Manifest V3. Permisos mínimos al instalar, opcionales bajo demanda
background.js          Service Worker. Hub central: mensajes, inyección, auditoría, Lab
icons/                 Iconos de la extensión (logo.svg fuente + PNG 16/48/128 + icons.svg sprite fuente)
ui/
  popup.html           UI del popup (Inicio + 10 herramientas, sprite SVG incrustado)
  panel.html           Panel DevTools (misma UI en modo panel)
  popup.js             Lógica de todas las herramientas (popup y panel)
  styles.css           Estilos del popup y panel
  devtools.html        Página DevTools que carga el panel
  devtools.js          Registra el panel en DevTools
content/
  time-travel-cs.js    CS dinámico — pide a background inyectar override de `Date`
  floating-widget.js   CS dinámico — widget flotante con features activas
  console-capture-cs.js CS dinámico (world MAIN) — captura console.* durante la captura
```

---

## Herramientas (Inicio + 10)

### 1. Inicio (Home)
- Dashboard con estado de features activas (Lab, Time Travel)
- Acceso rápido a todas las herramientas

### 2. Tag Scanner
- Escanea la página para detectar herramientas de tracking instaladas
- Detecta: GTM, GA4, Google Ads, Meta Pixel, TikTok Pixel, Hotjar, Clarity, Segment, etc.
- Toggle de bloqueo inline por herramienta (con banner de recarga)

### 3. Time Travel
- Sobreescribe `window.Date` con una fecha/hora personalizada
- Permite probar tracking con fechas pasadas/futuras
- Content script dinámico (`time-travel-cs.js`) registrado solo cuando está activo

### 4. Cache & Storage
- Borrar cookies, localStorage, cache, service workers por sitio

### 5. Consent Mode (estilo Consent Mode Inspector)
- Escanea el estado del Consent Mode de Google; badge v1/v2 y modo Básico vs Avanzado
- Detecta CMP (Cookiebot, OneTrust, etc.) y ajustes: wait_for_update, ads_data_redaction, url_passthrough, region
- Muestra estado de cada señal (ad_storage, analytics_storage, etc.) con transición default→update
- Historial de hits de Google (GA4/Ads/DoubleClick) con GCS decodificado al momento del disparo
  (interceptor en vivo + performance entries para hits previos al escaneo)
- Calculadora GCD interactiva y botón "Copiar informe" para compartir
- Auditoría declarativa `CONSENT_AUDIT_RULES` (18 reglas basadas en documentación de Google)

### 6. Cookie Audit
- Banner-respuesta: ¿la sesión GA4 está estable, con avisos o en riesgo? (y por qué)
- Sub-pestañas: Sesión (client_id, sesión #, countdown de inactividad, alertas),
  Cookies (tabla actual + perdidas, problemas de atributos como ⚠ con tooltip),
  Timeline (eventos compactos: nav, x-domain con/sin _gl, cookies creadas/borradas)
- Filtra ruido: updates de _ga_* que sólo cambian el timestamp interno no se muestran
- Atribución Google Ads: captura del gclid al aterrizar, verificación gclid↔_gcl_aw,
  Conversion Linker (_gcl_au), wbraid; roturas de atribución en el banner de estado
- Conversiones: captura los pings de compra (GA4 purchase con value/currency/transaction_id
  y Google Ads /pagead/conversion con value, currency_code, label y gclid) vía performance entries
- Motor en background: snapshot + chrome.cookies.onChanged + detección cross-domain

### 7. Lab (Inyectar & Bloquear)
- Inyectar contenedor GTM de prueba (por ID)
- Push personalizado al dataLayer (JSON estructurado — sin evaluación de código)
- Bloqueo de requests por URL pattern (declarativeNetRequest)
- Quick blocks: GTM, GA4, Ads, Meta, TikTok

### 8. Captura de página completa
- `chrome.tabs.captureVisibleTab()` solo fotografía el viewport, así que se hace scroll
  por tramos, se captura cada uno y se cosen en un `<canvas>` dentro del popup
- Oculta los elementos `position: fixed`/`sticky` a partir del segundo tramo (opcional)
  para que cabeceras y banners no se repitan a lo largo de la imagen
- Salvaguardas: máximo 60 tramos, si el alto supera ~32.000 px baja a escala 1x
  (límite de canvas de Chrome), reintentos ante el límite de frecuencia de
  `captureVisibleTab`, y restauración del scroll original pase lo que pase
- Salida: vista previa, descarga PNG, copia al portapapeles y apertura en pestaña
- No requiere permisos nuevos (usa `activeTab`) y la imagen nunca sale del navegador

### 9. HTML Grabber
- Captura el HTML renderizado (DOM en vivo) de la página actual
- Copiar al portapapeles o descargar como `.html`
- Vista previa del código en un textarea

### 10. Eventos GA4 (generador dataLayer)
- Generador de snippets `dataLayer.push()` para el funnel ecommerce GA4 completo
  (view_item_list → … → purchase/refund) y eventos recomendados (login, sign_up, search…)
- Esquemas declarativos en `DL_EVENT_SCHEMAS` (popup.js) — añadir un evento = añadir un objeto
- Convenio `ecommerce: null` antes de cada push (guía oficial GTM)
- Snippet editable, copiar al portapapeles o "Push a la página" (executeScript MAIN world)
- Esquemas basados en la documentación oficial de eventos ecommerce de GA4

### 11. Console Capture
- Captura `console.log/info/warn/error/debug` + errores JS de la página
- Content script dinámico (`console-capture-cs.js`, world MAIN) registrado solo durante la captura
- Los logs se guardan en `sessionStorage` de la página (sobreviven a recargas del mismo origen)
- Copiar al portapapeles o descargar como `.txt`

---

## Widget Flotante
- Se inyecta dinámicamente en las páginas cuando hay features activas
- Muestra pills: Time Travel, Cookie Audit, Lab
- Se colapsa a un icono circular
- Se actualiza en tiempo real sin recargar la página

---

## Permisos

### Fijos (al instalar)
| Permiso | Uso |
|---|---|
| `activeTab` | Acceso a la pestaña activa por gesto del usuario |
| `storage` | Guardar configuración y estado UI |
| `scripting` | Inyectar scripts en páginas (tags scan, Lab, etc.) |
| `browsingData` | Borrar cookies/storage/cache por sitio |
| `webNavigation` | Detectar cargas de página para inyectar Lab |
| `declarativeNetRequest` | Bloquear requests de tracking |

### Opcionales (bajo demanda)
| Permiso | Cuándo se pide | Uso |
|---|---|---|
| `cookies` | Al iniciar Cookie Audit | Leer metadatos de cookies (HttpOnly, domain, etc.) y escuchar cambios |
| `http://*/*`, `https://*/*` | Al usar cualquier herramienta que acceda a la página | Inyectar scripts, escanear tags, widget flotante |

---

## Arquitectura de inyección

```
Popup/Panel (popup.js)
    │
    ├── chrome.runtime.sendMessage ──→ Background (background.js)
    │                                      │
    │                                      ├── chrome.scripting.executeScript (inyección directa)
    │                                      ├── chrome.scripting.registerContentScripts (CS dinámicos)
    │                                      ├── chrome.declarativeNetRequest (bloqueo de red)
    │                                      └── chrome.tabs.sendMessage → floating-widget.js
    │
    └── chrome.scripting.executeScript (desde popup directamente)

Content Scripts:
    ├── content/time-travel-cs.js (dinámico, se registra al activar time-travel)
    ├── content/console-capture-cs.js (dinámico, world MAIN, registrado durante la captura de consola)
    └── content/floating-widget.js (dinámico, se inyecta al activar features)
```

---

## Chrome Web Store

### Infracciones resueltas (18 marzo 2026)
1. **Permiso `cookies` no usado** → movido a `optional_permissions`, se pide solo en Cookie Audit
2. **Permiso `declarativeNetRequestFeedback` no usado** → eliminado
3. **Host permissions amplios** → movidos a `optional_host_permissions`, se piden bajo demanda
4. **Content scripts en todas las URLs** → registrados dinámicamente via `chrome.scripting.registerContentScripts`
