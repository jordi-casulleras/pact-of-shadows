# Pact of Shadows

Juego de bazas con apuesta exacta, ambientado en ninjas, para navegador. Un jugador contra 1 a 5 bots, o multijugador online con salas de 2 a 6 jugadores.

## Comandos

| Comando | Qué hace |
| --- | --- |
| `npm run dev` | Arranca el juego en http://localhost:5173 |
| `npm test` | Tests del motor de reglas y de los bots |
| `npm run typecheck` | Comprobación de tipos |
| `npm run build` | Build de producción en `dist/` |
| `npm run sim` | Torneo bot contra bot (200 partidas por emparejamiento) |
| `npm run e2e` | Partidas completas en un navegador automatizado; necesita `npm run dev` en marcha y `npx playwright install chromium` |
| `npm run deploy:fn` | Empaqueta el servidor de salas y lo despliega en Supabase; necesita `npx supabase login` y `npx supabase link --project-ref REF` una vez |

## Estructura

- `src/engine/`: reglas puras (mazo, bazas, puntuación, reductor de partida). Sin dependencias de interfaz.
- `src/ai/`: bots de tres niveles y el torneo para compararlos.
- `src/app/`: sonido sintetizado, preferencias y guardado de la partida en el navegador.
- `src/net/`: multijugador. Lógica de salas del servidor (`room.ts`, `handler.ts`, `store.ts`), su entrada como Edge Function (`edge.ts`) y cliente del navegador (`client.ts`).
- `supabase/`: la migración de la tabla `rooms` y la configuración de la función `room`. `supabase/functions/room/index.ts` se genera con `npm run build:fn` y no se versiona.
- `src/i18n/`: textos en español e inglés.
- `src/ui/`: interfaz en React. Las ilustraciones de las cartas son SVG en `src/ui/Art.tsx`.
- `e2e/`: pruebas en navegador con Playwright.

Parámetros de URL para pruebas: `?seed=123` fija el reparto, `?speed=6` acorta las esperas `?gallery=1` muestra todas las cartas y `?rounds=2` acorta las partidas online.

## Multijugador

Quien crea una sala recibe un código de 5 caracteres; los demás lo escriben en «Unirse a sala» o abren el enlace `?room=CÓDIGO`. El anfitrión puede rellenar asientos con bots y empieza la partida.

El servidor es una Edge Function de Supabase (`room`) que guarda cada sala en la tabla `rooms` de Postgres. Guarda todas las manos y a cada jugador solo le envía la suya. La tabla está cerrada a la clave pública: solo la función puede leerla.

Nadie se registra, pero cada navegador inicia una sesión anónima de Supabase la primera vez que entra al multijugador. Esa sesión es su identidad (lo que le devuelve su asiento tras recargar) y la función rechaza cualquier llamada que no la traiga. El inicio de sesión pasa por un CAPTCHA de Cloudflare Turnstile, casi siempre invisible, para que un script no pueda conseguir sesiones.

Los navegadores no preguntan por el estado en bucle. Cuando alguien actúa, la función envía a cada jugador su vista por Supabase Realtime, en un canal privado `room:CÓDIGO:ID_DE_USUARIO` que solo ese usuario puede escuchar y en el que solo la función puede escribir. Solo se llama a la función para:

- actuar (crear, unirse, apostar, jugar una carta...);
- despertar al servidor cuando le toca mover a él (un bot, el cambio de ronda): cada vista dice en cuántos milisegundos (`wakeIn`) y los jugadores se turnan para que baste una petición;
- dar señales de vida cada 20 segundos, que también recupera cualquier aviso perdido. Quien calla 45 segundos aparece como ausente y a los 60 un bot juega por él.

La URL del proyecto, su clave pública (`sb_publishable_...`) y la clave de sitio de Turnstile se leen de `.env.local`, que no se versiona: copia `.env.example` y rellénalo. El repositorio no contiene ninguna referencia al proyecto de Supabase. `npm run dev` usa el mismo proyecto de Supabase que producción: no hay servidor de salas local.

## Desplegar

- **Web (Vercel)**: importa el repositorio. Solo sirve archivos estáticos. En **Settings → Environment Variables** define `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` y, si usas CAPTCHA, `VITE_TURNSTILE_SITE_KEY`; sin ellas el multijugador responde «El servidor de salas no está disponible».
- **Servidor (Supabase)**: tras cambiar algo en `src/engine/`, `src/ai/` o `src/net/`, ejecuta `npm run deploy:fn`. Los cambios de esquema van en `supabase/migrations/`.

### Ajustes del proyecto de Supabase

Se hacen una vez en el panel, no están en el código:

1. **Authentication → Sign In / Providers**: activar *Allow anonymous sign-ins*.
2. **Authentication → Attack Protection**: activar la protección con CAPTCHA, proveedor Turnstile, con la clave secreta del widget creado en Cloudflare. La clave de sitio va en `VITE_TURNSTILE_SITE_KEY` (`.env.local` y Vercel).
3. **Realtime → Settings**: desactivar *Allow public access*, para que solo existan canales privados.

Con el CAPTCHA activo, `npm run e2e` no puede entrar al multijugador desde un navegador automatizado contra este proyecto.
