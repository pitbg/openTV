# openTV 📺

**La televisión española, en directo desde tu navegador.** Un proyecto personal y autoalojado, sin cuentas de usuario propias ni retransmisiones de vídeo en el servidor.

![Node.js](https://img.shields.io/badge/Node.js-22-67b947) ![Docker](https://img.shields.io/badge/Docker-Compose-2496ed) ![HLS](https://img.shields.io/badge/Video-HLS-eab676)

## Qué incluye la v0.2.1

- Canales públicos nacionales (RTVE) y autonómicos (Telemadrid, Canal Sur, TV3, ETB, TVG, À Punt, Aragón TV y más) cuando figuran en el catálogo, además de una selección de cadenas privadas nacionales.
- **Antena 3:** dos variantes del reproductor oficial incrustado de Atresplayer, seleccionables desde el propio vídeo, y enlace al directo en su web. La plataforma puede mostrar «Actualmente sin emisión» o exigir una cuenta/plan según sus condiciones: openTV no puede garantizar su reproducción. **Telecinco:** acceso a la emisión de Mediaset Infinity, que no ofrece un HLS público en el catálogo utilizado.
- **La 1:** utiliza de forma preferente el reproductor incrustado oficial de RTVE; permite probar su enlace HLS como alternativa.
- Reproducción HLS nativa (Safari) o con [HLS.js](https://github.com/video-dev/hls.js/) (Chrome/Firefox/Edge).
- Búsqueda, filtros por ámbito o comunidad autónoma, favoritos y último canal visto (guardados en el propio navegador).
- Pantalla completa, cambio rápido entre canales y navegación con flechas izquierda/derecha.
- Enlace a la emisión oficial si no existe señal HLS compatible o el navegador bloquea la reproducción.
- Catálogo de [TDTChannels](https://www.tdtchannels.com/listas/) actualizado cada 6 horas, con caché en memoria y último resultado correcto si la fuente falla temporalmente.
- Interfaz adaptada a móvil y escritorio, y API `/api/channels` + `/api/health`.

**Importante:** algunos canales están geobloqueados, usan DRM, requieren permisos CORS especiales, exigen iniciar sesión en sus plataformas o cambian sus URLs. openTV **no** elude estas restricciones. La disponibilidad dentro del reproductor depende de cada emisora, incluso con los reproductores incrustados; en esos casos utiliza el enlace a su sitio web oficial. Las emisiones se descargan directamente del emisor al navegador: el contenedor no actúa como proxy de vídeo.

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
| `OPENTV_CATALOG_TTL_MS` | `21600000` | Tiempo de actualización del catálogo, en milisegundos (configurable en `compose.yml`) |

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
2. La API devuelve nombre, comunidad, logo, web oficial, reproductor incrustado oficial si existe y varias URLs HLS cuando están publicadas.
3. El navegador reproduce el HLS o carga el reproductor oficial y prueba alternativas si una señal HLS falla; no se almacenan ni redistribuyen los segmentos de vídeo.
4. Tus favoritos se guardan en `localStorage`. No hay base de datos ni seguimiento de usuarios.

### Limitaciones y próximas mejoras

- Añadir guía de programación EPG (ahora/siguiente) cuando se valide su formato y sincronización.
- Mejorar el control con mando en Android TV y añadir PWA instalable.
- Monitorizar de forma no intrusiva las fuentes y permitir configurar emisoras locales adicionales.

La lista de enlaces y los logos pertenecen a sus respectivos titulares. Datos atribuidos a [TDTChannels](https://github.com/LaQuay/TDTChannels) y sujetos a sus [condiciones de uso](https://www.tdtchannels.com/aviso-legal/). openTV no está afiliado a RTVE, Atresmedia, Mediaset ni a los operadores regionales.
