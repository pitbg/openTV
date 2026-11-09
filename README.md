# openTV 📺

**La televisión española, en directo desde tu navegador.** Un proyecto personal y autoalojado, sin cuentas de usuario propias. Puede reproducir fuentes online o, de forma opcional, las señales TDT de tu propio sintonizador VBox.

![Node.js](https://img.shields.io/badge/Node.js-22-67b947) ![Docker](https://img.shields.io/badge/Docker-Compose-2496ed) ![HLS](https://img.shields.io/badge/Video-HLS-eab676)

## Qué incluye la v0.4.0

- Canales públicos nacionales (RTVE) y autonómicos (Telemadrid, Canal Sur, TV3, ETB, TVG, À Punt, Aragón TV y más) cuando figuran en el catálogo, además de una selección de cadenas privadas nacionales.
- **Antena 3:** busca una URL HLS vigente cuando pulsas reproducir, consultando la API pública utilizada por [Streamlink](https://github.com/streamlink/streamlink/blob/master/src/streamlink/plugins/atresplayer.py). Funciona si la API y el CDN permiten la reproducción desde tu ubicación. Los reproductores incrustados siguen como alternativas manuales.
- **Telecinco:** consulta bajo demanda el catálogo oficial de fuentes HLS de Mediaset (Caronte), utiliza únicamente las opciones que anuncia sin DRM ni políticas de seguridad y las intenta reproducir en el navegador. **Integración experimental:** aunque la API publique una URL HLS, el CDN puede requerir autorización, cookies o condiciones de acceso adicionales. Si no funciona, el botón de web oficial abre [telecinco.es/endirecto](https://www.telecinco.es/endirecto/). No se eluden esas restricciones.
- **VBox TV Gateway (opcional):** importa canales de la lista IPTV de tu sintonizador TDT local (incluido Telecinco), prioriza esa señal si existe y la reproduce con [mpegts.js](https://github.com/xqq/mpegts.js). El backend de openTV transmite el MPEG-TS desde el VBox al navegador usando el mismo origen HTTPS, sin generar tokens ni recodificar el vídeo.
- **La 1:** utiliza de forma preferente el reproductor incrustado oficial de RTVE; permite probar su enlace HLS como alternativa.
- Reproducción HLS nativa (Safari) o con [HLS.js](https://github.com/video-dev/hls.js/) (Chrome/Firefox/Edge), y MPEG-TS de un VBox con [mpegts.js](https://github.com/xqq/mpegts.js/).
- Búsqueda, filtros por ámbito o comunidad autónoma, favoritos y último canal visto (guardados en el propio navegador).
- Pantalla completa, cambio rápido entre canales y navegación con flechas izquierda/derecha.
- Enlace a la emisión oficial si no existe señal HLS compatible o el navegador bloquea la reproducción.
- Catálogo de [TDTChannels](https://www.tdtchannels.com/listas/) actualizado cada 6 horas, con caché en memoria y último resultado correcto si la fuente falla temporalmente.
- Interfaz adaptada a móvil y escritorio, API `/api/channels` + `/api/health` y resolución HLS bajo demanda con `/api/streams/antena-3` y `/api/streams/telecinco`.

**Importante:** algunos canales están geobloqueados, usan DRM, requieren permisos CORS especiales, exigen iniciar sesión en sus plataformas o cambian sus URLs. openTV **no** elude estas restricciones. La disponibilidad dentro del reproductor depende de cada emisora, incluso con los reproductores incrustados; en esos casos utiliza el enlace a su sitio web oficial. Las señales HLS de emisoras online se descargan directamente del emisor al navegador; **solo si activas VBox**, openTV hace de proxy MPEG-TS para la televisión local. No publiques este acceso a terceros sin comprobar las condiciones de distribución aplicables.

## Ver la TDT de tu VBox (Telecinco incluido) 📡

Si tienes un VBox TV Gateway conectado a la antena y a la misma red que el servidor Ubuntu, **no necesitas Tvheadend ni FFmpeg**. En el menú del VBox, dentro de «Streaming → IPTV», encontrarás sus listas de canales y la guía XMLTV. openTV entiende su lista `vboxSimpleIptv.m3u8` y reproduce los canales como MPEG-TS.

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

Los canales de la lista local se incorporan al catálogo y se priorizan automáticamente. El frontend marca **TDT LOCAL**. Si el VBox está apagado, siguen disponibles los canales online; el servicio conserva temporalmente el último listado y reintenta la conexión. La lista se refresca cada minuto.

**Compatibilidad:** MPEG-TS es un contenedor. La reproducción web depende de los códecs emitidos y del soporte MSE del navegador. Si un canal usa un códec de vídeo no admitido (por ejemplo, MPEG-2 Video), puede verse en VLC pero no en openTV; habría que añadir transcodificación para ese canal. Safari reciente, Chrome y Firefox modernos admiten las funcionalidades necesarias en plataformas compatibles.

**Seguridad:** los canales TDT pasan por openTV y consumen ancho de banda del VBox y de tu servidor. Mantén openTV detrás de una red privada, acceso autenticado o Tailscale. Evita exponer el puerto `3080` directamente a Internet. No abras el puerto `55555` del VBox al exterior.

La URL XMLTV del VBox (`http://192.168.1.15:55555/vboxXmltv.xml`) queda identificada para una siguiente mejora: incorporar «Ahora / Después» y la guía completa. La primera integración se centra en comprobar que el directo funciona.

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
3. El navegador reproduce el HLS o carga el reproductor oficial y prueba alternativas si una señal HLS falla. Si se ha configurado un VBox, el servidor transmite por HTTP su MPEG-TS original mediante `/api/vbox/stream/<canal>` para que `mpegts.js` lo reproduzca bajo el mismo dominio. No se accede a contenido con DRM, se simulan sesiones de usuario ni se evitan restricciones geográficas.
4. Tus favoritos se guardan en `localStorage`. No hay base de datos ni seguimiento de usuarios.

### Limitaciones y próximas mejoras

- **Para diagnosticar Antena 3:** abre `http://IP:3080/api/streams/antena-3` en tu servidor. Si muestra `streams`, la resolución ha funcionado y cualquier error posterior suele estar en el acceso del navegador al HLS (CORS, origen o caducidad). Si muestra `error`, la respuesta describe el paso bloqueado. **Las URLs devueltas pueden incluir credenciales efímeras: no las compartas públicamente.**
- **Para diagnosticar Telecinco:** abre `http://IP:3080/api/streams/telecinco`. Si devuelve `streams`, la API publica fuentes HLS, pero aún hay que comprobar su accesibilidad en el reproductor (el CDN podría exigir autorización adicional). Si devuelve `error`, no hay fuentes compatibles o no se pudo consultar la API.
- Añadir guía de programación EPG (ahora/siguiente) tomando como base el XMLTV ya publicado por el VBox.
- Mejorar el control con mando en Android TV y añadir PWA instalable.
- Monitorizar de forma no intrusiva las fuentes y permitir configurar emisoras locales adicionales.

La lista de enlaces y los logos pertenecen a sus respectivos titulares. Datos atribuidos a [TDTChannels](https://github.com/LaQuay/TDTChannels) y sujetos a sus [condiciones de uso](https://www.tdtchannels.com/aviso-legal/). openTV no está afiliado a RTVE, Atresmedia, Mediaset ni a los operadores regionales.
