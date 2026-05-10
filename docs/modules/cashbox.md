# Módulo: Cashbox (Caja)

## Archivos

| Archivo | Rol |
|---|---|
| `api/dto/CashboxDto.kt` | DTOs de caja: `CashboxItemDto`, `StoreDto`, respuestas |
| `api/dto/CashboxSessionDto.kt` | DTOs de sesión: `CashboxSessionItemDto`, `SessionsListResponseDto` |
| `api/ApiService.kt` | `getSessions`, `getCurrentCashboxSession`, `openCashboxSession`, `closeCashboxSession` |
| `repository/CashboxRepository.kt` | `getAllOpenSessions`, `getCurrentSession`, `openSession`, `closeSession`, `getActiveCashboxes` |
| `compose/viewmodel/CashboxViewModel.kt` | StateFlows + lógica de caja |
| `ui/cashbox/CashboxFragment.kt` | Host Compose, Activity-scoped ViewModel |
| `compose/screen/CashboxScreen.kt` | Routing por rol + pantalla cierre cajero |
| `compose/screen/CashboxOpenScreen.kt` | Apertura de sesión (cajero) |
| `compose/screen/CashboxSupermarketScreen.kt` | Vista de todas las sesiones abiertas (supermarket) |

---

## Estado del ViewModel

| StateFlow | Tipo | Descripción |
|---|---|---|
| `currentSession` | `CashboxSessionItemDto?` | Sesión activa del usuario actual. `null` si no hay sesión o aún carga |
| `allOpenSessions` | `List<CashboxSessionItemDto>` | Todas las sesiones abiertas de la tienda |
| `cashboxes` | `List<CashboxItemDto>` | Todas las cajas activas de la tienda |
| `availableCashboxes` | `List<CashboxItemDto>` | Cajas sin sesión abierta (derivado de `cashboxes` - `allOpenSessions`) |
| `hasInitialLoadCompleted` | `Boolean` | `true` una vez que `loadCurrentSession` completó al menos una vez |

---

## Routing de pantalla por rol

```
role == "supermarket"             → CashboxSupermarketScreen (todas las sesiones abiertas)
role == "cashier" + sesión abierta → CashboxCloseContent (cerrar propia sesión)
role == "cashier" + sin sesión     → CashboxOpenScreen (abrir sesión en caja disponible)
```

---

## Reglas

- `availableCashboxes` = cajas activas cuyo `serialNumber` NO aparece en ninguna sesión de `allOpenSessions`
- `isSessionOpen` en `HomeFragment` usa `hasInitialLoadCompleted` para distinguir "cargando" de "sin sesión"
  - `!hasLoaded` → `null` (ambos botones deshabilitados, estado loading)
  - `currentSession?.status == "open"` → `true` (Cerrar habilitado)
  - else → `false` (Abrir habilitado)
- `HomeFragment.onResume()` llama `refreshStoreState(storeId)` para mantener estado actualizado al volver a Inicio
- `CashboxFragment.LaunchedEffect(storeId)` carga cashboxes y sesiones abiertas al entrar al módulo

---

## Endpoints usados

| Endpoint | Método | Propósito |
|---|---|---|
| `api/firestore/cashbox/user-stores` | GET | Tiendas del usuario |
| `api/cashbox/cashboxes?filter=store_id:X,status:active` | GET | Cajas activas de la tienda |
| `api/firestore/cashbox/sessions?store_id=X&status=open` | GET | Todas las sesiones abiertas |
| `api/firestore/cashbox/sessions/current` | GET | Sesión activa del usuario autenticado |
| `api/firestore/cashbox/sessions` | POST | Abrir sesión |
| `api/firestore/cashbox/sessions/{id}/close` | PATCH | Cerrar sesión |

---

## `closeSession` — manejo unificado

Un único método en el ViewModel cierra tanto la sesión propia (cajero) como la de otros (supermarket):

- Si `sessionId == currentSession.id` → actualiza `_currentSession`
- Siempre filtra `_allOpenSessions` eliminando la sesión cerrada
- Para cajero: `CashboxFragment.LaunchedEffect(successMessage)` detecta `role == "cashier"` y hace logout
- Para supermarket: no hay logout, solo se actualiza la lista
