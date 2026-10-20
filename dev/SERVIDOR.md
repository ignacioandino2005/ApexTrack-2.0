# ApexTrack — configuración que hace el desarrollador (una sola vez)

Las personas que usan la app no tienen que crear nada: solo tocan **Conectar con Google** y aceptan.
Para que eso funcione, el desarrollador tiene que cargar una vez dos valores en `js/config.js`.

## 1. ID de cliente de Google (copia automática en Drive)

La app pide el permiso `drive.file`: solo puede ver y crear sus propios archivos, dentro de la carpeta
"ApexTrack copias". No ve el resto del Drive de nadie. Google lo considera un permiso "no sensible",
así que no hace falta que Google revise la app.

1. Entrá a <https://console.cloud.google.com/> con tu cuenta y creá un proyecto (por ejemplo "ApexTrack").
2. **APIs y servicios → Biblioteca** → buscá **Google Drive API** → **Habilitar**.
3. **APIs y servicios → Pantalla de consentimiento de OAuth** (o "Google Auth Platform"):
   - Tipo de usuario: **Externo**.
   - Nombre de la app: ApexTrack · correo de asistencia: el tuyo · dominio autorizado: `github.io`.
   - Permisos (scopes): agregá `.../auth/drive.file` y `email`.
   - **Publicá la app** ("Publicar aplicación" → En producción). Si queda en "Prueba", solo pueden
     entrar las cuentas que agregues como usuarios de prueba (máximo 100).
4. **APIs y servicios → Credenciales → Crear credenciales → ID de cliente de OAuth**:
   - Tipo: **Aplicación web**.
   - Orígenes de JavaScript autorizados: `https://ignacioandino2005.github.io`
   - (No hacen falta URI de redireccionamiento.)
5. Copiá el **ID de cliente** (termina en `.apps.googleusercontent.com`) y pegalo en `js/config.js`,
   en `GOOGLE_CLIENT_ID`. Ese ID es público: no es una clave secreta.

Cómo funciona en el teléfono:
- Se guarda un archivo por día (`ApexTrack_copia_AAAA-MM-DD.json`). Se conservan los de las últimas
  2 semanas y uno por mes (para siempre).
- Nunca se sube una app vacía. Si la app tiene mucho menos datos que la última copia, se guarda aparte
  (`…_reducida.json`) y no pisa la buena.
- El permiso de Google dura 1 hora. Cuando hace falta subir y venció, la app lo renueva con el siguiente
  toque en un botón (Google abre su ventanita y se cierra sola), como mucho dos veces por día.
- Si se borran los datos del navegador, al entrar con la misma cuenta se ven todas las copias.

## 2. Servicio de aprendizaje compartido (IA propia)

Junta los aportes anónimos de todas las personas (qué dijeron y qué entendió Gemini) y arma el
"conocimiento" que cada teléfono descarga para que la IA propia (sin conexión) entienda cada vez más.

1. Creá una planilla nueva en Google Sheets (por ejemplo "ApexTrack comunidad").
2. **Extensiones → Apps Script**. Borrá lo que aparece y pegá todo el contenido de `server/comunidad.gs`.
3. Guardá. Arriba elegí la función **instalar** y tocá **Ejecutar** (autorizá los permisos). Crea las hojas
   "aportes" y "mensajes" y un disparador que rearma el conocimiento cada noche.
4. **Implementar → Nueva implementación** → tipo **Aplicación web**:
   - Ejecutar como: **Yo**.
   - Quién tiene acceso: **Cualquier usuario**.
5. Copiá la URL que termina en `/exec` y pegala en `js/config.js`, en `COMMUNITY_URL`.

Para revisar: abrí `URL?op=estado` (cantidad de aportes) o `URL?op=conocimiento` (lo que descargan
los teléfonos). En `server/comunidad.gs`, `MIN_PERSONAS` define cuántas personas distintas tienen que
coincidir para publicar un alimento: con pocos usuarios va en 1; cuando haya más, conviene subirlo a 2 o 3.

Qué se guarda y qué no:
- Sí: lo que se dijo de cada alimento ("dos milanesas de pollo al horno"), lo que entendió la IA
  (alimento, cantidad, gramos, valores por 100 g), si la persona lo corrigió, el modelo usado y el
  mensaje completo con su resultado (para entrenar más adelante un modelo propio).
- No: nombre, correo, peso, metas, clave de la IA ni ningún otro dato de la persona. Cada teléfono se
  identifica con un número al azar, solo para contar cuántas personas confirman un dato.
- Cada persona lo puede desactivar en Ajustes → Inteligencia artificial → "Ayudar a entrenarla".

## 3. Pruebas

Desde `dev/`: `npm install` una vez y después, dentro de `dev/test/`:

```
node foods.test.mjs
node offline.test.mjs
node ai_pipeline.test.mjs
node client.test.mjs        # modelos, límites, errores y consulta de respaldo
node local_first.test.mjs   # qué resuelve la IA propia sola
node server.test.mjs        # servicio de la comunidad (simulado) de punta a punta
node persist.mjs            # pérdida y recuperación de datos, Drive y comunidad (Chromium)
node e2e.mjs                # todos los botones y menús (Chromium)
```
