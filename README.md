# WaitList VIP

App local de lista de espera. Requiere Node.js 18 o superior (Node 24 ya está instalado en este equipo).

## Ejecutar

En esta carpeta, abre PowerShell y ejecuta:

```powershell
$env:ADMIN_PASSWORD='elige-una-contrasena-segura'
node server.js
```

Luego abre `http://localhost:3000`. El panel está en `http://localhost:3000/admin.html` y la pantalla TV en `http://localhost:3000/display.html`.

Los registros quedan guardados en `data/waitlist.json`. Para publicar la app, configura `ADMIN_PASSWORD` en las variables privadas del servicio de hosting; no la incluyas en el código.
