# Eléctricos

Plataforma para cobrar a cada usuario la energía que usa al cargar su vehículo eléctrico. Cada usuario tiene una tarjeta RFID que lo identifica y habilita la carga; el consumo se suma a su cuenta (pospago en expensas, o prepago con saldo).

- **Servidor central OCPP 1.6J** (Node, WebSocket): los cargadores se conectan a `wss://electricos.infratec.com.uy/ocpp/<id-del-cargador>`.
- **API REST** (Fastify + PostgreSQL): sitios, cargadores, cuentas, tarjetas, tarifas, sesiones, movimientos y liquidación mensual.
- **Panel React** (Vite, kit gui-infratec con marca Infratec).
- **Simulador de cargador** para probar sin hardware.

## Estructura

```
server/   API + servidor OCPP (src/ocpp.js), migraciones SQL, pruebas
web/      panel de administración React
sim/      simulador de cargador OCPP 1.6J
deploy/   configuración de PM2 y guía de despliegue
```

## Desarrollo

```bash
npm install
cp server/.env.example server/.env   # completar DATABASE_URL, JWT_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD
npm run dev:server                   # aplica migraciones, crea el admin y escucha en :3000
npm run dev:web                      # panel en :5173 con proxy a la API
npm test                             # pruebas de facturación
```

Simular una carga de 5 kWh (el cargador `SIM-01` aparece en el panel; aprobalo y asignale un sitio):

```bash
npm run sim -- --id SIM-01 --tag 04A1B2C3 --kwh 5 --speed 600 --interval 1
```

Sin `--tag` el simulador queda interactivo: `start <uid>`, `stop`, `quit`.

## Cómo funciona el cobro

1. El cargador lee la tarjeta y manda `Authorize`. Se acepta si la tarjeta existe, está activa y sin vencer, la cuenta está activa, el cargador está aprobado y pertenece al mismo sitio (o a esa cochera), y en prepago hay saldo.
2. `StartTransaction` abre una sesión con la lectura inicial del medidor. Si el sitio tiene límite de corriente, se reparte entre las cargas activas con `SetChargingProfile`.
3. `MeterValues` guarda lecturas; `StopTransaction` cierra la sesión.
4. La energía se valoriza por tramo según la tarifa (precio normal o valle, en hora de Montevideo) más el cargo por sesión, y se registra un movimiento negativo en la cuenta.
5. A fin de mes, **Liquidación** exporta un CSV por cuenta para las expensas.

## Configurar un cargador real

En la configuración del cargador (app o web del fabricante):

- Protocolo: OCPP 1.6J
- URL del servidor central: `wss://electricos.infratec.com.uy/ocpp/`
- Identificador (Charge Point ID / Charge Box ID): uno único, por ejemplo el número de serie
- Si se definió `OCPP_PASSWORD`, usuario = identificador y contraseña = `OCPP_PASSWORD` (Security Profile 1)

El cargador aparece en **Cargadores** como pendiente; se aprueba, se le asigna sitio y queda operativo. Con **Sincronizar tarjetas** se le envía la lista local para que siga autorizando sin internet.

Despliegue: ver [deploy/DEPLOY.md](deploy/DEPLOY.md).
