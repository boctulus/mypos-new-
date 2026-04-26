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
| Auth | Firebase Auth — `TokenProvider` caché + `Authorization: Bearer` |
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

## Autenticación — Firebase Auth

### TokenProvider (caché en memoria + mutex anti-race-condition)

Múltiples requests concurrentes (ej: 10 a la vez) pueden detectar el token null/expirado
simultáneamente y lanzar 10 refreshes en paralelo contra Firebase. El `Mutex` garantiza
que solo un refresh ocurra a la vez; los demás esperan y reusan el resultado.

```kotlin
object TokenProvider {
    @Volatile private var cachedToken: String? = null
    private val refreshMutex = Mutex()

    suspend fun getToken(forceRefresh: Boolean = false): String? {
        if (cachedToken != null && !forceRefresh) return cachedToken

        return refreshMutex.withLock {
            // double-check dentro del lock
            if (cachedToken != null && !forceRefresh) return@withLock cachedToken

            val token = FirebaseAuth.getInstance()
                .currentUser?.getIdToken(forceRefresh)?.await()?.token
            cachedToken = token
            token
        }
    }
}
```

- `AuthInterceptor` lee `TokenProvider.cachedToken` (no `runBlocking`, no bloquea OkHttp)
- `TokenRefreshInterceptor` ante 401: `getToken(forceRefresh = true)` + retry
- Si el retry falla → propagar error

### OkHttp

```kotlin
OkHttpClient.Builder()
    .connectTimeout(10, TimeUnit.SECONDS)
    .readTimeout(30, TimeUnit.SECONDS)
    .writeTimeout(30, TimeUnit.SECONDS)
    .addInterceptor(AuthInterceptor())
    .addInterceptor(TokenRefreshInterceptor())
    .addInterceptor(RetryInterceptor(maxRetries = 2))  // solo errores de red, nunca 4xx
    .addInterceptor(HttpLoggingInterceptor().apply { level = Level.BODY })  // solo debug
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

## Fases de Implementación

### Fase 0: Infraestructura base
- Agregar `buildConfig = true` + `buildConfigField` en `build.gradle.kts`
- `ApiConfig.kt`, `TokenProvider.kt`
- `ApiClient.kt` con `AuthInterceptor` + `TokenRefreshInterceptor` + timeouts
- `ConnectivityObserver.kt`

### Fase 1: Productos + Inventario
- `ApiService` con `GET /api/products`
- `ProductDto.kt`, `ProductRepository.kt`
- Actualizar `ProductsViewModel`, `InventoryViewModel`

### Fase 2: Customers + Sales
- `ApiService` con `GET /api/customers`, `POST /api/sales`, `GET /api/sales/*`
- `CustomerDto.kt`, `SaleDto.kt`
- `CustomerRepository.kt`, `SaleRepository.kt`
- `SalePendingQueue.kt`
- Actualizar `CustomersViewModel`, `SalesCalculatorViewModel`

### Fase 3: Payments + Cashbox
- `ApiService` con `GET/POST /api/cashbox/*`
- `CashboxDto.kt`, `CashboxRepository.kt`
- Actualizar `PaymentsViewModel`

### Fase 4: Reports + Notifications
- `ReportRepository.kt`, `NotificationRepository.kt`
- Actualizar `ReportsViewModel`, `NotificationsViewModel`

### Fase 5: DTE (async)
- `InvoicingDto.kt` con `job_id` y `DteStatus`
- `InvoicingRepository.kt` con polling + backoff
- `BillingViewModel` con `DteState`
- UI no bloqueante

### Fase 6: Room / Offline full — FUERA DE SCOPE (MVP)

---

## Verificación

- App compila con `BuildConfig.BASE_URL_BACKEND` inyectado
- `GET /api/products` retorna datos reales (no `DummyDataRepository`)
- Header `Authorization: Bearer <token>` presente en todas las requests (OkHttp LoggingInterceptor)
- Token expirado → `TokenRefreshInterceptor` refresca y reintenta automáticamente
- Sale fallida por red → `SalePendingQueue` en `PENDING`, se sincroniza al reconectar
- DTE: POST devuelve `job_id`, polling con backoff visible en UI, no se congela
- Ningún ViewModel llama a `DummyDataRepository` en producción

---

## Referencias

- Backend NodeJS: `D:\nodejs\friendlypos_nodejs\`
- Documentación endpoints: `D:\nodejs\friendlypos_nodejs\docs\routing\routing.md`
- OpenFactura SDK: `D:\laragon\www\sr-haulmer\`
- BASE_URL en build: `app/build.gradle.kts` (no leer `.env` en runtime)

---

*Documento actualizado: 2026-04-26*
