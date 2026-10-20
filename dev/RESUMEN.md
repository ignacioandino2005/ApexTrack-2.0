# ApexTrack 2 — Resumen para continuar (versión 2.5.0, 20/10/2026)

Complementa el resumen de la 2.3.0. Leé esto antes de tocar el código.

## Repositorio
- `ignacioandino2005/apextrack-2.0`, rama `main`. La app está en la raíz (ya no hay carpeta `app/`). Las pruebas están en `dev/test` y se corren desde ahí (`npm install` en `dev/`).
- Versión: `APP_VERSION` en `js/store.js` y `VERSION` en `sw.js` (cambiar las dos en cada entrega).
- Configuración del desarrollador: `js/config.js` (`GOOGLE_CLIENT_ID`, `COMMUNITY_URL`), ya cargados. La app de Google tiene que estar "En producción" (con la política de privacidad `privacidad.html`).

## Novedades de la 2.4.0
1. **Copia en Drive sin Apps Script del usuario** (`js/backup.js`): "Conectar con Google" con Google Identity Services, permiso `drive.file` (solo los archivos de la app, carpeta "ApexTrack copias"). Un archivo por día (`ApexTrack_copia_AAAA-MM-DD.json`), se conservan 14 días + uno por mes. El permiso dura 1 h: si hace falta subir y venció, se renueva con el siguiente toque en un botón (máximo 2 veces por día). Nunca sube una app vacía; si hay mucho menos datos que la última copia, guarda `…_reducida.json` aparte. El método anterior (Apps Script propio) sigue funcionando para quien lo tenía.
2. **Protección extra de datos** (`store.safetySnapshot`): antes de restaurar, importar o borrar todo, se guarda "lo que había antes" en el archivo interno (últimas 5), visible en Recuperar datos. Fotos diarias: ahora 7.
3. **IA más rápida y confiable** (`js/ai.js`):
   - El prompt solo lleva las referencias del usuario que tienen que ver con el mensaje (`relevantLines`).
   - Consulta de respaldo (`hedgedRequest`): si el primer modelo no contesta en 11 s (7 s en Rápida, 25 s en Máxima), se pregunta lo mismo a otro modelo y gana el primero; el otro se cancela.
   - **IA propia primero**: si el análisis local entiende todo el mensaje (`localVerdict`: todos los alimentos conocidos, con cantidad, sin palabras sin explicar), se resuelve al instante sin Gemini, con el botón "Revisar con Gemini". Se apaga en Ajustes → IA.
   - La IA devuelve `said` (las palabras que nombran cada alimento), que alimenta el aprendizaje.
4. **Aprendizaje compartido** (`js/community.js` + `server/comunidad.gs`): al guardar una comida analizada por Gemini se mandan aportes anónimos (frase dicha + alimento, gramos y valores; y el mensaje con su resultado). El servidor (Apps Script + planilla del desarrollador) calcula medianas por alimento, medidas caseras y frases → "conocimiento" que cada teléfono descarga cada 2 días y usa la IA propia (`setCommunityFoods` en `foods.js`). Se desactiva en Ajustes → IA → "Ayudar a entrenarla".
5. **Dictado con comas** (`voice.js` → `joinPhrase`): cada pausa agrega una coma, salvo que lo siguiente empiece con "y", "con", "de", etc.
6. Arreglo: "una banana" con una banana anterior registrada en gramos daba 1 g en el cálculo sin IA.

## Novedades de la 2.5.0
1. **Recordatorios** (`js/reminders-core.js` lógica pura compartida con el service worker, `js/notify.js` pantalla y suscripción). Tipos: comida, agua, hábito, estudio, gimnasio, peso, resumen del día, resumen semanal y libre; hora, días y "solo si no lo hice". Con la app cerrada llegan por push: el teléfono manda al servidor los horarios de 14 días (los de hoy ya cumplidos no van); `enviarAvisos()` en `server/comunidad.gs` (cada 5 min) manda un push vacío firmado con VAPID (ECDSA P-256 hecho a mano con BigInt) y el service worker (`sw.js`, ahora módulo) decide qué mostrar leyendo el estado de IndexedDB. Botones en la notificación: "+1 vaso", "Hecho", "Registrar". Sin servidor: revisión cada minuto con la app abierta + periodicSync.
2. **Resumen semanal** (`js/weekly.js`): números de la semana, comparación con la anterior, puntaje, consejos propios (mejorar / cambiar) y, si hay clave, el análisis de la IA (`insights.js`, ahora con "Qué cambiar"). Se arma solo el día elegido (lunes) y pide la IA sola (1 consulta por semana). Aviso en Hoy, botón en Progreso y en Ajustes.
3. **Pestañas personalizables nuevas**: Actividad (gasto, pasos, reloj, actividades) y Agua (`js/tabs.js`). Flechita sobre la pestaña para abrir cualquiera sin cambiar la principal. "Pestaña personalizable" es la primera opción de Personalizar.
4. **Reloj inteligente**: no hay forma de leer Samsung Health / Mi Fitness / Health Connect desde una web (Google Fit cerró su API). Solución: compartir una captura a ApexTrack (Web Share Target en el manifiesto, `/compartir` lo atiende el service worker) o "Cargar captura" en Actividad; la IA lee pasos, km y calorías activas (`from_device`) y reemplaza la captura anterior del mismo día. También "Pasos de hoy" a mano.
5. **"Widgets"**: Android no permite widgets de apps web. En su lugar: 4 accesos directos al mantener apretado el ícono (Dictar, Registrar, +1 vaso, Semana) y el recordatorio "Resumen del día" como notificación con botones.

## Pruebas (todas pasan salvo el caso Big Mac sin IA, que es esperable)
`foods.test`, `offline.test`, `offline_extra`, `ai_pipeline.test`, `client.test` (incluye la consulta de respaldo), `local_first.test`, `server.test`, `backup.test`, `reminders.test`, `vapid.test`, `features.mjs` (22 controles, service worker real), `persist.mjs` (Drive y comunidad simulados, 22 controles), `e2e.mjs` (60 controles; el paso de la planilla V1 se omite si falta `ref/consolidado.xlsx`).

## Ideas pendientes
- En el servidor: pegar el nuevo `comunidad.gs`, correr `instalarAvisos()` y publicar versión nueva.
- Con datos de la hoja "mensajes": entrenar un modelo chico propio (o reglas) para fechas, momentos y cantidades.
- Ver el resto en la respuesta del chat del 20/10 (sugerencias de mejoras).
