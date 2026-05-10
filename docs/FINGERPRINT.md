# 📘 Arquitectura de Activación de Dispositivos POS Android desde Dashboard Web

Este documento consolida una estrategia robusta, multi-tenant y compatible con Android moderno para registrar, activar, gestionar y proteger terminales POS desde un panel web, evitando dependencias de APIs obsoletas y garantizando operatividad en entornos retail reales.

---

## 1. El Problema Real vs. La Trampa del `SERIAL`

El desafío no es “cómo detectar el serial”, sino cómo resolver sistemáticamente:
1. Generar una identidad estable del dispositivo.
2. Evitar spoofing/clonado.
3. Mantener compatibilidad entre fabricantes POS Android.
4. Activar/desactivar remotamente.
5. Sobrevivir a reinstalaciones/factory reset.
6. Evitar APIs deprecated o bloqueadas por Google.

### ⚠️ El error arquitectónico potencial
Basar el licensing en `Build.SERIAL` o similares es insostenible desde Android 10+:
- `Build.SERIAL` está deprecated.
- `Build.getSerial()` requiere permisos privilegiados (`android.permission.READ_PHONE_STATE` + signature/privileged).
- OEMs modifican Android: devuelven `"unknown"`, seriales vacíos, repetidos o inaccesibles.
- Algunos SDKs OEM exponen seriales, otros no, otros exigen app de sistema.

👉 **Consecuencia:** Si el licensing depende SOLO del serial físico, el soporte técnico será infinito.

---

## 2. Principios Arquitectónicos Fundamentales

| Principio | Descripción |
|-----------|-------------|
| **Separación de responsabilidades** | Identidad física ≠ Activación/Licencia ≠ Pertenencia al tenant/store |
| **Tenancy server-side** | El hardware **no decide** a qué tienda pertenece. El backend asigna `store_id`. |
| **POS agnóstico** | El dispositivo no debe conocer `owner_id`, `manager`, `tenant` ni lógica de billing. |
| **Autenticación dual** | `Device Token` (terminal) ↔ `Employee Session` (operador humano). Son entidades distintas. |
| **Sin comunicación directa Dashboard ↔ POS** | Siempre: `Dashboard → Backend ← POS` |

---

## 3. Identidad del Dispositivo: UUID + Fingerprint Híbrido

### ✅ `device_uuid` (Identidad Persistente)
- Generado una vez: `UUID.randomUUID()`
- Almacenado en `EncryptedSharedPreferences` o `Room`
- **Nunca cambia** (salvo borrado manual de app/storage)
- Es el identificador primario en el sistema.

### 🔍 `device_fingerprint_hash` (Antifraude & Recuperación)
- Calculado dinámicamente en cada arranque.
- Fórmula híbrida (NO dependas de una sola fuente):
```kotlin
val androidId = Settings.Secure.getString(contentResolver, Settings.Secure.ANDROID_ID)
val fingerprint = listOf(
    androidId,
    Build.BRAND,
    Build.MODEL,
    Build.MANUFACTURER,
    Build.HARDWARE
).joinToString("|")

val deviceHash = sha256(fingerprint)
```
- **Regla crítica:** NUNCA guardes `ANDROID_ID` raw. Siempre haséalo.
- Sirve para: detección de clones, recuperación tras reinstalación, validación de integridad.

### 🛡️ Estrategia Extensible de Fingerprint
```kotlin
interface FingerprintStrategy {
    fun generate(context: Context): String
}

// Implementaciones
class AndroidIdFingerprintStrategy : FingerprintStrategy { ... }
class SunmiFingerprintStrategy : FingerprintStrategy { ... }
class UrovoFingerprintStrategy : FingerprintStrategy { ... }
class CompositeFingerprintStrategy(private val strategies: List<FingerprintStrategy>) : FingerprintStrategy { ... }
```
Esto garantiza compatibilidad con SUNMI, UROVO, PAX, Android stock, etc., sin acoplar APIs OEM al resto del sistema.

---

## 4. Flujo de Activación (Pairing Temporal)

Inspirado en Stripe Terminal, Shopify POS y MercadoPago POS.

### 📱 1. POS Android (Primer arranque)
1. Genera `device_uuid` y calcula `fingerprint_hash`.
2. Envía a `POST /api/pos/devices/register`:
```json
{
  "device_uuid": "...",
  "fingerprint_hash": "...",
  "manufacturer": "SUNMI",
  "model": "V2"
}
```
3. Backend devuelve:
```json
{
  "activation_code": "A7KD92",
  "expires_in": 300
}
```
*(Código corto, aleatorio, expira en 5 min)*

### 💻 2. Dashboard Web
1. Owner/manager autenticado navega a `Activar dispositivo POS`.
2. Introduce `A7KD92`.
3. Dashboard llama a: `POST /api/dashboard/pos-devices/activate`
```json
{
  "activation_code": "A7KD92"
}
```

### ⚙️ 3. Backend
- Resuelve `activation_code → pending_device`.
- Asocia automáticamente `store_id` (derivado del contexto JWT del manager) con `device_uuid`.
- Invalida el código de activación.

### 📲 4. POS obtiene Token
- POS intercambia código por JWT: `POST /api/pos/devices/token`
```json
{
  "device_uuid": "...",
  "fingerprint_hash": "..."
}
```
- Backend devuelve `device_token` (JWT con `type: "pos_device"`).

---

## 5. Diseño de Base de Datos

### `stores`
```sql
id          UUID PK
owner_id    UUID
name        VARCHAR
created_at  TIMESTAMP
```

### `pos_devices`
```sql
id                UUID PK
store_id          UUID FK
device_uuid       VARCHAR UNIQUE
device_hash       VARCHAR
device_name       VARCHAR
manufacturer      VARCHAR
model             VARCHAR
android_id_hash   VARCHAR
status            VARCHAR (pending, active, revoked, cloned)
last_seen_at      TIMESTAMP
activated_at      TIMESTAMP
revoked_at        TIMESTAMP
license_valid_until TIMESTAMP  -- Offline grace period
```

### `pos_activation_codes`
```sql
code        VARCHAR PK
device_uuid UUID FK
expires_at  TIMESTAMP
used_at     TIMESTAMP NULL
```

---

## 6. Arquitectura de la API (Backend)

Separación estricta por consumidor, middleware, rate limits y scopes JWT.

### 🟢 `/api/pos/*` → Solo Android POS
| Método | Ruta | Descripción |
|--------|------|-------------|
| `POST` | `/register` | Registro pendente + generación de activation code |
| `POST` | `/token`    | Intercambio de código por JWT device |
| `POST` | `/heartbeat`| Reporte de estado, batería, red |

### 🔵 `/api/dashboard/*` → Solo Web Admin
| Método | Ruta | Descripción |
|--------|------|-------------|
| `POST` | `/pos-devices/activate` | Vincula código con `store_id` |
| `POST` | `/pos-devices/revoke`   | Desactiva terminal remotamente |
| `GET`  | `/pos-devices`          | Listado, filtros, estado en tiempo real |

### 🔑 Diferenciación de Tokens JWT
**Dashboard JWT:**
```json
{ "user_id": 1, "store_id": 10, "role": "manager" }
```
**POS JWT:**
```json
{ "device_id": 55, "store_id": 10, "type": "pos_device" }
```

---

## 7. Implementación en Android: Módulo `:device-core`

Encapsula toda la lógica de identidad, activación, seguridad y heartbeat. **No debe conocer lógica de negocio del tenant.**

### 📁 Estructura (Clean Architecture)
```
:device-core
├── domain/
│   ├── models/
│   ├── repositories/
│   ├── services/
│   └── usecases/
├── data/
│   ├── local/      (Room, EncryptedSharedPreferences)
│   ├── remote/     (Retrofit/ktor clients)
│   ├── dto/
│   └── mappers/
├── security/
│   ├── fingerprint/
│   ├── crypto/
│   └── token/
├── activation/
│   ├── pairing/
│   ├── session/
│   └── licensing/
└── heartbeat/
```

### 🔌 Interfaces Clave
```kotlin
interface DeviceManager {
    fun getDeviceUuid(): String
    fun getFingerprintHash(): String
    fun getDeviceInfo(): DeviceInfo
}

interface ActivationRepository {
    suspend fun registerDevice(): ActivationResponse
    suspend fun activate(code: String): DeviceSession
}

interface DeviceAuthManager {
    fun getToken(): String?
    fun isActivated(): Boolean
}

data class DeviceInfo(
    val uuid: String,
    val fingerprintHash: String,
    val manufacturer: String,
    val model: String,
    val androidVersion: String,
    val appVersion: String
)
```

### 💾 Persistencia
- **Room:** Estado de activación, tokens, último heartbeat, offline grace period, metadata.
- **EncryptedSharedPreferences:** Private keys, refresh tokens, identificadores sensibles.

---

## 8. Resiliencia y Operaciones en Producción

### 📡 Heartbeat (Cada 30-60s)
```json
{
  "device_uuid": "...",
  "app_version": "2.1.0",
  "battery": 82,
  "network": true,
  "last_sale_at": "2026-05-09T14:22:00Z"
}
```
Permite desde el Dashboard:
- Ver online/offline en tiempo real.
- Bloquear dispositivos comprometidos.
- Detectar POS abandonados o fuera de línea crónica.

### 🛡️ Offline Grace Period (Crítico para Retail)
Si el backend falla, el POS **no debe morir**.
- Implementar `license_valid_until` (ej. 72 horas).
- Validación híbrida: `online preferred`, `offline temporal allowed`.
- Evita paradas de caja por fallos de DNS, AWS o internet.

### 🔍 Detección de Clones & Recuperación
- **Clonado:** `stored_fingerprint != current_fingerprint` → Invalidar licencia y alertar.
- **Reinstalación/Reset:** Mismo `fingerprint` + `model` + `manufacturer` → Prompt: `¿Desea recuperar la licencia anterior?`

---

## 9. Separación de Responsabilidades

| Sistema   | Responsabilidad Principal                          |
|-----------|----------------------------------------------------|
| **Android** | Identidad hardware, sesión terminal, heartbeat, validación offline |
| **Backend** | Activación, tenancy (`store_id`), seguridad, revocación, auditoría |
| **Dashboard** | Administración UI, visualización en tiempo real, gestión de flota |

---

## 10. Conclusión

La solución **no** es detectar un `SERIAL ID` OEM. La arquitectura correcta se basa en:
✅ Generar identidad propia (`device_uuid` + `fingerprint_hash`)  
✅ Pairing temporal mediante activation code corto  
✅ Asociación server-side por `store_id`  
✅ Separación estricta de APIs y JWT (Device vs User)  
✅ Heartbeat + Offline Grace Period para resiliencia retail  

### Beneficios directos:
- Compatibilidad universal Android (sin depender de OEMs)
- Arquitectura enterprise escalable
- Reducción drástica de soporte técnico
- UX limpia (códigos cortos vs seriales ilegibles)
- Preparado para: licencias por terminal, cobro por dispositivo, fleet management, MDM futuro y auditoría completa.

> 📦 **Recomendación final:** Encapsula todo en `:device-core` (Android) y `modules/pos-devices` (Backend). Mantén el Dashboard como una capa puramente administrativa. El hardware informa, el backend decide.
