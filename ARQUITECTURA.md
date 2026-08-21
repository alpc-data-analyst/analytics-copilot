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
  shot.html            Visor/editor de la última captura (pestaña propia)
  shot.js              Anotaciones sobre la captura (flechas, cajas, texto, difuminado)
  styles.css           Estilos del popup y panel
  devtools.html        Página DevTools que carga el panel
  devtools.js          Registra el panel en DevTools
content/
  time-travel-cs.js    CS dinámico — pide a background inyectar override de `Date`
  floating-widget.js   CS dinámico — widget flotante con features activas
  console-capture-cs.js CS dinámico (world MAIN) — captura console.* durante la captura
```

---

## Herramientas (Inicio + 9 en el menú + Captura rápida en la cabecera)

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

### 8. Captura de página completa (iconos de la cabecera)

Sin tarjeta en el menú: tres iconos en la cabecera, disponibles en todas las pantallas —
📷 `#quickShotBtn` (capturar), 💾 `#shotDownloadBtn` y 👁 `#shotOpenBtn` (los dos últimos
aparecen solo cuando ya hay una captura guardada).

**Motor de captura** (`captureFullPage` y ayudantes `shot*` en `ui/popup.js`)
- `chrome.tabs.captureVisibleTab()` solo fotografía el viewport, así que se hace scroll
  por tramos, se captura cada uno y se cosen en un `<canvas>`
- `shotMeasure()` decide qué scrollea: el documento o un contenedor interno con
  `overflow-y: auto` (GA4, SPAs). En ese caso recorta al rectángulo del contenedor
- La escala se **deriva** de la imagen capturada (`img.width / innerWidth`), nunca se
  asume `devicePixelRatio`; el ancho se toma de `documentElement.clientWidth` para
  excluir la barra de scroll
- Orden por tramo: scroll → esperar asentamiento → ocultar fijos → capturar. Los
  elementos `fixed`/`sticky` se reescanean en **cada** tramo porque muchas webs vuelven
  sticky la cabecera solo al hacer scroll. En modo contenedor se respetan los sticky más
  altos que `cropH * 0.25` (columnas congeladas de tablas)
- `shotPrimeLazy()` recorre la página antes de capturar para disparar el lazy load
- Salvaguardas: máximo 60 tramos, escala 1x si el alto supera ~32.000 px (límite de
  canvas de Chrome), reintentos ante el límite de frecuencia de `captureVisibleTab`,
  y restauración del scroll original pase lo que pase
- No requiere permisos nuevos (usa `activeTab`); la imagen nunca sale del navegador

**Caché de la última captura**
- El PNG se guarda como `Blob` en IndexedDB (`ac-shots` / `shots` / clave `last`) junto a
  hostname, timestamp y nombre de fichero. Se usa IndexedDB y no `chrome.storage` porque
  este obligaría a base64 (+33 % de tamaño) sobre imágenes de decenas de MB

**Visor y editor** (`ui/shot.html` + `ui/shot.js`)
- Herramientas: Mover, Flecha, Cuadrado, Texto y Difuminar, con 4 colores, deshacer
  (Ctrl/⌘+Z), borrar elemento (Supr) y limpiar todo
- Los elementos son **objetos**, no píxeles: se guardan en coordenadas naturales de la
  imagen y se pueden seleccionar y arrastrar después de crearlos. Al insertar uno se
  activa Mover automáticamente y queda seleccionado. Doble clic sobre un texto lo reedita
  (dejarlo vacío lo borra). Detección de clic: rectángulo con tolerancia para cajas y
  texto, distancia punto-segmento para flechas; gana el de más arriba en la pila
- **Rendimiento — decisión clave**: no existe ningún canvas del tamaño de la imagen. Uno
  de 2880×18522 ocupa ~200 MB y su alto supera el límite de textura de la GPU (16.384 px),
  lo que fuerza a Chrome a rasterizar por CPU y hace inusable el editor. En su lugar el
  fondo es un `<img>` (lo compone el navegador) y las anotaciones se pintan en **una capa
  `position: fixed` del tamaño de lo visible** (~4 MP / 16 MB), con
  `ctx.setTransform(S·dpr, 0, 0, S·dpr, offsetX, offsetY)` para seguir dibujando en
  coordenadas naturales. Se redibuja con rAF al mover el ratón, al hacer scroll y al
  editar, descartando lo que cae fuera de pantalla: **coste constante** sea cual sea el
  alto de la captura
- El difuminado muestrea de la imagen original y la pixela, así que en el PNG exportado el
  dato es irrecuperable, no es un efecto visual reversible
- La imagen a tamaño completo solo se compone una vez, al pulsar "Descargar PNG"
- El campo de texto se enfoca en el siguiente frame y su `blur` se ignora durante 150 ms:
  la acción por defecto del `mousedown` del canvas le robaba el foco y lo cerraba al nacer

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
