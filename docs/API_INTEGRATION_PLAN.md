# Plan de Implementación: Integración API REST

## Visión General

Este documento describe el plan para integrar la app Android FriendlyPOS con el backend NodeJS existente a través de API REST.

## Estado Actual

### Lo Implementado (listo)

- **UI**: Pantallas Compose + XML para Products, Inventory, Customers, Sales, Payments, Reports, Notifications
- **Modelo de datos**: Product, Customer, Sale, SaleReport, Notification
- **Datos**: Todos hardcoded en `DummyDataRepository.kt`

### Lo que Falta

- **Integración API REST** - NO existe cliente HTTP
- **Autenticación con Firebase** - NO implementada en código
- **Comunicación con Backend NodeJS** - Sin conectar

## Stack Tecnológico

| Componente | Tecnología |
|------------|-------------|
| HTTP Client | Retrofit 2.9.0 + OkHttp 4.12.0 |
| JSON Parser | Gson |
| Auth | Firebase Auth |
| Base URL | `.env` (http://localhost:3001) |

## Arquitectura

```
app/src/main/java/cl/friendlypos/mypos/
├── api/
│   ├── ApiClient.kt           # Singleton Retrofit
│   ├── ApiConfig.kt          # BASE_URL desde .env
│   ├── ApiService.kt         # Definición de endpoints
│   └── dto/                 # Data Transfer Objects
│       ├── ProductDto.kt
│       ├── CustomerDto.kt
│       ├── SaleDto.kt
│       └── ...
├── repository/
│   ├── ProductRepository.kt
│   ├── CustomerRepository.kt
│   ├── SaleRepository.kt
│   ├── ReportRepository.kt
│   ├── InvoicingRepository.kt
│   └── NotificationRepository.kt
└── compose/viewmodel/        # Actualizar existentes
```

## Endpoints a Integrar

### Módulo: Products

| Endpoint | Método | Descripción |
|----------|--------|-------------|
| `/api/products` | GET | Lista todos los productos |

### Módulo: Customers

| Endpoint | Método | Descripción |
|----------|--------|-------------|
| `/api/customers` | GET | Lista todos los clientes |

### Módulo: Sales

| Endpoint | Método | Descripción |
|----------|--------|-------------|
| `/api/sales` | POST | Crear nueva venta |
| `/api/sales/by-ticket/:ticketNumber` | GET | Buscar venta por ticket |
| `/api/sales/quotes` | POST | Crear cotización |
| `/api/sales/quotes` | GET | Lista cotizaciones |

### Módulo: Cashbox

| Endpoint | Método | Descripción |
|----------|--------|-------------|
| `/api/cashbox/session` | GET | Obtener sesión de caja |
| `/api/cashbox/session` | POST | Abrir/cerrar caja |
| `/api/cashbox/fund` | POST | Agregar fondo |

### Módulo: Reports

| Endpoint | Método | Descripción |
|----------|--------|-------------|
| `/api/reports/sales` | GET | Ventas por período |
| `/api/reports/summary` | GET | Resumen de ventas |

### Módulo: Notifications

| Endpoint | Método | Descripción |
|----------|--------|-------------|
| `/api/notifications` | GET | Lista notificaciones |

### Módulo: Invoicing (DTE)

| Endpoint | Método | Descripción |
|----------|--------|-------------|
| `/api/invoicing/emit` | POST | Emitir DTE |
| `/api/invoicing/status/:token` | GET | Consultar estado DTE |
| `/invoicing/api/save-config` | POST | Guardar configuración |

### OpenFactura (SDK PHP)

| Endpoint | Método | Descripción |
|----------|--------|-------------|
| `POST /dte/emit` | POST | Emitir DTE (boleta/factura) |
| `GET /dte/status/:token` | GET | Estado del DTE |
| `GET /taxpayer/:rut` | GET | Datos del contribuyentes |

## ViewModels a Actualizar

1. **ProductsViewModel** → usar ProductRepository
2. **InventoryViewModel** → usar ProductRepository (stock)
3. **CustomersViewModel** → usar CustomerRepository
4. **SalesCalculatorViewModel** → usar SaleRepository
5. **PaymentsViewModel** → usar SaleRepository + CashboxRepository
6. **ReportsViewModel** → usar ReportRepository
7. **NotificationsViewModel** → usar NotificationRepository
8. **BillingViewModel** → usar InvoicingRepository (NUEVO)

## Autenticación

### Flujo:
1. Usuario login con Firebase Auth
2. Obtener ID token de Firebase
3. Incluir en header: `Authorization: Bearer <id_token>`

### Notas:
- El backend usa sesiones Express
- Tienda (store_id) se obtiene del usuario logueado
- Para DTE se还需要 OpenFactura API key

## DTE - Facturación Electrónica

### Tipos de Documentos:
- **Boleta Electrónica** - Venta minorista
- **Factura Electrónica** - Venta con rut contribuyente

### Flujo:
1. Crear venta en `/api/sales`
2. Enviar a OpenFactura `/dte/emit`
3. Consultar estado `/dte/status/:token`
4. Generar PDF del DTE

## Implementación por Fases

### Fase 1: Productos + Inventory
- Agregar dependencias HTTP
- Crear ApiClient
- Crear ProductRepository
- Actualizar ProductsViewModel
- Actualizar InventoryViewModel

### Fase 2: Customers + Sales
- Crear CustomerRepository
- Crear SaleRepository
- Actualizar CustomersViewModel
- Actualizar SalesCalculatorViewModel

### Fase 3: Payments + Cashbox
- Crear CashboxRepository
- Actualizar PaymentsViewModel

### Fase 4: Reports + Notifications
- Crear ReportRepository
- Crear NotificationRepository
- Actualizar ReportsViewModel
- Actualizar NotificationsViewModel

### Fase 5: DTE (Facturación)
- Crear InvoicingRepository
- Crear BillingViewModel
- Integrar con OpenFactura SDK

## Consideraciones

### Offline
- Implementar caché local con Room para modo offline
- Sincronizar cuando hay conexión

### Seguridad
- NO exponer API keys en código
- Usar Firebase Auth para login

### Errores
- Manejar timeouts (30 segundos)
- Mostrar mensajes de error claros al usuario

## Referencias

- Backend NodeJS: `D:\nodejs\friendlypos_nodejs\`
- Documentación endpoints: `D:\nodejs\friendlypos_nodejs\docs\routing\routing.md`
- OpenFactura SDK: `D:\laragon\www\sr-haulmer\`
- .env: `.env` (BASE_URL_BACKEND=http://localhost:3001)

---

*Documento generado: 2026-04-26*