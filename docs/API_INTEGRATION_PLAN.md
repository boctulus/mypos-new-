# Plan de Implementación: Integración API REST

## Arquitectura

```
Android
  └─► NodeJS Backend (única fuente de verdad: auth, lógica, fiscal)
          └─► OpenFactura (PHP SDK)
          └─► Supabase / PostgreSQL
```

Android **NUNCA** habla con OpenFactura directamente.

---

## Decisiones

| Decisión | Valor |
|---|---|
| HTTP Client | Retrofit 2.9.0 + OkHttp 4.12.0 (ya en build.gradle.kts) |
| Auth | JWT backend (`POST /api/auth/login`) — `JwtTokenStorage` + `Authorization: Bearer` + refresh via `JwtRefreshInterceptor` |
| BASE_URL | `BuildConfig.BASE_URL_BACKEND` (inyectada en build) |
| Offline full | Fuera de scope (MVP) |
| Resiliencia | `SalePendingQueue` con estados explícitos |
| DTE | Flujo async con polling + backoff progresivo |

---

## Estructura de Archivos

```
app/src/main/java/cl/friendlypos/mypos/
├── api/
│   ├── ApiClient.kt          # Singleton Retrofit con interceptores
│   ├── ApiConfig.kt          # BASE_URL desde BuildConfig
│   ├── ApiService.kt         # Todos los endpoints contra NodeJS
│   ├── AuthInterceptor.kt    # Lee TokenProvider.cachedToken
│   ├── TokenRefreshInterceptor.kt  # Maneja 401 → refresh + retry
│   ├── TokenProvider.kt      # Caché de Firebase idToken
│   └── dto/
│       ├── ProductDto.kt
│       ├── CustomerDto.kt
│       ├── SaleDto.kt
│       ├── CashboxDto.kt
│       └── InvoicingDto.kt
├── repository/
│   ├── ProductRepository.kt
│   ├── CustomerRepository.kt
│   ├── SaleRepository.kt
│   ├── CashboxRepository.kt
│   ├── ReportRepository.kt
│   ├── InvoicingRepository.kt
│   └── NotificationRepository.kt
├── queue/
│   ├── SalePendingQueue.kt   # Buffer con estados PENDING/SENDING/FAILED/SYNCED
│   └── ConnectivityObserver.kt  # Ping a /health antes de flush
└── compose/viewmodel/        # ViewModels existentes a actualizar
```

---

## Endpoints a Integrar

### Módulo: Products
| Endpoint | Método |
|---|---|
| `/api/products` | GET |

### Módulo: Customers
| Endpoint | Método |
|---|---|
| `/api/customers` | GET |

### Módulo: Sales
| Endpoint | Método |
|---|---|
| `/api/sales` | POST |
| `/api/sales/by-ticket/:ticketNumber` | GET |
| `/api/sales/quotes` | POST |
| `/api/sales/quotes` | GET |

### Módulo: Cashbox
| Endpoint | Método |
|---|---|
| `/api/cashbox/session` | GET |
| `/api/cashbox/session` | POST |
| `/api/cashbox/fund` | POST |

### Módulo: Reports
| Endpoint | Método |
|---|---|
| `/api/reports/sales` | GET |
| `/api/reports/summary` | GET |

### Módulo: Notifications
| Endpoint | Método |
|---|---|
| `/api/notifications` | GET |

### Módulo: Invoicing (DTE — async)
| Endpoint | Método | Descripción |
|---|---|---|
| `/api/invoicing/create` | POST | Inicia emisión DTE → devuelve `{ job_id }` |
| `/api/invoicing/status/:job_id` | GET | Estado: `processing \| success \| error` |
| `/api/invoicing/save-config` | POST | Guarda configuración DTE |

---

## ViewModels a Actualizar

| ViewModel | Repository |
|---|---|
| `ProductsViewModel` | `ProductRepository` |
| `InventoryViewModel` | `ProductRepository` (stock) |
| `CustomersViewModel` | `CustomerRepository` |
| `SalesCalculatorViewModel` | `SaleRepository` |
| `PaymentsViewModel` | `SaleRepository` + `CashboxRepository` |
| `ReportsViewModel` | `ReportRepository` |
| `NotificationsViewModel` | `NotificationRepository` |
| `BillingViewModel` (nuevo) | `InvoicingRepository` |

---

## Configuración de Build

`app/build.gradle.kts` — cambios requeridos:

```kotlin
android {
    buildFeatures {
        buildConfig = true   // AGREGAR
    }
    buildTypes {
        debug {
            buildConfigField("String", "BASE_URL_BACKEND", "\"http://10.0.2.2:3001\"")
        }
        release {
            buildConfigField("String", "BASE_URL_BACKEND", "\"https://api.tudominio.com\"")
        }
    }
}
```

`ApiConfig.kt` usa `BuildConfig.BASE_URL_BACKEND`. No guardar secrets aquí.

---

## Autenticación — JWT Backend

### Flujo de login

1. Android llama `POST /api/auth/login` con `{ email, password }`
2. Backend autentica con Firebase, emite `{ access_token, refresh_token, expires_in }`
3. `JwtTokenStorage.saveTokens()` persiste ambos en SharedPreferences
4. Claims (uid, email, role, store_id) se extraen del payload JWT (base64) sin librería externa
5. Se construye `UserSession` a partir de los claims

### JwtTokenStorage

- Persiste `accessToken` y `refreshToken` en SharedPreferences `"JwtTokens"`
- `isAccessTokenValid()`: decodifica `exp` claim y compara con tiempo actual (buffer 60s)
- `decodePayload()`: base64-decode del payload, deserializa con Gson a `JwtPayload`
- Inicializado en `ApiClient.init(context)` con `applicationContext`

### OkHttp — orden de interceptores

```kotlin
OkHttpClient.Builder()
    .addInterceptor(JwtAuthInterceptor())     // agrega Authorization: Bearer <token>
    .addInterceptor(JwtRefreshInterceptor())  // en 401: refresh + retry
    .addInterceptor(DebugHttpInterceptor())   // logging detallado
    .addInterceptor(HttpLoggingInterceptor()) // logging OkHttp
```

### JwtAuthInterceptor

Lee `JwtTokenStorage.getAccessToken()` y agrega `Authorization: Bearer <token>`.
Si no hay token, el request pasa sin header (endpoints públicos como `/api/auth/login`).

### JwtRefreshInterceptor

- Detecta `HTTP 401` en la respuesta
- Llama `POST /api/auth/refresh` con `{ refresh_token }` via OkHttpClient simple (sin JWT interceptors)
- Si refresh exitoso → guarda nuevos tokens, reintenta request original con nuevo token
- `synchronized(refreshLock)`: evita refreshes paralelos; thread secundario reutiliza el token ya actualizado
- Si refresh falla → devuelve el 401 original al ViewModel

### Sesión en LoginActivity

```kotlin
ApiClient.hasValidSession() // → JwtTokenStorage.isAccessTokenValid()
SessionManager.clear(context) // → borra UserSession + JwtTokenStorage
```

---

## Idempotency Keys

Para POSTs críticos (`/api/sales`, `/api/invoicing/create`):

```
X-Idempotency-Key: <sale_session_id>
```

**Scope: por intención de venta (carrito), no por request individual.**

El `sale_session_id` es un UUID generado cuando el usuario confirma el carrito,
antes del primer intento de envío. Se conserva en:
- todos los retries de red
- reconexión tras fallo
- flush de `SalePendingQueue`

Si el usuario modifica el carrito (cambia items, cancela y reinicia), se genera
un nuevo `sale_session_id`.

- Backend guarda la key y devuelve la misma respuesta si llega duplicado
- Garantiza cero duplicados y trazabilidad de la intención de venta

---

## Buffer de Ventas Pendientes

### Estados de `SalePendingQueue`

| Estado | Significado |
|---|---|
| `PENDING` | Guardada localmente, no enviada |
| `SENDING` | En proceso de envío |
| `FAILED` | Error de red, retryable |
| `SYNCED` | Enviada y confirmada |

### Persistencia

**No usar SharedPreferences para la cola** — no es fiable para listas crecientes y puede corromperse.

Estrategia: archivo `sales_queue.json` con escritura atómica:
1. Escribir en archivo temporal (`sales_queue.json.tmp`)
2. Renombrar atómicamente a `sales_queue.json`
3. Si el proceso muere a mitad → el archivo original sigue intacto

Alternativa equivalente: **DataStore Preferences** (más idiomático Android, mejor que SharedPreferences).

### Flujo

1. Sale falla por red → estado `PENDING` en `SalePendingQueue`
2. UI muestra "Venta guardada localmente, enviando..."
3. `ConnectivityObserver` detecta reconexión + **debounce de 3–5 segundos** (los callbacks de red de Android pueden disparar 5–20 eventos seguidos al cambiar de WiFi a móvil)
4. **Antes de flush**: ping a `GET /health` del backend
5. Si `/health` responde → flush de ventas `PENDING`
6. Estado transiciona `PENDING → SENDING → SYNCED | FAILED`

---

## DTE — Flujo Async

```
Android                          NodeJS Backend
  │                                    │
  ├── POST /api/invoicing/create ──────►│
  │◄─── { job_id: "abc123" } ──────────┤
  │                                    │
  │  UI: "Procesando DTE..."           │ (backend llama a OpenFactura)
  │                                    │
  ├── GET /api/invoicing/status/abc123 ►│
  │◄─── { status: "processing" } ──────┤  (polling con backoff)
  │                                    │
  ├── GET /api/invoicing/status/abc123 ►│
  │◄─── { status: "success", dte_url }─┤
  │                                    │
  │  UI: muestra / imprime DTE         │
```

### Polling con backoff progresivo

```
1s → 2s → 4s → 8s → 15s (máximo, se mantiene hasta timeout o respuesta final)
```

### Estados de BillingViewModel

```kotlin
sealed class DteState {
    object Idle : DteState()
    object Processing : DteState()
    data class Success(val dteUrl: String) : DteState()
    data class Error(val message: String) : DteState()
}
```

---

## Estado de Implementación (2026-05-17)

### ✅ Completado

| Fase | Estado |
|---|---|
| Infraestructura base (build.gradle, ApiConfig, ApiClient, Retrofit) | ✅ |
| JWT Auth: `JwtTokenStorage`, `JwtAuthInterceptor`, `JwtRefreshInterceptor` | ✅ |
| Login JWT: `AuthRepository` → `POST /api/auth/login` | ✅ |
| Productos: `ProductDto`, `ProductRepository`, `ProductsViewModel`, `InventoryViewModel` | ✅ |
| Clientes: `CustomerDto`, `CustomerRepository`, `CustomersViewModel` | ✅ |
| Pagos/Historial: `SaleDocumentDto`, `ReportRepository`, `PaymentsViewModel`, `ReportsViewModel` | ✅ |
| Caja: `CashboxRepository`, `CashboxViewModel`, DTOs completos | ✅ |
| Backend: `req.session.user` → `req.user` en `products/routes/api.js`, `sales/routes/api.js` | ✅ |
| Backend: `isAuthenticated` → `requireAnyAuth` en `routes/api/supabase.routes.js` | ✅ |

### ⏳ Pendiente

| Fase | Estado |
|---|---|
| `SalePendingQueue` (offline queue) | ⏳ |
| `ConnectivityObserver` | ⏳ |
| DTE (facturación electrónica, polling + backoff) | ⏳ |
| Room / Offline full | Fuera de scope (MVP) |

### ⚠️ Limitación conocida

- El middleware web `isAuthenticated` sigue siendo cookie-only (es correcto: solo se usa en el login HTML del panel web, no en rutas Android).

---

## Verificación

- Login JWT: `POST /api/auth/login` devuelve `access_token` + `refresh_token`
- Header `Authorization: Bearer <token>` presente en todas las requests (OkHttp LoggingInterceptor)
- Token expirado → `JwtRefreshInterceptor` refresca y reintenta automáticamente
- `GET /api/products`, `GET /api/sales` retornan datos reales con JWT
- `GET /api/supabase/customers` funciona con Bearer token
- `ApiClient.hasValidSession()` → `JwtTokenStorage.isAccessTokenValid()`

---

## Referencias

- Backend NodeJS: `D:\nodejs\friendlypos_nodejs\`
- Documentación endpoints: `D:\nodejs\friendlypos_nodejs\docs\routing\routing.md`
- OpenFactura SDK: `D:\laragon\www\sr-haulmer\`
- BASE_URL en build: `app/build.gradle.kts` (no leer `.env` en runtime)

---

*Documento actualizado: 2026-04-26*
