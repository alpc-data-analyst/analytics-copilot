# Analytics Copilot — memoria del proyecto

Extensión de Chrome (Manifest V3) de **QA de analítica web**, de Antonio Luis Pérez.
Publicada en la Chrome Web Store y en GitHub con licencia MIT.

- Store: https://chromewebstore.google.com/detail/analytics-copilot/icnecmnkghkklcjmolmmcljdodeglfpe
- Repo: https://github.com/alpc-data-analyst/analytics-copilot
- Landing: https://antonioluisperez.com/analytics-copilot/ (la mantiene **otro** proyecto de Claude)

## Estructura

```
manifest.json      Manifest V3
background.js      Service worker: motor del Cookie Audit, inyecciones, Lab
ui/                Popup, panel DevTools, visor de capturas, lógica y estilos
content/           Content scripts dinámicos
icons/             Iconos de la extensión + fuentes SVG
docs/              Material de publicación (ver abajo)
capturas/          LOCAL, fuera de git: originales en bruto de las capturas
dist/              LOCAL, fuera de git: ZIPs de cada release
```

`docs/` es lo que se publica y lo que consumen terceros:

| Ruta | Para qué | Quién lo lee |
|---|---|---|
| `docs/screenshots/` | Imágenes finales 1280×800 sobre slate `#1F2937` | README, landing y ficha de la Store |
| `docs/landing-brief.md` | Especificación completa de la página del portfolio | El agente que lleva antonioluisperez.com |
| `docs/release-notes/vX.Y.Z.md` | Qué cambia en la web en cada versión | El mismo agente |
| `docs/store-listing.md` | Propósito único, justificación de permisos, descripción y "Qué hay de nuevo" | Antonio, al subir a la Store |

Regenerar una imagen de `docs/screenshots/` = recortar el original de `capturas/`, escalarlo y centrarlo en un lienzo 1280×800 de color `#1F2937` (con PIL). Recortar siempre el borde del navegador: deja una línea oscura de 1px que canta sobre el fondo slate.

## Reglas que costaron caro — no repetir

- **Nada de sprites SVG externos.** Un `<use href="icons.svg#id">` hacía que el popup dejara de abrirse tras el primer uso, sin ningún error visible. El sprite va **incrustado** en `popup.html` y `panel.html`.
- **`popup.html` y `panel.html` son gemelos.** Comparten `popup.js` y `styles.css`: todo cambio de markup va en los dos.
- **Nunca `new Function()` ni `eval()`.** Motivó un rechazo de la Store. El generador de eventos usa esquemas declarativos, no código evaluado.
- **`chrome.permissions.request()` solo dentro de un gesto del usuario**; si no, cierra el popup.
- **`cookies` es permiso opcional**: nada de `chrome.cookies.*` en el nivel superior de `background.js` — el service worker peta con *status code 15*. Va detrás de `permissions.contains`.
- **El motor de captura funciona; no tocarlo** salvo petición explícita (`shotMeasure`, `shotScrollTo`, `shotPrepare`, `shotHideFixedNow`, `shotRestore`, `shotPrimeLazy`, `captureFullPage` en `ui/popup.js`). La escala se deriva de `img.width / innerWidth`, nunca de `devicePixelRatio`.
- **Ningún canvas del tamaño de la captura.** Superan el límite de textura de la GPU (16.384 px) y Chrome rasteriza por CPU: el editor se vuelve inusable. `ui/shot.js` pinta en una capa del tamaño de lo visible. Explicado en ARQUITECTURA.md.
- **Las capturas sueltas van a `capturas/`**, nunca a la raíz: un `git add -A` las publica.

## Cómo se añade contenido

- **Regla de auditoría de Consent** → un objeto más en `CONSENT_AUDIT_RULES` (`ui/popup.js`)
- **Evento de dataLayer** → un objeto más en `DL_EVENT_SCHEMAS` (`ui/popup.js`)

Ambos son declarativos: añadir uno no toca lógica.

## Publicar una versión

1. Subir `version` en `manifest.json` (feature nueva = versión media)
2. Comprobar: sintaxis de todos los JS, que los ficheros del manifest y los `src`/`href`/`getURL` resuelven, que no hay `new Function`/`eval`, y que no queda ninguna referencia a empresas, correos ni a Claude
3. Dos ZIPs en `dist/`:
   - `analytics-copilot-vX.Y.Z-store.zip` → solo runtime (`manifest.json` en la raíz, `background.js`, `ui/`, `content/`, `icons/`), es el de la Store
   - `analytics-copilot-vX.Y.Z.zip` → lo anterior + los `.md` y `LICENSE`, para la release de GitHub
4. **Escribir `docs/release-notes/vX.Y.Z.md` siempre**, sin que lo pidan, para el agente de la web
5. Actualizar `docs/store-listing.md` (descripción y "Qué hay de nuevo") y `docs/landing-brief.md` si cambia el número de herramientas
6. Commit, tag `vX.Y.Z`, push y `gh release create` con el ZIP completo adjunto

Antonio sube el ZIP a la Store a mano; eso no lo hace Claude.

## Convenciones

- Todo en **español**: UI, documentación y mensajes de commit
- **Sin rastro de empresas ni de Claude** en código, docs o commits — el repo es personal y público
- Los commits van a nombre de `alpc-data-analyst`
- **No empujar a GitHub sin que Antonio lo pida.** Trabajar en local y avisar de que está listo
- No inventar ni generar capturas de la extensión: si falta una vista, pedírsela
