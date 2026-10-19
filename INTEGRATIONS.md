# Integraciones operativas de YESMAU

La aplicación actual no incluye un servidor propio. Los registros funcionales se guardan en `localStorage` y los adjuntos de incidencias en IndexedDB (`yesmau_files`). Estos datos pertenecen al navegador y al origen actual; no se sincronizan entre dispositivos.

## Correo de incidencias

Administración puede configurar el endpoint desde **Incidencias → Configuración del correo de incidencias**.

El endpoint recibe:

```json
{
  "template": "incident-confirmation",
  "to": "cliente@correo.com",
  "incident": {
    "code": "INC-000001",
    "title": "Título",
    "status": "Abierta",
    "createdAt": "2025-01-01T00:00:00.000Z"
  }
}
```

Debe responder con un estado HTTP exitoso (`2xx`). Las credenciales del proveedor de correo deben permanecer en el servidor o proxy, nunca en el navegador. Sin endpoint, la incidencia se conserva y la interfaz informa que el correo no fue enviado.

## IA para sugerencias de retazos

Administración puede configurar el endpoint y las reglas desde **Retazos inteligentes → Configuración de IA para retazos**.

El endpoint recibe:

```json
{
  "task": "scrap-product-suggestions",
  "context": {
    "fabricType": "Lino",
    "material": "100% lino",
    "sizeMeters": 0.8,
    "shape": "Rectangular",
    "pieces": 1
  },
  "rules": "Reglas configuradas por Administración"
}
```

Debe responder directamente con un arreglo o con `{ "suggestions": [] }`. Cada sugerencia admite:

```json
{
  "productName": "Bolsa mediana",
  "requiredSize": "0.55 m",
  "difficulty": "baja",
  "description": "Descripción verificable de la propuesta",
  "visualUrl": "https://...",
  "viability": 82
}
```

El navegador cancela la solicitud a los 2 segundos. No se generan respuestas locales simuladas cuando el endpoint no está configurado o falla.

El chat integrado usa el mismo endpoint con `task: "fabric-utilization-chat"`, el contexto de un retazo registrado o de una cantidad de tela ingresada, las reglas administrativas, hasta diez mensajes previos, el campo `message` y una lista `requestedAnalysis`. Esta lista solicita productos viables, consumo aproximado, retazos probables y opciones para aprovecharlos. Debe responder:

```json
{
  "reply": "Respuesta generada por el proveedor configurado"
}
```

El chat solo aparece dentro de una sesión de Administrador o Empleado.

## Verificación manual

1. **Materias primas:** registra un código nuevo y luego intenta repetirlo; el segundo registro debe rechazarse.
2. **Incidencias:** inicia sesión como Cliente o Empleado y crea una incidencia con y sin adjuntos. Confirma el registro en la lista y los blobs en IndexedDB. Sin endpoint debe indicarse que no se envió correo.
3. **Precios:** selecciona una prenda, completa costos y margen, y comprueba que el precio cambie en Inventario/Tienda.
4. **Retazos:** registra primero una materia prima de categoría `tela`; crea, filtra, edita y elimina un retazo.
5. **IA:** configura un endpoint compatible, genera sugerencias y verifica orden descendente por viabilidad y las marcas seleccionada/utilizada.

Las metas de concurrencia multiusuario, persistencia centralizada y entrega real de correo/IA requieren desplegar un backend transaccional. No pueden garantizarse entre navegadores con almacenamiento local.
