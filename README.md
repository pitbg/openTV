# openTV 📺

**La televisión española, en directo desde tu navegador.** Un proyecto personal y autoalojado, sin cuentas de usuario propias. Puede reproducir fuentes online o, de forma opcional, las señales TDT de tu propio sintonizador VBox.

![Node.js](https://img.shields.io/badge/Node.js-22-67b947) ![Docker](https://img.shields.io/badge/Docker-Compose-2496ed) ![HLS](https://img.shields.io/badge/Video-HLS-eab676)

## Qué incluye la v0.4.0

- Canales públicos nacionales (RTVE) y autonómicos (Telemadrid, Canal Sur, TV3, ETB, TVG, À Punt, Aragón TV y más) cuando figuran en el catálogo, además de una selección de cadenas privadas nacionales.
- **Antena 3:** busca una URL HLS vigente cuando pulsas reproducir, consultando la API pública utilizada por [Streamlink](https://github.com/streamlink/streamlink/blob/master/src/streamlink/plugins/atresplayer.py). Funciona si la API y el CDN permiten la reproducción desde tu ubicación. Los reproductores incrustados siguen como alternativas manuales.
- **Telecinco:** consulta bajo demanda el catálogo oficial de fuentes HLS de Mediaset (Caronte), utiliza únicamente las opciones que anuncia sin DRM ni políticas de seguridad y las intenta reproducir en el navegador. **Integración experimental:** aunque la API publique una URL HLS, el CDN puede requerir autorización, cookies o condiciones de acceso adicionales. Si no funciona, el botón de web oficial abre [telecinco.es/endirecto](https://www.telecinco.es/endirecto/). No se eluden esas restricciones.
- **VBox TV Gateway (opcional):** importa canales de la lista IPTV de tu sintonizador TDT local (incluido Telecinco), ofrece esa señal como respaldo de la opción online y la reproduce con [mpegts.js](https://github.com/xqq/mpegts.js). El backend transmite la señal MPEG-TS bajo el mismo origen HTTPS; **copia el vídeo original sin recodificarlo** y convierte el audio DVB MP2 a AAC para los navegadores que no lo admiten. FFmpeg está incluido en la imagen Docker, no hay que instalarlo en el host.
- **La 1:** intenta primero las fuentes HLS, recurre al reproductor incrustado oficial de RTVE si fallan y permite escoger la TDT local del VBox como tercera opción. Si el iframe oficial falla, el cambio a TDT es manual porque el navegador no permite detectar sus errores internos.
- Reproducción HLS nativa (Safari) o con [HLS.js](https://github.com/video-dev/hls.js/) (Chrome/Firefox/Edge), y MPEG-TS de un VBox con [mpegts.js](https://github.com/xqq/mpegts.js/).
- Interfaz compacta sin paneles laterales: tarjetas con logotipos oficiales y nombre, búsqueda, filtros Nacionales/Autonómicos/Favoritos y último canal visto (guardados en el propio navegador). Las siglas solo aparecen cuando no se puede cargar ningún logo.
- Pantalla completa, cambio rápido entre canales y navegación con flechas izquierda/derecha.
- Enlace a la emisión oficial si no existe señal HLS compatible o el navegador bloquea la reproducción.
- Catálogo de [TDTChannels](https://www.tdtchannels.com/listas/) actualizado cada 6 horas, con caché en memoria y último resultado correcto si la fuente falla temporalmente.
- Interfaz adaptada a móvil y escritorio, API `/api/channels` + `/api/health`, resolución HLS bajo demanda con `/api/streams/antena-3` y `/api/streams/telecinco`, y resolución del reproductor oficial de La Séptima con `/api/embeds/la-septima`.

**Importante:** algunos canales están geobloqueados, usan DRM, requieren permisos CORS especiales, exigen iniciar sesión en sus plataformas o cambian sus URLs. openTV **no** elude estas restricciones. La disponibilidad dentro del reproductor depende de cada emisora, incluso con los reproductores incrustados; en esos casos utiliza el enlace a su sitio web oficial. Las señales HLS de emisoras online se descargan directamente del emisor al navegador; **solo si activas VBox**, openTV hace de proxy MPEG-TS para la televisión local. No publiques este acceso a terceros sin comprobar las condiciones de distribución aplicables.

## Ver la TDT de tu VBox (Telecinco incluido) 📡

Si tienes un VBox TV Gateway conectado a la antena y a la misma red que el servidor Ubuntu, **no necesitas Tvheadend ni instalar FFmpeg en Ubuntu**: la imagen Docker ya incluye FFmpeg para adaptar el audio a AAC. En el menú del VBox, dentro de «Streaming → IPTV», encontrarás sus listas de canales y la guía XMLTV. openTV entiende su lista `vboxSimpleIptv.m3u8` y reproduce los canales como MPEG-TS.

1. Comprueba **desde el servidor**, no solo desde tu Mac, que puede leer la lista:

   ```bash
   curl -fSs --max-time 8 http://192.168.1.15:55555/vboxSimpleIptv.m3u8 | head -n 12
   ```

2. Añade al `.env` junto al `compose.yml`:

   ```env
   OPENTV_VBOX_PLAYLIST_URL=http://192.168.1.15:55555/vboxSimpleIptv.m3u8
   ```

3. Aplica la nueva configuración:

   ```bash
   docker compose up -d --build
   curl -s http://127.0.0.1:3080/api/health
   ```

   La respuesta debe mostrar `"vbox": { "enabled": true, "connected": true, ... }`. Si aparece `connected: false`, comprueba IP, puerto, alcance de la red Docker y que el VBox esté encendido.

### Probar la rama sin parar tu openTV actual

Mientras la integración se valida con el hardware real, puedes ejecutar una segunda instancia aislada:

```bash
git clone --branch feat/vbox-local-tdt https://github.com/pitbg/openTV.git opentv-vbox-test
cd opentv-vbox-test
```

Crea un `.env` en **esa carpeta** con:

```env
OPENTV_BIND=0.0.0.0
OPENTV_PORT=3081
OPENTV_CONTAINER_NAME=opentv-vbox-test
OPENTV_VBOX_PLAYLIST_URL=http://192.168.1.15:55555/vboxSimpleIptv.m3u8
```

Y levántalo de manera independiente:

```bash
docker compose -p opentv-vbox-test up -d --build
curl -s http://127.0.0.1:3081/api/health
```

Abre `http://IP_DEL_PITSERVER:3081` desde tu red local. Esta instancia no sustituye al servicio actual. Evita publicar el puerto de pruebas en Internet. Cuando termines, puedes pararla desde esa misma carpeta con `docker compose -p opentv-vbox-test down`.

Los canales del VBox se incorporan al catálogo, **pero se prioriza la señal online** (HLS o reproductor oficial) siempre que exista. Cuando un canal dispone de ambas fuentes aparece un selector **Online / TDT local** bajo el reproductor: puedes cambiar de fuente manualmente en cualquier momento. Si fallan las fuentes HLS online (incluida la obtención de HLS dinámico), openTV cambia automáticamente a **TDT local** y muestra que se ha activado el respaldo. Los canales que solo existen en el VBox siguen usando TDT directamente. Algunos reproductores oficiales se cargan en un iframe y no permiten detectar desde openTV si están funcionando: en esos casos puedes seleccionar TDT manualmente. Si el VBox está apagado, siguen disponibles los canales online; el servicio conserva temporalmente el último listado y reintenta la conexión. La lista se refresca cada minuto.

**Compatibilidad:** MPEG-TS es un contenedor. La reproducción web depende de los códecs emitidos y del soporte MSE del navegador. Si un canal usa un códec de vídeo no admitido (por ejemplo, MPEG-2 Video), puede verse en VLC pero no en openTV; habría que añadir transcodificación para ese canal. Safari reciente, Chrome y Firefox modernos admiten las funcionalidades necesarias en plataformas compatibles.

**Audio de la TDT:** Telecinco HD puede emitir H.264 Main con audio MP2. Este último no funciona de forma generalizada con MP4/MSE, por lo que openTV convierte **solo el audio** a AAC (128 kb/s), copiando el vídeo sin pérdida de calidad ni recodificación. Cada espectador que ve una señal local activa un proceso FFmpeg mientras la reproduce; al cerrar el vídeo se termina ese proceso. Si un canal ya utiliza audio compatible y quieres evitar la conversión, puedes definir `OPENTV_VBOX_TRANSCODE_AUDIO=false` en el `.env` (el valor predeterminado es `true`) y reconstruir la instancia. Esto devuelve el MPEG-TS original sin modificar.

**Compatibilidad especial para Firefox en macOS:** en algunos flujos H.264 el decodificador AppleVTDecoder de Firefox puede fallar aunque Safari los reproduzca (error `ffffdcf7`; véase [Mozilla 1709081](https://bugzilla.mozilla.org/show_bug.cgi?id=1709081)). Si Firefox informa `MediaMSEError` con la señal local original, openTV **reintenta una vez** con `/api/vbox/stream/<canal>?video=progressive`: FFmpeg reconstruye el vídeo como H.264 Baseline progresivo a 720p y mantiene AAC. Esta alternativa utiliza más recursos y puede introducir latencia; Safari y los navegadores que admitan la señal original no la utilizan. Probado en el VBox real con Firefox y Safari.

### Aceleración Intel Quick Sync (VA-API, opcional)

En Linux, algunas GPU Intel pueden codificar H.264 sin sobrecargar tanto la CPU. Por ejemplo, la **Intel UHD Graphics 630 (Coffee Lake)** expone H.264 mediante `VAEntrypointEncSliceLP`, el modo de bajo consumo: FFmpeg debe usar `h264_vaapi -low_power 1`. openTV mantiene por defecto `libx264`, que ya funciona; **solo el vídeo de compatibilidad (`?video=progressive`)** usa GPU cuando activas el overlay. Los canales que Safari reproduce directamente siguen copiando el vídeo original.

1. Comprueba desde el host que funciona `vainfo --display drm --device /dev/dri/renderD128` (la GPU debe ofrecer `VAProfileH264ConstrainedBaseline: VAEntrypointEncSliceLP`). Si indica permisos insuficientes, tu usuario debe pertenecer al grupo `render`: `sudo usermod -aG render "$USER"` y nueva sesión SSH. Para el contenedor se pasa además el GID numérico de ese dispositivo.
2. Desde la carpeta de openTV, configura el GID y levanta **la instancia de pruebas** con el overlay GPU:

   ```bash
   export OPENTV_RENDER_GID="$(stat -c '%g' /dev/dri/renderD128)"
   docker compose -p opentv-vbox-test -f compose.yml -f compose.gpu.yml up -d --build --force-recreate
   ```

3. Abre Telecinco HD en Firefox. Si el H.264 original falla, se solicita la señal progresiva y FFmpeg intenta `h264_vaapi`. Si el controlador o la GPU fallan **antes de empezar a enviar vídeo**, openTV registra el error, vuelve a conectar con el VBox y utiliza `libx264` automáticamente. Un fallo después de comenzar la emisión todavía puede interrumpir esa sesión. Para comprobarlo:

   ```bash
   docker compose -p opentv-vbox-test -f compose.yml -f compose.gpu.yml logs -f opentv
   ```

   También puedes comprobar el codificador real en la cabecera de la petición `?video=progressive` (DevTools → Red → respuesta → `X-OpenTV-Video-Encoder`): `vaapi` significa que la GPU está codificando; `cpu` indica que se ha utilizado el respaldo por software.

La imagen Docker incluye `intel-media-driver` (`iHD`) y `libva-intel-driver` (`i965`) en x86_64; el overlay expone exclusivamente `/dev/dri/renderD128` y añade el GID `render` al usuario no privilegiado del contenedor. No expone la GPU en el despliegue normal. Si tienes otro dispositivo DRM, ajusta `compose.gpu.yml` y `OPENTV_VBOX_VAAPI_DEVICE`.

#### Modo experimental: procesar todo el vídeo en la GPU

Telecinco HD emite **H.264 Main 1920×1080 entrelazado (`field_order=tt`), a 25 fps**. El modo VA-API anterior solo codifica por GPU, mientras FFmpeg todavía decodifica, aplica `yadif` y escala con la CPU. El controlador Intel `i965` de la UHD 630 anuncia `VAEntrypointVideoProc` y permite probar un pipeline completo en hardware: decodificación H.264 → `deinterlace_vaapi` → `scale_vaapi` → `h264_vaapi`. Utilizamos desentrelazado bob a frecuencia de fotograma y 720p proporcional (en canales 4:3 el ancho puede ser menor que 1280).

Mantén activa la instancia GPU, exporta el GID si has iniciado una sesión nueva, y añade el tercer archivo de Compose:

```bash
export OPENTV_RENDER_GID="$(stat -c '%g' /dev/dri/renderD128)"
docker compose -p opentv-vbox-test \
  -f compose.yml -f compose.gpu.yml -f compose.gpu-full.yml \
  up -d --build --force-recreate
```

La petición `?video=progressive` devuelve `X-OpenTV-Video-Encoder: vaapi-full` si **toda la cadena de vídeo** ha empezado a funcionar en la GPU. Si este modo no consigue arrancar, reintenta con el anterior (`vaapi`, solo codificación) y después con `cpu`. Los fallos después de empezar a enviar vídeo pueden interrumpir la sesión. **Probado por Pedro con el VBox y la Intel UHD 630 reales:** Firefox reproduce correctamente y el uso de CPU baja mucho al trasladar el trabajo a la GPU. El motor Video de `intel_gpu_top` puede diferir del porcentaje global de GPU.

Para regresar al modo Intel anterior, **sin** la cadena completa de GPU:

```bash
export OPENTV_RENDER_GID="$(stat -c '%g' /dev/dri/renderD128)"
docker compose -p opentv-vbox-test -f compose.yml -f compose.gpu.yml up -d --force-recreate
```

**Para volver a usar únicamente CPU**, quita el overlay al recrear el contenedor de pruebas:

```bash
docker compose -p opentv-vbox-test -f compose.yml up -d --force-recreate
```

No apliques el overlay al contenedor de producción hasta verificar la reproducción con el hardware real. Recodificar por GPU puede cambiar ligeramente la calidad y el bitrate respecto a `libx264`.

**Seguridad:** los canales TDT pasan por openTV y consumen ancho de banda del VBox y de tu servidor. Mantén openTV detrás de una red privada, acceso autenticado o Tailscale. Evita exponer el puerto `3080` directamente a Internet. No abras el puerto `55555` del VBox al exterior.

### Clasificación de canales y guía de programación (EPG)

El catálogo ya no separa todas las señales del VBox en un bloque «TDT local». **laSexta, Cuatro, FDF, Neox, Nova, Be Mad y otras cadenas nacionales** conservan su ámbito «Nacional» aunque únicamente se reciban desde el sintonizador; los canales de ámbito local aparecen en su región cuando se conoce. Las emisoras presentes en ambas fuentes se muestran una sola vez, con selector Online / TDT. Los canales que carecen de logotipo disponen de alternativas HTTPS; se descartan las URLs obsoletas del antiguo repositorio `maincenter/Logotipos-TV`.

La vista **«Guía TV»** muestra una parrilla horizontal al estilo de la guía tradicional: canales en una columna fija, horas en la cabecera, bloques que ocupan exactamente la duración de cada emisión y una línea vertical «AHORA». Se pueden explorar **seis horas** en la línea temporal, desplazarse horizontalmente y avanzar/retroceder una hora mediante botones. En esa vista, el **mismo reproductor** se reduce y permanece visible a un lado sin recrear el vídeo; al pulsar cualquier programa se sintoniza el canal y se vuelve automáticamente a la vista «Ver televisión» con el reproductor grande. La vista «Ver televisión» mantiene las tarjetas compactas y muestra bajo cada nombre únicamente el programa en emisión, con deslizamiento horizontal suave cuando el título no cabe; la programación completa «Ahora / Después» sigue bajo el reproductor y en la guía.

- **VBox:** `http://192.168.1.15:55555/vboxXmltv.xml` (derivado automáticamente de la URL IPTV configurada). Su EPG tiene prioridad para los canales que sintoniza; se consulta como máximo cada 15 minutos.
- **TDTChannels:** guía XMLTV oficial comprimida en [`TV.xml.gz`](https://www.tdtchannels.com/epg/TV.xml.gz), para completar los canales online y las ausencias del VBox. Se descarga como máximo cada hora. Puedes desactivarla con `OPENTV_EPG_TDT_ENABLED=false`.
- **EPGSHARE01:** guía pública española [`ES1.xml.gz`](https://epgshare01.online/epgshare01/epg_ripper_ES1.xml.gz), como tercer respaldo para cadenas ausentes de TDTChannels, especialmente Atresmedia (atreseries, laSexta, Neox, Nova, MEGA, etc.) y otras autonómicas. Se consulta como máximo cada seis horas, sin retransmitir vídeo. Se desactiva con `OPENTV_EPG_SHARE_ENABLED=false`.
- **Atresmedia:** parrilla española oficial de [Atreseries](https://atreseries.atresmedia.com/programacion/), con horarios de Atreseries y las otras cadenas del grupo. Se usa únicamente cuando VBox, TDTChannels y EPGSHARE01 no tienen programación actual; se consulta como máximo cada tres horas. Se desactiva con `OPENTV_EPG_ATRESMEDIA_ENABLED=false`. La parrilla internacional (`atresseries.com`) es distinta y no se utiliza.
- **La Séptima:** nuevo canal nacional que sustituyó a Atreseries en la frecuencia TDT en noviembre de 2026. Se identifica por separado como `la-septima`, usa el logo actual publicado por TDTChannels y la guía `LaSeptima.TV`. **Online por defecto** con el reproductor oficial de YouTube: `/api/embeds/la-septima` consulta el vídeo incrustado en la web oficial y actualiza su ID al cambiar el directo (caché de cinco minutos). El VBox sigue disponible mediante el selector **Online / TDT**, aunque no es posible detectar automáticamente todos los errores internos del iframe de YouTube. Se ignora un `tvg-id` antiguo de Atreseries si el VBox aún lo conserva tras el cambio de frecuencia.
- **API:** `GET /api/epg` devuelve el programa actual y hasta 24 emisiones siguientes (cuando existen), junto al estado de las fuentes. Conserva la última guía correcta si una descarga falla. El navegador consulta el estado cada dos minutos y muestra un indicador sencillo de disponibilidad, sin contadores.

La prioridad es **VBox → TDTChannels → EPGSHARE01** por canal; las dos últimas fuentes solo rellenan ausencias. Para usar únicamente la programación local desactiva **ambas** fuentes externas. Algunas emisoras sin guía publicada (por ejemplo HIT TV o servicios eventuales de noticias) pueden continuar sin EPG; openTV no inventa horarios ni programas. Puedes comprobar el contenido del VBox con `curl -fsS --max-time 8 'http://192.168.1.15:55555/vboxXmltv.xml' | head -c 500`.

## Instalar en tu servidor con Docker

Requisitos: Docker Engine y Docker Compose v2+.

```bash
git clone https://github.com/pitbg/openTV.git
cd openTV
docker compose up -d --build
```

Abre `http://IP_DEL_SERVIDOR:3080` **solo si has cambiado** `OPENTV_BIND` para permitir acceso desde la red. Por defecto el servicio escucha únicamente en `127.0.0.1:3080` del host: un valor seguro para usarlo detrás de Nginx Proxy Manager.

Para acceder desde la LAN sin proxy, crea un `.env` junto al `compose.yml`:

```env
OPENTV_BIND=0.0.0.0
OPENTV_PORT=3080
```

Vuelve a ejecutar `docker compose up -d`. No expongas un servicio sin autenticación directamente a Internet.

### Nginx Proxy Manager

Puedes configurar un *Proxy Host* que apunte a la IP privada del servidor y al puerto `3080`, manteniendo `OPENTV_BIND=0.0.0.0` y limitando el acceso con firewall/VPN o con una lista de acceso de NPM. Activa HTTPS y Websockets (aunque openTV no los requiere).

Si NPM y openTV comparten una red de Docker, puedes evitar publicar el puerto a toda la LAN y configurar NPM contra `opentv:3080`. Adapta las redes de Compose a las de tu instalación; no es obligatorio para funcionar.

### Variables de Compose

| Variable | Valor inicial | Descripción |
| --- | --- | --- |
| `OPENTV_BIND` | `127.0.0.1` | Interfaz de red del host donde se publica el puerto |
| `OPENTV_PORT` | `3080` | Puerto externo del servicio |
| `OPENTV_CONTAINER_NAME` | `opentv` | Nombre del contenedor; permite probar otra instancia sin colisiones |
| `OPENTV_CATALOG_TTL_MS` | `21600000` | Tiempo de actualización del catálogo, en milisegundos (configurable en `compose.yml`) |
| `OPENTV_VBOX_PLAYLIST_URL` | vacío | Lista IPTV del VBox; si está vacía, la integración TDT está desactivada |
| `OPENTV_EPG_TDT_ENABLED` | `true` | Utiliza TDTChannels como complemento para la programación; `false` desactiva solo esta fuente |
| `OPENTV_EPG_SHARE_ENABLED` | `true` | Añade la guía española EPGSHARE01 como tercer respaldo; `false` impide descargarla |
| `OPENTV_EPG_ATRESMEDIA_ENABLED` | `true` | Usa la programación española oficial de Atresmedia como último respaldo; `false` la desactiva |
| `OPENTV_VBOX_TRANSCODE_AUDIO` | `true` | Convierte audio de VBox a AAC usando FFmpeg; `false` retransmite el MPEG-TS original |
| `OPENTV_VBOX_VIDEO_ENCODER` | `cpu` | `cpu` utiliza libx264; `vaapi` prefiere codificación Intel por hardware para el vídeo progresivo |
| `OPENTV_VBOX_VAAPI_DEVICE` | `/dev/dri/renderD128` | Dispositivo DRM para FFmpeg, debe estar expuesto al contenedor |
| `OPENTV_VBOX_VAAPI_PIPELINE` | `encode` | `encode` deja los filtros en CPU; `full` usa `i965` para decodificar, desentrelazar, escalar y codificar por GPU (experimental) |

Para pruebas locales se puede indicar `OPENTV_CATALOG_URL` con un catálogo JSON compatible. No es necesario definirla en producción.

Para comprobar el estado:

```bash
curl http://127.0.0.1:3080/api/health
docker compose logs -f opentv
```

## Desarrollo local

Requiere Node.js 22 o superior.

```bash
npm ci
npm run dev
# http://localhost:3080
npm test
```

## Cómo funciona

1. El backend consulta el JSON publicado por TDTChannels y escoge los canales incluidos en `lib/catalog.mjs`. Las excepciones editoriales (como Antena 3, que no figura en ese JSON) tienen su ficha y URL oficial incorporadas explícitamente.
2. La API devuelve nombre, comunidad, logo, web oficial, reproductor incrustado oficial si existe y varias URLs HLS cuando están publicadas. Para Antena 3, `/api/streams/antena-3` consulta la API oficial; para Telecinco, `/api/streams/telecinco` consulta las fuentes de Caronte. Las URLs pueden caducar o no autorizar su reproducción externa.
3. El navegador prefiere HLS o el reproductor oficial. Si se ha configurado un VBox, el servidor transmite por HTTP su señal MPEG-TS mediante `/api/vbox/stream/<canal>` para que `mpegts.js` la reproduzca bajo el mismo dominio; con la configuración habitual FFmpeg conserva el vídeo H.264 y convierte el audio a AAC. Una fuente local disponible también se ofrece como selección manual y como respaldo ante errores de HLS. No se accede a contenido con DRM, se simulan sesiones de usuario ni se evitan restricciones geográficas.
4. La EPG enlaza los nombres e identificadores XMLTV con los canales, prefiriendo la señal de la guía del VBox cuando dispone de programación y completando huecos desde TDTChannels. La guía es informativa y no afecta a la fuente de vídeo seleccionada.
5. Tus favoritos se guardan en `localStorage`. No hay base de datos ni seguimiento de usuarios.

### Limitaciones y próximas mejoras

- **Para diagnosticar Antena 3:** abre `http://IP:3080/api/streams/antena-3` en tu servidor. Si muestra `streams`, la resolución ha funcionado y cualquier error posterior suele estar en el acceso del navegador al HLS (CORS, origen o caducidad). Si muestra `error`, la respuesta describe el paso bloqueado. **Las URLs devueltas pueden incluir credenciales efímeras: no las compartas públicamente.**
- **Para diagnosticar Telecinco:** abre `http://IP:3080/api/streams/telecinco`. Si devuelve `streams`, la API publica fuentes HLS, pero aún hay que comprobar su accesibilidad en el reproductor (el CDN podría exigir autorización adicional). Si devuelve `error`, no hay fuentes compatibles o no se pudo consultar la API.
- **Para diagnosticar La Séptima:** abre `http://IP:3080/api/embeds/la-septima`. La API devuelve un `embedUrl` de YouTube obtenido de la web oficial, no un enlace HLS. Si YouTube bloquea el iframe, elige **TDT local** manualmente en la interfaz.
- Ampliar la guía a una línea temporal navegable de varios días y mejorar los emparejamientos de canales con EPG ausente.
- Mejorar el control con mando en Android TV y añadir PWA instalable.
- Monitorizar de forma no intrusiva las fuentes y permitir configurar emisoras locales adicionales.

La lista de enlaces y los logos pertenecen a sus respectivos titulares. Datos atribuidos a [TDTChannels](https://github.com/LaQuay/TDTChannels) y sujetos a sus [condiciones de uso](https://www.tdtchannels.com/aviso-legal/). openTV no está afiliado a RTVE, Atresmedia, Mediaset ni a los operadores regionales.
