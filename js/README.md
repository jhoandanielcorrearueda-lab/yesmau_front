# Arquitectura MVC

La aplicación conserva JavaScript vanilla y organiza sus responsabilidades así:

## Modelos (`models/`)

- `apiModel.js`: autenticación, usuarios, roles, seguridad y auditoría.
- `appModel.js`: pedidos, inventario, ventas, configuración de módulos y datos persistidos.
- `operationsModel.js`: materias primas, incidencias, costos de prendas, retazos, adjuntos y conectores de correo/IA.
- `storageModel.js`: acceso seguro a `localStorage` y formato monetario COP.

Los modelos no renderizan HTML ni registran eventos de interfaz.

## Vistas (`views/`)

- `domView.js`: acceso al DOM, colección de elementos, iconos SVG y escape de contenido.
- `operationsView.js`: plantillas accesibles de los módulos operativos, sin lógica de persistencia.

La vista concentra utilidades de presentación y evita que los modelos dependan del navegador visual.

## Controladores (`controllers/`)

- `appController.js`: navegación, eventos, formularios, modales, coordinación entre modelos y vistas, y selección de la plantilla correspondiente.

## Entrada

- `main.js`: ejecuta únicamente el arranque de la aplicación mediante `bootstrap()`.
