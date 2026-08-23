# Rutina Aether + Elahe V2 — Push real

Esta versión usa Cloudflare Agents + Durable Objects + Web Push.

## 1) Instalar
npm install

## 2) Generar VAPID
npx web-push generate-vapid-keys

Guarda las tres variables como secretos de Cloudflare:
npx wrangler secret put VAPID_PUBLIC_KEY
npx wrangler secret put VAPID_PRIVATE_KEY
npx wrangler secret put VAPID_SUBJECT

Para VAPID_SUBJECT usa un correo tuyo, por ejemplo mailto:tu-correo@ejemplo.com

## 3) Desplegar
npm run deploy

La app se sirve desde public/ y el Worker enruta /agents/* al ReminderAgent.

## 4) Probar
Abre la URL workers.dev en Chrome Android, instala la PWA, toca Activar push y luego Probar en 10 segundos.
